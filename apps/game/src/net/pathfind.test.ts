import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { findPath, pathDurationMs, MOVE_COST, MOVE_DIAGONAL_COST } from "./pathfind";

/** mapa de teste a partir de um desenho: '.' andável, '#' parede, '~' água */
function mapaDe(linhas: string[]): GameMap {
  const width = linhas[0]!.length;
  const height = linhas.length;
  const collision: GameMap["collision"] = [];
  // linha 0 do desenho é o TOPO; a grade do rAthena cresce para o norte, então
  // a última linha do desenho é row 0 — assim o desenho fica legível.
  for (let row = 0; row < height; row++) {
    const linha = linhas[height - 1 - row]!;
    for (let col = 0; col < width; col++) {
      const c = linha[col];
      collision.push(c === "#" ? "wall" : c === "~" ? "water" : "walkable");
    }
  }
  return {
    id: "teste",
    name: "teste",
    size: { width, height },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(width * height).fill(0),
    collision,
    surface: [],
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
    lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
    authoredHexScale: 1,
    metadata: { version: 5, generatedAt: new Date().toISOString() },
  } as GameMap;
}

describe("findPath — o A* do rAthena", () => {
  it("terreno livre: anda em diagonal, um passo por célula", () => {
    const map = mapaDe([".....", ".....", ".....", ".....", "....."]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 3, y: 3 });
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it("CONTORNA a parede em vez de atravessar (o bug do bloco vermelho)", () => {
    // parede vertical no meio, com passagem só embaixo
    const map = mapaDe([
      "..#..",
      "..#..",
      "..#..",
      "..#..",
      ".....",
    ]);
    const path = findPath(map, { x: 0, y: 3 }, { x: 4, y: 3 })!;
    expect(path).not.toBeNull();
    // nenhuma célula do caminho pode ser parede
    for (const c of path) {
      expect(map.collision[c.y * map.size.width + c.x]).not.toBe("wall");
    }
    // e ele desce para passar pela abertura (row 0)
    expect(Math.min(...path.map((c) => c.y))).toBe(0);
  });

  it("não corta a QUINA de uma parede (chk_dir)", () => {
    // para ir de (0,0) a (1,1) em diagonal seria preciso passar pela quina;
    // com N e E bloqueados, o rAthena obriga a dar a volta
    const map = mapaDe([
      "...",
      "#..",
      ".#.",
    ]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 });
    // (1,0) é parede e (0,1) é parede → não há como chegar em (1,1) sem cortar
    expect(path).toBeNull();
  });

  it("destino bloqueado não tem caminho", () => {
    const map = mapaDe(["...", ".#.", "..."]);
    expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("água é andável (tipo 3 do map_cache)", () => {
    const map = mapaDe([".~.", ".~.", ".~."]);
    const path = findPath(map, { x: 0, y: 1 }, { x: 2, y: 1 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
  });

  it("fora do mapa não tem caminho", () => {
    const map = mapaDe(["...", "...", "..."]);
    expect(findPath(map, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
  });
});

describe("pathDurationMs", () => {
  it("passo diagonal custa 40% a mais que o reto (unit.cpp:229)", () => {
    const reto = pathDurationMs([{ x: 1, y: 0 }], { x: 0, y: 0 }, 150);
    const diagonal = pathDurationMs([{ x: 1, y: 1 }], { x: 0, y: 0 }, 150);
    expect(reto).toBe(150);
    expect(diagonal).toBe((150 * MOVE_DIAGONAL_COST) / MOVE_COST);
    expect(diagonal / reto).toBeCloseTo(1.4, 5);
  });

  it("soma o caminho inteiro", () => {
    const path = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
    ];
    expect(pathDurationMs(path, { x: 0, y: 0 }, 100)).toBe(140 + 100 + 140);
  });
});
