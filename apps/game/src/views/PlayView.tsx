import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useNavigate } from "react-router-dom";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AimPreview } from "../play/AimPreview";
import { AlvoPorTab } from "../play/AlvoPorTab";
import { melhorAlvo, RAIO_ASSIST_PX, type Candidato } from "../play/aimAssist";
import { useSoftLockStore } from "../play/softLockStore";
import { atacar, castarEmAlvo, pegar } from "../net/acoes";
import { cliqueVaiParaOChao, useAimStore } from "../net/aimStore";
import { FollowCamera } from "../play/FollowCamera";
import { useViewCenter } from "../play/useViewCenter";
import { AQUECIMENTO_INICIAL, passoDeAquecimento } from "../play/aquecimento";
import { raiosDeVisao } from "../play/viewRadius";
import { GradientSky } from "../scene/GradientSky";
import { aplicarNevoaDoCeu } from "../scene/skyFog";
import { SKY_HORIZON, SKY_TOP } from "../scene/skyGradient.glsl";
import { RetroFilter } from "../scene/RetroFilter";
import { PerfProbe, PerfOverlay } from "../scene/PerfHud";
import { SondaDeCena, SondaDeSuspense } from "../core/diagnostics/SondaDeCanvas";
import { PreCompilarProps } from "../play/PreCompilarProps";
import { marcarPropsVisiveis } from "../core/diagnostics/cenaProbe";
import { scaleToWorld, useGameplayConfig } from "../play/useGameplayConfig";
import { scatterDemoProps, findWalkableStart } from "../play/demoProps";
import { DamageNumbers } from "../combat/DamageNumbers";
import { Drops } from "../combat/Drops";
import { Hud } from "../hud/Hud";
import { Panel, RpgButton } from "../ui/rpg";
import { gateway } from "../net/gateway";
import { useSessionStore } from "../net/sessionStore";
import { useWorldEvents } from "../net/useWorldEvents";
import { cellToWorld, legacyMapping, localToServer, serverToLocal, type LegacyMapping } from "../net/legacyCells";
import { setPathfinder, setTetoDeTrecho, useWorldStore } from "../net/worldStore";
import { estaMeAtacando } from "../net/ameacas";
import { findPath, tetoDeTrecho } from "../net/pathfind";
import { map3dFor } from "../net/legacyMaps";
import { NetPlayer } from "../net/NetPlayer";
import { NetEntities } from "../net/NetEntity";
import { NetDamageNumbers } from "../net/NetDamageNumbers";
import { SkillVfx } from "../vfx/SkillVfx";
import { GroundItems, useGroundItems } from "../net/GroundItems";
import { preloadAssets } from "../assets";
import { preloadPropsDoMapa } from "../props/registry";

preloadAssets();

// culling por distância (mapas hex): render só o pedaço ao redor do player.
// Raios/névoa vêm da config do game (admin /game-editor). Props renderizam ALÉM
// do fim do fog → surgem já cobertos (pop invisível) e emergem suave.
const CHUNK = 16; // recalcula o culling a cada 16 unidades andadas (não por frame)
/** abertura vertical da câmera — a névoa do céu precisa da MESMA para converter
 * elevação em altura de tela */
const FOV_DA_CAMERA = 50;

/**
 * Céu e névoa saem do MESMO módulo (`scene/skyFog`) porque são a mesma cor.
 *
 * A chamada abaixo troca o chunk de névoa do three pela versão que desbota para
 * a cor do céu NAQUELE ângulo de elevação, em vez de para uma constante — é o
 * que impede o topo de uma montanha distante de virar recorte claro contra o azul
 * (referência `Desktop/ref/silhueta.jpg`). Roda no import, antes de qualquer
 * material da cena compilar.
 */
aplicarNevoaDoCeu();

// Constantes em unidades de HEXÁGONO nativo: multiplicadas por hexScale onde
// são usadas. Fixas, elas encolhem junto com o mundo — com hexScale 10 a
// sombra cobriria menos de um hexágono e o culling recalcularia a cada passo.
/**
 * Meia-largura do frustum de sombra, e o tamanho do mapa dela.
 *
 * Os dois andam juntos: o que decide a NITIDEZ é a densidade de texel por
 * unidade de mundo, `SHADOW_MAP / (2 × SHADOW_RADIUS)`.
 *
 * Era 95 com mapa 2048² — 190 unidades de lado a 10,8 texels por unidade, e o
 * mapa inteiro rasterizado A CADA QUADRO (o `SunRig` move a luz e o alvo no
 * `useFrame`, com todo personagem e todo prop em `castShadow`). Metade daquele
 * frustum não tinha nada dentro: a névoa fecha em ~120 unidades e o alcance de
 * desenho é ~130, medidos do PERSONAGEM, então sombra a 95 unidades de raio já
 * caía em terreno que ninguém enxerga.
 *
 * 55 com mapa 1024² dá 9,3 texels por unidade — 14% menos nítido, contra ¼ da
 * rasterização por quadro. É a troca boa, e é a única do bloco de GPU que muda
 * a imagem de forma mensurável.
 */
const SHADOW_RADIUS = 55;
const SHADOW_MAP = 1024;
/**
 * O alvo da sombra anda em PASSOS, não continuamente.
 *
 * A câmera de sombra é ortográfica e o mapa dela é uma grade fixa; movendo o
 * alvo por fração de texel, a borda de cada sombra "ferve" enquanto o jogador
 * anda (o *shadow swimming* clássico). Grudando o alvo numa grade do tamanho de
 * um texel, a projeção cai sempre no mesmo lugar e a fervura some — de graça,
 * porque é a mesma conta de arredondar que o `useViewCenter` já faz com o
 * centro de visão.
 */
