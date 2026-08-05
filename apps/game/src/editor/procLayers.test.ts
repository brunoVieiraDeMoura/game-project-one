import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { procKey, useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Camada procedural POR ESCOPO.
 *
 * Pedido do change.txt: "quero ter uma layer diferente para gerar
 * proceduralmente o relevo, agua, estrada, vegetação e construção — para cada
 * uma das partes selecionadas". Antes havia uma configuração por categoria, e o
 * filtro `_gen`+categoria apagava a camada do outro escopo ao regenerar.
 */
function mapaImportado(): GameMap {
  const W = 40;
  const H = 40;
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const i = (col: number, row: number) => row * W + col;
  // cinturão bloqueado de 3 células em volta (a "borda")
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) if (c < 3 || r < 3 || c >= W - 3 || r >= H - 3) collision[i(c, r)] = "wall";
  // ravina 4×4 no miolo (o "buraco")
  for (let r = 18; r < 22; r++) for (let c = 18; c < 22; c++) collision[i(c, r)] = "cliff";
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 1,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision,
    surface: [],
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const props = () => st().map!.props;
const daCamada = (cat: string, scope: string) =>
  props().filter((p) => p.tags?.[0] === "_gen" && p.tags?.[1] === cat && p.tags?.[2] === scope);

/** categoria espalhável do catálogo (ver props/registry: SCATTER_CATEGORIES) */
const CAT = "tree";

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], procAmounts: {}, procSeeds: {}, procDisabled: {} });
  st().init(mapaImportado());
});

describe("camadas procedurais por escopo", () => {
  it("gerar dentro e depois na borda mantém as DUAS", () => {
    st().setEditScope("inside");
    st().setCategoryAmount(CAT, 40);
    const dentro = daCamada(CAT, "inside").length;
    expect(dentro).toBeGreaterThan(0);

    st().setEditScope("border");
    st().setCategoryAmount(CAT, 40);
    expect(daCamada(CAT, "border").length).toBeGreaterThan(0);
    // a camada de dentro sobreviveu — era exatamente o que se perdia antes
    expect(daCamada(CAT, "inside")).toHaveLength(dentro);
  });

  it("quantidade e seed são guardadas por camada", () => {
    st().setEditScope("inside");
    st().setCategoryAmount(CAT, 25);
    st().setEditScope("border");
    st().setCategoryAmount(CAT, 70);
    expect(st().procAmounts[procKey("inside", CAT)]).toBe(25);
    expect(st().procAmounts[procKey("border", CAT)]).toBe(70);
    expect(st().procSeeds[procKey("inside", CAT)]).not.toBe(st().procSeeds[procKey("border", CAT)]);
  });

  it("na borda os assets caem em célula BLOQUEADA (senão a camada gerava zero)", () => {
    st().setEditScope("border");
    st().setCategoryAmount(CAT, 60);
    const gerados = daCamada(CAT, "border");
    expect(gerados.length).toBeGreaterThan(0);
    // a borda deste mapa é a faixa de 3 células: todo asset tem que estar nela
    const W = st().map!.size.width;
    const fora = gerados.filter((p) => {
      const col = Math.floor(p.position[0] / 2);
      const row = Math.floor(p.position[2] / 2);
      return col >= 3 && row >= 3 && col < W - 3 && row < W - 3;
    });
    expect(fora).toHaveLength(0);
  });

  it("re-randomizar uma camada não toca na outra", () => {
    st().setEditScope("inside");
    st().setCategoryAmount(CAT, 30);
    st().setEditScope("border");
    st().setCategoryAmount(CAT, 30);
    const antesDentro = daCamada(CAT, "inside").map((p) => p.id);

    st().reseedCategory(CAT); // escopo ativo = border
    expect(daCamada(CAT, "inside").map((p) => p.id)).toEqual(antesDentro);
  });
});

describe("relevo procedural por escopo", () => {
  it("relevo do miolo não altera a colisão nem toca no buraco", () => {
    st().setEditScope("inside");
    st().setTerrainFeature("hill", 80);
    const m = st().map!;
    const i = (col: number, row: number) => row * m.size.width + col;
    // o cinturão continua parede e a ravina continua ravina
    expect(m.collision[i(0, 0)]).toBe("wall");
    expect(m.collision[i(19, 19)]).toBe("cliff");
    expect(m.heightmap[i(19, 19)]).toBe(0); // buraco sem altura autorada
    // e o miolo andável recebeu relevo
    const algumRelevo = m.heightmap.some((h, idx) => h !== 0 && m.collision[idx] === "walkable");
    expect(algumRelevo).toBe(true);
  });

  it("cada escopo guarda seu próprio relevo/seed", () => {
    st().setEditScope("inside");
    st().setTerrainFeature("hill", 50);
    st().setEditScope("border");
    st().setTerrainFeature("mountain", 20);
    expect(st().terrainFeatures.inside.hill).toBe(50);
    expect(st().terrainFeatures.border.hill).toBe(0);
    expect(st().terrainFeatures.border.mountain).toBe(20);
  });

  it("montanha na borda não abre passagem na parede", () => {
    // a montanha FECHA passagem, nunca abre: gerá-la sobre a moldura pode
    // engrossar o bloqueio, jamais transformá-lo em chão
    st().setEditScope("border");
    st().setTerrainFeature("mountain", 100);
    const m = st().map!;
    const i = (col: number, row: number) => row * m.size.width + col;
    expect(m.collision[i(0, 0)]).toBe("wall");
    expect(m.collision[i(1, 1)]).toBe("wall");
  });
});
