import type { CellLattice } from "@ragnarok/engine-core";
import { hexToWorld, worldToHex } from "./hexGrid";
import { NEIGHBOR_BY_EDGE } from "./hexTiles";

/**
 * Lattice do clique-tile (modo grid) em mapas HEXAGONAIS: célula = hexágono
 * (col,row) do mesmo grid do terreno/editor, centro = `hexToWorld`, vizinhos =
 * as 6 bordas.
 *
 * Sem isso o modo grid andava numa grade QUADRADA de `map.cellSize` (5) dentro
 * de um mundo de hexágonos com 2 de largura: o passo não tinha relação com o
 * tile pisado e o personagem parava a até 2,5 unidades do hexágono clicado —
 * o que ficou visível quando o cursor de chão virou um marcador pequeno.
 *
 * Escala: hexToWorld/worldToHex já aplicam o hexScale corrente, então o passo
 * acompanha o tamanho do bloco automaticamente (ver hexGrid.setHexScale).
 */
export const HEX_LATTICE: CellLattice = {
  toCell(x, z) {
    const { col, row } = worldToHex(x, z);
    return { cx: col, cz: row };
  },
  center(cx, cz) {
    return hexToWorld(cx, cz);
  },
  neighbors(cx, cz) {
    const ring = NEIGHBOR_BY_EDGE[cz & 1]!;
    return ring.map(([dc, dr]) => ({ cx: cx + dc, cz: cz + dr }));
  },
};
