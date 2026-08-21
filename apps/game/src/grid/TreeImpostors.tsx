import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import type { GameMap, MapProp } from "@ragnarok/map-format";
import { propCategory, propUrl } from "../props/registry";
import { bakeSpeciesImage } from "./treeImpostorBake";
import { compartilharTexturas } from "../gltfTexturas";
import { alturaDoHorizonte } from "./HorizonMesh";
import { registrarEvento } from "../core/diagnostics/flightRecorder";
import { isolado } from "../core/diagnostics/isolamento";
import { medir } from "../core/diagnostics/medir";

/**
 * IMPOSTORES DE ÁRVORE — billboard TEXTURIZADO, não mais a "cruz" sem
 * textura da primeira versão desta camada.
 *
 * ## Por que a v1 (cruz de 2 placas, cor chapada) foi trocada
 *
 * Funcionava (árvore aparecia além do raio de detalhe, trocava pela árvore
 * 3D ao aproximar, 1 draw call) mas o RESULTADO VISUAL era ruim: silhueta
 * fina, sem copa, lida como "linhas pretas" em vez de floresta — relatado
 * depois de ver ao vivo. O ganho de performance não compensava um horizonte
 * feio. Este módulo mantém a MESMA arquitetura (`InstancedMesh`, troca
 * binária no raio de detalhe, atualização só quando `center` muda) e troca
 * só a REPRESENTAÇÃO: em vez de inventar uma forma geométrica genérica,
 * fotografa a árvore 3D DE VERDADE (mesma malha, mesma textura de casca/
 * folha do catálogo) numa imagem 2D pequena (`treeImpostorBake.ts`) e cola
 * essa foto num quad billboard. A silhueta e a cor do impostor SÃO as da
 * árvore real — não uma aproximação desenhada à mão.
 *
 * ## Pipeline (dados reaproveitados, nada inventado)
 *
 * 1. `collectTreeSpecies` lê `map.props` e acha as espécies (`assetId`) das
 *    categorias `tree`/`tree_bare`/`bush` (Fase 2: arbusto entrou aqui pelo
 *    mesmo motivo — copa reconhecível, não vale a pena inventar um segundo
 *    sistema de impostor só pra ele) que o MAPA de fato usa — não as ~20 do
 *    catálogo inteiro, só as poucas que aparecem aqui (`props/registry.tsx`
 *    resolve assetId→url, mesma fonte que `VegetationInstancer` usa pro
 *    prop real dentro do raio de detalhe).
 * 2. `treeImpostorBake.bakeSpeciesImage` renderiza CADA espécie (o `.gltf`
 *    de verdade) numa foto de frente 128×128, fundo transparente, e mede o
 *    bounding box real (largura/altura em unidades de mundo) — mesmo
 *    processo que `editor/thumbnailer.ts` já usa pra ícone de paleta, câmera/
 *    tonemapping ajustados pro caso de billboard (ver o comentário daquele
 *    módulo).
 * 3. As fotos entram num ATLAS único (`buildTreeAtlas`, 1 canvas, 1
 *    `CanvasTexture`) — 1 textura pro mapa inteiro, não uma por espécie.
 * 4. Um `InstancedMesh` de UM quad (billboard, sempre virado pra câmera —
 *    ver o truque de view-space no vertex shader) desenha cada árvore
 *    lendo, por instância, um retângulo do atlas (`aAtlasRect`) e um
 *    tamanho em mundo (`aSize`, medido no passo 2 × a escala do prop).
 *
 * ## Por que ainda é 1 draw call, sem malha por árvore
 *
 * O atlas nasce ANTES de qualquer árvore ser desenhada (bake acontece uma
 * vez, no carregamento do mapa, fora do `useFrame`) — depois disso é
 * exatamente a mesma conta da v1: 1 `InstancedMesh`, 1 geometria (agora com
 * `uv` além de `position`), 1 material, N instâncias. `aSize`/`aAtlasRect`
 * são atributos INSTANCED na geometria (mesmo mecanismo do `instanceMatrix`)
 * — não crescem o número de draw calls, só o tamanho do buffer.
 *
 * ## Por que billboard "view-space" e não cross-quad nem rotação por CPU
 *
 * A placa sempre encara a câmera SEM reorientar a `instanceMatrix` a cada
 * quadro (o que custaria CPU por instância, todo frame): o `instanceMatrix`
 * carrega só a TRANSLAÇÃO (posição no mundo); o vertex shader soma o
 * deslocamento do canto do quad (`position.xy`, em unidades locais) direto
 * em ESPAÇO DE VISTA, onde X/Y já são "direita da tela"/"cima da tela" por
 * definição — nenhum uniform de câmera, nenhuma matriz extra, o próprio
 * `projectionMatrix * mvPosition` já produz um retângulo voltado pra
 * câmera em QUALQUER ângulo. Ver `treeImpostorBake` e o `onBeforeCompile`
 * abaixo.
 *
 * ## Preto/halo — por que NÃO acontece aqui
 *
 * A v1 quebrou por causa de `material.vertexColors = true` sem atributo
 * `color` por vértice (ver o comentário removido daquela versão). Esta
 * versão não usa `vertexColors`/`instanceColor` NENHUM — a cor vem inteira
 * da TEXTURA (`material.map`), e o corte é por `alphaTest` (MASK), não por
 * blending: sem `transparent: true`, sem alpha premultiplicado, sem ordem de
 * desenho pra acertar — o pixel ou passa opaco ou é descartado, nunca meio-
 * transparente escurecendo a névoa atrás. É a MESMA técnica que os `.gltf`
 * de árvore já usam (`alphaMode: "MASK"`, conferido no catálogo Quaternius) —
 * o atlas herda o corte de quem gerou a imagem.
 *
 * ## Coerência de horizonte (Fase de correção, `render-tecnic.txt` seção 25)
 *
 * Duas causas faziam árvore/arbusto distante aparecer "voando", desconectados
 * do terreno visível — nenhuma das duas é a hipótese óbvia (`treeDistance >
 * terrainDistance`; a malha do horizonte SEMPRE cobre o mapa inteiro):
 *
 *  • **Causa A (vertical)**: o Y da instância era o AUTORADO do prop (altura
 *    do chão DETALHADO) mesmo além do raio de detalhe, onde quem está
 *    desenhado é `HorizonMesh` — cuja altura é sistematicamente mais BAIXA
 *    ali (o MÍNIMO de uma vizinhança, de propósito, contra o poke-through).
 *    Corrigido ancorando o Y em `alturaDoHorizonte` além de uma banda de
 *    transição (`BANDA_TRANSICAO_ALTURA`), não mais no Y autorado.
 *  • **Causa B (teto ausente)**: o impostor não tinha limite de distância —
 *    desenhava instâncias muito além de `fogFar`, 100% atrás de névoa opaca.
 *    Corrigido com `limite` (de `play/worldVisibility.ts`).
 */

