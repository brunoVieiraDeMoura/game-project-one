import type { WorldGrid } from "../grid";

/**
 * AABB de mundo (x/z) de uma área de células, amostrando os 4 cantos + folga
 * de meia célula (cobre a caixa inteira da célula da ponta, não só o centro).
 *
 * Recebe a GRADE do mapa (`WorldGrid`, de `grid/`) em vez de assumir hexágono
 * — era `hexToWorld`/`HEX_W`/`HEX_V` cravados aqui, sem checar `terrainMode`
 * nenhum. Isso deixava todo gatilho autorado num mapa SQUARE (o único tipo
 * que o projeto usa hoje — mapa importado do rAthena) posicionado com
 * matemática hexagonal errada, silenciosamente: a área e o alvo do warp
 * caíam num lugar diferente da célula que o editor mostrava.
 *
 * Módulo À PARTE de `TriggerRuntime.tsx` de propósito: aquele arquivo importa
 * `combat/combatStore`, que registra um helper de console (`window.__combat`)
 * no top-level do módulo — inofensivo no navegador, mas quebra a suíte de
 * testes em ambiente Node (sem `window`). Geometria pura não precisa arrastar
 * esse import só para ser testada.
 */
export function areaAABB(grid: WorldGrid, a: { col: number; row: number; w: number; h: number }) {
  const c1 = a.col, r1 = a.row, c2 = a.col + a.w - 1, r2 = a.row + a.h - 1;
  const pts = [grid.cellToWorld(c1, r1), grid.cellToWorld(c2, r1), grid.cellToWorld(c1, r2), grid.cellToWorld(c2, r2)];
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  return {
    minX: Math.min(...xs) - grid.cellWidth() / 2, maxX: Math.max(...xs) + grid.cellWidth() / 2,
    minZ: Math.min(...zs) - grid.cellDepth() / 2, maxZ: Math.max(...zs) + grid.cellDepth() / 2,
  };
}
