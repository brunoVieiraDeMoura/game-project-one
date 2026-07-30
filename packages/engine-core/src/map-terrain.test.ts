import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { createMapTerrainQuery } from "./map-terrain";

/** grid 3×2 (row-major, index = y*width+x), cellSize 5:
 *  y=0: walkable wall  walkable
 *  y=1: water    cliff walkable
 */
const map: GameMap = {
  id: "t",
  name: "t",
  size: { width: 3, height: 2 },
  cellSize: 5,
  terrainMode: "smooth",
  heightmap: [0, 0, 0, 7, 0, 0],
  collision: ["walkable", "wall", "walkable", "water", "cliff", "walkable"],
  surface: [],
  waterLevel: null,
  props: [],
  spawns: [],
  triggers: [],
  ramps: [],
  authoredHexScale: 1,
  lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
  metadata: { version: 1, generatedAt: "2026-07-19T00:00:00.000Z" },
};

describe("createMapTerrainQuery", () => {
  const q = createMapTerrainQuery(map);

  it("walkable e water pisáveis; wall e cliff bloqueiam", () => {
    expect(q.isWalkable(0, 0)).toBe(true); // (0,0) index 0 walkable
    expect(q.isWalkable(5, 0)).toBe(false); // cx=1,cy=0 index 1 = wall
    expect(q.isWalkable(10, 0)).toBe(true); // cx=2,cy=0 index 2 = walkable
  });

  it("mapeia world→célula por cellSize", () => {
    // (x,z)=(6,1) → cx=1,cy=0 → index 1 = wall → bloqueado
    expect(q.isWalkable(6, 1)).toBe(false);
    // (x,z)=(2,7) → cx=0,cy=1 → index 3 = water → pisável
    expect(q.isWalkable(2, 7)).toBe(true);
    // (x,z)=(7,8) → cx=1,cy=1 → index 4 = cliff → bloqueado
    expect(q.isWalkable(7, 8)).toBe(false);
  });

  it("fora dos limites = bloqueado", () => {
    expect(q.isWalkable(-1, 0)).toBe(false);
    expect(q.isWalkable(15, 0)).toBe(false);
    expect(q.isWalkable(0, 10)).toBe(false);
  });

  it("altura vem do heightmap da célula", () => {
    // (x,z)=(0,6) → cx=0,cy=1 → index 3 → altura 7
    expect(q.getHeight(0, 6)).toBe(7);
    expect(q.getHeight(0, 0)).toBe(0);
    expect(q.getHeight(-1, -1)).toBe(0); // fora = 0
  });
});
