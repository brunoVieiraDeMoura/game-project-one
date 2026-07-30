import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { rampCells } from "./rampBrush";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

const LIM = { width: 40, height: 40 };

describe("rampCells", () => {
  it("interpola do nível de baixo ao de cima ao longo do traçado", () => {
    const cells = rampCells({ col: 5, row: 5 }, { col: 13, row: 5 }, 0, 8, 0, LIM);
    const porColuna = new Map(cells.map((c) => [c.col, c.level]));
    // subida contínua: uma célula, um nível
    for (let k = 0; k <= 8; k++) expect(porColuna.get(5 + k), `col ${5 + k}`).toBe(k);
  });

  it("as pontas ficam exatamente nos níveis pedidos", () => {
    const cells = rampCells({ col: 2, row: 2 }, { col: 2, row: 12 }, 1, 6, 0, LIM);
    const base = cells.find((c) => c.row === 2)!;
    const topo = cells.find((c) => c.row === 12)!;
    expect(base.level).toBe(1);
    expect(topo.level).toBe(6);
  });

  it("não passa das pontas: t é preso em 0..1", () => {
    const cells = rampCells({ col: 10, row: 10 }, { col: 14, row: 10 }, 0, 4, 2, LIM);
    // uma célula ANTES da ponta de baixo não pode ficar negativa nem além do topo
    const antes = cells.filter((c) => c.col < 10);
    const depois = cells.filter((c) => c.col > 14);
    for (const c of antes) expect(c.level).toBe(0);
    for (const c of depois) expect(c.level).toBe(4);
  });

  it("a largura vem do raio do pincel", () => {
    const fina = rampCells({ col: 20, row: 20 }, { col: 26, row: 20 }, 0, 3, 0, LIM);
    const larga = rampCells({ col: 20, row: 20 }, { col: 26, row: 20 }, 0, 3, 2, LIM);
    expect(larga.length).toBeGreaterThan(fina.length * 3);
    // na faixa larga, células da mesma coluna têm a MESMA altura (a rampa sobe
    // ao longo do traçado, não para os lados)
    const col23 = larga.filter((c) => c.col === 23).map((c) => c.level);
    expect(new Set(col23).size).toBe(1);
  });

  it("descer é o mesmo gesto ao contrário", () => {
    const cells = rampCells({ col: 5, row: 5 }, { col: 10, row: 5 }, 5, 0, 0, LIM);
    const porColuna = new Map(cells.map((c) => [c.col, c.level]));
    expect(porColuna.get(5)).toBe(5);
    expect(porColuna.get(10)).toBe(0);
  });

  it("não sai dos limites do mapa", () => {
    const cells = rampCells({ col: 0, row: 0 }, { col: 3, row: 0 }, 0, 3, 3, LIM);
    for (const c of cells) {
      expect(c.col).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.col).toBeLessThan(LIM.width);
      expect(c.row).toBeLessThan(LIM.height);
    }
  });

  it("clique sem arrastar não cria ladeira nenhuma", () => {
    const cells = rampCells({ col: 8, row: 8 }, { col: 8, row: 8 }, 2, 2, 1, LIM);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c.level).toBe(2);
  });
});

/** mapa quadrado plano, com um platô de nível 6 do lado direito */
function mapaComPlato(): GameMap {
  const W = 40;
  const H = 40;
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  for (let r = 0; r < H; r++) for (let c = 25; c < W; c++) heightmap[r * W + c] = 6;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 1,
    terrainMode: "square",
    heightmap,
    collision: new Array(n).fill("walkable"),
    surface: [],
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const alt = (col: number, row: number) => st().map!.heightmap[row * 40 + col];

describe("pincel rampa no editor", () => {
  beforeEach(() => {
    setHexScale(1);
    useEditorStore.setState({ past: [], future: [], rampAnchor: null, rampBase: null });
    st().init(mapaComPlato());
    st().setEditScope("all");
    st().setBrush("ramp");
    st().setBrushSize(1);
  });

  it("arrastar do chão até o platô cria a ladeira inteira", () => {
    st().beginStroke();
    st().beginRamp(20, 10); // chão, nível 0
    st().paintCell(25, 10); // platô, nível 6
    // sobe ao longo das cinco células, sem degrau seco
    const perfil = [alt(20, 10), alt(21, 10), alt(22, 10), alt(23, 10), alt(24, 10), alt(25, 10)];
    expect(perfil).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it("arrastar de novo NÃO acumula (a base é o mapa de antes do gesto)", () => {
    st().beginStroke();
    st().beginRamp(20, 10);
    st().paintCell(25, 10);
    const primeiro = [alt(21, 10), alt(23, 10)];
    // o mesmo gesto, sem soltar: passa pela célula do meio e volta ao fim
    st().paintCell(23, 10);
    st().paintCell(25, 10);
    expect([alt(21, 10), alt(23, 10)]).toEqual(primeiro);
  });

  it("sem âncora (nenhum gesto começado) não muda nada", () => {
    st().endRamp();
    const antes = st().map;
    st().paintCell(25, 10);
    expect(st().map).toBe(antes);
  });

  it("um undo desfaz a rampa inteira", () => {
    st().beginStroke();
    st().beginRamp(20, 10);
    st().paintCell(25, 10);
    st().undo();
    for (let c = 20; c < 25; c++) expect(alt(c, 10)).toBe(0);
  });

  it("não abre passagem nem molda bloqueio fora do escopo próprio", () => {
    const m = mapaComPlato();
    (m.collision as string[])[10 * 40 + 22] = "cliff";
    st().init(m);
    st().setEditScope("inside");
    st().setBrush("ramp");
    st().beginStroke();
    st().beginRamp(20, 10);
    st().paintCell(25, 10);
    expect(st().map!.collision[10 * 40 + 22]).toBe("cliff");
    expect(alt(22, 10)).toBe(0); // a ravina não recebeu altura
    expect(alt(23, 10)).toBeGreaterThan(0); // o chão em volta, sim
  });
});
