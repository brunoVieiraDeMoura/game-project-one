import type { GameMap } from "@ragnarok/map-format";
import { createMapTerrainQuery } from "@ragnarok/engine-core";
import { HEX_SIZE, HEX_V, HEX_W, hexToWorld, levelToY, worldToHex } from "../hex/hexGrid";
import { HEX_LATTICE } from "../hex/hexLattice";
import { NEIGHBOR_BY_EDGE } from "../hex/hexTiles";
import { createHexTerrainQuery } from "../hex/hexTerrainQuery";
import { SQUARE_SIZE, squareLevelToY, squareToWorld, worldToSquare } from "./squareGrid";
import { SQUARE_LATTICE } from "./squareLattice";
import { createSquareTerrainQuery } from "./squareTerrainQuery";
import type { WorldGrid } from "./types";

export type { WorldGrid } from "./types";
export * from "./squareGrid";
export { SQUARE_LATTICE } from "./squareLattice";
export { createSquareTerrainQuery } from "./squareTerrainQuery";

/** mapas autorados no editor: hexágonos KayKit, escala controlada por hexScale */
const HEX_GRID: WorldGrid = {
  kind: "hex",
  cellToWorld: hexToWorld,
  worldToCell: worldToHex,
  cellWidth: HEX_W,
  cellDepth: HEX_V,
  levelToY,
  lattice: HEX_LATTICE,
  neighbors: (col, row) => NEIGHBOR_BY_EDGE[row & 1]!.map(([dc, dr]) => [col + dc, row + dr] as [number, number]),
  terrainQuery: createHexTerrainQuery,
  extent(map) {
    // uma folga de um tile evita borda morta no último hexágono
    const w = HEX_W() * map.size.width;
    const d = HEX_V() * map.size.height;
    return { width: w + HEX_W(), depth: d + HEX_V(), cx: w / 2, cz: d / 2 };
  },
  markerRadius: HEX_SIZE,
};

/** mapas do rAthena: uma célula do servidor é uma célula do mundo */
const SQUARE_GRID: WorldGrid = {
  kind: "square",
  cellToWorld: squareToWorld,
  worldToCell: worldToSquare,
  cellWidth: () => SQUARE_SIZE,
  cellDepth: () => SQUARE_SIZE,
  levelToY: squareLevelToY,
  lattice: SQUARE_LATTICE,
  // quatro vizinhos para pintura: incluir a diagonal faria o pincel vazar pela
  // quina e a margem de rio crescer na diagonal
  neighbors: (col, row) => [
    [col + 1, row],
    [col - 1, row],
    [col, row + 1],
    [col, row - 1],
  ],
  terrainQuery: createSquareTerrainQuery,
  extent(map) {
    const w = SQUARE_SIZE * map.size.width;
    const d = SQUARE_SIZE * map.size.height;
    return { width: w, depth: d, cx: w / 2, cz: d / 2 };
  },
  // meia célula: o marcador cobre exatamente o quadrado em que o passo cai
  markerRadius: () => SQUARE_SIZE / 2,
};

/**
 * Mapa legado achatado (`terrainMode: "smooth"`): grade quadrada de
 * `map.cellSize`, desenhada como um plano só. Mantido para os mapas antigos —
 * conteúdo novo do rAthena nasce em `"square"`.
 */
const SMOOTH_GRID: WorldGrid = {
  kind: "square",
  neighbors: (col, row) => [
    [col + 1, row],
    [col - 1, row],
    [col, row + 1],
    [col, row - 1],
  ],
  cellToWorld: (col, row) => ({ x: col, z: row }),
  worldToCell: (x, z) => ({ col: x, row: z }),
  cellWidth: () => 1,
  cellDepth: () => 1,
  levelToY: (level) => level,
  lattice: SQUARE_LATTICE,
  terrainQuery: createMapTerrainQuery,
  extent: (map) => ({
    width: map.size.width * map.cellSize,
    depth: map.size.height * map.cellSize,
    cx: (map.size.width * map.cellSize) / 2,
    cz: (map.size.height * map.cellSize) / 2,
  }),
  markerRadius: () => 0,
};

/**
 * A grade deste mapa.
 *
 * `smooth` recebe uma grade derivada do próprio `cellSize` do mapa (por isso é
 * construída por chamada, não constante) — os outros dois são singletons.
 */
export function gridFor(map: GameMap): WorldGrid {
  if (map.terrainMode === "blocks") return HEX_GRID;
  if (map.terrainMode === "square") return SQUARE_GRID;
  const size = map.cellSize;
  return {
    ...SMOOTH_GRID,
    cellToWorld: (col, row) => ({ x: (col + 0.5) * size, z: (row + 0.5) * size }),
    worldToCell: (x, z) => ({ col: Math.floor(x / size), row: Math.floor(z / size) }),
    cellWidth: () => size,
    cellDepth: () => size,
  };
}