/**
 * Categorias representadas nesta camada — árvore/árvore seca (original) +
 * arbusto (Fase 2 da otimização de renderização): a copa do arbusto também se
 * beneficia do billboard texturizado em vez de sumir de uma vez ao passar do
 * raio de detalhe. `VegetationInstancer` já cuida do arbusto REAL dentro do
 * raio — aqui é só a representação de LONGE, mesmo mecanismo dos dois.
 */
const CATEGORIAS_IMPOSTOR = new Set(["tree", "tree_bare", "bush"]);

const ATLAS_CELL = 128;
/** tamanho de reserva se uma espécie falhar o bake (assetId órfão) — nunca trava o resto do atlas */
const FALLBACK_SIZE = { width: 1.2, height: 3 };

export interface TreeImpostorInstance {
  position: THREE.Vector3;
  assetId: string;
  /** escala uniforme do prop (mesma leitura que `PropInstance` usa) */
  scale: number;
  /** espelha o billboard em X — variedade barata sem segundo ângulo de bake */
  flip: 1 | -1;
}

/** hash determinístico e estável do id do prop — mesma árvore sempre espelha (ou não) do mesmo jeito entre recargas */
function hashFlip(id: string): 1 | -1 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h & 1) === 0 ? 1 : -1;
}

/** extrai as instâncias de árvore de `map.props` — pura, testável sem `<Canvas>` */
export function buildTreeImpostorInstances(props: readonly MapProp[]): TreeImpostorInstance[] {
  const out: TreeImpostorInstance[] = [];
  for (const p of props) {
    const cat = propCategory(p.assetId);
    if (!cat || !CATEGORIAS_IMPOSTOR.has(cat)) continue;
    if (!propUrl(p.assetId)) continue; // assetId desconhecido: sem glTF pra bakear, sem impostor (PropInstance também omite)
    out.push({
      position: new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
      assetId: p.assetId,
      scale: p.scale?.[0] ?? 1,
      flip: hashFlip(p.id),
    });
  }
  return out;
}

