import * as THREE from "three";

/**
 * VENTO PROCEDURAL — deslocamento de vértice, sem física e sem `useFrame` por
 * objeto.
 *
 * Mesmo padrão de `hex/groundMaterial.ts`/`grid/SquareTerrain.tsx` (água):
 * `onBeforeCompile` sobre um CLONE do material do glTF, `customProgramCacheKey`
 * porque o patch varia por perfil, e um uniform de tempo AVANÇADO POR FORA (um
 * `useFrame` só, em `WindSystem`) em vez de por instância.
 *
 * O truque que evita trabalho de JS por planta: `PropInstance` clona a CENA do
 * glTF (`gltf.scene.clone(true)`), mas `THREE.Mesh.clone()` copia
 * `material`/`geometry` POR REFERÊNCIA, não por cópia profunda — então toda
 * árvore da mesma espécie no mapa aponta para o MESMO objeto de material.
 * Patchear uma vez por espécie (cache por identidade do material original,
 * `MATERIAIS_COM_VENTO`) e todas as instâncias ganham vento de graça. A
 * variação por INSTÂNCIA (pra não balançar tudo em sincronia) sai de dentro do
 * shader, a partir de `modelMatrix[3].xz` (a posição de mundo de cada malha já
 * é única mesmo com material compartilhado) — nenhum uniform por objeto.
 */

export type WindCategory = "grass" | "tree";

export interface WindProfile {
  /** deslocamento máximo (unidades de mundo) no topo da malha */
  amp: number;
  /** velocidade da onda principal */
  freq: number;
  /** velocidade da rajada (variação de baixa frequência) */
  gustFreq: number;
  /** fração de `amp` somada pela rajada (0..1) */
  gustAmp: number;
  /** expoente do peso por altura — maior = base mais parada */
  heightPow: number;
}

/** perfil-base por categoria: grama balança rápido e quase inteira, árvore
 * balança devagar e só na copa (heightPow alto mantém o tronco parado). */
export const WIND_PROFILES: Record<WindCategory, WindProfile> = {
  grass: { amp: 0.16, freq: 2.6, gustFreq: 0.35, gustAmp: 0.6, heightPow: 1.3 },
  tree: { amp: 0.1, freq: 0.85, gustFreq: 0.18, gustAmp: 0.55, heightPow: 2.4 },
};

/**
 * Categoria do catálogo (`props/registry`) → categoria de vento. Só
 * folhagem baixa (grama/arbusto) e madeira (árvore/árvore seca) recebem o
 * patch — pedra/construção/etc. saem sem tocar no material.
 */
const WIND_CATEGORY_BY_PROP_CATEGORY: Record<string, WindCategory | undefined> = {
  grass: "grass",
  bush: "grass",
  // flor/planta — mesmo perfil raso da grama (caule fino, sem massa de
  // tronco); chegaram com o pacote `nature-catalog` (2026-08)
  flower: "grass",
  plant: "grass",
  tree: "tree",
  tree_bare: "tree",
  // rock/stone ficam de fora de propósito — pedra não balança com vento
};

export function windCategoryFor(propCategory: string | undefined): WindCategory | undefined {
  return propCategory ? WIND_CATEGORY_BY_PROP_CATEGORY[propCategory] : undefined;
}

/**
 * Overrides por asset — as 3 grama + 3 árvore do cenário de teste (seção 8 do
 * pedido) ganham intensidade/velocidade EXPLICITAMENTE diferentes, pra dar
 * pra comparar visualmente tipo A/B/C sem depender só da variação por hash.
 * Assets fora desta lista usam o perfil-base da categoria — funciona pra
 * qualquer prop de grama/árvore do catálogo, não só os 6 escolhidos.
 */
const SPECIES_OVERRIDE: Record<string, Partial<WindProfile>> = {
  // grama baixa — curta, oscila rápido e pouco
  grass_2_a: { amp: 0.08, freq: 3.4, gustAmp: 0.4 },
  // grama média
  grass_1_a: { amp: 0.16, freq: 2.6 },
  // grama alta/tufo denso — mais massa, oscila mais devagar e mais largo
  grass_1_d: { amp: 0.26, freq: 1.7, gustAmp: 0.7 },
  // árvore pequena — mais ágil que uma copa grande
  tree_2_a: { amp: 0.07, freq: 1.1, heightPow: 2.0 },
  // árvore média
  tree_1_a: { amp: 0.1, freq: 0.85 },
  // árvore grande/copa larga — mais inércia, oscila mais devagar
  tree_1_c: { amp: 0.13, freq: 0.6, heightPow: 2.8 },
};

