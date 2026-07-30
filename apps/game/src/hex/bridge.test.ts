import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { createHexTerrainQuery } from "./hexTerrainQuery";
import { hexToWorld, setHexScale, levelToY } from "./hexGrid";
import { propDeck } from "../props/registry";

/**
 * Ponte = travessia. O bug que motivou estes testes: só a célula do CENTRO do
 * prop virava tabuleiro, então numa ponte de vários hexágonos dava pra encostar
 * mas o meio do rio continuava bloqueado.
 */

/** mapa com um rio vertical na coluna 4 (bloqueado) e terra dos dois lados */
function mapaComRio(w = 9, h = 9): GameMap {
  const n = w * h;
  const m = {
    id: "t", name: "t",
    size: { width: w, height: h },
    cellSize: 1, terrainMode: "blocks",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    ramps: [], props: [], spawns: [], triggers: [],
    authoredHexScale: 1,
  } as unknown as GameMap;
  for (let row = 0; row < h; row++) {
    for (const col of [3, 4, 5]) {
      const i = row * w + col;
      m.surface[i] = "river";
      m.collision[i] = "water";
    }
  }
  return m;
}

/** ponte cruzando o rio em (4,4), girada 90° pra atravessar no eixo X */
function comPonte(m: GameMap, escala: number): GameMap {
  const o = hexToWorld(4, 4);
  return {
    ...m,
    props: [
      {
        id: "b1",
        assetId: "hex_bridge_a",
        position: [o.x, levelToY(0), o.z],
        rotation: [0, Math.PI / 2, 0],
        scale: [escala, escala, escala],
      },
    ],
  } as unknown as GameMap;
}

describe("ponte", () => {
  it("o catálogo traz o tabuleiro medido do modelo", () => {
    const d = propDeck("hex_bridge_a");
    expect(d).toBeDefined();
    expect(d!.y).toBeGreaterThan(0); // piso ACIMA da origem do prop
    expect(d!.hx).toBeGreaterThan(0);
    expect(d!.hz).toBeGreaterThan(0);
  });

  it("sem ponte, o rio bloqueia", () => {
    setHexScale(1);
    const q = createHexTerrainQuery(mapaComRio());
    for (const col of [3, 4, 5]) {
      const o = hexToWorld(col, 4);
      expect(q.isWalkable(o.x, o.z)).toBe(false);
    }
  });

  it("com ponte, dá pra atravessar o rio INTEIRO (não só o centro)", () => {
    setHexScale(1);
    // vão grande o bastante pras 3 células de rio
    const q = createHexTerrainQuery(comPonte(mapaComRio(), 6));
    for (const col of [3, 4, 5]) {
      const o = hexToWorld(col, 4);
      expect(q.isWalkable(o.x, o.z)).toBe(true);
    }
  });

  it("anda POR CIMA: o tabuleiro fica acima do leito", () => {
    setHexScale(1);
    const m = comPonte(mapaComRio(), 6);
    const q = createHexTerrainQuery(m);
    const semPonte = createHexTerrainQuery(mapaComRio());
    const o = hexToWorld(4, 4);
    expect(q.getHeight(o.x, o.z)).toBeGreaterThan(semPonte.getHeight(o.x, o.z));
    const d = propDeck("hex_bridge_a")!;
    expect(q.getHeight(o.x, o.z)).toBeCloseTo(levelToY(0) + d.y * 6, 5);
  });

  it("o piso é PLANO: mesma altura em toda a travessia (sem degrau no meio)", () => {
    setHexScale(1);
    const q = createHexTerrainQuery(comPonte(mapaComRio(), 6));
    const alturas = [3, 4, 5].map((col) => {
      const o = hexToWorld(col, 4);
      return q.getHeight(o.x, o.z);
    });
    for (const a of alturas) expect(a).toBeCloseTo(alturas[0]!, 6);
  });

  it("fora do vão o rio continua bloqueado", () => {
    setHexScale(1);
    const q = createHexTerrainQuery(comPonte(mapaComRio(), 6));
    const longe = hexToWorld(4, 8); // mesma coluna de rio, longe da ponte
    expect(q.isWalkable(longe.x, longe.z)).toBe(false);
  });

  it("acompanha o hexScale", () => {
    const m = comPonte(mapaComRio(), 6);
    setHexScale(1);
    const q1 = createHexTerrainQuery(m);
    const o1 = hexToWorld(4, 4);
    expect(q1.isWalkable(o1.x, o1.z)).toBe(true);
    setHexScale(10);
    // no mundo grande posição E tamanho do prop vêm escalados (scaleMapPositions);
    // comPonte já monta a posição na escala corrente
    const q10 = createHexTerrainQuery(comPonte(mapaComRio(), 60));
    for (const col of [3, 4, 5]) {
      const o = hexToWorld(col, 4);
      expect(q10.isWalkable(o.x, o.z)).toBe(true);
    }
    setHexScale(1);
  });
});
