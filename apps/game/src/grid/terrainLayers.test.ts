import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { buildChunkGeometry, cellLayer } from "./squareChunks";
import { TERRAIN_LAYER } from "./terrainTextures";

/**
 * As camadas de textura do chão quadrado.
 *
 * Duas invariantes valem mais que o resto:
 *
 * • o índice de camada é CONSTANTE nos quatro vértices de um quad — ele é
 *   interpolado pelo rasterizador, e um valor fracionário no meio do quad não
 *   corresponde a camada nenhuma;
 * • o peso da mistura num canto é o MESMO visto dos dois lados da fronteira,
 *   senão a transição teria uma costura visível entre células vizinhas.
 */

const W = 8;
const H = 8;

function mapa(over: Partial<Record<"collision" | "surface", unknown[]>> = {}): GameMap {
  const n = W * H;
  return {
    size: { width: W, height: H },
    collision: over.collision ?? new Array(n).fill("walkable"),
    surface: over.surface ?? new Array(n).fill("grass"),
    heightmap: new Array(n).fill(0),
  } as unknown as GameMap;
}

const idx = (col: number, row: number) => row * W + col;

describe("cellLayer", () => {
  it("superfície autorada escolhe a camada", () => {
    const surface = new Array(W * H).fill("grass");
    surface[idx(3, 3)] = "sand";
    surface[idx(4, 3)] = "stone";
    const m = mapa({ surface });
    expect(cellLayer(m, idx(3, 3))).toBe(TERRAIN_LAYER.sand);
    expect(cellLayer(m, idx(4, 3))).toBe(TERRAIN_LAYER.stone);
  });

  it("mata (wall sem superfície) usa a textura de GRAMA — é vegetação, não pedra", () => {
    const collision = new Array(W * H).fill("walkable");
    collision[idx(1, 1)] = "wall";
    expect(cellLayer(mapa({ collision, surface: [] }), idx(1, 1))).toBe(TERRAIN_LAYER.grass);
  });

  it("barranco e leito de água usam TERRA", () => {
    const collision = new Array(W * H).fill("walkable");
    collision[idx(1, 1)] = "cliff";
    collision[idx(2, 1)] = "water";
    const m = mapa({ collision, surface: [] });
    expect(cellLayer(m, idx(1, 1))).toBe(TERRAIN_LAYER.dirt);
    expect(cellLayer(m, idx(2, 1))).toBe(TERRAIN_LAYER.dirt);
  });

  it("montanha (wall + stone) usa PEDRA, apesar de bloqueada", () => {
    // é o que a torna diferente da mata: o pincel de montanha grava a superfície
    const collision = new Array(W * H).fill("walkable");
    const surface = new Array(W * H).fill("grass");
    collision[idx(5, 5)] = "wall";
    surface[idx(5, 5)] = "stone";
    expect(cellLayer(mapa({ collision, surface }), idx(5, 5))).toBe(TERRAIN_LAYER.stone);
  });
});

describe("atributos de mistura na malha", () => {
  /** vértices agrupados de 4 em 4 (um quad) com camada e peso */
  function quads(m: GameMap) {
    const geo = buildChunkGeometry(m, 0, 0);
    const pos = geo.getAttribute("position");
    const a = geo.getAttribute("aLayerA");
    const b = geo.getAttribute("aLayerB");
    const t = geo.getAttribute("aBlend");
    const out: Array<{ la: number; lb: number; pesos: number[]; xz: Array<[number, number]> }> = [];
    for (let v = 0; v < pos.count; v += 4) {
      out.push({
        la: a.getX(v),
        lb: b.getX(v),
        pesos: [t.getX(v), t.getX(v + 1), t.getX(v + 2), t.getX(v + 3)],
        xz: [0, 1, 2, 3].map((k) => [pos.getX(v + k), pos.getZ(v + k)] as [number, number]),
      });
    }
    geo.dispose();
    return out;
  }

  it("mapa uniforme: peso zero em tudo, uma camada só", () => {
    const qs = quads(mapa());
    expect(qs.every((q) => q.la === TERRAIN_LAYER.grass)).toBe(true);
    expect(qs.every((q) => q.pesos.every((p) => p === 0))).toBe(true);
  });

  it("camada é constante dentro de cada quad", () => {
    const surface = new Array(W * H).fill("grass");
    for (let r = 0; r < H; r++) for (let c = 4; c < W; c++) surface[idx(c, r)] = "sand";
    const geo = buildChunkGeometry(mapa({ surface }), 0, 0);
    const a = geo.getAttribute("aLayerA");
    const b = geo.getAttribute("aLayerB");
    for (let v = 0; v < a.count; v += 4) {
      for (let k = 1; k < 4; k++) {
        expect(a.getX(v + k)).toBe(a.getX(v));
        expect(b.getX(v + k)).toBe(b.getX(v));
      }
    }
    geo.dispose();
  });

  it("na fronteira grama|areia os dois lados concordam no mesmo canto", () => {
    const surface = new Array(W * H).fill("grass");
    for (let r = 0; r < H; r++) for (let c = 4; c < W; c++) surface[idx(c, r)] = "sand";
    const qs = quads(mapa({ surface }));
    // canto do mapa em x = 4*2 = 8 (SQUARE_SIZE = 2), no meio da coluna
    const CANTO: [number, number] = [8, 8];
    const contribuicoes: number[] = [];
    for (const q of qs) {
      const k = q.xz.findIndex(([x, z]) => x === CANTO[0] && z === CANTO[1]);
      if (k < 0) continue;
      // quanto de AREIA este quad desenha naquele canto
      const areia =
        q.la === TERRAIN_LAYER.sand ? 1 - q.pesos[k]! : q.lb === TERRAIN_LAYER.sand ? q.pesos[k]! : 0;
      contribuicoes.push(areia);
    }
    // quatro células se encontram nesse canto — duas de grama, duas de areia
    expect(contribuicoes).toHaveLength(4);
    // e todas desenham a MESMA proporção ali: é o que faz a costura sumir
    expect(new Set(contribuicoes.map((v) => v.toFixed(4))).size).toBe(1);
    expect(contribuicoes[0]).toBeCloseTo(0.5, 5);
  });

  it("no miolo de cada região a textura sai pura", () => {
    const surface = new Array(W * H).fill("grass");
    for (let r = 0; r < H; r++) for (let c = 4; c < W; c++) surface[idx(c, r)] = "sand";
    const qs = quads(mapa({ surface }));
    // canto (0,0) do mapa: só células de grama o tocam
    const q = qs.find((x) => x.xz.some(([px, pz]) => px === 0 && pz === 0))!;
    const k = q.xz.findIndex(([px, pz]) => px === 0 && pz === 0);
    expect(q.la).toBe(TERRAIN_LAYER.grass);
    expect(q.pesos[k]).toBe(0);
  });
});
