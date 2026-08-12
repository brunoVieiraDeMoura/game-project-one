import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { findBlockedClusters, summarizeClusters } from "./blockedClusters";

/** mapa de teste desenhado: '.' andável, '#' parede, '^' penhasco, '~' água */
function mapaDe(linhas: string[]): GameMap {
  const width = linhas[0]!.length;
  const height = linhas.length;
  const collision: GameMap["collision"] = [];
  for (let row = 0; row < height; row++) {
    const linha = linhas[height - 1 - row]!;
    for (let col = 0; col < width; col++) {
      const c = linha[col];
      collision.push(c === "#" ? "wall" : c === "^" ? "cliff" : c === "~" ? "water" : "walkable");
    }
  }
  return {
    id: "t", name: "t",
    size: { width, height },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(width * height).fill(0),
    collision,
    surface: [],
    terrainStyle: {},
    waterLevel: null,
    props: [], spawns: [], triggers: [], ramps: [],
    lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
    authoredHexScale: 1,
    sky: { skyId: "day" },
    ambientParticles: [],
    metadata: { version: 5, generatedAt: new Date().toISOString() },
  } as GameMap;
}

describe("findBlockedClusters", () => {
  it("uma célula sozinha é obstáculo pequeno", () => {
    const c = findBlockedClusters(mapaDe([".....", "..#..", "....."]));
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe("small");
    expect(c[0]!.center).toEqual({ col: 2, row: 1 });
  });

  it("duas coladas são médio; encostadas só pela QUINA são dois pequenos", () => {
    const juntas = findBlockedClusters(mapaDe([".....", ".##..", "....."]));
    expect(juntas).toHaveLength(1);
    expect(juntas[0]!.kind).toBe("medium");

    const quina = findBlockedClusters(mapaDe(["..#..", ".#...", "....."]));
    expect(quina).toHaveLength(2);
    expect(quina.every((c) => c.kind === "small")).toBe(true);
  });

  it("três em L é médio", () => {
    const c = findBlockedClusters(mapaDe(["......", ".##...", ".#....", "......"]));
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe("medium");
    expect(c[0]!.cells).toHaveLength(3);
  });

  it("quadrado 2×2 é grande; quatro em linha continua médio", () => {
    const quadrado = findBlockedClusters(mapaDe(["......", ".##...", ".##...", "......"]));
    expect(quadrado[0]!.kind).toBe("large");
    // centro no meio das quatro células
    expect(quadrado[0]!.center).toEqual({ col: 1.5, row: 1.5 });

    const linha = findBlockedClusters(mapaDe(["......", ".####.", "......"]));
    expect(linha[0]!.kind).toBe("medium");
  });

  it("mancha maior que quatro é estrutura (encosta, construção, borda)", () => {
    const c = findBlockedClusters(mapaDe(["#####", "#####", "#####"]));
    expect(c).toHaveLength(1);
    expect(c[0]!.kind).toBe("structure");
    expect(c[0]!.onBorder).toBe(true);
  });

  it("penhasco conta como bloqueado; água não", () => {
    const c = findBlockedClusters(mapaDe([".....", ".^~..", "....."]));
    expect(c).toHaveLength(1);
    expect(c[0]!.cells).toEqual([[1, 1]]);
  });

  it("marca quem encosta na moldura do mapa", () => {
    const c = findBlockedClusters(mapaDe([
      "#....",
      ".....",
      "..#..",
      ".....",
      ".....",
    ]));
    expect(c.filter((x) => x.onBorder)).toHaveLength(1); // o do canto
    expect(c.filter((x) => !x.onBorder)).toHaveLength(1); // o do meio
  });

  it("resume a contagem por tipo", () => {
    const c = findBlockedClusters(mapaDe([
      "........",
      ".#...##.",
      ".....##.",
      "........",
      "..##....",
      "........",
    ]));
    expect(summarizeClusters(c)).toEqual({ small: 1, medium: 1, large: 1, structure: 0 });
  });
});
