import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { brushFalloff, useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Pincel PROPORCIONAL (o "Proportional Editing" do Blender / "Soft Selection").
 *
 * Antes `raise` somava +1 nível em cada célula do disco por igual: subia um pilar
 * de topo chato e paredes retas, exatamente o aspecto de blocos que se quer
 * evitar. Agora o centro sobe `força` e a vizinhança acompanha em degradê, então
 * o gesto produz colina.
 */
const W = 30;
const H = 30;
const idx = (col: number, row: number) => row * W + col;

function mapaPlano(): GameMap {
  const n = W * H;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 1,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: [],
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const alt = (col: number, row: number) => st().map!.heightmap[idx(col, row)] ?? 0;

describe("brushFalloff", () => {
  it("vale 1 no centro e 0 na borda", () => {
    expect(brushFalloff(0, 10)).toBeCloseTo(1);
    expect(brushFalloff(10, 10)).toBeCloseTo(0);
  });

  it("cai de forma monótona, sem aresta na borda", () => {
    let anterior = brushFalloff(0, 10);
    for (let d = 0.5; d <= 10; d += 0.5) {
      const v = brushFalloff(d, 10);
      expect(v).toBeLessThanOrEqual(anterior + 1e-9);
      anterior = v;
    }
    // derivada ~0 na borda (smoothstep): sem degrau no limite do pincel
    expect(brushFalloff(9.9, 10)).toBeLessThan(0.01);
  });

  it("raio zero afeta só o próprio ponto", () => {
    expect(brushFalloff(0, 0)).toBe(1);
    expect(brushFalloff(1, 0)).toBe(0);
  });
});

describe("pincel de relevo proporcional", () => {
  beforeEach(() => {
    setHexScale(1);
    useEditorStore.setState({ past: [], future: [] });
    st().init(mapaPlano());
    st().setEditScope("all");
    st().setBrush("raise");
    st().setBrushSize(5);
    st().setBrushStrength(1);
  });

  it("o centro sobe mais que o meio, e o meio mais que a borda", () => {
    st().paintCell(15, 15);
    const centro = alt(15, 15);
    const meio = alt(18, 15);
    const borda = alt(20, 15);
    expect(centro).toBeGreaterThan(meio);
    expect(meio).toBeGreaterThan(borda);
    expect(borda).toBeGreaterThanOrEqual(0);
  });

  it("a altura é FRACIONÁRIA (é o que permite encosta lisa)", () => {
    st().setBrushStrength(0.3);
    st().paintCell(15, 15);
    const h = alt(16, 15);
    expect(h).toBeGreaterThan(0);
    expect(Number.isInteger(h)).toBe(false);
  });

  it("passar várias vezes acumula, como amassar argila", () => {
    st().setBrushStrength(0.3);
    st().paintCell(15, 15);
    const uma = alt(15, 15);
    for (let k = 0; k < 4; k++) st().paintCell(15, 15);
    expect(alt(15, 15)).toBeGreaterThan(uma * 3);
  });

  it("sem degrau seco entre células vizinhas da colina", () => {
    st().setBrushStrength(1);
    st().paintCell(15, 15);
    let maiorDegrau = 0;
    for (let c = 10; c < 20; c++) maiorDegrau = Math.max(maiorDegrau, Math.abs(alt(c + 1, 15) - alt(c, 15)));
    // o pico é 1 nível e o disco tem 5 de raio: nenhum par vizinho salta 1 inteiro
    expect(maiorDegrau).toBeLessThan(0.5);
  });

  it("força maior sobe mais, no mesmo gesto", () => {
    st().setBrushStrength(0.2);
    st().paintCell(8, 8);
    const fraco = alt(8, 8);
    st().setBrushStrength(1.2);
    st().paintCell(20, 20);
    expect(alt(20, 20)).toBeGreaterThan(fraco * 3);
  });

  it("suavizar aproxima da média sem arredondar para nível inteiro", () => {
    // degrau seco no meio do mapa
    const m = mapaPlano();
    for (let r = 0; r < H; r++) for (let c = 15; c < W; c++) (m.heightmap as number[])[idx(c, r)] = 4;
    st().init(m);
    st().setBrush("smooth");
    st().setBrushSize(4);
    st().setBrushStrength(1);
    st().paintCell(15, 15);
    const h = alt(15, 15);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(4);
    expect(Number.isInteger(h)).toBe(false);
  });
});
