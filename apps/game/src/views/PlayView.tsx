import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useNavigate } from "react-router-dom";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GameMapSchema, type GameMap, DEFAULT_LIGHTING } from "@ragnarok/map-format";
import type { GameplayConfig } from "@ragnarok/game-data";
import { useMap } from "../map/useMap";
import { MapTerrain } from "../map/MapTerrain";
import { HexTerrain } from "../hex/HexTerrain";
import { setHexScale } from "../hex/hexGrid";
import { gridFor } from "../grid";
import { SquareTerrain } from "../grid/SquareTerrain";
import { HorizonMesh } from "../grid/HorizonMesh";
import { TreeImpostors } from "../grid/TreeImpostors";
import { propBlockedCellsCached } from "../grid/propCells";
import { buildSquareDemo } from "../play/squareDemoMap";
import { buildWindTestMap, type WindTestStage } from "../play/windTestMap";
import { WindSystem } from "../props/WindSystem";
import { scaleMapPositions } from "../hex/mapScale";
import { groundProps } from "../hex/groundProps";
import { PropInstance } from "../props/PropInstance";
import { VegetationInstancer, ehCategoriaInstanciavel } from "../props/VegetationInstancer";
import { Monster } from "../entities/Monster";
import { NpcWalker } from "../entities/NpcWalker";
import { previewSpawns, type PreviewSpawn } from "../entities/previewSpawns";
import { Player } from "../play/Player";
import { usePlayStore } from "../play/playStore";
import { TriggerRuntime } from "../play/TriggerRuntime";
import { GroundInteract, markerRadiusFor, PROPS_GROUP } from "../play/GroundInteract";
import { TERRAIN_GROUP, temLinhaDeVisada } from "../play/pickGround";
import { AimPreview } from "../play/AimPreview";
import { AttackRangeCircle } from "../play/AttackRangeCircle";
import { AlvoPorTab } from "../play/AlvoPorTab";
import { melhorAlvo, RAIO_ASSIST_PX, type Candidato } from "../play/aimAssist";
import { useSoftLockStore } from "../play/softLockStore";
import { atacar, castarEmAlvo, pegar } from "../net/acoes";
import { useWorldDropStore } from "../net/worldDropStore";
import { cliqueVaiParaOChao, useAimStore } from "../net/aimStore";
import { FollowCamera } from "../play/FollowCamera";
import { useViewCenter } from "../play/useViewCenter";
import { AQUECIMENTO_INICIAL, passoDeAquecimento } from "../play/aquecimento";
import { visibilidadeDoMundo } from "../play/worldVisibility";
import { GradientSky } from "../scene/GradientSky";
import { TexturedSky } from "../scene/TexturedSky";
import { AmbientParticles, isParticleKind, type ParticleKind } from "../vfx/AmbientParticles";
import { buildSceneTestMap, PARTICLE_SPOTS } from "../play/sceneTestMap";
import { SHOWCASE_MAP_ID, SHOWCASE_PARTICLE_SPOTS } from "../play/showcaseSpots";
import { aplicarNevoaDoCeu } from "../scene/skyFog";
import { SKY_HORIZON, SKY_TOP } from "../scene/skyGradient.glsl";
import { RetroFilter } from "../scene/RetroFilter";
import { PerfProbe, PerfOverlay } from "../scene/PerfHud";
import { attachWebglContextRecovery } from "../core/webglContextRecovery";
import { SondaDeCena, SondaDeSuspense, SondaDeRender } from "../core/diagnostics/SondaDeCanvas";
import { PreCompilarProps } from "../play/PreCompilarProps";
import { marcarPropsVisiveis } from "../core/diagnostics/cenaProbe";
import { isolado } from "../core/diagnostics/isolamento";
import { medir } from "../core/diagnostics/medir";
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
import { VfxRoot } from "../vfx/core/VfxRoot";
import { Projectile } from "../vfx/Projectile";
import { GroundItems, useGroundItems } from "../net/GroundItems";
import { MapAmbience } from "../audio/mapAmbience";
import { preloadAssets } from "../assets";
import { preloadPropsDoMapa, urlsDoMapa } from "../props/registry";
import { preloadWindowArt } from "../ui/preloadWindowArt";

preloadAssets();
preloadWindowArt();

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
/**
 * Teto pra espera de ASSETS do mapa (`EsperaAssetsDoMapa`) — mesma régua do
 * `TETO_PRECARGA_MS` acima, mas mais folgado: aquele é geometria local
 * (CPU, sem rede); isto é fetch de `.gltf`/textura de verdade, que numa
 * conexão ruim pode legitimamente demorar mais que 3 s. É válvula de
 * segurança, não o caminho normal — o bake do atlas de árvore/arbusto
 * (`grid/treeImpostorBake.ts`) já mede ~1 s pra dezenas de espécies com o
 * asset em cache; isto aqui é só pro caso de rede lenta/asset preso não
 * segurar o jogador pra sempre.
 */
const TETO_ASSETS_MS = 8000;
const SUN_DISTANCE = 140; // mesma escala do editor (EditorScene) — só a direção muda
/** fator de compensação de luminância da troca `ambientLight`→`hemisphereLight`
 * (ver comentário no JSX abaixo). 1.7 ainda deixava o lado sem sol escuro
 * demais (relato do teste de showcase) — 2.4 é o segundo ajuste. */
const HEMI_BOOST = 2.4;
/** tom de "chão" do hemisphereLight — mais claro que um marrom terroso de
 * verdade, de propósito: é luz de preenchimento, não física de bounce */
const HEMI_GROUND = "#8a7d64";

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
function SunRig({ targetRef, offset, intensity = 1.35, scale = 1, shadowsOn = true }: { targetRef: React.MutableRefObject<THREE.Vector3>; offset: THREE.Vector3; intensity?: number; scale?: number; shadowsOn?: boolean }) {
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
        castShadow={shadowsOn}
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
    aoTerminar();
  });

  return null;
}

