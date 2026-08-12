import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import type { GameMap, MapProp } from "@ragnarok/map-format";
import { propCategory, propUrl } from "../props/registry";
import { bakeSpeciesImage } from "./treeImpostorBake";
import { compartilharTexturas } from "../gltfTexturas";
import { registrarEvento } from "../core/diagnostics/flightRecorder";
import { isolado } from "../core/diagnostics/isolamento";

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

  registrarEvento("cena", "impostorArvore:atlas", {
    especies: species.length,
    ms: Math.round((performance.now() - t0) * 10) / 10,
  });
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

export function TreeImpostors({
  map,
  center,
  radius,
}: {
  map: GameMap;
  center: { x: number; z: number };
  radius: number;
}) {
  const instances = useMemo(() => buildTreeImpostorInstances(map.props), [map]);
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
    const sizeAttr = geometry.getAttribute("aSize") as THREE.InstancedBufferAttribute;
    const rectAttr = geometry.getAttribute("aAtlasRect") as THREE.InstancedBufferAttribute;
    const r2 = radius * radius;
    let n = 0;
    for (const inst of instances) {
      const dx = inst.position.x - center.x;
      const dz = inst.position.z - center.z;
      // dentro do raio de detalhe: a árvore 3D real (PropInstance) já cobre
      // este ponto — não desenhar a mesma árvore duas vezes
      if (dx * dx + dz * dz <= r2) continue;
      const size = atlas.sizeByAssetId.get(inst.assetId) ?? FALLBACK_SIZE;
      const rect = atlas.rectByAssetId.get(inst.assetId);
      if (!rect) continue; // espécie não bakeada (não deveria acontecer — collectTreeSpecies gera o mesmo conjunto)
      _m.compose(inst.position, _q, _s);
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
  }, [instances, atlas, geometry, center.x, center.z, radius]);

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