const SHADOW_TEXEL = (SHADOW_RADIUS * 2) / SHADOW_MAP;

/**
 * Orçamento de construção de chunk ENQUANTO a tela de carregamento está no ar.
 *
 * Os 6 ms do `SquareTerrain` existem para não roubar tempo de um quadro que
 * precisa desenhar jogo. Atrás da tela de carregamento não há jogo para
 * desenhar, então o mesmo teto só fazia a espera durar o dobro.
 */
const ORCAMENTO_CARREGANDO_MS = 12;
/**
 * Teto da espera pela pré-carga.
 *
 * Medido no `prt_fild08`: 169 chunks × ~2,7 ms ≈ 450 ms, com folga de sobra
 * aqui. O teto existe para o caso patológico — mapa de relevo pesado, máquina
 * lenta — em que segurar o jogador seria pior que soltá-lo: o streaming de
 * sempre continua valendo e é o comportamento seguro.
 */
const TETO_PRECARGA_MS = 3000;
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
  // passo da grade em que o alvo da sombra é grudado (ver SHADOW_TEXEL)
  const passo = SHADOW_TEXEL * scale;
  useFrame(() => {
    const p = targetRef.current;
    const l = lightRef.current;
    if (!l) return;
    // arredondar ANTES de somar o deslocamento do sol: é a posição do alvo que
    // define onde a projeção cai, e luz e alvo têm de andar o mesmo tanto para a
    // direção do sol não mudar
    const ax = Math.round(p.x / passo) * passo;
    const az = Math.round(p.z / passo) * passo;
    l.position.set(ax + offset.x, p.y + offset.y, az + offset.z);
    target.position.set(ax, p.y, az);
    target.updateMatrixWorld();
  });
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        intensity={intensity}
        castShadow
        shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        target={target}
      >
        <orthographicCamera attach="shadow-camera" args={[-shadowR, shadowR, shadowR, -shadowR, 1, 400 * scale]} />
      </directionalLight>
    </>
  );
}

/**
 * Apaga o DESENHO da cena sem desmontar nada.
 *
 * Enquanto a tela de carregamento está no ar, não há nada a mostrar — nem mapa,
 * nem personagem, nem monstro. Mas o `<Canvas>` NÃO pode ser desmontado: quem
 * drena a fila da pré-carga é o `useFrame` do `SquareTerrain`, e o cache de
 * geometria dele vive num `useRef` da instância — desmontar pararia o trabalho
 * que a tela está esperando e jogaria fora tudo que já foi construído.
 *
 * `scene.visible = false` resolve os dois lados: o `projectObject` do three sai
 * na primeira linha quando o objeto está invisível (three.module.js:16326), então
 * a lista de render sai VAZIA e nenhum triângulo é desenhado; o `clear` do
 * quadro continua acontecendo (:1355), então a tela fica limpa em vez de
 * congelada no último quadro. E o laço do R3F segue chamando todo `useFrame`,
 * porque isso não passa pelo renderer.
 *
 * O ganho não é só cosmético: os quadros da tela de carregamento deixam de
 * gastar GPU com sombra, névoa e chão para nada, e sobra máquina para montar
 * chunk — que é justamente o que se está esperando.
 */
function OcultarCena({ oculta }: { oculta: boolean }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.visible = !oculta;
    // sair daqui com a cena apagada deixaria a tela preta para sempre
    return () => {
      scene.visible = true;
    };
  }, [scene, oculta]);
  return null;
}

/**
 * Espera a cena parar de compilar, com a cortina ainda no ar.
 *
 * Só é montado durante a fase de aquecimento e some quando avisa que terminou.
 * A REGRA mora em `play/aquecimento` (pura, e travada em teste): aqui só entram
 * o sinal do renderer e o relógio. O pior defeito possível desta tela é nunca
 * sair, e isso é coisa de teste, não de componente.
 */
function AquecerCena({ aoTerminar }: { aoTerminar: () => void }) {
  const gl = useThree((s) => s.gl);
  const estado = useRef(AQUECIMENTO_INICIAL);
  const inicio = useRef(0);
  const avisado = useRef(false);

  useFrame(() => {
    if (avisado.current) return;
    if (inicio.current === 0) inicio.current = performance.now();
    const decorrido = performance.now() - inicio.current;
    // `programs` pode não existir em renderer de teste/mock — 0 é contagem
    // parada, e contagem parada revela pela estabilidade
    const programas = gl.info.programs?.length ?? 0;
    const passo = passoDeAquecimento(estado.current, programas, decorrido);
    estado.current = passo.estado;
    if (!passo.pronto) return;
    // `aoTerminar` desmonta este componente, mas só no próximo render do React —
    // sem a trava, os quadros no meio do caminho chamariam de novo
    avisado.current = true;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(
        `[play] cena aquecida em ${Math.round(decorrido)} ms, ` +
          `${programas} shaders${passo.porTeto ? " (por teto de tempo)" : ""}`,
      );
    }
    aoTerminar();
  });

  return null;
}

/**
 * A ASSISTÊNCIA DE MIRA, avaliada uma vez por quadro.
 *
 * É a única execução: ela publica o alvo escolhido no `play/softLockStore`, o
 * `NetEntity` lê para acender, e o clique lê para agir. Antes havia duas contas
 * — uma para o realce, outra no clique — e o mouse podia andar entre elas, o que
 * fazia acender um monstro e o clique pegar outro.
 *
 * Componente porque precisa de `useFrame`, da CÂMERA e do TAMANHO do canvas: a
 * escolha é em pixel de tela (ver `play/aimAssist`), e projetar exige os dois.
 *
 * O ponteiro é lido direto do canvas, não do plano de clique do `GroundInteract`
 * — assim ele vale também com o cursor em cima de um monstro ou de um prop, sem
 * depender de o raio acertar o chão.
 */
