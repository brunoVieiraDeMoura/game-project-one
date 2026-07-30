import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useNavigate } from "react-router-dom";
import { Physics } from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GameMapSchema, type GameMap, DEFAULT_LIGHTING } from "@ragnarok/map-format";
import type { GameplayConfig } from "@ragnarok/game-data";
import { useMap } from "../map/useMap";
import { MapTerrain } from "../map/MapTerrain";
import { HexTerrain } from "../hex/HexTerrain";
import { setHexScale } from "../hex/hexGrid";
import { gridFor } from "../grid";
import { SquareTerrain } from "../grid/SquareTerrain";
import { propBlockedCellsCached } from "../grid/propCells";
import { buildHexDemo } from "../hex/hexPrefab";
import { scaleMapPositions } from "../hex/mapScale";
import { groundProps } from "../hex/groundProps";
import { PropInstance } from "../props/PropInstance";
import { Monster } from "../entities/Monster";
import { NpcWalker } from "../entities/NpcWalker";
import { previewSpawns, type PreviewSpawn } from "../entities/previewSpawns";
import { Player } from "../play/Player";
import { usePlayStore } from "../play/playStore";
import { TriggerRuntime } from "../play/TriggerRuntime";
import { GroundInteract, markerRadiusFor, PROPS_GROUP } from "../play/GroundInteract";
import { TERRAIN_GROUP } from "../play/pickGround";
import { FollowCamera } from "../play/FollowCamera";
import { useViewCenter } from "../play/useViewCenter";
import { GradientSky } from "../scene/GradientSky";
import { RetroFilter } from "../scene/RetroFilter";
import { scaleToWorld, useGameplayConfig } from "../play/useGameplayConfig";
import { scatterDemoProps, findWalkableStart } from "../play/demoProps";
import { DamageNumbers } from "../combat/DamageNumbers";
import { Drops } from "../combat/Drops";
import { Hud, useHudCursor } from "../hud/Hud";
import { Panel, RpgButton } from "../ui/rpg";
import { gateway } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { useWorldEvents } from "../net/useWorldEvents";
import { legacyMapping, localToServer, serverToLocal } from "../net/legacyCells";
import { setPathfinder } from "../net/worldStore";
import { findPath } from "../net/pathfind";
import { map3dFor } from "../net/legacyMaps";
import { NetPlayer } from "../net/NetPlayer";
import { NetEntities } from "../net/NetEntity";
import { NetDamageNumbers } from "../net/NetDamageNumbers";
import { SkillVfx } from "../vfx/SkillVfx";
import { GroundItems } from "../net/GroundItems";
import { preloadAssets } from "../assets";
import { preloadProps } from "../props/registry";

preloadAssets();
preloadProps();

// culling por distância (mapas hex): render só o pedaço ao redor do player.
// Raios/névoa vêm da config do game (admin /game-editor). Props renderizam ALÉM
// do fim do fog → surgem já cobertos (pop invisível) e emergem suave.
const CHUNK = 16; // recalcula o culling a cada 16 unidades andadas (não por frame)
const TERRAIN_MARGIN = 1.18; // terreno = renderDistance × isso (chão sob props fogados)

// céu: gradiente (horizonte claro → azul no topo). A base = cor do fog, então o
// terreno funde no horizonte sem emenda e não sobra branco/cinza além do fog.
const SKY_HORIZON = "#cfe0ee";
const SKY_TOP = "#5a8fc7";

// Constantes em unidades de HEXÁGONO nativo: multiplicadas por hexScale onde
// são usadas. Fixas, elas encolhem junto com o mundo — com hexScale 10 a
// sombra cobriria menos de um hexágono e o culling recalcularia a cada passo.
const SHADOW_RADIUS = 95; // meia-largura do frustum de sombra
const SUN_DISTANCE = 140; // mesma escala do editor (EditorScene) — só a direção muda

/** direção/altura do sol a partir de azimute/elevação (graus) — mesma fórmula
 * do editor (EditorScene), pra o /play bater com o que foi ajustado lá. */
function sunOffset(azimuthDeg: number, elevationDeg: number, scale = 1): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const d = SUN_DISTANCE * scale;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az) * d, Math.sin(el) * d, Math.cos(el) * Math.cos(az) * d);
}

