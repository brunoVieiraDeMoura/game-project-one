import * as THREE from "three";
import { WIND_GLSL, WIND_VERTEX, windUniforms, type WindProfile } from "./wind";
import { REVEAL_CONFIG, revealStats } from "./vegetationReveal";
import { isolado } from "../core/diagnostics/isolamento";

/**
 * MATERIAL DE ÁRVORE COM REVELAÇÃO — vento (reaproveita `props/wind.ts`, sem
 * reescrever) + fade de revelação (copa/tronco alto funde mais que a base),
 * no MESMO `onBeforeCompile` — mesmo motivo de `props/grass/grassMaterial.ts`
 * não usar `windMaterialFor` direto: dois patches de `onBeforeCompile` no
 * mesmo material não empilham, o segundo simplesmente substitui o primeiro.
 *
 * ## Fade — BLEND real (4º/5º tuning: dither sempre mostrava a trama)
 *
 * Testadas as duas técnicas ao vivo (`pontilhadinhos.jpg`): dither/discard
 * (ruído branco, depois Bayer ordenado) sempre deixa visível a TEXTURA do
 * padrão em fade PARCIAL (~50%) — é inerente a decidir pixel-a-pixel entre
 * "desenha" ou "descarta"; nenhum padrão de dither escapa disso no meio da
 * curva, só nas pontas (perto de 0% ou 100%). `transparent=true` +
 * `diffuseColor.a *= (1 - vFadeAmount)` dá gradiente contínuo de verdade.
 *
 * O motivo original pra evitar `transparent` era o caso genérico ("milhares
 * de árvores, cada uma um objeto na fila de blend/sort") — não se aplica
 * aqui: a vegetação é INSTANCIADA (1 `InstancedMesh` por ESPÉCIE, não por
 * árvore), então ligar blend nesta espécie custa UM objeto a mais na lista
 * de transparência (≈15 no total, uma por espécie de árvore), não um por
 * árvore. `instanceFade` continua um float por instância (`attribute` sob
 * `USE_INSTANCING`) — nenhum material novo por árvore, nenhum uniform novo
 * por árvore, só a SAÍDA do shader mudou de discard pra alpha.
 *
 * ## Máscara vertical — LIMIAR + smoothstep, só na FOLHA
 *
 * `pow(hFrac, N)` nunca achata em 1,0 de verdade — só se aproxima
 * assintoticamente. A máscara tem TRÊS regiões (ver `vegetationReveal.ts:
 * canopyWeightForHeight`, a cópia em JS testável desta MESMA fórmula):
 *
 *   h <= canopyFadeStart            → platô no mínimo (uTrunkFadeFraction) — o "toco" visível
 *   canopyFadeStart..canopyFadeFull → smoothstep (transição suave, Hermite)
 *   h >= canopyFadeFull             → platô em 1,0 (resto da árvore, achatado no MÁXIMO)
 *
 * `finalFade = instanceFade × canopyWeight(alturaFracionária)` — é o
 * `occlusionFade × canopyFade` do pedido; não existe `distanceFade` de árvore
 * hoje (o corte de árvore é binário por raio, em `instanciasVisiveisNaCamada`
 * — decisão deliberada de NÃO mexer nisso aqui).
 *
 * `uIsBark` (bug visual real, `pontilhadinhos.jpg` — "galho virando silhueta
 * transparente no céu"): a malha de CASCA (`Bark_*`) do catálogo Quaternius
 * inclui o GALHO inteiro, não só o toco — sobe quase até onde a copa começa.
 * Aplicar a MESMA curva por altura nela fazia os galhos altos ficarem quase
 * 100% transparentes (mesma faixa "alta" que devia ser só da folha),
 * revelando um esqueleto fantasma contra o céu. `Bark_*`/`Leaves_*` são
 * SUB-MALHAS SEPARADAS (`bakeSpeciesParts`, um material por parte) — a
 * casca inteira agora usa um peso PLANO (`uTrunkFadeFraction`, sem curva por
 * altura nenhuma); só a folha segue a máscara height-based. `DeadTree_*` (só
 * tem `Bark_*`, sem copa) por consequência quase não funde — condizente
 * com o galho seco já ser fino/aberto na silhueta, não precisa esconder.
 *
 * ## Uniforms COMPARTILHADOS — tuning sem recompilar
 *
 * `uCanopyFadeStart`/`uCanopyFadeFull`/`uTrunkFadeFraction` apontam pro MESMO
 * objeto (`revealShaderUniforms`) em TODA espécie — igual `windUniforms`.
 * Mudar `.value` pelo console (`window.__revelacao.uniforms`) atualiza a
 * malha inteira no PRÓXIMO quadro, sem tocar em `customProgramCacheKey` nem
 * recompilar shader nenhum. Só `uRevealOn` (liga/desliga por `?iso=`) e
 * `uWind*` (perfil por ESPÉCIE, não por mapa) continuam sendo uniform próprio
 * por material.
 */

export const revealShaderUniforms = {
  uCanopyFadeStart: { value: REVEAL_CONFIG.canopyFadeStart },
  uCanopyFadeFull: { value: REVEAL_CONFIG.canopyFadeFull },
  uTrunkFadeFraction: { value: REVEAL_CONFIG.trunkFadeFraction },
};

const CANOPY_VERTEX_GLSL = `
attribute float instanceFade;
uniform float uCanopyMinY;
uniform float uCanopyMaxY;
uniform float uCanopyFadeStart;
uniform float uCanopyFadeFull;
uniform float uTrunkFadeFraction;
uniform float uRevealOn;
uniform float uIsBark;
varying float vFadeAmount;
`;

