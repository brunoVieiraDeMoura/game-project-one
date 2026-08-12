import { describe, expect, it } from "vitest";
import type { GameMap } from "./index";
import { objetosForaDosLimites, resizeGameMap } from "./resize";

function mapa(w: number, h: number, cellSize = 5): GameMap {
  const n = w * h;
  return {
    id: "t",
    name: "t",
    size: { width: w, height: h },
    cellSize,
    terrainMode: "square",
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
    lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
    sky: { skyId: "day" },
    ambientParticles: [],
    metadata: { version: 6, generatedAt: new Date().toISOString() },
  } as GameMap;
}

describe("resizeGameMap", () => {
  it("encolher preserva o canto superior-esquerdo (heightmap/collision/surface)", () => {
    const m = mapa(4, 4);
    const idx = (c: number, r: number) => r * 4 + c;
    m.heightmap[idx(1, 1)] = 3;
    m.collision[idx(2, 2)] = "wall";
    m.surface[idx(0, 3)] = "sand";

    const { map: r } = resizeGameMap(m, 3, 3);
    expect(r.size).toEqual({ width: 3, height: 3 });
    expect(r.heightmap[1 * 3 + 1]).toBe(3); // (1,1) sobrevive
    expect(r.collision[2 * 3 + 2]).toBe("wall"); // (2,2) sobrevive (última linha/coluna que cabe)
    // (0,3) caiu fora (row 3 não existe mais num mapa 3×3)
  });

  it("crescer preenche o novo espaço com o padrão (nível 0, walkable, grass)", () => {
    const m = mapa(2, 2);
    m.heightmap[0] = 5;
    m.collision[0] = "wall";
    const { map: r } = resizeGameMap(m, 4, 4);
    expect(r.size).toEqual({ width: 4, height: 4 });
    expect(r.heightmap[0]).toBe(5); // (0,0) preservado
    expect(r.collision[0]).toBe("wall");
    // célula nova (3,3), fora da área antiga
    expect(r.heightmap[3 * 4 + 3]).toBe(0);
    expect(r.collision[3 * 4 + 3]).toBe("walkable");
    expect(r.surface[3 * 4 + 3]).toBe("grass");
  });

  it("rampas são reindexadas pro novo width, não perdidas nem embaralhadas", () => {
    const m = mapa(5, 5);
    const idx = (c: number, r: number) => r * 5 + c;
    m.ramps = [idx(2, 2), 3]; // célula (2,2), borda 3
    const { map: r } = resizeGameMap(m, 4, 4);
    const novoIdx = 2 * 4 + 2; // (2,2) no mapa novo de largura 4
    expect(r.ramps).toEqual([novoIdx, 3]);
  });

  it("mesmo tamanho é NO-OP (devolve a mesma referência de mapa)", () => {
    const m = mapa(6, 6);
    const { map: r } = resizeGameMap(m, 6, 6);
    expect(r).toBe(m);
  });

  it("props/spawns dentro dos novos limites não aparecem em foraDosLimites", () => {
    const m = mapa(10, 10, 2);
    m.props = [{ id: "p1", assetId: "a", position: [4, 0, 4], rotation: [0, 0, 0], scale: [1, 1, 1] }];
    m.spawns = [{ id: "s1", kind: "player_start", position: [6, 0, 6] }];
    const { foraDosLimites } = resizeGameMap(m, 10, 10); // sem encolher
    expect(foraDosLimites.props).toHaveLength(0);
    expect(foraDosLimites.spawns).toHaveLength(0);
  });

  it("encolher relata quem fica fora (props/spawns), SEM apagar do array", () => {
    const m = mapa(10, 10, 2); // limite atual: 20×20 unidades
    m.props = [
      { id: "dentro", assetId: "a", position: [2, 0, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: "fora", assetId: "a", position: [18, 0, 2], rotation: [0, 0, 0], scale: [1, 1, 1] }, // x=18 >= 5*2=10
    ];
    m.spawns = [{ id: "s-fora", kind: "player_start", position: [2, 0, 18] }];
    const { map: r, foraDosLimites } = resizeGameMap(m, 5, 5); // novo limite: 10×10
    // nada foi apagado — os dois props e o spawn continuam no array
    expect(r.props).toHaveLength(2);
    expect(r.spawns).toHaveLength(1);
    // mas o relatório aponta exatamente quem ficou fora
    expect(foraDosLimites.props.map((p) => p.id)).toEqual(["fora"]);
    expect(foraDosLimites.spawns.map((s) => s.id)).toEqual(["s-fora"]);
  });

  it("gatilho conta como fora se QUALQUER canto da área ultrapassa o limite", () => {
    const m = mapa(10, 10, 2);
    m.triggers = [{ id: "t1", kind: "save", area: { col: 4, row: 4, w: 3, h: 3 } }]; // vai até col 7 (x=14 >= limite 10 depois do resize)
    const { foraDosLimites } = resizeGameMap(m, 5, 5);
    expect(foraDosLimites.triggers.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("objetosForaDosLimites", () => {
  it("não muda nada — é só leitura", () => {
    const m = mapa(4, 4, 3);
    m.props = [{ id: "p", assetId: "a", position: [100, 0, 100], rotation: [0, 0, 0], scale: [1, 1, 1] }];
    const r = objetosForaDosLimites(m, 4, 4);
    expect(r.props).toHaveLength(1);
    expect(m.props).toHaveLength(1); // array original intocado
  });
});