/**
 * Sinaliza "ainda tem asset do mapa em voo" — o fallback de um `<Suspense>`
 * que embrulha `EsperaAssetsDoMapa`. Montado ⇒ suspenso ⇒ ainda carregando;
 * desmontado ⇒ resolveu. Mesmo idioma de `SondaDeSuspense`
 * (`core/diagnostics/SondaDeCanvas.tsx`): "monta = suspendeu, desmonta =
 * revelou" é o único sinal disponível, porque a promessa é lançada no
 * render e o React não devolve quem a lançou.
 */
function AvisaCarregandoAssets({ set }: { set: (v: boolean) => void }) {
  useEffect(() => {
    set(true);
    return () => set(false);
  }, [set]);
  return null;
}

/**
 * Suspende até TODAS as urls do mapa (props, vegetação instanciada, espécies
 * do impostor de árvore/arbusto — `urlsDoMapa` cobre as três, é o mesmo
 * conjunto que `preloadPropsDoMapa` já baixa) estarem resolvidas no cache do
 * `useGLTF`. Nunca desenha nada — existe só para o `<Suspense>` pai saber
 * quando a cortina pode considerar os ASSETS prontos, não só o terreno.
 *
 * ## Por que isto precisa existir
 *
 * `preloadPropsDoMapa` (chamado no boot) é FIRE-AND-FORGET DE PROPÓSITO — a
 * API do drei (`suspend-react`) descarta a promise (`void query(...)`), não
 * dá pra `await` nela. Sem este componente, `construindo`/`aquecendo` só
 * sabiam sobre terreno (`SquareTerrain.precarregar`): num carregamento a
 * frio, com dezenas de `.gltf` de vegetação ainda em voo, a cortina podia
 * cair achando que "terminou" — e o jogador ganhava controle enquanto árvore,
 * arbusto e o atlas de impostor (`grid/TreeImpostors`) ainda estavam
 * suspensos, chegando aos pedaços em pleno jogo. Era a folga que sobrava do
 * "entra rápido, mas demora até esquentar" mesmo depois do bake do atlas
 * parar de levar 41 segundos (`grid/treeImpostorBake.ts`) — o BAKE ficou
 * rápido, mas a CORTINA nunca esperava por ele pra começo de conversa.
 */
function EsperaAssetsDoMapa({ urls, set }: { urls: string[]; set: (v: boolean) => void }) {
  useGLTF(urls);
  // Roda SÓ quando isto de fato renderiza — ou seja, resolveu (`useGLTF` não
  // suspendeu, ou suspendeu e voltou). Sem isto, o caso "nada suspendeu" (urls
  // já em cache) nunca dispara `set(false)` nenhum: o fallback não chega a
  // montar, então `AvisaCarregandoAssets` também não roda — o único jeito de
  // sair do `true` inicial é o filho resolvido se anunciar sozinho.
  useEffect(() => {
    set(false);
  }, [set]);
  return null;
}

/**
 * O SINAL DE VERDADE de que `<Scene>` MONTOU — não que o mapa chegou, não que
 * o HUD pode aparecer: que a raiz da própria árvore 3D (terreno, céu, luz,
 * atlas de impostor de árvore) parou de estar suspensa e comitou de verdade.
 *
 * ## A causa raiz que isto corrige
 *
 * Antes desta sonda, `construindo`/`aquecendo`/`aquecido` não tinham NENHUMA
 * ligação com o `<Suspense>` que embrulha `<Scene>` — dependiam só de sinais
 * paralelos (mapa chegou, terreno pré-cacheado, urls de prop resolvidas). O
 * `AquecerCena` decide "aquecida" quando `gl.info.programs.length` PARA de
 * crescer por 8 quadros — e numa cena AINDA SUSPENSA (`<Scene>` nunca montou)
 * essa contagem fica travada em 0 desde o primeiro quadro: "0 parado por 8
 * quadros" é indistinguível de "compilação terminada", e a cortina caía em
 * ~130 ms com a `THREE.Scene` de verdade tendo ZERO filhos. É exatamente a
 * assinatura da referência do usuário (`aee.jpg`): HUD completo, `cena: 0
 * filhos · 0 vis · OCULTA`, `draw calls 0`, `triângulos 0k` — o jogo achava
 * que tinha terminado de aquecer algo que nunca chegou a existir.
 *
 * ## Por que um SIBLING de `<Scene>`, dentro do MESMO `<Suspense>`
 *
 * Um `<Suspense>` só comita QUALQUER filho quando NENHUM descendente dentro
 * dele está suspenso — é a mesma garantia que já sustenta `SondaDeSuspense`
 * (`core/diagnostics/SondaDeCanvas.tsx`, "monta = suspendeu, desmonta =
 * revelou"), só que aqui o sinal vira ESTADO de verdade (`cenaMontada`), não
 * só evento de flight recorder — e por isso não pode ficar atrás do `if
 * (import.meta.env.DEV)` que protege aquela sonda: a cortina em produção
 * precisa da MESMA garantia.
 *
 * `<VegetationInstancer>` e cada `<PropInstance>` têm `<Suspense
 * fallback={null}>` PRÓPRIO (ver o comentário longo no JSX de `Scene`) — de
 * propósito, para um `.glb` de prop individual não travar o mundo inteiro.
 * Este sinal NÃO espera por eles, e está certo não esperar: vegetação/prop
 * entrando aos poucos depois da cortina é o comportamento desejado. O que
 * bloqueia `cenaMontada` é só a estrutura que NÃO tem boundary próprio —
 * terreno, céu, luz, atlas de árvore (`TreeImpostors`) — que é precisamente
 * o que precisa estar de pé para a cena deixar de ser um retângulo cinza.
 */
