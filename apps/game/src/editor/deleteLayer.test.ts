import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap, MapProp, MapSpawn } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";
import { squareToWorld } from "../grid/squareGrid";

/**
 * Hierarquia: apagar a camada inteira e marcar faixas com Shift.
 *
 * Apagar respeita o ESCOPO da barra — a mesma regra que vale para criar. Sem
 * isso o botão de apagar seria a única ferramenta do editor capaz de atravessar
 * o escopo e derrubar trabalho do outro lado do mapa.
 */
const W = 24;
const H = 24;
const idx = (col: number, row: number) => row * W + col;

/** prop numa célula (posição de mundo, como o editor grava) */
function propEm(id: string, col: number, row: number): MapProp {
  const { x, z } = squareToWorld(col, row);
  return { id, assetId: "tree_1_a", position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] } as MapProp;
}
function spawnEm(id: string, col: number, row: number): MapSpawn {
  const { x, z } = squareToWorld(col, row);
  return { id, kind: "mob", refId: "poring", count: 1, position: [x, 0, z] } as MapSpawn;
}

function mapaComCoisas(): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) if (c < 2 || r < 2 || c >= W - 2 || r >= H - 2) collision[idx(c, r)] = "wall";
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
    // dois no miolo, um na borda
    props: [propEm("p1", 10, 10), propEm("p2", 12, 12), propEm("p3", 0, 5)],
    spawns: [spawnEm("s1", 8, 8), spawnEm("s2", 9, 9), spawnEm("s3", 1, 1)],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const ids = (arr: Array<{ id: string }>) => arr.map((x) => x.id);

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], multi: [], multiSpawn: [], selected: null, selectedSpawn: null });
  st().init(mapaComCoisas());
});

describe("apagar camada", () => {
  it('escopo "Dentro" apaga só os objetos do miolo', () => {
    st().setEditScope("inside");
    st().deleteLayer("props");
    expect(ids(st().map!.props)).toEqual(["p3"]); // o da borda ficou
  });

  it('escopo "Borda" apaga só o da moldura', () => {
    st().setEditScope("border");
    st().deleteLayer("props");
    expect(ids(st().map!.props)).toEqual(["p1", "p2"]);
  });

  it('escopo "Tudo" apaga a camada inteira', () => {
    st().setEditScope("all");
    st().deleteLayer("props");
    expect(st().map!.props).toHaveLength(0);
  });

  it("apagar spawns não encosta nos objetos", () => {
    st().setEditScope("all");
    st().deleteLayer("spawns");
    expect(st().map!.spawns).toHaveLength(0);
    expect(st().map!.props).toHaveLength(3);
  });

  it("dá para desfazer", () => {
    st().setEditScope("all");
    st().deleteLayer("props");
    st().undo();
    expect(ids(st().map!.props)).toEqual(["p1", "p2", "p3"]);
  });

  it("camada vazia no escopo não mexe no mapa (nem gera histórico)", () => {
    st().setEditScope("hole"); // este mapa não tem buraco
    const antes = st().map;
    st().deleteLayer("props");
    expect(st().map).toBe(antes);
  });
});

describe("apagar camada de gatilhos — pelo CENTRO da área, não pelo canto", () => {
  /**
   * Módulo 7: `t.area.col,row` é só o canto superior-esquerdo. Um gatilho que
   * COMEÇA na borda mas se estende pro miolo (ou o contrário) tinha o escopo
   * decidido só pelo canto — agora é pelo centro, a mesma convenção que
   * `BlockedCluster.center` já usa.
   */
  function comGatilhoNaFronteira() {
    const map = st().map!;
    // cols 0/1 são borda (c<2); o gatilho começa no 1 (borda) e vai até o 3
    // (miolo) — o CENTRO (col 2) cai do lado de DENTRO.
    const trigger = { id: "tr1", kind: "script", area: { col: 1, row: 10, w: 3, h: 1 }, event: "x" };
    useEditorStore.setState({ map: { ...map, triggers: [trigger] } as typeof map });
  }

  it('escopo "Dentro": o gatilho é apagado (o CENTRO dele está dentro)', () => {
    comGatilhoNaFronteira();
    st().setEditScope("inside");
    st().deleteLayer("triggers");
    expect(st().map!.triggers).toHaveLength(0);
  });

  it('escopo "Borda": o gatilho NÃO é apagado (o centro não é borda, só o canto era)', () => {
    comGatilhoNaFronteira();
    st().setEditScope("border");
    st().deleteLayer("triggers");
    expect(st().map!.triggers).toHaveLength(1);
  });
});

describe("seleção por faixa (Shift)", () => {
  it("marca do último selecionado até o clicado, nas duas direções", () => {
    st().select(0);
    st().selectRange(2);
    expect(st().multi).toEqual([0, 1, 2]);

    st().select(2);
    st().selectRange(0);
    expect(st().multi).toEqual([0, 1, 2]);
  });

  it("apagar o marcado remove o lote de uma vez", () => {
    st().select(0);
    st().selectRange(1);
    st().deleteSelected();
    expect(ids(st().map!.props)).toEqual(["p3"]);
  });

  it("faixa de spawns é independente da de objetos", () => {
    st().selectSpawn(0);
    st().selectSpawnRange(2);
    expect(st().multiSpawn).toEqual([0, 1, 2]);
    expect(st().multi).toEqual([]);
    st().deleteSelected();
    expect(st().map!.spawns).toHaveLength(0);
    expect(st().map!.props).toHaveLength(3);
  });

  it("Ctrl+clique liga e desliga um item só", () => {
    st().toggleMultiSpawn(1);
    expect(st().multiSpawn).toEqual([1]);
    st().toggleMultiSpawn(1);
    expect(st().multiSpawn).toEqual([]);
  });
});
