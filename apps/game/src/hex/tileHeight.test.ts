import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { sampleTileHeight } from "./tileHeight";
import { createHexTerrainQuery } from "./hexTerrainQuery";
import { hexToWorld, setHexScale, LEVEL_HEIGHT, levelToY } from "./hexGrid";

/**
 * O chão tem que seguir a GEOMETRIA da peça, não uma média dela: a estrada só é
 * mais baixa onde a faixa passa, e a rampa sobe pelo perfil real, do começo ao
 * fim. Cada aproximação anterior falhou num desses pontos.
 */

function mapa(patch: Partial<GameMap> = {}, w = 9, h = 9): GameMap {
  const n = w * h;
  return {
    id: "t", name: "t",
    size: { width: w, height: h },
    cellSize: 1, terrainMode: "blocks",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    ramps: [], props: [], spawns: [], triggers: [],
    authoredHexScale: 1,
    ...patch,
  } as unknown as GameMap;
}

describe("sampleTileHeight", () => {
  it("grama é plana", () => {
    for (const [x, z] of [[0, 0], [0.5, 0.3], [-0.8, 0.4]] as const)
      expect(Math.abs(sampleTileHeight("hex_grass", 0, x, z))).toBeLessThan(0.02);
  });

  it("a estrada é escavada SÓ na faixa (não no hexágono inteiro)", () => {
    // hex_road_A rot 0: faixa cruzando o tile; o centro afunda, a quina não
    const centro = sampleTileHeight("hex_road_A", 0, 0, 0);
    expect(centro).toBeLessThan(-0.02);
    const fora = sampleTileHeight("hex_road_A", 0, 0, 1.0); // longe da faixa
    expect(fora).toBeGreaterThan(centro + 0.02);
  });

  it("a rampa sobe monotonicamente pelo eixo, do começo ao fim", () => {
    // na rotação base a peça sobe no sentido +x (desce pela borda 3)
    let ant = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const x = -0.98 + (i / 20) * 1.96;
      const h = sampleTileHeight("hex_grass_sloped_high", 0, x, 0);
      expect(h).toBeGreaterThanOrEqual(ant - 1e-6); // nunca desce
      ant = h;
    }
    // pontas ancoradas: encosta no nível de baixo e chega no de cima —
    // era aqui que a rampa "vazava" (começo/fim fora do plano da peça)
    expect(sampleTileHeight("hex_grass_sloped_high", 0, -0.98, 0)).toBeLessThan(0.08);
    expect(sampleTileHeight("hex_grass_sloped_high", 0, 0.98, 0)).toBeGreaterThan(0.95);
  });

  it("rotacionar a peça gira o relevo junto", () => {
    // ponto no eixo da rampa rot 0 = ponto girado 60° na rampa rot 1
    const a = sampleTileHeight("hex_grass_sloped_high", 0, -0.6, 0);
    const th = -Math.PI / 3; // rot 1 gira o mundo em TILE_ROT_STEP
    const b = sampleTileHeight("hex_grass_sloped_high", 1, -0.6 * Math.cos(th), 0.6 * Math.sin(th));
    expect(b).toBeCloseTo(a, 1);
  });

  it("peça sem medição não quebra (chão plano)", () => {
    expect(sampleTileHeight("nao_existe", 0, 0, 0)).toBe(0);
  });
});

describe("getHeight com o relevo real", () => {
  it("na estrada o personagem pisa NA faixa, não flutuando sobre ela", () => {
    setHexScale(1);
    const m = mapa();
    const W = m.size.width;
    for (let c = 2; c <= 6; c++) m.surface[4 * W + c] = "dirt"; // estrada horizontal
    const q = createHexTerrainQuery(m);
    const o = hexToWorld(4, 4);
    const naFaixa = q.getHeight(o.x, o.z);
    expect(naFaixa).toBeLessThan(levelToY(0) - 0.02); // afundado na faixa
    const naGrama = q.getHeight(hexToWorld(4, 2).x, hexToWorld(4, 2).z);
    expect(naGrama).toBeCloseTo(levelToY(0), 2);
  });

  it("a rampa é contínua: nada de degrau no começo nem no fim", () => {
    setHexScale(1);
    const m = mapa();
    const W = m.size.width;
    const idx = 4 * W + 4;
    m.heightmap[idx] = 0;
    for (let r = 0; r < m.size.height; r++) for (let c = 5; c < W; c++) m.heightmap[r * W + c] = 1;
    m.ramps = [idx, 3]; // desce pela borda 3 (-x, lado baixo); sobe pro col 5
    const q = createHexTerrainQuery(m);
    const o = hexToWorld(4, 4);
    // varre o eixo DENTRO da célula: sobe sempre, sem salto entre amostras
    let ant = q.getHeight(o.x - 0.95, o.z);
    expect(ant).toBeLessThan(0.1 * LEVEL_HEIGHT()); // encosta no nível de baixo
    for (let i = 1; i <= 40; i++) {
      const h = q.getHeight(o.x - 0.95 + (i / 40) * 1.9, o.z);
      expect(h).toBeGreaterThanOrEqual(ant - 1e-6);
      expect(h - ant).toBeLessThan(0.15 * LEVEL_HEIGHT());
      ant = h;
    }
    expect(ant).toBeGreaterThan(0.9 * LEVEL_HEIGHT()); // chega no nível de cima
  });

  it("escala junto com o hexScale", () => {
    const m = mapa();
    const W = m.size.width;
    for (let c = 2; c <= 6; c++) m.surface[4 * W + c] = "dirt";
    setHexScale(1);
    const h1 = createHexTerrainQuery(m).getHeight(hexToWorld(4, 4).x, hexToWorld(4, 4).z);
    setHexScale(10);
    const h10 = createHexTerrainQuery(m).getHeight(hexToWorld(4, 4).x, hexToWorld(4, 4).z);
    expect(h10).toBeCloseTo(h1 * 10, 4);
    setHexScale(1);
  });
});
