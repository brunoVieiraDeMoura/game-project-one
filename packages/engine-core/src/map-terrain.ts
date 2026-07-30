import { cellIndex, type GameMap } from "@ragnarok/map-format";
import type { TerrainQuery } from "./movement/types";

/**
 * Adapta um GameMap ao TerrainQuery que os MovementControllers consomem — o
 * ÚNICO ponto que traduz colisão/altura do mapa pra query (nem grid nem free
 * duplicam isso). Coordenadas de mundo: origem no canto (0,0) da célula 0;
 * cada célula tem `cellSize` unidades de lado, então a célula de world (x,z) é
 * floor(x/cellSize), floor(z/cellSize).
 *
 * Andável = walkable OU water (em RO água é pisável; wall/cliff bloqueiam).
 * Fora dos limites = bloqueado. Altura vem do heightmap (0 quando ausente do
 * cache legado).
 */
export function createMapTerrainQuery(map: GameMap): TerrainQuery {
  const { width, height } = map.size;
  const { cellSize } = map;

  const cellOf = (x: number, z: number): number | null => {
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(z / cellSize);
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) return null;
    return cellIndex(map, cx, cy);
  };

  return {
    getHeight(x, z) {
      const idx = cellOf(x, z);
      return idx === null ? 0 : (map.heightmap[idx] ?? 0);
    },
    isWalkable(x, z) {
      const idx = cellOf(x, z);
      if (idx === null) return false;
      const c = map.collision[idx];
      return c === "walkable" || c === "water";
    },
  };
}