/** espécies (assetId único → url) de árvore que ESTE mapa realmente usa — não o catálogo inteiro */
export function collectTreeSpecies(props: readonly MapProp[]): { assetId: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const p of props) {
    const cat = propCategory(p.assetId);
    if (!cat || !CATEGORIAS_IMPOSTOR.has(cat)) continue;
    if (seen.has(p.assetId)) continue;
    const url = propUrl(p.assetId);
    if (url) seen.set(p.assetId, url);
  }
  return [...seen.entries()]
    .map(([assetId, url]) => ({ assetId, url }))
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
}

export interface TreeAtlas {
  texture: THREE.CanvasTexture;
  rectByAssetId: Map<string, [number, number, number, number]>;
  sizeByAssetId: Map<string, { width: number; height: number }>;
}

/**
 * Bakeia todas as espécies e monta o atlas — sequencial de propósito: o
 * bake reusa UM renderer offscreen só (`treeImpostorBake`), então duas
 * espécies em paralelo disputariam o mesmo canvas. Só roda uma vez por
 * conjunto de espécies (troca de mapa), nunca no `useFrame`.
 *
 * **Síncrono** (bug corrigido — ver o comentário de `treeImpostorBake.ts`):
 * `cena` já vem CARREGADA (o chamador usa o mesmo `useGLTF` cacheado que os
 * props reais), então não há mais rede/parse por espécie — só o render da
 * foto, que é local e rápido. Bakear 30 espécies deixou de ser 30
 * `await`s encadeados (medido: 41 SEGUNDOS com cache frio) para virar um
 * laço comum.
 */