/**
 * Rig do sol: uma luz direcional que SEGUE o player (posição + alvo + câmera de
 * sombra). Sem isso, a câmera de sombra fica presa na origem e some quando o
 * player anda pra longe (mapas grandes) → cena sem sombra, iluminação "flat".
 * A direção do sol vem do `lighting` salvo no mapa (editor "Camadas & Luz");
 * só a origem acompanha o player.
 */
function SunRig({ targetRef, offset, intensity = 1.35, scale = 1 }: { targetRef: React.MutableRefObject<THREE.Vector3>; offset: THREE.Vector3; intensity?: number; scale?: number }) {
  const shadowR = SHADOW_RADIUS * scale;
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    const p = targetRef.current;
    const l = lightRef.current;
    if (!l) return;
    l.position.set(p.x + offset.x, p.y + offset.y, p.z + offset.z);
    target.position.set(p.x, p.y, p.z);
    target.updateMatrixWorld();
  });
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        intensity={intensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        target={target}
      >
        <orthographicCamera attach="shadow-camera" args={[-shadowR, shadowR, shadowR, -shadowR, 1, 400 * scale]} />
      </directionalLight>
    </>
  );
}

const PLAY_PARAMS = new URLSearchParams(window.location.search);
const IS_PREVIEW = PLAY_PARAMS.get("preview") === "1"; // mapa em memória do editor
const DEFAULT_MAP = PLAY_PARAMS.get("map") ?? "hexdemo";
/**
 * `/play` puro é O JOGO: exige sessão no rAthena.
 *
 * O modo local (mundo de mentira, personagem de demonstração) continua
 * existindo para o editor, mas só quando pedido de propósito — `?preview=1`
 * (mapa vindo do editor) ou `?map=<id>` (abrir um mapa salvo). Sem isso, abrir
 * /play direto mostrava um personagem nível 50 que não é de ninguém, ao lado de
 * um HUD que dizia estar logado.
 */
const LOCAL_MODE = IS_PREVIEW || PLAY_PARAMS.has("map");
/** mapa do rAthena que TEM cena 3D — destino do botão de escape acima */
const FALLBACK_MAP = "prt_fild08";
/** `?retro=off|pixel|8bit|16bit` sobrescreve o filtro só nesta aba — serve pra
 * comparar custo/visual sem precisar salvar no admin */
const RETRO_OVERRIDE = PLAY_PARAMS.get("retro");