/**
 * Onde, na vertical, a assistência considera que o alvo ESTÁ — em frações de
 * célula acima do chão.
 *
 * O mob é o centro do cilindro de clique do `NetEntity`
 * (`height × HITBOX_ALTURA / 2`, e `height` é ~uma célula na escala padrão), e a
 * caixinha de loot é rasteira. Sem isto os dois eram projetados no PÉ: numa
 * câmera a ~26 unidades com fov 50°, o corpo do monstro cai ~26 px acima do pé,
 * ou seja, o ponteiro — que chega por cima — enxergava metade do raio de 48 px.
 */
const MIRA_ALTURA_MOB = 0.62;
const MIRA_ALTURA_ITEM = 0.2;

function AssistenciaDeMira({
  map,
  mapping,
  cellSize,
  playerPos,
  fogFar,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
  playerPos: React.MutableRefObject<THREE.Vector3>;
  /** onde a névoa fecha: além dela não é candidato */
  fogFar: number;
}) {
  const gl = useThree((s) => s.gl);
  const tamanho = useThree((s) => s.size);
  /** ponteiro em px de CSS, relativo ao canvas; `null` = fora dele */
  const ponteiro = useRef<{ px: number; py: number } | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const mover = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ponteiro.current = { px: e.clientX - r.left, py: e.clientY - r.top };
    };
    // o ponteiro saiu do canvas: não há alvo a travar
    const sair = () => {
      ponteiro.current = null;
    };
    el.addEventListener("pointermove", mover);
    el.addEventListener("pointerleave", sair);
    return () => {
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerleave", sair);
      useSoftLockStore.getState().apontar(null);
    };
  }, [gl]);

  // rascunho reutilizado: projetar aloca um Vector3 por chamada, e isto roda
  // por candidato, por quadro
  const scratch = useMemo(() => new THREE.Vector3(), []);

  useFrame((estado) => {
    const p = ponteiro.current;
    if (!p) {
      useSoftLockStore.getState().apontar(null);
      return;
    }
    // skill de área não é assistida: o alvo dela é a célula escolhida
    if (cliqueVaiParaOChao(useAimStore.getState().skill)) {
      useSoftLockStore.getState().apontar(null);
      return;
    }

    const cam = estado.camera;
    const agora = performance.now();
    const eu = playerPos.current;

    /** célula do servidor → candidato já projetado na tela */
    const candidato = (
      gid: number,
      x: number,
      y: number,
      atacando: boolean,
      alturaDoAlvo: number,
    ): Candidato => {
      const w = cellToWorld(map, mapping, x, y);
      // projeta o CORPO, não o pé. Mirar no monstro põe o ponteiro na altura do
      // peito dele, e o pé fica dezenas de pixels abaixo — projetando o chão, o
      // raio de assistência ficava quase todo ATRÁS do bicho, do lado por onde o
      // mouse nunca chega. É o mesmo ponto do cilindro de clique (`NetEntity`),
      // então o clique perto e o clique em cima concordam por construção.
      scratch.set(w.x, w.y + alturaDoAlvo, w.z);
      const dxCam = w.x - cam.position.x;
      const dzCam = w.z - cam.position.z;
      const visivel = dxCam * dxCam + dzCam * dzCam <= fogFar * fogFar;
      scratch.project(cam);
      // `z` fora de -1..1 é atrás da câmera; sem isto um alvo às costas do
      // jogador reaparece projetado NA TELA, espelhado
      const naTela =
        scratch.z >= -1 &&
        scratch.z <= 1 &&
        scratch.x >= -1 &&
        scratch.x <= 1 &&
        scratch.y >= -1 &&
        scratch.y <= 1;
      return {
        gid,
        px: (scratch.x * 0.5 + 0.5) * tamanho.width,
        py: (-scratch.y * 0.5 + 0.5) * tamanho.height,
        naTela,
        visivel,
        distanciaDoJogador: Math.hypot(w.x - eu.x, w.z - eu.z) / cellSize,
        atacando,
      };
    };

    const mundo = useWorldStore.getState();
    const mobs: Candidato[] = [];
    for (const gid of mundo.gids) {
      const e = mundo.entities[gid];
      if (!e || e.kind !== "mob" || gid === mundo.selfGid) continue;
      mobs.push(candidato(gid, e.x, e.y, estaMeAtacando(gid, agora), cellSize * MIRA_ALTURA_MOB));
    }

    const mob = melhorAlvo(p, mobs);
    publicarDiagnostico(p, mobs, mob?.gid ?? 0);
    if (mob) {
      useSoftLockStore.getState().apontar({ gid: mob.gid, tipo: "mob" });
      return;
    }

    /**
     * Sem em quem bater, o clique pega o que está no chão.
     *
     * A lista de itens só é montada quando NÃO há mob: num campo cheio de drop
     * depois de uma caçada, projetar dezenas de caixinhas por quadro para
     * descartá-las em seguida seria trabalho jogado fora.
     */
    const itens: Candidato[] = [];
    for (const it of Object.values(useGroundItems.getState().items)) {
      itens.push(candidato(it.gid, it.x, it.y, false, cellSize * MIRA_ALTURA_ITEM));
    }
    const item = melhorAlvo(p, itens);
    useSoftLockStore.getState().apontar(item ? { gid: item.gid, tipo: "item" } : null);
  });

  return null;
}