export function buildTreeAtlas(species: { assetId: string; scene: THREE.Object3D }[]): TreeAtlas {
  const t0 = performance.now();
  const cols = Math.max(1, Math.ceil(Math.sqrt(species.length)));
  const rows = Math.max(1, Math.ceil(species.length / cols));
  const canvas = document.createElement("canvas");
  canvas.width = cols * ATLAS_CELL;
  canvas.height = rows * ATLAS_CELL;
  const ctx = canvas.getContext("2d")!;
  const rectByAssetId = new Map<string, [number, number, number, number]>();
  const sizeByAssetId = new Map<string, { width: number; height: number }>();

  for (let i = 0; i < species.length; i++) {
    const { assetId, scene } = species[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * ATLAS_CELL;
    const y = row * ATLAS_CELL;
    const baked = bakeSpeciesImage(scene);
    ctx.drawImage(baked.canvas, x, y, ATLAS_CELL, ATLAS_CELL);
    sizeByAssetId.set(assetId, { width: baked.width, height: baked.height });
    // canvas cresce de CIMA pra baixo (y=0 no topo); textura WebGL lê de
    // BAIXO pra cima (v=0 embaixo) — `CanvasTexture.flipY` (default true) já
    // inverte na hora de subir pra GPU, então o retângulo em V tem de ser o
    // ESPELHO do retângulo em pixel, não o mesmo número
    const u0 = x / canvas.width;
    const u1 = (x + ATLAS_CELL) / canvas.width;
    const v0 = 1 - (y + ATLAS_CELL) / canvas.height;
    const v1 = 1 - y / canvas.height;
    rectByAssetId.set(assetId, [u0, v0, u1, v1]);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // sem mipmap: atlas sem padding entre células vazaria cor de uma espécie
  // na vizinha no mip menor. As placas já são pequenas na tela a essa
  // distância — o aliasing que sobra é imperceptível coberto pela névoa.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const ms = Math.round((performance.now() - t0) * 10) / 10;
  registrarEvento("cena", "impostorArvore:atlas", { especies: species.length, ms });
  return { texture, rectByAssetId, sizeByAssetId };
}

/**
 * Hook: bakeia o atlas quando `species` muda (troca de mapa) e descarta o
 * anterior. `species` deve vir de um `useMemo` estável — é a identidade do
 * array, não o conteúdo, que dispara o recálculo.
 *
 * `useMemo`, não `useState`+`useEffect`: o bake agora é SÍNCRONO (nenhuma
 * rede, nenhum `await` — ver `buildTreeAtlas`), então não existe mais
 * corrida entre um bake velho terminando depois do novo já ter começado. A
 * v1 desta função precisava de uma flag `viva` exatamente pra essa corrida;
 * sem promessa nenhuma no meio, ela deixou de poder acontecer.
 */
function useTreeAtlas(species: { assetId: string; scene: THREE.Object3D }[]): TreeAtlas | null {
  const atlas = useMemo(() => (species.length > 0 ? buildTreeAtlas(species) : null), [species]);
  // descarta a textura quando o átlas TROCA (não só no desmonte) — cada
  // recálculo deixaria a textura velha viva pra sempre
  const anterior = useRef<TreeAtlas | null>(null);
  useEffect(() => {
    const velho = anterior.current;
    anterior.current = atlas;
    return () => {
      if (velho && velho !== atlas) velho.texture.dispose();
    };
  }, [atlas]);
  return atlas;
}

/**
 * Geometria UNITÁRIA do billboard: um quad de base (0,0) a topo (0,1) em Y,
 * largura -0,5..0,5 em X, Z sempre 0 — a forma real (largura/altura em
 * unidades de mundo) entra pelo atributo `aSize`, não por escala geométrica,
 * porque o billboard não usa a rotação/escala normal de `instanceMatrix`
 * (ver o comentário do módulo). Sem atributo `normal`: `MeshBasicMaterial`
 * sem envmap nunca lê normal (`beginnormal_vertex` só roda sob `USE_ENVMAP`/
 * `USE_SKINNING`, nenhum dos dois usado aqui).
 */
function buildBillboardQuadGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const index = new Uint16Array([0, 1, 2, 0, 2, 3]);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Material do billboard: `MeshBasicMaterial` + `alphaTest` (MASK, não
 * blend — ver o comentário do módulo sobre preto/halo) + `onBeforeCompile`
 * pro truque de billboard em espaço de vista e a leitura do retângulo do
 * atlas. Só o VÉRTICE é tocado — o fragmento fica 100% padrão
 * (`map_fragment`/`alphatest_fragment`/`fog_fragment` de fábrica), porque
 * `diffuseColor *= texture2D(map, vMapUv)` já lê alpha da textura sozinho
 * uma vez que `vMapUv` aponta pro retângulo certo.
 */
function makeImpostorMaterial(atlas: THREE.CanvasTexture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    map: atlas,
    transparent: false,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 aSize;\nattribute vec4 aAtlasRect;`)
      .replace("#include <begin_vertex>", `vec3 transformed = vec3( 0.0 );`)
      .replace(
        "#include <project_vertex>",
        `
#ifdef USE_INSTANCING
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( transformed, 1.0 );
#else
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
#endif
  // billboard em ESPAÇO DE VISTA: X/Y de view space já são "direita"/"cima"
  // da tela por definição, então somar o canto do quad aqui (em vez de
  // rotacionar a instância pra encarar a câmera) já basta — nenhum uniform
  // de câmera, nenhum recalculo por quadro.
  mvPosition.xy += position.xy * aSize;
  gl_Position = projectionMatrix * mvPosition;
`,
      )
      .replace("#include <uv_vertex>", `#include <uv_vertex>\n  vMapUv = mix( aAtlasRect.xy, aAtlasRect.zw, vMapUv );`);
  };
  return mat;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(); // sempre identidade — a rotação do billboard é o truque de view-space, não a instanceMatrix
const _s = new THREE.Vector3(1, 1, 1); // idem: o tamanho real vai em `aSize`, não na escala da matriz
const _pos = new THREE.Vector3();

/**
 * Quanto a árvore/arbusto leva, em unidades de mundo ALÉM do raio de
 * detalhe, para o Y sair do valor autorado (o mesmo Y que a árvore 3D tinha
 * bem ali no instante da troca) e chegar ao Y da SUPERFÍCIE DO HORIZONTE
 * (`alturaDoHorizonte`) — a correção do "impostor voando" (`render-tecnic.txt`
 * seção 25).
 *
 * Sem esta banda, o Y pularia de imediato no exato quadro em que a árvore
 * vira impostor — um pop vertical bem na linha de troca, mesmo em terreno
 * plano onde a diferença é pequena. Com ela, a transição de Y anda junto com
 * a distância, na mesma direção que o jogador já está andando (afastando-se),
 * então nunca é percebida como salto — só como a árvore "assentar" enquanto
 * fica pequena na tela.
 *
 * 40 unidades = 20 células: cruzado a passo normal de personagem em ~1-2 s,
 * devagar o bastante para não ler como pop; curto o bastante para o Y já
 * estar 100% ancorado no horizonte bem antes de chegar perto de `fogFar`
 * (~230 unidades depois do raio de detalhe no padrão, ver `viewRadius.ts`).
 */
const BANDA_TRANSICAO_ALTURA = 40;

export interface InstanciaVisivel {
  /** índice em `instances`/`alturasHorizonte` — chave pra buscar assetId/escala/flip/atlas depois */
  index: number;
  /** Y final da instância (já ancorado, ver `BANDA_TRANSICAO_ALTURA`) */
  y: number;
  /** distância (não ao quadrado) ao centro de visão — só para depuração/teste */
  d: number;
}

/**
 * Decide QUAIS instâncias desenham neste `center` e o Y ANCORADO de cada
 * uma — pura, testável sem `<Canvas>` (mesmo padrão de
 * `buildTreeImpostorInstances`/`buildHorizonGeometry`). O `useEffect` do
 * componente só escreve o resultado nos buffers de GPU (matriz/tamanho/
 * retângulo do atlas); a DECISÃO de visibilidade e altura mora aqui, onde dá
 * pra travar por teste (`coerenciaHorizonte.test.ts`) sem montar cena nenhuma.
 *
 * As DUAS correções da Fase de coerência de horizonte moram neste laço:
 *  • `d2 > limite2` — teto absoluto (causa B, ver o comentário de `limite`
 *    no componente): nenhuma instância além da névoa é sequer considerada.
 *  • `y` — ancorado em `alturasHorizonte[i]` além da banda de transição
 *    (causa A, ver `BANDA_TRANSICAO_ALTURA`), nunca mais o Y autorado cru.
 */
export function resolverInstanciasVisiveis(
  instances: readonly TreeImpostorInstance[],
  alturasHorizonte: ArrayLike<number>,
  center: { x: number; z: number },
  radius: number,
  limite: number,
): InstanciaVisivel[] {
  const r2 = radius * radius;
  const limite2 = limite * limite;
  const out: InstanciaVisivel[] = [];
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i]!;
    const dx = inst.position.x - center.x;
    const dz = inst.position.z - center.z;
    const d2 = dx * dx + dz * dz;
    // dentro do raio de detalhe: a árvore 3D real (PropInstance) já cobre
    // este ponto — não desenhar a mesma árvore duas vezes
    if (d2 <= r2) continue;
    // ALÉM do teto absoluto: o fragmento já é 100% cor-de-névoa ali —
    // desenhar é trabalho jogado fora (causa B)
    if (d2 > limite2) continue;
    const d = Math.sqrt(d2);
    const t = Math.min(1, Math.max(0, (d - radius) / BANDA_TRANSICAO_ALTURA));
    const y = inst.position.y + (alturasHorizonte[i]! - inst.position.y) * t;
    out.push({ index: i, y, d });
  }
  return out;
}

