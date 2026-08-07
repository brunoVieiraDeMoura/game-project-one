import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { areaAABB } from "./triggerGeometry";
import { gridFor } from "../grid";
import { squareToWorld, SQUARE_SIZE } from "../grid/squareGrid";
import { hexToWorld } from "../hex/hexGrid";
import { setHexScale } from "../hex/hexGrid";

/**
 * `TriggerRuntime` usava `hexToWorld`/`HEX_W`/`HEX_V` SEM checar
 * `terrainMode` — todo gatilho autorado num mapa square (o único tipo que o
 * projeto usa hoje) era posicionado com matemática hexagonal, errada. A
 * correção é ler a grade do PRÓPRIO mapa (`gridFor`), como o resto da cena
 * de jogo já faz.
 */
function mapaComModo(terrainMode: GameMap["terrainMode"]): GameMap {
  const W = 10, H = 10, n = W * H;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode,
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
    authoredHexScale: 1,
  } as unknown as GameMap;
}

describe("areaAABB (TriggerRuntime)", () => {
  it("mapa SQUARE: a caixa sai da grade quadrada, não da hexagonal", () => {
    setHexScale(1);
    const map = mapaComModo("square");
    const grid = gridFor(map);
    const box = areaAABB(grid, { col: 3, row: 4, w: 2, h: 2 });

    // os 4 cantos em squareToWorld, com meia célula de folga pra fora
    const c1 = squareToWorld(3, 4);
    const c2 = squareToWorld(4, 5);
    expect(box.minX).toBeCloseTo(Math.min(c1.x, c2.x) - SQUARE_SIZE / 2, 9);
    expect(box.maxX).toBeCloseTo(Math.max(c1.x, c2.x) + SQUARE_SIZE / 2, 9);
    expect(box.minZ).toBeCloseTo(Math.min(c1.z, c2.z) - SQUARE_SIZE / 2, 9);
    expect(box.maxZ).toBeCloseTo(Math.max(c1.z, c2.z) + SQUARE_SIZE / 2, 9);
  });

  it("mapa SQUARE não usa mais a matemática hexagonal (a causa do bug)", () => {
    setHexScale(1);
    const map = mapaComModo("square");
    const grid = gridFor(map);
    const box = areaAABB(grid, { col: 3, row: 4, w: 1, h: 1 });

    // com o bug antigo, o centro da célula seria hexToWorld(3,4) — bem
    // diferente de squareToWorld(3,4) porque a grade hex usa passo em X maior
    // e desloca linha ímpar em meia célula.
    const hex = hexToWorld(3, 4);
    const centroCaixa = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
    expect(Math.abs(centroCaixa.x - hex.x)).toBeGreaterThan(0.5);
  });

  it("mapa HEX (blocks) continua usando hexToWorld — não regrediu o caso hex", () => {
    setHexScale(1);
    const map = mapaComModo("blocks");
    const grid = gridFor(map);
    const box = areaAABB(grid, { col: 3, row: 4, w: 1, h: 1 });
    const hex = hexToWorld(3, 4);
    const centroCaixa = { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
    expect(centroCaixa.x).toBeCloseTo(hex.x, 9);
    expect(centroCaixa.z).toBeCloseTo(hex.z, 9);
  });
});
