import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * `Desktop/ref/aqui-animal.jpg`: Montanha pintada até o fim virava um platô
 * com parede quase vertical na borda ("sobe seco") — o teto de altura era
 * GLOBAL (`MOUNTAIN_MAX`), então qualquer célula do disco, por mais longe do
 * centro, acabava saturando nele se o gesto se repetisse o bastante (e
 * arrastar o mouse já dispara dezenas de `paintCell` por segundo). Agora o
 * teto é por célula (`teto × peso do falloff`), então a borda do disco nunca
 * alcança a altura do centro — a subida fica curva, não em mesa.
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
const h = (c: number, r: number) => mapa().heightmap[idx(c, r)]!;

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], riverCells: [] });
  st().init(campoPlano());
  st().setEditScope("all");
});

describe("Montanha: a encosta não vira platô por mais que se pinte", () => {
  it("pintar MUITAS vezes no mesmo ponto ainda deixa a borda do disco mais baixa que o centro", () => {
    st().setBrush("mountain");
    st().setBrushSize(8);
    st().setBrushStrength(1);
    st().beginStroke();
    for (let k = 0; k < 80; k++) st().paintCell(20, 20); // disparado como um arrasto longo

    const centro = h(20, 20);
    const meio = h(24, 20); // metade do raio
    const borda = h(28, 20); // quase na borda do disco (raio 8)

    expect(centro).toBeGreaterThan(meio);
    expect(meio).toBeGreaterThan(borda);
    // a borda fica sensivelmente abaixo do centro — não "quase lá", uma encosta de verdade
    expect(borda).toBeLessThan(centro * 0.4);
  });

  it("o centro AINDA alcança o teto (MOUNTAIN_MAX) com pintura suficiente — não regride a força do pincel", () => {
    st().setBrush("mountain");
    st().setBrushSize(6);
    st().setBrushStrength(1);
    st().beginStroke();
    for (let k = 0; k < 80; k++) st().paintCell(20, 20);
    expect(h(20, 20)).toBe(40); // MOUNTAIN_MAX
  });

  it("um gesto único e pequeno (poucas passadas) continua dando um morro suave, como antes", () => {
    st().setBrush("mountain");
    st().setBrushSize(6);
    st().setBrushStrength(0.3);
    st().beginStroke();
    st().paintCell(20, 20);
    st().paintCell(20, 20);
    st().paintCell(20, 20);
    expect(h(20, 20)).toBeGreaterThan(0);
    expect(h(20, 20)).toBeLessThan(40);
  });
});