const CANOPY_VERTEX_MAIN = `
{
  float canopyWeight;
  if (uIsBark > 0.5) {
    // casca/galho: peso PLANO, nunca segue a curva por altura (ver uIsBark no docblock)
    canopyWeight = uTrunkFadeFraction;
  } else {
    float hFrac = clamp((transformed.y - uCanopyMinY) / max(uCanopyMaxY - uCanopyMinY, 1e-4), 0.0, 1.0);
    float t = smoothstep(uCanopyFadeStart, uCanopyFadeFull, hFrac);
    canopyWeight = mix(uTrunkFadeFraction, 1.0, t);
  }
  vFadeAmount = uRevealOn * instanceFade * canopyWeight;
}
`;

const CANOPY_FRAGMENT_GLSL = `
varying float vFadeAmount;
`;

// multiplica o ALPHA (não descarta pixel) — `diffuseColor.a` já existe no
// chunk `<color_fragment>` que este bloco sucede; `alphatest_fragment` (se a
// folha tiver corte de forma, Quaternius alphaMode MASK) roda DEPOIS, então
// o recorte da silhueta da folha continua intacto, só por cima dele agora
// tem gradiente de transparência de verdade.
const CANOPY_FRAGMENT_MAIN = `
diffuseColor.a *= (1.0 - vFadeAmount);
`;

interface BoundsY {
  minY: number;
  maxY: number;
}
const boundsCache = new WeakMap<THREE.BufferGeometry, BoundsY>();
function boundsFor(geo: THREE.BufferGeometry): BoundsY {
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
 * Clona + patcha (vento + revelação) na primeira vez por material-base;
 * cache por identidade do `base` — UM programa de GPU por espécie, igual
 * `windMaterialFor`/`grassMaterialFor`.
 *
 * `revealOn` entra na CHAVE de cache (não como só-uniform-mutável): mesma
 * regra do `fadeOn` da grama — `?iso=semRevelacaoArvore` decide na MONTAGEM,
 * não precisa ser um toggle ao vivo por quadro.
 *
 * Sem parâmetro `cfg`: os três campos da máscara vertical vivem SÓ em
 * `revealShaderUniforms` (inicializado de `REVEAL_CONFIG` na carga do
 * módulo). Se este material aceitasse `cfg` nas chamadas seguintes e
 * resincronizasse o uniform toda vez, uma espécie nova carregada DEPOIS de
 * alguém ajustar `window.__revelacao.uniforms` ao vivo apagaria o ajuste —
 * a fonte de verdade em runtime é sempre o uniform compartilhado, nunca o
 * `cfg` de um chamador específico.
 */
export function treeMaterialFor(
  base: THREE.Material,
  geometry: THREE.BufferGeometry,
  cacheKey: string,
  windProfile: WindProfile,
  isBark = false,
): THREE.Material {
  const cached = materialCache.get(base);
  if (cached) return cached;

  const { minY, maxY } = boundsFor(geometry);
  const mat = base.clone();
  const revealOn = isolado("semRevelacaoArvore") ? 0 : 1;
  // blend real (ver comentário do módulo) — só quando a revelação está
  // ativa: com `?iso=semRevelacaoArvore` a árvore nem ganha o custo de
  // transparência, volta a ser opaca normal (mesma régua de `uRevealOn`).
  if (revealOn) mat.transparent = true;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.uniforms.uWindDir = windUniforms.uWindDir;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindAmp = { value: windProfile.amp };
    shader.uniforms.uWindFreq = { value: windProfile.freq };
    shader.uniforms.uWindGustFreq = { value: windProfile.gustFreq };
    shader.uniforms.uWindGustAmp = { value: windProfile.gustAmp };
    shader.uniforms.uWindHeightPow = { value: windProfile.heightPow };
    shader.uniforms.uWindMinY = { value: minY };
    shader.uniforms.uWindMaxY = { value: maxY };
    // reutiliza os MESMOS limites Y do vento — a copa é "onde o vento é
    // forte", e "onde o fade é forte" é a mesma pergunta geométrica
    shader.uniforms.uCanopyMinY = { value: minY };
    shader.uniforms.uCanopyMaxY = { value: maxY };
    shader.uniforms.uCanopyFadeStart = revealShaderUniforms.uCanopyFadeStart;
    shader.uniforms.uCanopyFadeFull = revealShaderUniforms.uCanopyFadeFull;
    shader.uniforms.uTrunkFadeFraction = revealShaderUniforms.uTrunkFadeFraction;
    shader.uniforms.uRevealOn = { value: revealOn };
    shader.uniforms.uIsBark = { value: isBark ? 1 : 0 };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WIND_GLSL}\n${CANOPY_VERTEX_GLSL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WIND_VERTEX}\n${CANOPY_VERTEX_MAIN}`);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CANOPY_FRAGMENT_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${CANOPY_FRAGMENT_MAIN}`);
  };
  mat.customProgramCacheKey = () => `treeReveal|${cacheKey}|r${revealOn}`;
  mat.needsUpdate = true;

  materialCache.set(base, mat);
  return mat;
}

// mesma régua de `window.__vento`/`window.__iso`/`window.__revelacao`: expõe
// os uniforms compartilhados pra tuning ao vivo. Anexa em CIMA do objeto que
// `vegetationReveal.ts` já criou (`revealStats`), então
// `window.__revelacao.uniforms.uCanopyFadeStart.value = 0.5` funciona no
// console sem esperar nenhuma outra ordem de import.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (revealStats as unknown as { uniforms?: unknown }).uniforms = revealShaderUniforms;
}
