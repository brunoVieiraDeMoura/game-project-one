import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * `agua-bugada.jpg` (repro ao vivo: "sobe o relevo bastante do lado do rio"):
 * `mountain` já se recusava a sobrescrever água, mas o resto do grupo RELEVO
 * (`raise`/`lower`/`flatten`/`noise`/`smooth`/`inflate`/`scrape`) não — um
 * pincel de raio grande encostado no rio erguia o LEITO célula a célula, cada
 * uma um tanto diferente (o falloff do disco não acompanha a curva do rio), e
 * como a lâmina do rio lê a altura da PRÓPRIA célula, a água virava uma escada
 * de alturas — os picos triangulares escuros saindo da água da referência.
 */
const W = 40;
const H = 40;
const idx = (col: number, row: number) => row * W + col;

function campoPlano(): GameMap {
  const n = W * H;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const mapa = () => st().map!;
const surf = (c: number, r: number) => mapa().surface[idx(c, r)];

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], riverCells: [] });
  st().init(campoPlano());
  st().setEditScope("all");
});

describe("relevo nunca mexe em água já pintada", () => {
  it("'Subir ▲' com disco grande encostado no rio não altera o leito", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    for (let r = 15; r <= 25; r++) {
      st().beginStroke();
      st().paintCell(20, r);
    }
    const alturaAntes = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);

    // disco de raio 8 CENTRADO dentro do próprio rio — o caso que reproduz o bug
    st().setBrush("raise");
    st().setBrushSize(8);
    st().setBrushStrength(1);
    st().beginStroke();
    for (let k = 0; k < 10; k++) st().paintCell(20, 20);

    const alturaDepois = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);
    expect(alturaDepois).toEqual(alturaAntes);
    for (let r = 15; r <= 25; r++) expect(surf(20, r)).toBe("river");
  });

  it("terra ao lado do rio SOBE normalmente — só a água em si fica de fora", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);

    st().setBrush("raise");
    st().setBrushSize(3);
    st().setBrushStrength(1);
    st().beginStroke();
    for (let k = 0; k < 5; k++) st().paintCell(24, 20); // longe o bastante do leito

    expect(mapa().heightmap[idx(24, 20)]).toBeGreaterThan(0);
  });

  it("'Suavizar' também não mexe em lago", () => {
    st().setBrush("water");
    st().setBrushSize(4);
    st().beginStroke();
    st().paintCell(20, 20);
    const alturaAntes = mapa().heightmap[idx(20, 20)];

    st().setBrush("smooth");
    st().setBrushSize(6);
    st().setBrushStrength(1);
    st().beginStroke();
    for (let k = 0; k < 5; k++) st().paintCell(20, 20);

    expect(mapa().heightmap[idx(20, 20)]).toBe(alturaAntes);
    expect(surf(20, 20)).toBe("water");
  });

  it("'Afundar ▼' (lower) também não mexe em rio", () => {
    st().setBrush("riverDeep");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);
    const alturaAntes = mapa().heightmap[idx(20, 20)];

    st().setBrush("lower");
    st().setBrushSize(6);
    st().setBrushStrength(1);
    st().beginStroke();
    for (let k = 0; k < 5; k++) st().paintCell(20, 20);

    expect(mapa().heightmap[idx(20, 20)]).toBe(alturaAntes);
    expect(surf(20, 20)).toBe("river");
  });

  /**
   * `grab`/`ledge` moram fora do laço principal (arrastam de uma ÂNCORA, não
   * um disco parado sob o cursor) e tinham a MESMA lacuna: só bloqueavam
   * `wall`/`cliff`, nunca `river`/`water`. Reportado ao vivo: "testa com Subir
   * e Puxar, todas dão o mesmo problema".
   */
  it("'Puxar' (grab) com a âncora encostada no rio não mexe no leito", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    for (let r = 15; r <= 25; r++) {
      st().beginStroke();
      st().paintCell(20, r);
    }
    const alturaAntes = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);

    st().setBrush("grab");
    st().setBrushSize(8);
    st().setBrushStrength(1);
    st().beginStroke();
    st().beginRamp(20, 20); // âncora bem no meio do rio
    st().paintCell(30, 20); // arrasta bem longe — puxão forte

    const alturaDepois = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);
    expect(alturaDepois).toEqual(alturaAntes);
    for (let r = 15; r <= 25; r++) expect(surf(20, r)).toBe("river");
  });

  it("'Promontório' (ledge) não avança por cima do rio nem troca a superfície dele", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    for (let r = 15; r <= 25; r++) {
      st().beginStroke();
      st().paintCell(20, r);
    }
    const alturaAntes = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);

    st().setBrush("ledge");
    st().setBrushSize(8);
    st().beginStroke();
    st().beginRamp(10, 20); // raiz do lado de cá do rio
    st().paintCell(30, 20); // ponta do lado de lá — atravessa o canal inteiro

    const alturaDepois = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);
    expect(alturaDepois).toEqual(alturaAntes);
    for (let r = 15; r <= 25; r++) expect(surf(20, r)).toBe("river");
  });

  it("pincel de superfície (Areia) não sobrescreve rio dentro do raio", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);

    st().setBrush("sand");
    st().setBrushSize(6);
    st().beginStroke();
    st().paintCell(20, 20);

    expect(surf(20, 20)).toBe("river");
  });

  it("mas o pincel de Lago continua podendo pintar por cima do rio (fusão rio↔lago)", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);

    st().setBrush("water");
    st().setBrushSize(4);
    st().beginStroke();
    st().paintCell(20, 20);

    expect(surf(20, 20)).toBe("water");
  });
});