function Scene({
  map,
  gameplay,
  playerPos,
  camAzimuth,
  online,
}: {
  map: GameMap;
  gameplay: GameplayConfig;
  playerPos: React.MutableRefObject<THREE.Vector3>;
  camAzimuth: React.MutableRefObject<number>;
  /** true = quem manda no mundo é o rAthena (ver net/); false = mundo local de demo */
  online: boolean;
}) {
  // A grade DESTE mapa: hexágonos do editor ou quadrados do rAthena. Tudo que
  // era `if (isHex)` espalhado pela cena passa por aqui.
  const grid = gridFor(map);
  const isHex = grid.kind === "hex";
  // Amarração com o mapa do rAthena. Sem ela não dá para converter célula do
  // servidor em posição de mundo, então o modo online não liga.
  const mapping = useMemo(() => legacyMapping(map), [map]);
  const net = online && mapping !== null;
  // tamanho do bloco hex — precisa estar setado ANTES de qualquer hexToWorld
  // (inclusive o do memo logo abaixo, que computa o spawn do player). Síncrono
  // no corpo do render (não em efeito): o efeito rodaria TARDE DEMAIS, depois
  // do 1º hexToWorld já ter usado a escala errada (1, default, antes do fetch
  // do server_config voltar).
  //
  // Só no mapa HEX: a grade quadrada tem tamanho fixo de propósito (ver
  // grid/squareGrid.ts) — com hexScale 10 um mapa 400×400 viraria 8.000 unidades
  // de lado, além do `camera.far`, e desafinaria câmera/névoa/alcance de uma vez.
  if (isHex) setHexScale(gameplay.hexScale);
  // célula do clique-tile: o passo do movimento, a tolerância de chegada e o
  // marcador de destino são todos medidos NELA, então tem que ser a mesma célula
  // que o terreno desenha (hexágono ou quadrado), nunca o `cellSize` do GameMap.
  const moveCell = grid.cellWidth();
  // culling por distância (só em mapas hex/blocks): render o pedaço ao redor do
  // player. Recalcula por chunk (useViewCenter), não por frame. Fog esconde a borda.
  const center = useViewCenter(playerPos, CHUNK * gameplay.hexScale);
  const PROP_RADIUS = gameplay.renderDistance;
  const TERRAIN_RADIUS = gameplay.renderDistance * TERRAIN_MARGIN;
  const FOG_NEAR = gameplay.fogNear;
  const FOG_FAR = gameplay.fogFar;
  // extensão do mundo pro plano de clique: num mapa hex é o passo do grid ×
  // tamanho (que já embute o hexScale); no smooth é a grade de células. Uma
  // folga de um tile evita borda morta no último hexágono.
  const ground = useMemo(
    () => grid.extent(map),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, isHex, gameplay.hexScale],
  );

  // COMO O SERVIDOR ANDA: o pacote de movimento traz só as duas pontas do
  // trecho, então o cliente refaz o caminho com o mesmo A* do rAthena
  // (net/pathfind) para não cortar quina nem atravessar parede. Registrado aqui
  // porque é a cena que tem a colisão e a amarração com a grade do servidor.
  useEffect(() => {
    if (!mapping) {
      setPathfinder(null);
      return;
    }
    // Props sólidos entram no caminho pela MESMA regra que o exportador usa ao
    // gravar o `map_cache` (grid/propCells): é assim que o desenho do cliente
    // acompanha o desvio que o servidor já faz em volta da árvore.
    const bloqueadasPorProp = propBlockedCellsCached(map);
    setPathfinder((from, to) => {
      const a = serverToLocal(mapping, from.x, from.y);
      const b = serverToLocal(mapping, to.x, to.y);
      const caminho = findPath(map, { x: a.col, y: a.row }, { x: b.col, y: b.row }, bloqueadasPorProp);
      if (!caminho) return null;
      return caminho.map((c) => {
        const s = localToServer(mapping, c.x, c.y);
        return { x: s.x, y: s.y };
      });
    });
    return () => setPathfinder(null);
  }, [map, mapping]);

  const world = useMemo(() => {
    // Props contam na colisão: depois de exportar o mapa para o `map_cache`
    // (export:mapcache), o servidor barra exatamente as células dos props
    // sólidos, então o cursor de chão dizer o mesmo é a verdade — não mais uma
    // promessa que o servidor desmentia.
    const terrain = grid.terrainQuery(map);
    // mapa autorado: player_start do editor, ou o centro da grade;
    // mapa do servidor: primeira célula andável
    const playerStart = map.spawns.find((s) => s.kind === "player_start");
    const start = isHex
      ? playerStart
        ? { x: playerStart.position[0], z: playerStart.position[2] }
        : (() => {
            const c = grid.cellToWorld(Math.floor(map.size.width / 2), Math.floor(map.size.height / 2));
            return { x: c.x, z: c.z };
          })()
      : findWalkableStart(map);
    // Props do MAPA (hex do editor, square do rAthena) vêm de `map.props`; só o
    // plano legado "smooth" ganha um scatter de demonstração para não ficar vazio.
    const props = map.terrainMode === "smooth" ? scatterDemoProps(map, start) : [];
    // Sem sessão, os "monstros" são só os spawns autorados no mapa, parados —
    // serve ao editor conferir a distribuição. Não há mais mob de demonstração.
    const monsters: PreviewSpawn[] = previewSpawns(map);
    playerPos.current.set(start.x, terrain.getHeight(start.x, start.z), start.z);
    return { terrain, start, props, monsters };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `net` entra nas dependências: sair/entrar de sessão troca quem manda na
    // colisão (servidor × cliente) e a query precisa ser refeita
  }, [map, gameplay.hexScale, net]);

  // Props visíveis: só os dentro do raio do centro de visão. Vale para as duas
  // grades de verdade — o mapa do rAthena tem 400×400 células, então desenhar
  // tudo é ainda menos viável ali que no hex. Só o "smooth" legado (scatter de
  // demonstração, punhado de props) passa direto.
  const culled = map.terrainMode !== "smooth";
  const allProps = culled ? map.props : world.props;
  const visibleProps = useMemo(() => {
    if (!culled) return allProps;
    const r2 = PROP_RADIUS * PROP_RADIUS;
    return allProps.filter((p) => {
      const dx = p.position[0] - center.x, dz = p.position[2] - center.z;
      return dx * dx + dz * dz <= r2;
    });
  }, [allProps, culled, center.x, center.z, PROP_RADIUS]);

  if (import.meta.env.DEV)
    (window as unknown as { __playStats?: unknown }).__playStats = {
      visibleProps: visibleProps.length,
      totalProps: allProps.length,
      center,
      start: world.start,
      // getter, não cópia: o objeto é montado no RENDER e a posição muda a cada
      // FRAME — copiada, ela mentia a posição de vários segundos atrás.
      get player() {
        return { x: playerPos.current.x, y: playerPos.current.y, z: playerPos.current.z };
      },
      hexScale: gameplay.hexScale,
      modo: usePlayStore.getState().mode,
      alvo: usePlayStore.getState().moveTarget,
      mapa: `${map.size.width}x${map.size.height}`,
      raioTerreno: TERRAIN_RADIUS,
      online,
      legacy: mapping,
      net,
    };

  // sol/ambiente salvos no mapa (editor "Camadas & Luz") — mapas antigos sem o
  // campo caem no default do schema (mesma sensação de antes).
  const lighting = map.lighting ?? DEFAULT_LIGHTING;
  const sunOff = useMemo(
    () => sunOffset(lighting.sunAzimuth, lighting.sunElevation, gameplay.hexScale),
    [lighting.sunAzimuth, lighting.sunElevation, gameplay.hexScale],
  );

  return (
    <>
      {import.meta.env.DEV && <ThreeDebug />}
      <GradientSky top={SKY_TOP} bottom={SKY_HORIZON} />
      {/* fog: desbota do FOG_NEAR ao FOG_FAR; props/terreno renderizam além disso
          (já cobertos) → itens distantes emergem suave, sem pop na borda. Cor =
          base do gradiente do céu → horizonte contínuo. */}
      {culled && <fog attach="fog" args={[SKY_HORIZON, FOG_NEAR, FOG_FAR]} />}
      <ambientLight intensity={lighting.ambient} />
      {/* sol que segue o player (sombras corretas mesmo longe da origem) */}
      <SunRig targetRef={playerPos} offset={sunOff} intensity={lighting.sunIntensity} scale={gameplay.hexScale} />
      <Physics>
        {/* Terreno: peças hexagonais nos mapas do editor, malha por chunk nos
            mapas do rAthena, plano único no "smooth" legado. */}
        {/* nome é contrato com o GroundInteract: o clique mira o TOPO do terreno,
            não o plano de y=0 — sobre um bloco alto os dois estão longe um do outro */}
        <group name={TERRAIN_GROUP}>
          {isHex ? (
            <HexTerrain map={map} center={center} radius={TERRAIN_RADIUS} ground={gameplay} />
          ) : map.terrainMode === "square" ? (
            <SquareTerrain map={map} center={center} radius={TERRAIN_RADIUS} ground={gameplay} />
          ) : (
            <MapTerrain map={map} />
          )}
        </group>
        {/* props do mapa (culled); o "smooth" legado usa o scatter de demo.
            O nome do grupo é contrato com o GroundInteract: é nele que o clique
            testa se o raio bateu numa árvore antes de chegar ao chão. */}
        <group name={PROPS_GROUP}>
          {visibleProps.map((p) => (
            <PropInstance key={p.id} prop={p} />
          ))}
        </group>
        {/* ONLINE: monstros, NPCs e o próprio personagem vêm do map-server. Nada
            de IA, spawn autorado ou gatilho local — o servidor já faz tudo isso,
            e duplicar aqui só criaria dois mundos discordando.
            OFFLINE (demo/preview/editor): mundo simulado local, como antes. */}
        {net && mapping ? (
          <>
            <NetEntities
              map={map}
              mapping={mapping}
              charScale={gameplay.charScale}
              animationSpeed={gameplay.animationSpeed}
              cellSize={moveCell}
            />
            <GroundItems map={map} mapping={mapping} cellSize={moveCell} />
            <NetPlayer
              map={map}
              mapping={mapping}
              gameplay={gameplay}
              positionRef={playerPos}
              camAzimuthRef={camAzimuth}
              cellSize={moveCell}
            />
          </>
        ) : (
          <>
            {world.monsters.map((m) => (
              <Monster
                key={m.id}
                terrain={world.terrain}
                spawn={m.spawn}
                characterKey={m.characterKey}
                gameplay={gameplay}
              />
            ))}
            <Player
              terrain={world.terrain}
              cellSize={moveCell}
              start={world.start}
              positionRef={playerPos}
              camAzimuthRef={camAzimuth}
              gameplay={gameplay}
              lattice={grid.lattice}
            />
            {/* NPCs com rota de patrulha autorada no editor */}
            {map.spawns
              .filter((sp) => sp.kind === "npc" && sp.path && sp.path.points.length > 0)
              .map((sp) => (
                <NpcWalker key={sp.id} spawn={sp} terrain={world.terrain} cellSize={map.cellSize} gameplay={gameplay} />
              ))}
            {/* gatilhos de área autorados no editor (warp/dano/cura/save) */}
            <TriggerRuntime map={map} playerPos={playerPos} />
          </>
        )}
      </Physics>
      <Drops />
      {/* números de dano: online vêm do ZC.NOTIFY_ACT (já calculados pelo
          servidor); offline, do combate simulado local */}
      {net && mapping ? (
        <>
          <NetDamageNumbers map={map} mapping={mapping} />
          {/* efeitos de skill: todos nascem de pacote do servidor */}
          <SkillVfx map={map} mapping={mapping} cellSize={moveCell} />
        </>
      ) : (
        <DamageNumbers />
      )}
      {/* clique-tile: marcador do tamanho do personagem, na MESMA célula que o
          movimento usa (hex nos mapas de bloco) */}
      <GroundInteract
        worldWidth={ground.width}
        worldDepth={ground.depth}
        centerX={ground.cx}
        centerZ={ground.cz}
        cellSize={moveCell}
        terrain={world.terrain}
        lattice={grid.lattice}
        markerRadius={markerRadiusFor(gameplay.charScale, CHAR_MODEL_HEIGHT, grid.markerRadius())}
      />
      {/* filtro retrô (16 bits) — pós-processamento, ver scene/RetroFilter */}
      <RetroFilter
        retroMode={(RETRO_OVERRIDE as typeof gameplay.retroMode) ?? gameplay.retroMode}
        retroPixelSize={gameplay.retroPixelSize}
        retroDither={gameplay.retroDither}
      />
      <FollowCamera
        targetRef={playerPos}
        azimuthRef={camAzimuth}
        distance={gameplay.cameraDistance}
        maxZoom={gameplay.cameraMaxZoom}
        rotateSpeed={gameplay.cameraRotateSpeed}
        targetHeight={gameplay.charScale * CHAR_MODEL_HEIGHT}
      />
    </>
  );
}