/**
 * `__mira()` no console (DEV): por que a assistência escolheu — ou não escolheu.
 *
 * Sem isto, "o aim assist não está funcionando" não tem como ser respondido: não
 * dá para saber se o ponteiro chegou, se havia candidato, ou se todos ficaram a
 * 50 px de um raio de 48. Devolve o ponteiro, o alvo e a distância em PIXEL de
 * cada mob, ordenada — o número que a decisão usa, na unidade em que ela pensa.
 *
 * Escreve num objeto de módulo por quadro, e o `window` recebe só um GETTER: uma
 * atribuição por quadro no `window` é observável pelo GC e pelo devtools.
 */
const diagnosticoDaMira: {
  ponteiro: { px: number; py: number } | null;
  alvo: number;
  raio: number;
  mobs: { gid: number; distPx: number; naTela: boolean; visivel: boolean; atacando: boolean }[];
} = { ponteiro: null, alvo: 0, raio: RAIO_ASSIST_PX, mobs: [] };

function publicarDiagnostico(p: { px: number; py: number }, mobs: Candidato[], alvo: number) {
  if (!import.meta.env.DEV) return;
  diagnosticoDaMira.ponteiro = p;
  diagnosticoDaMira.alvo = alvo;
  diagnosticoDaMira.mobs = mobs
    .map((c) => ({
      gid: c.gid,
      distPx: Math.round(Math.hypot(c.px - p.px, c.py - p.py)),
      naTela: c.naTela,
      visivel: c.visivel,
      atacando: c.atacando,
    }))
    .sort((a, b) => a.distPx - b.distPx)
    .slice(0, 8);
}