export function TreeImpostors({
  map,
  center,
  radius,
  limite,
}: {
  map: GameMap;
  center: { x: number; z: number };
  radius: number;
  /**
   * Teto ABSOLUTO de distância — nenhuma instância além disto é desenhada,
   * nem processada. Vem de `play/worldVisibility.ts` (`limiteVegetacao`,
   * hoje = `fogFar`): antes desta Fase, este componente desenhava toda
   * instância fora de `radius` SEM teto — na diagonal de um mapa grande isso
   * passava de 3× `fogFar`, cem por cento atrás de névoa opaca (causa B
   * medida em `render-tecnic.txt` seção 25). Puro trabalho de vértice/fill
   * jogado fora, sem ganho visual nenhum.
   */
  limite: number;
}) {
  const instances = useMemo(() => buildTreeImpostorInstances(map.props), [map]);
  /**
   * Y da superfície do HORIZONTE (não do prop) em cada posição — calculado
   * UMA vez por prop, aqui, não por quadro nem por troca de `center`: é
   * estático enquanto o mapa não trocar (mesmo mapa → mesma malha decimada).
   * Ver `alturaDoHorizonte` (`HorizonMesh.tsx`) — a causa raiz do "impostor
   * voando" era ancorar a árvore distante no Y AUTORADO (altura do chão
   * DETALHADO, que não existe mais ali) em vez do Y da malha que de fato está
   * desenhada além do raio de detalhe.
   */
  const alturasHorizonte = useMemo(() => {
    const arr = new Float32Array(instances.length);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]!;
      arr[i] = alturaDoHorizonte(map, inst.position.x, inst.position.z);
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `instances` já depende de `map`; recalcular por identidade de `instances` basta
  }, [instances, map]);
  const species = useMemo(() => collectTreeSpecies(map.props), [map]);
  const urls = useMemo(() => species.map((s) => s.url), [species]);

  /**
   * As cenas JÁ CARREGADas — o MESMO cache que `VegetationInstancer`/
   * `PropInstance` usam (`useGLTF`, primed por `preloadPropsDoMapa` no boot
   * do mapa). É isso que elimina a rede/parse duplicados que faziam o bake
   * levar 41 segundos (ver `treeImpostorBake.ts`) — na prática, por já
   * estarem pré-carregadas, isto resolve na hora; o `<Suspense>` em
   * `PlayView` é a rede de segurança se alguma ainda estiver em voo.
   */
  const gltfs = useGLTF(urls) as unknown as { scene: THREE.Object3D }[];
  const speciesComCena = useMemo(() => {
    const out: { assetId: string; scene: THREE.Object3D }[] = [];
    for (let i = 0; i < species.length; i++) {
      const gltf = gltfs[i];
      if (!gltf) continue;
      // dedup de textura ANTES de ler a cena — mesma ordem que
      // `VegetationInstancer.bakeSpeciesParts` já segue, e pela mesma razão
      // (evita N cópias da mesma imagem de folha/casca entre espécies)
      compartilharTexturas(gltf as never);
      out.push({ assetId: species[i]!.assetId, scene: gltf.scene });
    }
    return out;
  }, [species, gltfs]);
  const atlas = useTreeAtlas(speciesComCena);

  const geometry = useMemo(() => {
    const geo = buildBillboardQuadGeometry();
    const cap = Math.max(1, instances.length);
    geo.setAttribute("aSize", new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
    geo.setAttribute("aAtlasRect", new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    return geo;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a CAPACIDADE (contagem) importa aqui; o conteúdo é escrito no efeito abaixo
  }, [instances.length]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => (atlas ? makeImpostorMaterial(atlas.texture) : null), [atlas]);
  useEffect(() => () => material?.dispose(), [material]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const primeira = useRef(true);

  // Reescreve matriz/tamanho/retângulo-do-atlas só quando `center` muda — o
  // MESMO gatilho que `PlayView.visibleProps` usa pros props reais, nunca
  // por `useFrame`.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !atlas || instances.length === 0) return;
    medir("impostor→rebuild", () => {
      const sizeAttr = geometry.getAttribute("aSize") as THREE.InstancedBufferAttribute;
      const rectAttr = geometry.getAttribute("aAtlasRect") as THREE.InstancedBufferAttribute;
      // a DECISÃO (quem desenha, com que Y) mora em `resolverInstanciasVisiveis`
      // — pura, testada sem `<Canvas>` (`coerenciaHorizonte.test.ts`). Aqui só
      // sobra escrever o resultado nos buffers de GPU (matriz/tamanho/atlas).
      const visiveis = resolverInstanciasVisiveis(instances, alturasHorizonte, center, radius, limite);
      let n = 0;
      for (const v of visiveis) {
        const inst = instances[v.index]!;
        const size = atlas.sizeByAssetId.get(inst.assetId) ?? FALLBACK_SIZE;
        const rect = atlas.rectByAssetId.get(inst.assetId);
        if (!rect) continue; // espécie não bakeada (não deveria acontecer — collectTreeSpecies gera o mesmo conjunto)
        _pos.set(inst.position.x, v.y, inst.position.z);
        _m.compose(_pos, _q, _s);
        mesh.setMatrixAt(n, _m);
        sizeAttr.setXY(n, size.width * inst.scale * inst.flip, size.height * inst.scale);
        rectAttr.setXYZW(n, rect[0], rect[1], rect[2], rect[3]);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      rectAttr.needsUpdate = true;
      if (primeira.current) {
        registrarEvento("cena", "impostorArvore:create", { instancias: instances.length, visiveis: n });
        primeira.current = false;
      }
    });
  }, [instances, alturasHorizonte, atlas, geometry, center.x, center.z, radius, limite]);

  // isolamento (`?iso=semImpostorArvore`): checado DEPOIS dos hooks, mesmo
  // padrão do resto da cena (hook registrado é hook que roda)
  if (isolado("semImpostorArvore")) return null;
  if (instances.length === 0 || !atlas || !material) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instances.length]}
      // a malha cobre árvores do mapa INTEIRO, não só o que está no frustum
      // deste quadro (mesmo raciocínio do HorizonMesh: culling automático do
      // three cortaria a caixa do InstancedMesh inteiro, não por instância)
      frustumCulled={false}
      name="impostoresArvore"
      castShadow={false}
      receiveShadow={false}
    />
  );
}
