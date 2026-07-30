import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { NEIGHBOR_BY_EDGE, longestRun, pickCoastTile, pickRiverTile, pickRoadTile, rampRot } from "./hexTiles";

/**
 * QUAL peça de terreno está em cada célula — uma resposta só, usada pelo
 * desenho (HexTerrain) e pela colisão (hexTerrainQuery).
 *
 * Existe porque a altura do chão passou a ser lida da geometria REAL da peça
 * (ver tileHeight.ts). Se o render escolhesse a peça por um caminho e a física
 * por outro, o personagem andaria sobre um relevo que ninguém vê — que era
 * exatamente o sintoma antigo em outra forma.
 */
export type TileChoice = { file: string; rot: number };

/** rampas do mapa (array achatado [célula, borda, ...]) → mapa indexado */
export function rampMap(map: GameMap): Map<number, number> {
  const ramps = new Map<number, number>();
  for (let i = 0; i + 1 < map.ramps.length; i += 2) ramps.set(map.ramps[i]!, map.ramps[i + 1]!);
  return ramps;
}

export function pickTileFor(map: GameMap, col: number, row: number, ramps: Map<number, number>): TileChoice {
  const { width, height } = map.size;
  const inside = (c: number, r: number) => c >= 0 && c < width && r >= 0 && r < height;
  const surfAt = (c: number, r: number) => {
    if (!inside(c, r)) return null;
    const j = cellIndex(map, c, r);
    const s = map.surface[j] ?? "grass";
    if (s === "river") return "river";
    if (s === "water" || map.collision[j] === "water") return "water";
    return s;
  };

  const idx = cellIndex(map, col, row);
  const nb = NEIGHBOR_BY_EDGE[row & 1]!;
  const self = surfAt(col, row);
  const at = (k: number) => surfAt(col + nb[k]![0], row + nb[k]![1]);
  const offMap = (k: number) => !inside(col + nb[k]![0], row + nb[k]![1]);

  // 1) RIO — foz vira lâmina de água; senão canal orientado pelas conexões
  if (self === "river") {
    for (let k = 0; k < 6; k++) if (at(k) === "water") return { file: "hex_water", rot: 0 };
    const conns: number[] = [];
    for (let k = 0; k < 6; k++) {
      const s = at(k);
      if (s === "river" || s === "water" || offMap(k)) conns.push(k);
    }
    const variant = (col * 7 + row * 13) % 3 === 0;
    const pick = pickRiverTile(conns, variant);
    return pick ?? { file: "hex_water", rot: 0 };
  }

  // 2) LAGO / mar
  if (self === "water") return { file: "hex_water", rot: 0 };

  const isRoad = self === "dirt";

  // 3) RAMPA (com estrada, se a estrada passa por ali)
  const down = ramps.get(idx);
  if (down != null)
    return { file: isRoad ? "hex_road_A_sloped_high" : "hex_grass_sloped_high", rot: rampRot(down) };

  // 4) ESTRADA
  if (isRoad) {
    const conns: number[] = [];
    for (let k = 0; k < 6; k++) if (at(k) === "dirt") conns.push(k);
    const pick = pickRoadTile(conns);
    if (pick) return pick;
  }

  // 5) COSTA (terra no nível da água encostando em lago)
  if ((map.heightmap[idx] ?? 0) === 0) {
    const wet: number[] = [];
    for (let k = 0; k < 6; k++) if (at(k) === "water") wet.push(k);
    const run = wet.length ? longestRun(wet) : null;
    if (run && run.len <= 4) {
      const edges = Array.from({ length: run.len }, (_, i) => (run.start + i) % 6);
      const pick = pickCoastTile(edges);
      if (pick) return pick;
    }
  }

  // 6) chão padrão
  return { file: "hex_grass", rot: 0 };
}