if (import.meta.env.DEV) {
  (window as unknown as { __mira?: () => unknown }).__mira = () => diagnosticoDaMira;
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
  orcamentoTerrenoMs,
  onTerrenoProgresso,
  precarregarTerreno = false,
  precompilarProps = false,
}: {
  map: GameMap;
  gameplay: GameplayConfig;
  playerPos: React.MutableRefObject<THREE.Vector3>;
  camAzimuth: React.MutableRefObject<number>;
  /** true = quem manda no mundo é o rAthena (ver net/); false = mundo local de demo */
  online: boolean;
  /** repassados ao SquareTerrain — a tela de carregamento mora no PlayView */
  orcamentoTerrenoMs?: number;
  onTerrenoProgresso?: (feitos: number, total: number) => void;
  /**
   * Montar o mapa INTEIRO em segundo plano — só enquanto a tela de carregamento
   * está no ar (ver o uso no `PlayView`).
   */
  precarregarTerreno?: boolean;
  /**
   * Compilar os materiais de TODA espécie de prop do mapa, atrás da cortina.
   *
   * Só na fase de AQUECIMENTO: na de construção a cena está com
   * `visible = false` e o `compileAsync` percorre por `traverseVisible` — ali
   * ele não compilaria nada. Ver `play/PreCompilarProps`.
   */
  precompilarProps?: boolean;
}) {
  // A grade DESTE mapa: hexágonos do editor ou quadrados do rAthena. Tudo que
  // era `if (isHex)` espalhado pela cena passa por aqui.
  const grid = gridFor(map);
  /**
   * Onde o mouse aponta no chão — preenchido pelo `GroundInteract`.
   *
   * Fica aqui, e não dentro dele, porque a prévia da skill de área precisa do
   * MESMO ponto: recalcular custaria um segundo raycast por quadro e os dois
   * poderiam divergir por um quadro, com o disco caindo numa célula e o clique
   * noutra.
   */
  const hoverChao = useRef<{ x: number; z: number } | null>(null);

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

  /**
   * O que o clique faz com o alvo travado — ver `play/aimAssist`.
   *
   * Ele NÃO escolhe o alvo: quem escolhe é o `AssistenciaDeMira`, uma vez por
   * quadro, e publica no `play/softLockStore`. Aqui só se lê o que está
   * publicado. Enquanto eram duas contas — uma para acender, outra no clique —
   * o mouse podia andar entre elas, e o jogo acendia um monstro e batia noutro.
   *
   * Sem `mapping` (preview do editor, mundo local) devolve `undefined` e o
   * clique volta a ser só caminhada.
   */
  const assistir = useMemo(() => {
    if (!mapping) return undefined;

    return (): boolean => {
      const mira = useAimStore.getState().skill;
      // skill de ÁREA não é assistida: o alvo dela é a célula que o jogador
      // escolheu, e puxar o ponto mudaria onde a magia cai
      if (cliqueVaiParaOChao(mira)) return false;

      const alvo = useSoftLockStore.getState().alvo;
      if (!alvo) return false;

      /**
       * Com skill de ALVO mirando, a assistência escolhe EM QUEM — e só isso.
       * Item não serve: quem apontou uma magia não quer pegar loot.
       */
      if (mira && mira.mode === "entity") {
        if (alvo.tipo !== "mob") return false;
        castarEmAlvo(mira.id, mira.level, mira.name, alvo.gid);
        useAimStore.getState().cancel();
        return true;
      }

      if (alvo.tipo === "mob") {
        const e = useWorldStore.getState().entities[alvo.gid];
        if (!e) return false;
        atacar(alvo.gid, e.x, e.y);
        return true;
      }

      const it = useGroundItems.getState().items[alvo.gid];
      if (!it) return false;
      pegar(it.gid, it.x, it.y);
      return true;
    };
  }, [mapping]);
  // culling por distância (só em mapas hex/blocks): render o pedaço ao redor do
  // player. Recalcula por chunk (useViewCenter), não por frame. Fog esconde a borda.
  const center = useViewCenter(playerPos, CHUNK * gameplay.hexScale);
  // raios e névoa saem do MESMO lugar (play/viewRadius), que é onde mora a regra
  // "não desenhe o que a névoa já escondeu" — e onde o teste a confere
  const visao = raiosDeVisao(gameplay);
  const PROP_RADIUS = visao.props;
  const TERRAIN_RADIUS = visao.terreno;
  const FOG_NEAR = visao.fogNear;
  const FOG_FAR = visao.fogFar;
  // extensão do mundo pro plano de clique: num mapa hex é o passo do grid ×
  // tamanho (que já embute o hexScale); no smooth é a grade de células. Uma
  // folga de um tile evita borda morta no último hexágono.
  const ground = useMemo(
    () => grid.extent(map),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, isHex, gameplay.hexScale],
  );

  /**
   * COMO O SERVIDOR ANDA: o pacote de movimento traz só as duas pontas do
   * trecho, então o cliente refaz o caminho com o mesmo A* do rAthena
   * (net/pathfind) para não cortar quina nem atravessar parede. Registrado aqui
   * porque é a cena que tem a colisão e a amarração com a grade do servidor.
   *
   * No RENDER, não num efeito: efeitos de FILHO rodam antes dos do pai, então o
   * `NetPlayer` montava (e podia receber pacote de movimento) antes de existir
   * pathfinder — e sem ele o `buildMotion` cai no passo de rei, que desenha
   * linha reta por cima de parede. Mesma janela reaparecia depois de cada warp,
   * porque a limpeza zera o registro. `useMemo` roda antes dos filhos montarem;
   * o efeito abaixo fica só com a limpeza da desmontagem.
   */
  const buscaDeCaminho = useMemo(() => {
    if (!mapping) return null;
    // Props sólidos entram no caminho pela MESMA regra que o exportador usa ao
    // gravar o `map_cache` (grid/propCells): é assim que o desenho do cliente
    // acompanha o desvio que o servidor já faz em volta da árvore.
    const bloqueadasPorProp = propBlockedCellsCached(map);
    return {
      caminho: (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const a = serverToLocal(mapping, from.x, from.y);
        const b = serverToLocal(mapping, to.x, to.y);
        const caminho = findPath(map, { x: a.col, y: a.row }, { x: b.col, y: b.row }, bloqueadasPorProp);
        if (!caminho) return null;
        return caminho.map((c) => {
          const s = localToServer(mapping, c.x, c.y);
          return { x: s.x, y: s.y };
        });
      },
      // O teto do pedido não é constante: o rAthena aceita 30 células com a reta
      // livre e só 14 quando há bloqueio no meio (`OFFICIAL_WALKPATH`), recusando
      // em silêncio acima disso. Quem sabe se a reta está livre é a cena.
      teto: (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const a = serverToLocal(mapping, from.x, from.y);
        const b = serverToLocal(mapping, to.x, to.y);
        return tetoDeTrecho(map, { x: a.col, y: a.row }, { x: b.col, y: b.row }, bloqueadasPorProp);
      },
    };
  }, [map, mapping]);

  // no RENDER (ver acima): fecha a janela entre o filho montar e o pai rodar efeito
  setPathfinder(buscaDeCaminho?.caminho ?? null);
  setTetoDeTrecho(buscaDeCaminho?.teto ?? null);

  /**
   * E DE NOVO NO EFEITO — senão o StrictMode desliga o pathfinder a sessão toda.
   *
   * Em DEV o React monta, DESMONTA e remonta cada componente uma vez. A limpeza
   * abaixo roda nesse desmonte simulado e zera o registro; o `useMemo` acima
   * NÃO re-executa no remonte (o valor memoizado continua válido, as
   * dependências não mudaram). Resultado: `pathfinder` ficava `null` da entrada
   * no mapa até recarregar a página, e ninguém percebia porque nada quebra —
   * o `buildMotion` cai no passo de rei e o personagem anda em linha reta.
   *
   * O estrago medido com ele nulo (`voo-*.json` do laudo): predição nunca roda
   * (`previu` = 0), a duração do trecho sai da distância em LINHA RETA e o
   * cliente termina o trecho cedo, ficando à frente do servidor — deriva
   * mediana de 7,8 células contra 3,2 no pior caso com o pathfinder ativo. Era
   * essa deriva que fazia o `clif_fixpos` seguinte ser classificado como
   * TELEPORTE e cravar o personagem 7 células atrás.
   *
   * Registrar aqui TAMBÉM é idempotente (escreve a mesma função) e devolve o
   * registro depois de qualquer limpeza — inclusive a do StrictMode.
   */
  useEffect(() => {
    setPathfinder(buscaDeCaminho?.caminho ?? null);
    setTetoDeTrecho(buscaDeCaminho?.teto ?? null);
    return () => {
      setPathfinder(null);
      setTetoDeTrecho(null);
    };
  }, [buscaDeCaminho]);

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

  /**
   * `visibleProps` muda a cada 16 unidades andadas (`useViewCenter`), e é
   * exatamente aí que um prop novo entra em cena — o momento em que um `.glb`
   * frio pode suspender o boundary.
   *
   * Num EFEITO, não no render: o carimbo tem de cair no commit, que é quando o
   * prop de fato monta. No render ele sairia adiantado e a correlação com a
   * suspensão ficaria invertida.
   */
  useEffect(() => {
    if (import.meta.env.DEV) marcarPropsVisiveis(visibleProps.length);
  }, [visibleProps.length]);

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
      {/* separa "cena escondida" de "cena desmontada": na re-suspensão o R3F
          esconde em vez de desmontar, então esta sonda ficar CALADA enquanto a
          `SondaDeSuspense` monta é a prova de que não houve desmonte */}
      {import.meta.env.DEV && <SondaDeCena />}
      <GradientSky top={SKY_TOP} bottom={SKY_HORIZON} />
      {/* fog: desbota do FOG_NEAR ao FOG_FAR; props/terreno renderizam além disso
          (já cobertos) → itens distantes emergem suave, sem pop na borda. Cor =
          base do gradiente do céu → horizonte contínuo. */}
      {culled && <fog attach="fog" args={[SKY_HORIZON, FOG_NEAR, FOG_FAR]} />}
      <ambientLight intensity={lighting.ambient} />
      {/* sol que segue o player (sombras corretas mesmo longe da origem) */}
      <SunRig targetRef={playerPos} offset={sunOff} intensity={lighting.sunIntensity} scale={gameplay.hexScale} />
      {/*
        NÃO existe mais `<Physics>` aqui.
        O Rapier era montado com terreno e props dentro, mas nada consultava o
        mundo dele: quem decide passagem é o `TerrainQuery` e, online, o
        map-server. O que ele fazia de fato era cobrar um passo de simulação por
        quadro e — pior — construir um collider `hull` toda vez que um prop
        entrava no culling, ou seja, no meio da caminhada. Quem quiser física de
        objeto de verdade (caixa que rola, ragdoll) precisa remontar o provider.
      */}
      <>
        {/* Terreno: peças hexagonais nos mapas do editor, malha por chunk nos
            mapas do rAthena, plano único no "smooth" legado. */}
        {/* nome é contrato com o GroundInteract: o clique mira o TOPO do terreno,
            não o plano de y=0 — sobre um bloco alto os dois estão longe um do outro */}
        <group name={TERRAIN_GROUP}>
          {isHex ? (
            <HexTerrain map={map} center={center} radius={TERRAIN_RADIUS} ground={gameplay} />
          ) : map.terrainMode === "square" ? (
            /* `precarregar`: o mapa inteiro é construído em segundo plano, com
               o que sobra do orçamento de cada quadro, então andar deixa de
               custar geometria. O que é DESENHADO continua sendo só o que cabe
               no alcance — desenhar os 169 chunks seriam 169 draw calls e ~346
               mil triângulos, e 81% deles ficam atrás de névoa opaca.

               Ele vale SÓ enquanto a cortina está no ar. A tela de carregamento
               tem teto de tempo (`TETO_PRECARGA_MS`), e quando ela caía por
               estouro a fila continuava cheia: o `useFrame` do `SquareTerrain`
               seguia construindo 6 ms POR QUADRO enquanto o jogador andava —
               exatamente o desperdício que a tela existe para eliminar, e uma
               fonte de quadros longos o bastante para fechar o trecho de
               caminhada antes da emenda (ver `worldStore.selfMove`). Depois da
               cortina, o streaming normal (`porConstruir` + o anel de folga) já
               cobre tudo. */
            <SquareTerrain
              map={map}
              center={center}
              radius={TERRAIN_RADIUS}
              ground={gameplay}
              precarregar={precarregarTerreno}
              orcamentoMs={orcamentoTerrenoMs}
              onProgresso={onTerrenoProgresso}
            />
          ) : (
            <MapTerrain map={map} />
          )}
        </group>
        {/* props do mapa (culled); o "smooth" legado usa o scatter de demo.
            O nome do grupo é contrato com o GroundInteract: é nele que o clique
            testa se o raio bateu numa árvore antes de chegar ao chão. */}
        <group name={PROPS_GROUP}>
          {/*
            UM `<Suspense>` POR PROP, como o editor sempre fez
            (`EditorScene.tsx`). Sem eles, um único `.gltf` frio entrando no
            culling suspendia o boundary que embrulha a CENA INTEIRA — medido no
            `voo-1785937156994.json`: `Rock_3_M_Color1.gltf`, 177 ms suspenso, e
            no fim o React desmontava e remontava a subárvore.

            O piscar de um quadro era o sintoma visível; o estrago caro era o
            remonte levar junto o cache de chunks do `SquareTerrain` (169 → 4 no
            laudo, ou seja ~35 MB e ~450 ms de geometria refeitos do zero).

            Com um boundary por prop, o que falta é UM prop, por alguns
            quadros — o resto do mundo nem fica sabendo. O `fallback` é `null`
            de propósito: a alternativa seria desenhar um placeholder no lugar
            de uma árvore, o que é pior que a ausência dela.
          */}
          {visibleProps.map((p) => (
            <Suspense key={p.id} fallback={null}>
              <PropInstance prop={p} />
            </Suspense>
          ))}
        </group>
        {/* paga a compilação de shader de TODA espécie do mapa enquanto a
            cortina está no ar — ver `play/PreCompilarProps` */}
        {precompilarProps && <PreCompilarProps map={map} />}
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
              fogFar={visao.fogFar}
            />
            <GroundItems map={map} mapping={mapping} cellSize={moveCell} />
            <NetPlayer
              map={map}
              mapping={mapping}
              gameplay={gameplay}
              positionRef={playerPos}
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
      </>
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
        hoverRef={hoverChao}
        assistir={assistir}
      />
      {/* Tab cicla o inimigo mais próximo, com peso para onde a câmera aponta */}
      {mapping && <AlvoPorTab map={map} mapping={mapping} fogFar={FOG_FAR} />}
      {/* a trava do soft lock, visível: acende o mob que o clique acertaria */}
      {mapping && (
        <AssistenciaDeMira
          map={map}
          mapping={mapping}
          cellSize={moveCell}
          playerPos={playerPos}
          fogFar={FOG_FAR}
        />
      )}
      {/* skill de área mirando: onde ela cai e de onde dá para lançá-la */}
      <AimPreview playerPos={playerPos} hoverPos={hoverChao} cellSize={moveCell} terrain={world.terrain} />
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
        terrain={world.terrain}
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