function profileFor(assetId: string, cat: WindCategory): WindProfile {
  const base = WIND_PROFILES[cat];
  const over = SPECIES_OVERRIDE[assetId];
  return over ? { ...base, ...over } : base;
}

/**
 * Uniforms GLOBAIS (direção/força/tempo do vento) — um objeto só,
 * COMPARTILHADO POR REFERÊNCIA por todo material com vento. `WindSystem`
 * muta `uWindTime.value` num único `useFrame`; nenhum material individual
 * precisa de atualização.
 */
export const windUniforms = {
  uWindTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
  uWindStrength: { value: 1 },
};

/** GLSL comum injetado uma vez por material com vento */
const WIND_GLSL = `
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindAmp;
uniform float uWindFreq;
uniform float uWindGustFreq;
uniform float uWindGustAmp;
uniform float uWindHeightPow;
uniform float uWindMinY;
uniform float uWindMaxY;
`;

// hash barato (1 seno) — só pra desfasar cada instância, não é ruído de verdade.
//
// A semente é a posição de mundo do OBJETO — `modelMatrix[3].xz`. Isso quebra
// sob `InstancedMesh` (Fase 1, otimização de vegetação): todo o `InstancedMesh`
// tem UM `modelMatrix` só (a transform do grupo, não de cada planta), então sem
// a guarda abaixo todas as instâncias da mesma malha balançariam em sincronia
// perfeita. `instanceMatrix[3].xz` é a tradução da PRÓPRIA instância (o atributo
// que o three já declara sob `USE_INSTANCING`) — única por planta, sem uniform
// novo nem custo extra por instância.
const WIND_VERTEX = `
{
  float wH = clamp((transformed.y - uWindMinY) / max(uWindMaxY - uWindMinY, 1e-4), 0.0, 1.0);
  float wW = pow(wH, uWindHeightPow);
#ifdef USE_INSTANCING
  vec2 wSeed = instanceMatrix[3].xz;
#else
  vec2 wSeed = modelMatrix[3].xz;
#endif
  float wPhase = fract(sin(dot(wSeed, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float wMain = sin(uWindTime * uWindFreq + wPhase);
  float wGust = sin(uWindTime * uWindGustFreq + wPhase * 1.7) * uWindGustAmp;
  float wDisp = (wMain + wGust) * uWindAmp * wW * uWindStrength;
  transformed.xz += uWindDir * wDisp;
}
`;

const boundsCache = new WeakMap<THREE.BufferGeometry, { minY: number; maxY: number }>();

function boundsFor(geo: THREE.BufferGeometry): { minY: number; maxY: number } {
  let b = boundsCache.get(geo);
  if (b) return b;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  b = { minY: bb.min.y, maxY: bb.max.y };
  boundsCache.set(geo, b);
  return b;
}

const materialCache = new WeakMap<THREE.Material, THREE.Material>();

/**
 * Devolve a versão com vento do material (clona + patcha na PRIMEIRA vez por
 * material original; da segunda em diante é lookup no cache — zero
 * recompilação de shader por instância nova da mesma espécie).
 */
export function windMaterialFor(base: THREE.Material, geometry: THREE.BufferGeometry, assetId: string, cat: WindCategory): THREE.Material {
  const cached = materialCache.get(base);
  if (cached) return cached;

  const profile = profileFor(assetId, cat);
  const { minY, maxY } = boundsFor(geometry);
  const mat = base.clone();
  const key = `wind|${cat}|${assetId}`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindAmp = { value: profile.amp };
    shader.uniforms.uWindFreq = { value: profile.freq };
    shader.uniforms.uWindGustFreq = { value: profile.gustFreq };
    shader.uniforms.uWindGustAmp = { value: profile.gustAmp };
    shader.uniforms.uWindHeightPow = { value: profile.heightPow };
    shader.uniforms.uWindMinY = { value: minY };
    shader.uniforms.uWindMaxY = { value: maxY };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WIND_GLSL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WIND_VERTEX}`);
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;

  materialCache.set(base, mat);
  return mat;
}

// mesmo padrão de `__gl`/`__perf`/`__iso` (flightRecorder/isolamento/PerfHud):
// inspeção manual no console durante o teste A/B, sem custo em produção
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __vento?: unknown }).__vento = {
    uniforms: windUniforms,
    perfis: WIND_PROFILES,
  };
}
