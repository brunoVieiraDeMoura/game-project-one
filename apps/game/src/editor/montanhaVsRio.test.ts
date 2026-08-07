import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Módulo 3 (Água) — as duas travas que faltavam no PINCEL manual (o gerador
 * procedural já as tinha):
 *
 *  • Montanha nunca sobrescreve célula de RIO — sem isso, cruzar o disco por
 *    cima de um canal já traçado cortava o rio em dois com uma parede sólida
 *    no meio, em silêncio.
 *  • Rio nunca sobrescreve célula de LAGO — sem isso, o pincel trocava a
 *    bacia gradual do lago por um platô de profundidade fixa, abrindo um
 *    degrau na emenda.
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
const col_ = (c: number, r: number) => mapa().collision[idx(c, r)];

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], riverCells: [] });
  st().init(campoPlano());
  st().setEditScope("all");
});

describe("Montanha nunca corta um rio", () => {
  it("pintar rio raso e depois montanha por cima NÃO vira o canal em parede", () => {
    // rio horizontal na linha 20
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    for (let c = 15; c <= 25; c++) {
      st().beginStroke();
      st().paintCell(c, 20);
    }
    for (let c = 15; c <= 25; c++) expect(surf(c, 20)).toBe("river");

    // montanha bem no meio do traçado
    st().setBrush("mountain");
    st().setBrushSize(6);
    st().setBrushStrength(1);
    st().beginStroke();
    st().paintCell(20, 20);

    // o canal continua rio onde estava — a montanha não engoliu o leito
    for (let c = 15; c <= 25; c++) {
      expect(surf(c, 20)).toBe("river");
      expect(col_(c, 20)).not.toBe("wall");
    }
  });

  it("montanha longe do rio continua funcionando normalmente", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(5, 5);
    expect(surf(5, 5)).toBe("river");

    st().setBrush("mountain");
    st().setBrushSize(4);
    st().setBrushStrength(1);
    st().beginStroke();
    st().paintCell(30, 30);
    expect(surf(30, 30)).toBe("stone");
    expect(col_(30, 30)).toBe("wall");
  });
});

describe("Rio nunca sobrescreve um lago", () => {
  it("pintar rio raso por cima de água de lago não troca a bacia por um platô fixo", () => {
    st().setBrush("water");
    st().setBrushSize(4);
    st().beginStroke();
    st().paintCell(20, 20);
    expect(surf(20, 20)).toBe("water");
    const alturaDoLago = mapa().heightmap[idx(20, 20)];

    st().setBrush("riverDeep");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);

    // a célula continua sendo água de LAGO (surface "water"), não virou "river"
    expect(surf(20, 20)).toBe("water");
    expect(mapa().heightmap[idx(20, 20)]).toBe(alturaDoLago);
  });

  it("rio raso em chão comum (sem lago por perto) continua pintando normalmente", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(10, 10);
    expect(surf(10, 10)).toBe("river");
  });
});

/**
 * `agua-bugada.jpg`, item 1: subir montanha do lado do rio fazia a raiz da
 * montanha (`suavizarRaiz`) escrever DIRETO no heightmap da célula de água —
 * a mesma altura que `cornerLevel` lê pro canto do rio. "A água sobe a
 * montanha" era essa contaminação, não um efeito visual à parte.
 */
describe("montanha do lado do rio: a água fica embaixo, não sobe junto", () => {
  it("pintar montanha adjacente a rio raso já existente não altera a altura da água", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    for (let r = 15; r <= 25; r++) {
      st().beginStroke();
      st().paintCell(20, r);
    }
    const alturaAntes = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);

    // montanha ENCOSTADA no rio (raio 3, célula 23 fica a 3 de distância da coluna 20)
    st().setBrush("mountain");
    st().setBrushSize(3);
    st().setBrushStrength(1);
    st().beginStroke();
    st().paintCell(23, 20);

    // a montanha de fato subiu (prova que o traçado fez algo)
    expect(mapa().heightmap[idx(23, 20)]).toBeGreaterThan(0);
    expect(col_(23, 20)).toBe("wall");

    // e a coluna de água inteira continua exatamente como estava
    const alturaDepois = [...Array(11).keys()].map((k) => mapa().heightmap[idx(20, 15 + k)]);
    expect(alturaDepois).toEqual(alturaAntes);
    for (let r = 15; r <= 25; r++) expect(surf(20, r)).toBe("river");
  });

  it("descer a montanha de volta (mountainClear) também não mexe na água vizinha", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);
    // baseline real (RIVER_SHALLOW_Y, não necessariamente 0) — o que importa
    // é que ele não se mova, não que seja um valor específico
    const alturaAgua = mapa().heightmap[idx(20, 20)];

    st().setBrush("mountain");
    st().setBrushSize(3);
    st().setBrushStrength(1);
    st().beginStroke();
    st().paintCell(22, 20);
    expect(mapa().heightmap[idx(20, 20)]).toBe(alturaAgua);

    st().setBrush("mountainClear");
    st().setBrushSize(3);
    st().beginStroke();
    st().paintCell(22, 20);
    expect(col_(22, 20)).toBe("walkable");
    // a água nunca saiu do próprio nível em nenhum momento do processo
    expect(mapa().heightmap[idx(20, 20)]).toBe(alturaAgua);
    expect(surf(20, 20)).toBe("river");
  });
});