function SinalizaCenaPronta({ set }: { set: (v: boolean) => void }) {
  useEffect(() => {
    set(true);
    return () => set(false);
  }, [set]);
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
  raioEntidade,
}: {
  map: GameMap;
  mapping: LegacyMapping;
  cellSize: number;
  playerPos: React.MutableRefObject<THREE.Vector3>;
  /** raio de DETALHE (Fase G) — nunca o do horizonte: além dele não é candidato */
  raioEntidade: number;
}) {
  const gl = useThree((s) => s.gl);
  const tamanho = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  /** ponteiro em px de CSS, relativo ao canvas; `null` = fora dele */
  const ponteiro = useRef<{ px: number; py: number } | null>(null);

  /**
   * Montanha e prop também BLOQUEIAM a mira, não só a visão.
   *
   * Achados por NOME uma vez (não a cada quadro — `getObjectByName` percorre a
   * cena inteira) e reachados quando o mapa troca, porque a troca desmonta e
   * remonta os dois grupos. Vazio até o primeiro `useEffect` rodar não é
   * problema: sem obstáculo nenhum, o gate abaixo simplesmente não filtra nada.
   */
  const obstaculos = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    const terreno = scene.getObjectByName(TERRAIN_GROUP);
    const props = scene.getObjectByName(PROPS_GROUP);
    obstaculos.current = [terreno, props].filter((o): o is THREE.Object3D => !!o);
  }, [scene, map]);

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
      const visivel = dxCam * dxCam + dzCam * dzCam <= raioEntidade * raioEntidade;
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

    let mob = melhorAlvo(p, mobs);
    /**
     * Montanha no meio não é candidato, mesmo perto do ponteiro.
     *
     * `visivel` acima só descarta pela NÉVOA — barato, testado por quadro para
     * todo candidato. O raio contra terreno/prop é caro (centenas de props na
     * cena), então só roda para o VENCEDOR, e só de novo se ele for excluído:
     * é "o alvo no blind da montanha", não "todo mob na tela". Teto de 6
     * exclusões por segurança num aglomerado cercado de obstáculo.
     */
    if (mob && obstaculos.current.length > 0) {
      const excluidos = new Set<number>();
      while (mob) {
        const e = mundo.entities[mob.gid];
        if (!e) break;
        const w = cellToWorld(map, mapping, e.x, e.y);
        const alvo = scratch.set(w.x, w.y + cellSize * MIRA_ALTURA_MOB, w.z).clone();
        if (temLinhaDeVisada(cam.position, alvo, obstaculos.current)) break;
        excluidos.add(mob.gid);
        if (excluidos.size >= 6) {
          mob = null;
          break;
        }
        mob = melhorAlvo(
          p,
          mobs.filter((m) => !excluidos.has(m.gid)),
        );
      }
    }
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
    let item = melhorAlvo(p, itens);
    if (item && obstaculos.current.length > 0) {
      const excluidos = new Set<number>();
      while (item) {
        const it = useGroundItems.getState().items[item.gid];
        if (!it) break;
        const w = cellToWorld(map, mapping, it.x, it.y);
        const alvo = scratch.set(w.x, w.y + cellSize * MIRA_ALTURA_ITEM, w.z).clone();
        if (temLinhaDeVisada(cam.position, alvo, obstaculos.current)) break;
        excluidos.add(item.gid);
        if (excluidos.size >= 6) {
          item = null;
          break;
        }
        item = melhorAlvo(
          p,
          itens.filter((m) => !excluidos.has(m.gid)),
        );
      }
    }
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
  aoPrecompilarVegetacao,
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
  /**
   * Avisa `PlayView` quando `VegetationInstancer` termina de precompilar
   * (ou não tem nada pra precompilar) — vira `vegetacaoPronta`, que
   * `gameReady` exige. Ver o comentário longo em `PlayView` sobre por quê.
   */
  aoPrecompilarVegetacao?: () => void;
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
  // raios e névoa saem do MESMO lugar (play/worldVisibility, que ENVOLVE
  // play/viewRadius), que é onde mora a regra "não desenhe o que a névoa já
  // escondeu" — e onde o teste a confere. `visibilidadeDoMundo` acrescenta os
  // raios de VEGETAÇÃO (Fase de coerência de horizonte) sem trocar nenhum dos
  // 4 raios que já existiam.
  const mapaMaiorLado = Math.max(grid.extent(map).width, grid.extent(map).depth);
  const visao = visibilidadeDoMundo(gameplay, mapaMaiorLado);
  const PROP_RADIUS = visao.detalhe;
  const TERRAIN_RADIUS = visao.detalhe;
  /**
   * Raio de ENTIDADE (mob/player/npc) — sempre `detalhe`, NUNCA `fogFar`.
   *
   * Fase G da auditoria de render: antes deste raio existir, `NetEntities`/
   * `AlvoPorTab`/`AssistenciaDeMira` liam `fogFar` direto, que agora é o raio
   * do HORIZONTE (~390, não ~130) — sem esta variável esticar a névoa faria
   * entidade desenhar e ser alvejável a centenas de unidades de distância.
   */
  const RAIO_ENTIDADE = visao.entidades;
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
  const visibleProps = useMemo(
    () =>
      medir("props→cull", () => {
        // isolamento (Fase C, `?iso=semProps`): nenhum prop monta — hoje é sempre
        // vazio em mapa real (`props: []` na migração), então isto só tem efeito
        // visível no `smooth` legado/editor
        if (isolado("semProps")) return [];
        if (!culled) return allProps;
        const r2 = PROP_RADIUS * PROP_RADIUS;
        return allProps.filter((p) => {
          const dx = p.position[0] - center.x, dz = p.position[2] - center.z;
          return dx * dx + dz * dz <= r2;
        });
      }),
    [allProps, culled, center.x, center.z, PROP_RADIUS],
  );

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
      {/* `semCeuFoto`: skybox real (Kenney, scene/TexturedSky) é o padrão;
          isolado volta pro degradê procedural antigo — teste A/B "sky
          enhancement ON/OFF" do pedido de auditoria. A névoa (abaixo) continua
          lendo SKY_TOP/SKY_HORIZON de qualquer jeito: as duas paletas batem
          (skybox-day.png foi escolhido por isso), então a névoa nunca precisou
          saber qual céu está desenhado. */}
      {isolado("semCeuFoto") ? <GradientSky top={SKY_TOP} bottom={SKY_HORIZON} /> : <TexturedSky skyId={map.sky?.skyId} />}
      {/* FASE G: a névoa amarra no HORIZONTE agora, não no raio de detalhe
          (`play/viewRadius`) — desbota de FOG_NEAR a FOG_FAR bem depois de onde
          o chão detalhado acaba (~130), dentro do trecho coberto pela malha
          decimada (`grid/HorizonMesh`, sempre presente). É isso que troca a
          "parede de névoa" antiga por: detalhe → chão simplificado → névoa →
          céu, contínuo. Cor = base do gradiente do céu, igual antes. */}
      {culled && !isolado("semNevoa") && <fog attach="fog" args={[SKY_HORIZON, FOG_NEAR, FOG_FAR]} />}
      {/* HemisphereLight troca o `ambientLight` chapado por luz de cima (céu)
          + luz de baixo (chão) — o lado sem sol direto deixa de ir a preto
          puro sem precisar de 2ª luz ambiente (regra do pedido: nenhuma
          ambient light extra). `semAmbiente` zera (teste A/B).

          `HEMI_BOOST = 1.7` e `HEMI_GROUND` mais claro que um marrom
          "realista": no showcase (`?map=scenetest`), a troca de `ambientLight`
          branco por `hemisphereLight` colorido deixou o lado sem sol direto
          visivelmente mais escuro que antes — mesmo `intensity` numérico, mas
          `SKY_TOP` (#5a8fc7) tem ~metade da luminância do branco que o
          `ambientLight` usava, e a metade de baixo da esfera (voltada pro chão)
          ainda mais escura com um marrom saturado. O boost e o chão mais claro
          compensam essa perda sem tocar na luz direcional nem crescer o
          contraste sol×sombra — é objetivo do pedido "sombra soma
          profundidade, não vira breu". */}
      <hemisphereLight args={[SKY_TOP, HEMI_GROUND, isolado("semAmbiente") ? 0 : lighting.ambient * HEMI_BOOST]} />
      {/* sol que segue o player (sombras corretas mesmo longe da origem).
          `semSol` apaga a luz inteira (não só a sombra) — teste A/B
          "LIGHTING ON/OFF"; `semSombra` mantém a luz mas tira só a sombra. */}
      {!isolado("semSol") && (
        <SunRig
          targetRef={playerPos}
          offset={sunOff}
          intensity={lighting.sunIntensity}
          scale={gameplay.hexScale}
          shadowsOn={!isolado("semSombra")}
        />
      )}
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
        <SondaDeRender id="centro-vegetacao">
        <group name={TERRAIN_GROUP}>
          {isolado("semTerreno") ? null : isHex ? (
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
        {/* FASE G — o HORIZONTE (`grid/HorizonMesh`), fora do `TERRAIN_GROUP` de
            propósito: o `GroundInteract` raycasta contra esse grupo para clique
            no chão e base de prop, e o horizonte não é uma superfície clicável —
            é a malha decimada do mapa INTEIRO, sempre presente, por baixo do
            chão detalhado. Só existe para o mapa real do rAthena (`"square"`):
            é onde a `props: []` da migração deixou o LOD3/impostor sem o que
            representar (ver o comentário do módulo) — hex/editor mantêm o
            terreno próprio deles, sem mudança. */}
        {map.terrainMode === "square" && <HorizonMesh map={map} playerPos={playerPos} />}
        {/* Impostores de árvore (grid/TreeImpostors): mesma extensão do
            HorizonMesh, mas para as árvores do mapa em vez do chão — troca
            binária com o PropInstance real no MESMO raio de detalhe
            (PROP_RADIUS), sem duplicar draw call por árvore. `limite`
            (`visao.limiteVegetacao`, Fase de coerência de horizonte): teto
            absoluto de distância — sem ele o impostor desenhava instâncias
            bem além da névoa, 100% desperdiçadas. */}
        {map.terrainMode === "square" && !isolado("semProps") && (
          <TreeImpostors map={map} center={center} radius={PROP_RADIUS} limite={visao.limiteVegetacao} />
        )}
        {/* props do mapa (culled); o "smooth" legado usa o scatter de demo.
            O nome do grupo é contrato com o GroundInteract: é nele que o clique
            testa se o raio bateu numa árvore antes de chegar ao chão. */}
        <group name={PROPS_GROUP}>
          {/* VEGETAÇÃO INSTANCIADA (props/VegetationInstancer): grama, flor,
              planta, arbusto, árvore e árvore seca — 1 InstancedMesh por
              espécie/sub-malha em vez de 1 Mesh por prop. Só nos mapas
              "culled" (square/blocks): `map.props` é a fonte de verdade só ali
              — o "smooth" legado gera props em runtime (scatterDemoProps) e
              continua 100% no caminho antigo, sem mudança. DENTRO do
              PROPS_GROUP de propósito: é nele que o GroundInteract raycasta
              pra achar prop clicado, instanciado ou não. */}
          {culled && (
            <Suspense fallback={null}>
              <VegetationInstancer
                map={map}
                center={center}
                radius={PROP_RADIUS}
                radiusRasteira={visao.vegetacaoRasteira}
                playerPos={playerPos}
                aoPrecompilar={aoPrecompilarVegetacao}
              />
            </Suspense>
          )}
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

            `culled && ehCategoriaInstanciavel`: as espécies que o
            VegetationInstancer acima já desenha saem daqui — sem isso a
            mesma árvore apareceria DUAS vezes (a instanciada + a individual).
          */}
          {visibleProps
            .filter((p) => !(culled && ehCategoriaInstanciavel(p.assetId)))
            .map((p) => (
              <Suspense key={p.id} fallback={null}>
                <PropInstance prop={p} />
              </Suspense>
            ))}
        </group>
        </SondaDeRender>
        {/* avança o relógio do vento (props/wind.ts) — UM useFrame pro mapa
            inteiro, nenhuma planta tem update individual */}
        <WindSystem />
        {/* partículas ambientais do cenário de teste offline (`?map=scenetest`),
            posições fixas em `play/sceneTestMap.ts:PARTICLE_SPOTS` */}
        {IS_SCENETEST &&
          !isolado("semParticulas") &&
          PARTICLE_SPOTS.map((p, i) => <AmbientParticles key={i} kind={p.kind} origin={p.origin} count={p.count} radius={p.radius} />)}
        {/* mapa de showcase REAL (`gpqa01`, personagem de verdade, online ou
            offline via `?map=gpqa01`) — resto do conteúdo (árvore/lago/
            construção) veio do `build-showcase-map.ts`, só as partículas
            (que não têm campo próprio em `MapProp`) moram no client */}
        {map.id === SHOWCASE_MAP_ID &&
          !isolado("semParticulas") &&
          SHOWCASE_PARTICLE_SPOTS.map((p, i) => (
            <AmbientParticles key={i} kind={p.kind} origin={p.origin} count={p.count} radius={p.radius} scale={p.scale} />
          ))}
        {/* partículas ambientais DO MAPA (`map.ambientParticles`, painel
            "Camadas & Luz" do editor) — qualquer mapa, não só o showcase.
            Centradas no `center` de culling (o mesmo que já move terreno/
            props), então "seguem" o jogador sem update por partícula: é
            `center` mudando de valor (a cada 16 unidades, ver
            `useViewCenter`) que reescreve a posição-base do emissor. */}
        {!isolado("semParticulas") &&
          (map.ambientParticles ?? [])
            .filter((p) => p.enabled && isParticleKind(p.particleId))
            .map((p, i) => (
              <AmbientParticles
                key={`map-${i}`}
                kind={p.particleId as ParticleKind}
                origin={[center.x, 1, center.z]}
                count={Math.round(15 + p.intensity * 60)}
                radius={35}
                scale={p.scale}
                speedScale={p.speed}
              />
            ))}
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
              raioEntidade={RAIO_ENTIDADE}
              terrain={world.terrain}
            />
            <GroundItems map={map} mapping={mapping} cellSize={moveCell} />
            <NetPlayer
              map={map}
              mapping={mapping}
              gameplay={gameplay}
              positionRef={playerPos}
              cellSize={moveCell}
              terrain={world.terrain}
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
          {/* efeitos de skill NÃO migrados pro VFX Core — cai aqui quando
              `vfx/skillVfxBindings.ts` ainda não tem o aegis (todo o resto
              até a Fase 5 terminar) */}
          <SkillVfx map={map} mapping={mapping} cellSize={moveCell} terrain={world.terrain} />
          {/* VFX Core (leia1.txt — padronização Skills/VFX): skills
              migradas nascem aqui, nunca em `SkillVfx` acima — as duas
              árvores convivem até a Fase 5 esvaziar `SkillVfx` de vez. */}
          <VfxRoot map={map} mapping={mapping} cellSize={moveCell} terrain={world.terrain} />
          {/* projétil de ataque à distância (flecha etc): nasce do próprio ZC.NOTIFY_ACT, ver net/useWorldEvents */}
          <Projectile map={map} mapping={mapping} cellSize={moveCell} />
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
      {mapping && <AlvoPorTab map={map} mapping={mapping} />}
      {/* a trava do soft lock, visível: acende o mob que o clique acertaria */}
      {mapping && (
        <AssistenciaDeMira
          map={map}
          mapping={mapping}
          cellSize={moveCell}
          playerPos={playerPos}
          raioEntidade={RAIO_ENTIDADE}
        />
      )}
      {/* skill de área mirando: onde ela cai e de onde dá para lançá-la */}
      <AimPreview playerPos={playerPos} hoverPos={hoverChao} cellSize={moveCell} terrain={world.terrain} />
      {/* alcance do ataque básico, enquanto houver alvo selecionado */}
      <AttackRangeCircle playerPos={playerPos} cellSize={moveCell} terrain={world.terrain} />
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
 * câmera mira no meio do corpo em vez do pé; `NetPlayer` reusa pra estimar o
 * OLHO na checagem de linha de visão (`net/visao`) */
export const CHAR_MODEL_HEIGHT = 1.8;

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
/** `?map=windtest[&extreme=1][&stage=low|medium|high|extreme]` — cenário
 * sintético de vegetação p/ medir custo do vento (`play/windTestMap.ts`).
 * Mesma ideia do hexdemo acima: mapa local, sem sessão, sem busca na API. */
const IS_WINDTEST = LOCAL_MODE && !IS_PREVIEW && DEFAULT_MAP === "windtest";
const WINDTEST_EXTREME = PLAY_PARAMS.get("extreme") === "1";
const WINDTEST_STAGE_RAW = PLAY_PARAMS.get("stage");
const WINDTEST_STAGE: WindTestStage | undefined =
  WINDTEST_STAGE_RAW === "low" || WINDTEST_STAGE_RAW === "medium" || WINDTEST_STAGE_RAW === "high" || WINDTEST_STAGE_RAW === "extreme"
    ? WINDTEST_STAGE_RAW
    : undefined;
/** `?map=scenetest` — cenário de teste de luz/céu/água/sombra/partículas
 * (`play/sceneTestMap.ts`). Mesmo mecanismo local do hexdemo/windtest. */
const IS_SCENETEST = LOCAL_MODE && !IS_PREVIEW && DEFAULT_MAP === "scenetest";

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
  // busca do banco sempre; hexdemo usa a versão salva SÓ se for "square" (o
  // formato do prefab atual — ver play/squareDemoMap.ts; senão prefab, ignora
  // versão hex/smooth/quebrada salva antes da troca). Em preview, não busca.
  // distâncias (câmera, névoa, alcance, pulo) vêm em unidades de hexágono e
  // passam a valer no tamanho de bloco atual — ver scaleToWorld
  const gameplayRaw = useGameplayConfig();
  const gameplay = scaleToWorld(gameplayRaw);
  // Os três mapas locais gerados aqui (demo, windtest, scenetest) são grade
  // QUADRADA de tamanho fixo — ao contrário do hex prefab antigo
  // (`hex/hexPrefab.ts`, ainda usado só pelo editor), nenhum depende de
  // `hexScale`. `gameplay.hexScale` fica nas dependências mesmo assim: é o
  // sinal de "a config já chegou da API", e recomputar o demo de graça uma
  // vez a mais não custa nada.
  const demoMap = useMemo(
    () =>
      IS_DEMO
        ? buildSquareDemo()
        : IS_WINDTEST
          ? buildWindTestMap({ extreme: WINDTEST_EXTREME, stage: WINDTEST_STAGE })
          : IS_SCENETEST
            ? buildSceneTestMap()
            : null,
    [gameplay.hexScale],
  );

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
  const mapId = IS_PREVIEW || IS_WINDTEST || IS_SCENETEST ? "" : online ? (netMapId ?? "") : DEFAULT_MAP;
  // Com sessão, NUNCA cair no mapa de demonstração: se o servidor colocou o
  // personagem num mapa que ainda não tem cena 3D, o certo é dizer isso — abrir
  // o hexdemo faria o jogador andar num mundo que não é o dele (foi o que
  // aconteceu ao morrer e renascer em Prontera).
  const useDemo = IS_DEMO && !online;

  const fetched = useMap(mapId);
  const rawMap = IS_PREVIEW
    ? previewMap
    : IS_WINDTEST || IS_SCENETEST
      ? demoMap
      : useDemo
        ? (fetched.map?.terrainMode === "square" ? fetched.map : demoMap)
        : fetched.map;
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
    : useDemo || IS_WINDTEST || IS_SCENETEST
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
    setVegetacaoPronta(false);
    // Reset explícito, ALÉM do idioma monta/desmonta de `SinalizaCenaPronta`:
    // o `<Suspense>` de `<Scene>` some inteiro quando `map` vira `null` no
    // meio de um warp (`{map && (<Suspense>...)}`), e o desmonte do sinalizador
    // já cobre isso — mas resetar aqui também deixa a intenção explícita e
    // protege contra qualquer ordem de commit em que o desmonte ainda não
    // tenha corrido antes do primeiro render do mapa novo.
    setCenaMontada(false);
  }, [mapId]);
  useEffect(() => {
    if (!esperaPreCarga) return;
    const t = setTimeout(() => setPrecargaExpirou(true), TETO_PRECARGA_MS);
    return () => clearTimeout(t);
  }, [esperaPreCarga, mapId]);
  /**
   * Espera os ASSETS do mapa (props, vegetação, impostor de árvore/arbusto —
   * ver `EsperaAssetsDoMapa`), não só o terreno. Começa em `true` — palpite
   * seguro pro primeiro quadro, mas NUNCA é a fonte da verdade depois disso:
   * quem manda é sempre o Suspense (`AvisaCarregandoAssets`/
   * `EsperaAssetsDoMapa`, montados mais abaixo), e o que quer que renderize —
   * fallback (ainda carregando) OU o filho resolvido (`useGLTF` não
   * suspendeu, ou suspendeu e voltou) — dispara seu PRÓPRIO `set(...)` ao
   * montar. Por isso não existe aqui nenhum efeito "resetando pra true no
   * troca de mapa": um reset assim corre risco de ganhar do Suspense (se o
   * mapa novo já estiver com os assets em cache, o fallback nunca chega a
   * montar pra devolver `false`) e travar em `true` pra sempre.
   */
  const [carregandoProps, setCarregandoProps] = useState(true);
  const [assetsExpiraram, setAssetsExpiraram] = useState(false);
  const urlsMapa = useMemo(() => (map ? urlsDoMapa(map.props) : []), [map]);
  useEffect(() => {
    setAssetsExpiraram(false);
    if (urlsMapa.length === 0) return;
    const t = setTimeout(() => setAssetsExpiraram(true), TETO_ASSETS_MS);
    return () => clearTimeout(t);
  }, [urlsMapa, mapId]);
  /** o mapa ainda nem chegou (fetch + zod de 160.000 células) */
  const carregandoMapa = !IS_PREVIEW && !map && !error;
  const carregandoTerreno =
    esperaPreCarga && !precargaExpirou && (precarga === null || precarga.feitos < precarga.total);
  const carregandoAssets = urlsMapa.length > 0 && carregandoProps && !assetsExpiraram;
  /** fase 1: montando dado. Nada é desenhado, e é por isso que ela é rápida. */
  const construindo = carregandoMapa || carregandoTerreno || carregandoAssets;
  /**
   * `<Scene>` MONTOU DE VERDADE — ver `SinalizaCenaPronta` acima para a causa
   * raiz que este gate corrige. `construindo` falso não significava "a árvore
   * 3D existe": significava só "os sinais paralelos (mapa, terreno, urls de
   * prop) bateram" — o `<Suspense>` que embrulha `<Scene>` podia continuar
   * suspenso por qualquer coisa que ELE carrega e que nenhum desses sinais
   * cobre (o atlas de `TreeImpostors`, por exemplo, ou o céu). `aguardandoCena`
   * é a fase nova: dado pronto, mas a raiz da árvore 3D ainda não comitou.
   */
  const [cenaMontada, setCenaMontada] = useState(false);
  const aguardandoCena = !construindo && Boolean(map) && !cenaMontada;
  /**
   * Fase 3: AQUECER — a cena já é desenhada, mas a cortina continua no ar.
   *
   * Ela existe porque as fases anteriores não aquecem nada: com `scene.visible
   * = false` o three nem percorre a cena, então não compila shader nem sobe
   * textura para a GPU. Revelar direto no fim da construção só mudaria o
   * engasgo de lugar — o primeiro quadro visível pagaria a compilação de TODOS
   * os materiais de uma vez, que é o pior quadro possível e logo no instante em
   * que o jogador ganha o controle.
   *
   * Só começa depois de `cenaMontada` — contar "shader parou de compilar" só
   * faz sentido depois de a cena ter shader nenhum para compilar. É essa
   * dependência que falta antes desta correção fazia o `AquecerCena` declarar
   * "aquecida" (`gl.info.programs.length` parado em 0) sobre uma `THREE.Scene`
   * ainda sem filho nenhum.
   *
   * Aqui a cena é desenhada de verdade atrás da cortina: shader compila, textura
   * sobe, o `useFrame` de cada coisa dá as primeiras voltas. Quando os quadros
   * caros acabam, a cortina sai — e o primeiro quadro que o jogador vê já é um
   * quadro barato. Quem decide que acabou é o `AquecerCena`.
   */
  const [aquecido, setAquecido] = useState(false);
  const aoAquecer = useCallback(() => setAquecido(true), []);
  /**
   * Precompile da vegetação instanciada (`props/VegetationInstancer.tsx`)
   * — SEPARADO de `aquecido` de propósito.
   *
   * `AquecerCena` só enxerga `gl.info.programs.length`: na prática, hoje,
   * ele já espera o precompile da vegetação terminar (compilar espécie nova
   * conta como programa novo, o que reseta a contagem de quadros parados) —
   * mas isso é um efeito COLATERAL do jeito que os dois foram medidos, não
   * uma garantia estrutural. `VegetationInstancer` é montado o tempo todo
   * (nunca condicionado a `aquecendo`, ao contrário de `PreCompilarProps`),
   * e o `<Suspense fallback={null}>` que o embrulha em `PlayView` NÃO
   * bloqueia `cenaMontada` — então, em tese, se as urls de espécie ainda
   * estivessem em voo quando `EsperaAssetsDoMapa` estourasse o teto
   * (`assetsExpiraram`), o precompile de vegetação só começaria DEPOIS do
   * resto já ter revelado. `vegetacaoPronta` fecha essa lacuna: é um sinal
   * EXPLÍCITO (`VegetationInstancer` chama de volta quando a fila de
   * precompile — uma espécie por quadro, ver o comentário lá — esvazia, ou
   * na hora se não há vegetação instanciável no mapa), em vez de depender
   * de o efeito colateral continuar valendo.
   */
  const [vegetacaoPronta, setVegetacaoPronta] = useState(false);
  const aoPrecompilarVegetacao = useCallback(() => setVegetacaoPronta(true), []);
  /**
   * `GAME_READY` — a única condição que baixa a cortina e revela o HUD.
   *
   * Precisa de CINCO coisas ao mesmo tempo: dado pronto (`!construindo`),
   * `<Scene>` comitada (`cenaMontada`, não suspensa — `!aguardandoCena` é
   * redundante com isso mas deixado explícito por clareza), o aquecimento
   * declarado feito (`aquecido`) — que só passa a rodar DEPOIS de
   * `cenaMontada` (ver acima), então "aquecido" aqui já implica pelo menos
   * alguns quadros reais desenhados com conteúdo de verdade, não uma cena
   * vazia — e `vegetacaoPronta` (acima). Sem a última, `aquecido` sozinho
   * podia ficar `true` com o precompile de vegetação ainda rodando —
   * pequeno agora (uma espécie por quadro, não mais um bloco de segundos),
   * mas ainda assim trabalho que não devia acontecer depois do jogador ter
   * controle.
   */
  const gameReady = !construindo && !aguardandoCena && cenaMontada && aquecido && vegetacaoPronta;
  /**
   * `aquecendo` fica de pé até `gameReady`, não até `aquecido` sozinho — é
   * isso que segura a cortina (e mantém `AquecerCena`/`VegetationInstancer`
   * montados, fazendo o trabalho deles) enquanto só falta `vegetacaoPronta`.
   * `AquecerCena` já se protege contra chamar `aoTerminar` duas vezes
   * (`avisado.current`), então continuar montado depois de `aquecido` já
   * ter virado `true` é seguro — só fica ocioso.
   */
  const aquecendo = !construindo && !aguardandoCena && Boolean(map) && cenaMontada && !gameReady;
  const carregando = construindo || aguardandoCena || aquecendo;

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
    <div
      style={{ position: "absolute", inset: 0 }}
      onDragOver={(e) => {
        // só reage a item do inventário (`application/x-ro-item`, o mesmo
        // mime da SkillBar) — outros arrastes (texto, arquivo) passam direto.
        // E só sobre o <canvas>: uma janela do HUD por cima dele é o jogador
        // reorganizando a bolsa, não jogando o item no chão — a MESMA condição
        // do `onDrop`, de propósito. Aceitar aqui em cima do HUD e recusar só
        // no drop (sem `preventDefault`) deixava o cursor nativo "pode soltar"
        // o arraste inteiro e, ao soltar sobre HUD, o navegador não tinha para
        // onde resolver o gesto — o cursor de arraste do Windows ficava PRESO
        // até o próximo clique, porque nem `drop` nem `dragend` fechavam a
        // sequência do jeito que o SO esperava.
        if (e.dataTransfer.types.includes("application/x-ro-item") && e.target instanceof HTMLCanvasElement) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        if (!(e.target instanceof HTMLCanvasElement)) return;
        // `dataTransfer` só existe DENTRO do evento nativo — lido antes do
        // `setTimeout`, nunca depois
        const raw = e.dataTransfer.getData("application/x-ro-item");
        if (!raw) return;
        e.preventDefault();
        const index = Number(raw);
        // Abrir o diálogo é uma atualização PESADA (monta `WorldDropDialog`,
        // sobe um overlay de z-index 1000 cobrindo a tela) — feita ainda
        // DENTRO do handler nativo de `drop`, ela competia com o navegador
        // terminando a própria sequência de arraste (`drop` → `dragend`), e o
        // cursor do SO ficava PRESO na versão "arrastando", só se desfazendo
        // no próximo clique. Adiando para o próximo tick deixa o navegador
        // fechar o gesto nativo primeiro — o React só reage depois.
        setTimeout(() => useWorldDropStore.getState().abrir(index), 0);
      }}
    >
      {/* só com sessão: avisa o map-server que a cena montou e escuta o mundo */}
      {online && map && <WorldEventsBridge />}
      {/* música + natureza do mapa atual — por `mapId`, nunca por posição/
          quadro (ver `audio/mapAmbience`). `mapId` já cobre sessão online
          E `?map=prt_fild08` local, então dá pra testar sem servidor. */}
      <MapAmbience mapId={mapId || null} />
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
        /**
         * `toneMappingExposure` — o R3F liga `ACESFilmicToneMapping` por
         * padrão (nunca configurado explicitamente aqui), e ACES comprime
         * sombra/meio-tom mais que sol/realce. É outra fatia do "sombra
         * escura demais" que `HEMI_BOOST` sozinho não cobre — 1 uniform
         * global, sem passe de render extra, sem tocar em nenhuma luz.
         */
        gl={{ toneMappingExposure: 1.25 }}
        /**
         * `attachWebglContextRecovery` direto aqui, não num componente filho
         * (`useEffect`) — achado ao vivo: o `Context Lost` real acontece
         * LOGO no login, durante `AquecerCena` (pico de compilação de
         * shader), ANTES do primeiro commit do React terminar. `onCreated`
         * dispara SÍNCRONO assim que o `WebGLRenderer` nasce, antes de
         * qualquer filho montar — um `useEffect` de filho perdia essa
         * janela (`ver core/webglContextRecovery.ts`). Canvas principal
         * vive a sessão de jogo inteira; sem cleanup explícito aqui de
         * propósito, o listener morre com a página/o canvas.
         */
        onCreated={(state) => attachWebglContextRecovery(state.gl)}
      >
        {/* Fora do Suspense: tem de valer já no primeiro quadro, antes de
            qualquer .gltf resolver.
            `construindo || aguardandoCena`, não `carregando`: durante o
            AQUECIMENTO a cena tem de estar visível para o three compilar os
            shaders dela — quem esconde ali é a cortina, não a cena. Mas
            enquanto `<Scene>` ainda está suspensa (`aguardandoCena`) ela nem
            tem filho nenhum — ocultar aqui também é o que impede QUALQUER
            quadro de tentar desenhar uma cena que ainda não existe. */}
        <OcultarCena oculta={construindo || aguardandoCena} />
        {aquecendo && <AquecerCena aoTerminar={aoAquecer} />}
        {/*
          Boundary PRÓPRIO pra `EsperaAssetsDoMapa` — separado do da `<Scene>`
          abaixo de propósito: este só existe pra alimentar `carregandoProps`
          (a cortina), nunca pra decidir o que desenha. `key={mapId}` força
          remontar do zero num warp — sem isso, um mapa novo com menos urls
          poderia herdar o estado resolvido do mapa anterior por um quadro.
        */}
        {map && (
          <Suspense key={mapId} fallback={<AvisaCarregandoAssets set={setCarregandoProps} />}>
            <EsperaAssetsDoMapa urls={urlsMapa} set={setCarregandoProps} />
          </Suspense>
        )}
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
            <Fragment key={mapId}>
              {/*
                `key={mapId}` NO FRAGMENT, não só decoração — é o que corrige
                um bug real achado ao vivo (warp A→B→A com B tendo pego
                cache HIT em `useMap`): sem uma key amarrada ao mapa,
                `<Scene>`/`<SquareTerrain>` podiam continuar na MESMA
                instância/fiber entre um mapa e outro (a transição
                `map: objA → null → objB` não é garantia de commit
                SEPARADO — a suspeita, confirmada ao vivo, é que o React
                as empacota quando a segunda vem de um `queueMicrotask`
                logo depois da primeira). Com a mesma instância de
                `SquareTerrain` viva, o cache de chunk por COORDENADA
                (`cx,cz`) do mapa ANTERIOR ficava de pé quando os dados do
                mapa NOVO chegavam — e como as duas coordenadas batem (é a
                mesma grade 400×400), a lógica de invalidação incremental
                (`chunksSujos`, feita para EDIÇÃO no editor, nunca para
                troca de mapa) comparava terrenos de DOIS MAPAS DIFERENTES
                célula a célula, marcava tudo como "sujo", e o mesmo `key`
                de chunk acabava e entrando em `visible` DUAS VEZES — uma
                vez com a geometria velha (ainda "pronta" no cache) e outra
                com a reconstruída — daí o "Encountered two children with
                the same key" e, atrás dele, um `useMemo` reconstruindo o
                mapa inteiro por engano, um long task de ~4s, e a cortina
                (`cenaMontada`) nunca resolvendo porque a árvore ficava
                presa reconciliando essa bagunça.

                `key` é a garantia FORTE do React — muda o key, muda a
                identidade, o React desmonta o de baixo e monta um do zero,
                sem depender de timing de commit nenhum. Cobre `<Scene>` E
                `<SinalizaCenaPronta>` juntos (o Fragment é o nó com a key),
                porque os dois têm de resetar JUNTOS: se só `<Scene>`
                remontasse, `<SinalizaCenaPronta>` (sem key própria)
                sobreviveria entre mapas e seu efeito de montagem — que é
                quem vira `cenaMontada` — nunca disparia de novo para o
                mapa seguinte, prendendo a cortina embaixo pra sempre na
                condição OPOSTA (curtain nunca sobe).
              */}
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
                aoPrecompilarVegetacao={aoPrecompilarVegetacao}
              />
              {/* SIBLING de `<Scene>`, no MESMO boundary — ver o comentário
                  longo em `SinalizaCenaPronta`. Só monta quando este
                  `<Suspense>` de fato resolve, e é ISSO que vira `cenaMontada`. */}
              <SinalizaCenaPronta set={setCenaMontada} />
            </Fragment>
          )}
        </Suspense>
      </Canvas>
      {/* o medidor é do JOGO rodando: sobre a tela de carregamento ele mediria
          quadros que não desenham nada e ainda apareceria por cima do aviso */}
      {import.meta.env.DEV && gameReady && <PerfOverlay />}

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
                : carregandoAssets
                  ? "carregando árvores e objetos…"
                  : aguardandoCena
                    ? "renderizando o mundo…"
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

        FASE E1: durante o AQUECIMENTO (`aquecendo`, cortina ainda no ar mas a
        cena já desenha) isto NÃO pode ser `display:none` — é exatamente a
        fase em que o `TargetFrame` precisa estar de pé para o contexto WebGL
        do retrato do alvo nascer e compilar cedo (ver `hud/PlayerFrame`).
        `display:none` tira o elemento da árvore de renderização;
        `visibility:hidden` mantém a caixa (e o desenho por baixo) viva, só
        não pinta — mesma troca feita dentro do `TargetFrame`. Continua
        `display:none` de verdade em `construindo`/`aguardandoCena` (dado
        ainda não pronto OU `<Scene>` ainda suspensa — nenhum dos dois tem o
        que aquecer) e sem `map`. É exatamente esta condição — nunca
        `!gameReady` sozinho misturado com o HUD achando que terminou — que
        impede o HUD de pintar por cima de um Canvas ainda cinza (a causa
        raiz da referência `aee.jpg`: sem `aguardandoCena` aqui, o HUD virava
        `display:contents` no instante em que `construindo` batia falso, com
        `<Scene>` ainda suspensa por baixo).
      */}
      {mapaDoHud && (
        <div
          style={
            construindo || aguardandoCena || !map
              ? { display: "none" }
              : aquecendo
                ? { display: "block", visibility: "hidden" }
                : { display: "contents" }
          }
        >
          <Hud map={mapaDoHud} playerPos={playerPos} aquecendo={aquecendo} />
        </div>
      )}
    </div>
  );
}