const waiting: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0b0d12",
  color: "#e6e8ee",
  font: "14px system-ui",
};

/** altura do modelo KayKit em escala 1 (o char é renderizado com charScale) —
 * usada só pra câmera mirar no meio do corpo em vez de no pé */
const CHAR_MODEL_HEIGHT = 1.8;

/** Em DEV, dá acesso à cena/câmera pelo console (`__three().scene`). */
function ThreeDebug() {
  const { scene, camera } = useThree();
  useEffect(() => {
    (window as unknown as { __three?: () => unknown }).__three = () => ({ scene, camera });
  }, [scene, camera]);
  return null;
}

/**
 * Assinatura dos eventos de mundo, montada só quando há sessão.
 *
 * É um componente e não uma chamada direta no PlayView porque o hook avisa o
 * servidor que a cena está pronta (`world:ready`): no modo demo isso mandaria
 * um pedido sem sessão nenhuma e o gateway responderia derrubando a tela.
 */
function WorldEventsBridge() {
  useWorldEvents();
  return null;
}

const IS_DEMO = LOCAL_MODE && !IS_PREVIEW && DEFAULT_MAP === "hexdemo";

/** Mundo 3D jogável + HUD RO completo. */
export function PlayView() {
  // preview: mapa em memória do editor, entregue por postMessage (sem cota de
  // sessionStorage — mapas grandes estouravam e davam "preview vazio"). A aba
  // sinaliza "pronta" pro opener (editor), que responde com o mapa.
  const [previewMap, setPreviewMap] = useState<GameMap | null>(null);
  const [previewWaiting, setPreviewWaiting] = useState(IS_PREVIEW);
  useEffect(() => {
    if (!IS_PREVIEW) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "ragnarok:preview-map") {
        try {
          setPreviewMap(GameMapSchema.parse(e.data.map));
        } catch {
          /* mapa inválido → segue null (mostra erro) */
        }
        setPreviewWaiting(false);
      }
    };
    window.addEventListener("message", onMsg);
    // avisa o editor (opener) que já pode mandar o mapa
    if (window.opener) window.opener.postMessage({ type: "ragnarok:preview-ready" }, "*");
    // sem resposta em 6s → para de esperar (mostra erro)
    const t = setTimeout(() => setPreviewWaiting(false), 6000);
    return () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(t);
    };
  }, []);
  // busca do banco sempre; hexdemo usa a versão salva SÓ se for "blocks" (senão
  // prefab — ignora versão smooth/quebrada salva antes do fix). Em preview, não busca.
  // distâncias (câmera, névoa, alcance, pulo) vêm em unidades de hexágono e
  // passam a valer no tamanho de bloco atual — ver scaleToWorld
  const gameplayRaw = useGameplayConfig();
  const gameplay = scaleToWorld(gameplayRaw);
  // O demo é GERADO em código, e buildHexDemo usa hexToWorld — ou seja, nasce
  // preso ao hexScale que estiver ativo. No primeiro render a config ainda não
  // voltou da API (hexScale = 1 default); sem refazer o demo quando ela chega,
  // o terreno é desenhado no tamanho novo mas player/monstros/props ficam nas
  // coordenadas antigas: o player aparecia na quina do mapa olhando pra fora
  // (só céu) e em cima dos esqueletos, que o matavam em segundos.
  const demoMap = useMemo(() => (IS_DEMO ? buildHexDemo() : null), [gameplay.hexScale]);

  // Com sessão no rAthena, quem escolhe o mapa é o SERVIDOR: ele diz em que
  // mapa legado o personagem está e a gente carrega a cena 3D que representa
  // aquele mapa (net/legacyMaps). Sem sessão (demo, preview, ?map=) vale o
  // comportamento antigo.
  const session = useSessionStore((s) => s.world);
  const online = session !== null;
  const netMapId = session ? map3dFor(session.mapName) : null;
  // Com sessão, só existe o mapa que o servidor indicou. Sem correspondência,
  // string vazia = não busca nada (o aviso abaixo explica) — carregar o mapa do
  // `?map=` seria desenhar um mundo que não é onde o personagem está.
  const mapId = IS_PREVIEW ? "" : online ? (netMapId ?? "") : DEFAULT_MAP;
  // Com sessão, NUNCA cair no mapa de demonstração: se o servidor colocou o
  // personagem num mapa que ainda não tem cena 3D, o certo é dizer isso — abrir
  // o hexdemo faria o jogador andar num mundo que não é o dele (foi o que
  // aconteceu ao morrer e renascer em Prontera).
  const useDemo = IS_DEMO && !online;

  const fetched = useMap(mapId);
  const rawMap = IS_PREVIEW ? previewMap : useDemo ? (fetched.map?.terrainMode === "blocks" ? fetched.map : demoMap) : fetched.map;
  // posições (props/spawns/rotas) vêm na escala em que o mapa foi autorado —
  // traz pro tamanho de bloco atual, senão só o terreno cresce
  // ...e depois assenta os props no relevo real da peça embaixo deles (a faixa
  // da estrada é escavada e a rampa é inclinada — ver hex/groundProps.ts)
  const map = useMemo(() => {
    if (!rawMap) return null;
    // `hexScale` (e portanto o reescalonamento de posições) é coisa do mundo
    // hexagonal: a grade quadrada tem tamanho fixo, e passar por aqui só moveria
    // props e spawns do mapa do rAthena para fora do lugar.
    if (rawMap.terrainMode !== "blocks") return rawMap;
    const escalado = scaleMapPositions(rawMap, gameplay.hexScale);
    return groundProps(escalado, gridFor(escalado).terrainQuery(escalado));
  }, [rawMap, gameplay.hexScale]);
  // O mapa do servidor não existe no acervo 3D — ou porque não há apelido
  // (`map3dFor`), ou porque a API não tem esse mapa (404). Os dois casos deixam
  // o jogador sem chão, então os dois precisam da saída de emergência.
  const semMapa3D = Boolean(session) && !useDemo && !IS_PREVIEW && (!netMapId || Boolean(fetched.error));
  const error = IS_PREVIEW
    ? previewMap || previewWaiting
      ? null
      : "preview vazio — volte ao editor e clique Play"
    : useDemo
      ? null
      : semMapa3D
        ? `o servidor colocou o personagem em "${session?.mapName}", que ainda não tem mapa 3D — só os mapas migrados do map_cache existem por enquanto`
        : fetched.error;
  const playerPos = useRef(new THREE.Vector3());
  const camAzimuth = useRef(0);
  const cursor = useHudCursor();
  const phase = useSessionStore((s) => s.phase);
  const navigate = useNavigate();

  // Sem sessão e sem modo local pedido: manda para o login em vez de desenhar
  // um mundo que não é de ninguém.
  useEffect(() => {
    if (LOCAL_MODE) return;
    if (phase === "offline") navigate("/login");
    else if (phase === "chars") navigate("/char-select");
  }, [phase, navigate]);

  if (!LOCAL_MODE && !online) {
    return (
      <div style={waiting}>
        {phase === "entering" ? "entrando no mundo…" : "conectando ao servidor…"}
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, cursor }}>
      {/* só com sessão: avisa o map-server que a cena montou e escuta o mundo */}
      {online && map && <WorldEventsBridge />}
      <Canvas camera={{ position: [40, 40, 40], fov: 50, near: 0.5, far: 4000 }} shadows>
        <Suspense fallback={null}>
          {map && (
            <Scene
              map={map}
              gameplay={gameplay}
              playerPos={playerPos}
              camAzimuth={camAzimuth}
              online={online}
            />
          )}
        </Suspense>
      </Canvas>

      {error && (
        <div style={{ position: "absolute", top: 10, left: 10, maxWidth: 520 }}>
          <Panel>
            <div style={{ font: "12px system-ui", color: "#8a2f22" }}>{error}</div>
            {online && semMapa3D && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {/* Saída de emergência: enquanto só um mapa tem cena 3D, cair
                    num mapa sem cena deixaria o personagem preso — o mundo
                    existe no servidor, mas não há o que desenhar.
                    `@load` volta ao ponto de salvamento e vale para QUALQUER
                    jogador (liberado no grupo 0 em rathena-conf/groups.yml); é
                    o que a Asa de Borboleta faz no RO. O @warp abaixo é atalho
                    de teste e continua exigindo GM. */}
                <RpgButton color="blue" onClick={() => gateway().emit("chat:send", { text: "@load" })}>
                  Voltar ao ponto de salvamento
                </RpgButton>
                <RpgButton
                  onClick={() => gateway().emit("chat:send", { text: `@warp ${FALLBACK_MAP} 170 373` })}
                >
                  Ir para {FALLBACK_MAP}
                </RpgButton>
                <span style={{ font: "10px system-ui", color: "#8a7868" }}>o segundo requer GM</span>
              </div>
            )}
          </Panel>
        </div>
      )}
      {IS_PREVIEW && previewWaiting && !map && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#e6e8ee", font: "14px system-ui", background: "#0b0d12" }}>
          carregando preview do editor…
        </div>
      )}
      {map && <Hud map={map} playerPos={playerPos} />}
    </div>
  );
}
