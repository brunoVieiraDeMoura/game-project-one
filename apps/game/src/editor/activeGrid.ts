import type { GameMap } from "@ragnarok/map-format";
import { gridFor, type WorldGrid } from "../grid";
import { HEX_V, HEX_W, hexToWorld, levelToY, worldToHex } from "../hex/hexGrid";
import { HEX_LATTICE } from "../hex/hexLattice";
import { createHexTerrainQuery } from "../hex/hexTerrainQuery";
import { NEIGHBOR_BY_EDGE } from "../hex/hexTiles";

/**
 * A grade do mapa ABERTO no editor.
 *
 * O editor trabalha um mapa por vez, e a forma da grade muda tudo: onde fica o
 * centro de uma célula, quem são os vizinhos de um pincel, qual o passo do
 * traçado de estrada. Passar isso como argumento por dezenas de funções puras
 * (`wanderPath`, `cellsInRadius`, o scatter…) só espalharia ruído; o editor já
 * trata `hexScale` como estado de módulo pela mesma razão.
 *
 * `init`/`newMap` do editorStore fixam a grade ao abrir o mapa.
 */

/** grade hexagonal — o default, e o que os mapas autorados usam */
const HEX_FALLBACK: WorldGrid = {
  kind: "hex",
  cellToWorld: hexToWorld,
  worldToCell: worldToHex,
  cellWidth: HEX_W,
  cellDepth: HEX_V,
  levelToY,
  lattice: HEX_LATTICE,
  neighbors: (col, row) => NEIGHBOR_BY_EDGE[row & 1]!.map(([dc, dr]) => [col + dc, row + dr] as [number, number]),
  terrainQuery: createHexTerrainQuery,
  extent: (map) => {
    const w = HEX_W() * map.size.width;
    const d = HEX_V() * map.size.height;
    return { width: w + HEX_W(), depth: d + HEX_V(), cx: w / 2, cz: d / 2 };
  },
  markerRadius: () => 0,
};

let ativa: WorldGrid = HEX_FALLBACK;

export function setEditorGrid(map: GameMap | null): void {
  ativa = map ? gridFor(map) : HEX_FALLBACK;
}

export function editorGrid(): WorldGrid {
  return ativa;
}