/**
 * Tela que cobre o canvas enquanto o mundo é montado.
 *
 * `fracao` é `null` enquanto não há progresso mensurável (fetch do mapa e o zod
 * das 160.000 células, que é um bloco só e não avisa o meio do caminho) — aí a
 * barra fica indeterminada em vez de mentir um número.
 */
function TelaDeCarregamento({ rotulo, fracao }: { rotulo: string; fracao: number | null }) {
  return (
    <div style={{ ...waiting, flexDirection: "column", gap: 14 }}>
      <div>{rotulo}</div>
      <div
        style={{
          width: 260,
          height: 6,
          borderRadius: 3,
          background: "#1b2030",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: fracao === null ? "35%" : `${Math.round(fracao * 100)}%`,
            background: "#c9a227",
            borderRadius: 3,
            // sem fração não há o que animar por porcentagem; a barra parcial
            // parada já diz "está trabalhando" sem inventar progresso
            opacity: fracao === null ? 0.5 : 1,
            transition: "width 120ms linear",
          }}
        />
      </div>
      {fracao !== null && (
        <div style={{ font: "11px system-ui", color: "#7d8496" }}>{Math.round(fracao * 100)}%</div>
      )}
    </div>
  );
}

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
  /** ver o bloco de `mapaDoHud`, abaixo: mantém o HUD montado na troca de mapa */
  const ultimoMapa = useRef<GameMap | null>(null);
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

  /**
   * Baixa AGORA os assets que este mapa usa, enquanto a cortina está no ar.
   *
   * No RENDER e não num efeito, pela mesma razão que o `setPathfinder` da
   * `Scene` está no render: efeito de pai roda DEPOIS do de filho, e depois do
   * primeiro commit — os props já teriam montado e pedido os `.gltf` a frio,
   * que é exatamente o que se quer evitar. `useGLTF.preload` é idempotente,
   * então o StrictMode chamar duas vezes não custa nada.
   *
   * É a prevenção; o `<Suspense>` por prop lá embaixo é a contenção. As duas
   * porque a primeira não cobre prop que o mapa não declara (nada hoje, mas o
   * scatter procedural do editor pode passar a criar) e a segunda não evita o
   * download, só o estrago.
   */
  if (map) preloadPropsDoMapa(map.props);

  /**
   * O ÚLTIMO mapa não-nulo, só para o HUD não DESMONTAR na troca.
   *
   * Esconder o HUD por CSS (em vez de desmontá-lo) não bastou, e o laudo pegou:
   * no `voo-1785946077631.json` o `desmontou-em hud` continuou saindo em cada
   * portal, levando `retrato:jogador` e `retrato:alvo` junto no MESMO
   * milissegundo. A razão é o `useMap`, que faz `setMap(null)` assim que o `id`
   * muda — então `{map && …}` derrubava a subárvore antes de a condição de
   * `carregando` ter qualquer chance de agir.
   *
   * Mesmo padrão do `ultima` do `TargetFrame`, e pela mesma razão: segurar a
   * última ficha boa para o `<Canvas>` do retrato não precisar morrer, porque
   * contexto novo nasce com o cache de programa vazio e recompila tudo.
   *
   * O mapa velho nunca é VISTO: enquanto `map` é nulo o bloco está em
   * `display: none`. Ele só existe para o React não derrubar a subárvore.
   */
  if (map) ultimoMapa.current = map;
  const mapaDoHud = map ?? ultimoMapa.current;
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
  const phase = useSessionStore((s) => s.phase);
  const navigate = useNavigate();

  /**
   * Tela de carregamento: segura o jogador até o mapa INTEIRO estar montado.
   *
   * O `SquareTerrain` já construía o mapa todo em segundo plano (`precarregar`),
   * mas gotejando 6 ms por quadro ENQUANTO se joga — competindo com o quadro
   * justamente enquanto o jogador anda, que é quando chunk novo entra no
   * alcance. Atrás desta tela ele monta tudo com o dobro de orçamento e sem
   * ninguém olhando; depois dela, andar não constrói mais nada.
   *
   * Só mapa `square` (o do rAthena) tem pré-carga — o hex do editor não a liga.
   */
  const [precarga, setPrecarga] = useState<{ feitos: number; total: number } | null>(null);
  const [precargaExpirou, setPrecargaExpirou] = useState(false);
  const aoProgredirTerreno = useCallback(
    (feitos: number, total: number) => setPrecarga({ feitos, total }),
    [],
  );
  const esperaPreCarga = map?.terrainMode === "square";
  // trocar de mapa (warp) recomeça a espera do zero
  useEffect(() => {
    setPrecarga(null);
    setPrecargaExpirou(false);
    setAquecido(false);
  }, [mapId]);
  useEffect(() => {
    if (!esperaPreCarga) return;
    const t = setTimeout(() => setPrecargaExpirou(true), TETO_PRECARGA_MS);
    return () => clearTimeout(t);
  }, [esperaPreCarga, mapId]);
  /** o mapa ainda nem chegou (fetch + zod de 160.000 células) */
  const carregandoMapa = !IS_PREVIEW && !map && !error;
  const carregandoTerreno =
    esperaPreCarga && !precargaExpirou && (precarga === null || precarga.feitos < precarga.total);
  /** fase 1: montando dado. Nada é desenhado, e é por isso que ela é rápida. */
  const construindo = carregandoMapa || carregandoTerreno;
  /**
   * Fase 2: AQUECER — a cena já é desenhada, mas a cortina continua no ar.
   *
   * Ela existe porque a fase 1 não aquece nada: com `scene.visible = false` o
   * three nem percorre a cena, então não compila shader nem sobe textura para a
   * GPU. Revelar direto no fim da construção só mudaria o engasgo de lugar — o
   * primeiro quadro visível pagaria a compilação de TODOS os materiais de uma
   * vez, que é o pior quadro possível e logo no instante em que o jogador ganha
   * o controle.
   *
   * Aqui a cena é desenhada de verdade atrás da cortina: shader compila, textura
   * sobe, o `useFrame` de cada coisa dá as primeiras voltas. Quando os quadros
   * caros acabam, a cortina sai — e o primeiro quadro que o jogador vê já é um
   * quadro barato. Quem decide que acabou é o `AquecerCena`.
   */
  const [aquecido, setAquecido] = useState(false);
  const aoAquecer = useCallback(() => setAquecido(true), []);
  const aquecendo = !construindo && Boolean(map) && !aquecido;
  const carregando = construindo || aquecendo;

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
    <div style={{ position: "absolute", inset: 0 }}>
      {/* só com sessão: avisa o map-server que a cena montou e escuta o mundo */}
      {online && map && <WorldEventsBridge />}
      <Canvas
        camera={{ position: [40, 40, 40], fov: FOV_DA_CAMERA, near: 0.5, far: 4000 }}
        /**
         * PCF simples, não PCF *soft*.
         *
         * `shadows` sozinho herda o `PCFSoftShadowMap`, que é o filtro mais caro
         * do three — ele amostra o mapa de sombra várias vezes por fragmento
         * para suavizar a borda. Num visual low-poly com sol duro a borda macia
         * quase não aparece, e a conta é paga em cada pixel de chão da tela.
         * `"percentage"` é o `PCFShadowMap`.
         */
        shadows="percentage"
        /**
         * Teto de `dpr`: sem ele o canvas nasce no `devicePixelRatio` da tela, e
         * num notebook hi-dpi isso é 4× de pixels para desenhar o MESMO quadro
         * (nesta máquina o valor é 1, então aqui não muda nada — é seguro contra
         * "no outro PC trava"). O `CharacterPortrait` já fazia isso.
         */
        dpr={[1, 1.5]}
      >
        {/* Fora do Suspense: tem de valer já no primeiro quadro, antes de
            qualquer .gltf resolver.
            `construindo`, não `carregando`: durante o AQUECIMENTO a cena tem de
            estar visível para o three compilar os shaders dela — quem esconde
            ali é a cortina, não a cena. */}
        <OcultarCena oculta={construindo} />
        {aquecendo && <AquecerCena aoTerminar={aoAquecer} />}
        {/*
          O fallback deixou de ser `null` em DEV, e isso é INSTRUMENTAÇÃO, não
          conteúdo: `SondaDeSuspense` não desenha nada, ela só existe enquanto o
          boundary está suspenso — montar = suspendeu, desmontar = revelou. É o
          único sinal direto disponível, porque a promessa é lançada no render e
          o React não conta quem a lançou.

          O NOME importa: o `<Suspense>` do retrato do HUD também é nomeado, e
          sem isso "qual boundary caiu" ficaria ambíguo quando os dois
          suspendessem juntos.
        */}
        <Suspense fallback={import.meta.env.DEV ? <SondaDeSuspense nome="cena" /> : null}>
          {import.meta.env.DEV && <PerfProbe />}
          {map && (
            <Scene
              map={map}
              gameplay={gameplay}
              playerPos={playerPos}
              camAzimuth={camAzimuth}
              online={online}
              orcamentoTerrenoMs={carregandoTerreno ? ORCAMENTO_CARREGANDO_MS : undefined}
              onTerrenoProgresso={aoProgredirTerreno}
              precarregarTerreno={carregandoTerreno}
              precompilarProps={aquecendo}
            />
          )}
        </Suspense>
      </Canvas>
      {/* o medidor é do JOGO rodando: sobre a tela de carregamento ele mediria
          quadros que não desenham nada e ainda apareceria por cima do aviso */}
      {import.meta.env.DEV && !carregando && <PerfOverlay />}

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
      {/* Cobre o canvas SEM desmontá-lo: é o `useFrame` do SquareTerrain, rodando
          por baixo, que drena a fila da pré-carga. Substituir o canvas por esta
          tela pararia justamente o trabalho que ela está esperando. */}
      {carregando && !error && (
        <TelaDeCarregamento
          rotulo={
            carregandoMapa
              ? "carregando o mapa…"
              : carregandoTerreno
                ? "montando o terreno…"
                : "preparando a cena…"
          }
          // no aquecimento não há fração honesta a mostrar: o que se espera é a
          // compilação parar, e ninguém sabe de antemão quantos shaders faltam
          fracao={aquecendo || carregandoMapa || !precarga ? null : precarga.feitos / precarga.total}
        />
      )}
      {/*
        O HUD vem DEPOIS da tela de carregamento no DOM, e elemento posicionado
        pinta na ordem em que aparece: sem escondê-lo, barras, minimapa e chat
        ficavam POR CIMA do aviso de carregamento.

        Mas ele é ESCONDIDO, não desmontado — a mesma solução que o
        `TargetFrame` já usa, e pela mesma razão. Cada `CharacterPortrait` é um
        `WebGLRenderingContext` inteiro, e desmontar o HUD levava os dois junto:
        medido no `voo-1785940564494.json`, `desmontou-em hud`,
        `retrato:jogador` e `retrato:alvo` saem no MESMO milissegundo, os
        canvases morrem 11 ms depois e renascem 1,5 s adiante. Um contexto novo
        nasce com o cache de PROGRAMA vazio, então tudo que o retrato desenha
        volta a compilar do zero — e compilar shader é o gargalo medido neste
        laudo (190 ms dentro de `gl.render` num quadro de 207).

        `display: contents` não cria caixa nenhuma, então os filhos continuam
        posicionados contra o mesmo bloco de contenção que antes — o layout é
        idêntico, some só a pintura.
      */}
      {mapaDoHud && (
        <div style={{ display: carregando || !map ? "none" : "contents" }}>
          <Hud map={mapaDoHud} playerPos={playerPos} />
        </div>
      )}
    </div>
  );
}
