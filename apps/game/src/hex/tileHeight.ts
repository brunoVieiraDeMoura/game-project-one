import data from "./tile-heightfields.json";
import { TILE_ROT_STEP } from "./hexTiles";

/**
 * Altura do chão lida da GEOMETRIA REAL de cada peça.
 *
 * Antes a altura era aproximada: uma constante por tipo de superfície e uma
 * curva 1D na rampa. Resultado: o personagem flutuava sobre a faixa escavada
 * da estrada (a queda valia pro hexágono inteiro, não só pra faixa), afundava
 * no meio da rampa e "vazava" no começo e no fim dela (a curva não conhecia a
 * posição lateral, e as pontas não casavam com a peça vizinha).
 *
 * Agora cada peça tem um heightfield N×N medido do .gltf
 * (scripts/measure-tiles.mjs → tile-heightfields.json) e a altura sai de
 * amostragem bilinear nele — todo caimento e curvatura da peça, do jeito que
 * o olho vê.
 *
 * As alturas são LOCAIS (1 = altura de um nível); quem chama multiplica por
 * LEVEL_HEIGHT(), que já embute o hexScale.
 */
const FIELDS = data.tiles as Record<string, (number | null)[]>;
const N = data.resolution as number;

const SQRT3 = Math.sqrt(3);
/** meia-largura (x) e meia-altura (z) do tile nativo — mesma convenção do script */
const APOTHEM = 1;
const CORNER = 2 / SQRT3;

/** peças conhecidas (diagnóstico/teste) */
export const KNOWN_TILES = Object.keys(FIELDS);

/** amostra a grade em coordenada contínua, ignorando células fora do hexágono */
function bilinear(grid: (number | null)[], u: number, v: number): number {
  // u,v em [0,N-1] sobre os CENTROS das células
  const c0 = Math.floor(u), r0 = Math.floor(v);
  const fu = u - c0, fv = v - r0;
  let acc = 0, w = 0;
  for (let dr = 0; dr <= 1; dr++) {
    for (let dc = 0; dc <= 1; dc++) {
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || c >= N || r < 0 || r >= N) continue;
      const h = grid[r * N + c];
      if (h == null) continue; // fora do hexágono: não entra na média
      const peso = (dc ? fu : 1 - fu) * (dr ? fv : 1 - fv);
      acc += h * peso;
      w += peso;
    }
  }
  if (w > 0) return acc / w;
  // borda exata do hexágono: cai no vizinho válido mais próximo
  return nearest(grid, c0, r0);
}

function nearest(grid: (number | null)[], c0: number, r0: number): number {
  for (let raio = 1; raio <= 3; raio++) {
    let acc = 0, n = 0;
    for (let dr = -raio; dr <= raio; dr++) {
      for (let dc = -raio; dc <= raio; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || c >= N || r < 0 || r >= N) continue;
        const h = grid[r * N + c];
        if (h == null) continue;
        acc += h;
        n++;
      }
    }
    if (n) return acc / n;
  }
  return 0;
}

/**
 * Altura local em (lx, lz), coordenadas do TILE em unidades nativas
 * (centro em 0,0; hexágono com apótema 1). `rot` é o mesmo índice de rotação
 * que o render aplica — aqui ele é DESFEITO para amostrar a peça sem girar.
 */
export function sampleTileHeight(file: string, rot: number, lx: number, lz: number): number {
  const grid = FIELDS[file];
  if (!grid) return 0; // peça sem medição: chão plano (comportamento antigo)

  // desfaz a rotação do render: mundo = R(θ)·local ⇒ local = R(-θ)·mundo
  const th = rot * TILE_ROT_STEP;
  const cos = Math.cos(th), sin = Math.sin(th);
  const x = lx * cos - lz * sin;
  const z = lx * sin + lz * cos;

  const u = ((x + APOTHEM) / (2 * APOTHEM)) * N - 0.5;
  const v = ((z + CORNER) / (2 * CORNER)) * N - 0.5;
  return bilinear(grid, clamp(u, 0, N - 1), clamp(v, 0, N - 1));
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
