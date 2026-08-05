import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Fase 4 do `next-change-editor.txt`: relevo por slider e estrada com textura.
 *
 *  • COLINAS e MONTANHAS viraram dois sliders, cada um governando altura e
 *    quantidade juntas;
 *  • o LAGO saiu do gerador (o pincel continua);
 *  • a ESTRADA deixou de ser sempre terra batida.
 */
const W = 60;
const H = 60;

function campo(): GameMap {
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
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const mapa = () => st().map!;
const conta = (f: (i: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < W * H; i++) if (f(i)) n++;
  return n;
};

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
  st().init(campo());
  st().setEditScope("all");
});

describe("colinas", () => {
  it("no zero o campo continua plano", () => {
    expect(conta((i) => (mapa().heightmap[i] ?? 0) !== 0)).toBe(0);
  });

  it("o slider ergue o terreno", () => {
    st().setTerrainFeature("hill", 60);
    expect(conta((i) => (mapa().heightmap[i] ?? 0) > 0.5)).toBeGreaterThan(0);
  });

  it("mais slider, mais altura", () => {
    // altura E quantidade no mesmo número: é o pedido, e é o que evita dois
    // controles que precisam ser casados à mão
    st().setTerrainFeature("hill", 30);
    const baixo = Math.max(...mapa().heightmap);
    st().setTerrainFeature("hill", 90);
    expect(Math.max(...mapa().heightmap)).toBeGreaterThan(baixo);
  });

  it("colina NÃO fecha passagem — ela é morro andável", () => {
    st().setTerrainFeature("hill", 100);
    expect(conta((i) => mapa().collision[i] !== "walkable")).toBe(0);
  });

  it("a altura é FRACIONÁRIA — arredondar devolveria o degrau", () => {
    st().setTerrainFeature("hill", 70);
    const fracionarias = conta((i) => {
      const h = mapa().heightmap[i] ?? 0;
      return h !== Math.round(h);
    });
    expect(fracionarias).toBeGreaterThan(0);
  });
});

describe("montanhas", () => {
  it("o slider cria maciço, e ele BLOQUEIA", () => {
    st().setTerrainFeature("mountain", 70);
    expect(conta((i) => mapa().collision[i] === "wall")).toBeGreaterThan(0);
    expect(conta((i) => mapa().surface[i] === "stone")).toBeGreaterThan(0);
  });

  it("mais slider, mais montanha", () => {
    st().setTerrainFeature("mountain", 20);
    const pouco = conta((i) => mapa().collision[i] === "wall");
    st().setTerrainFeature("mountain", 95);
    expect(conta((i) => mapa().collision[i] === "wall")).toBeGreaterThan(pouco);
  });

  it("no zero não sobra rocha nenhuma", () => {
    st().setTerrainFeature("mountain", 80);
    expect(conta((i) => mapa().collision[i] === "wall")).toBeGreaterThan(0);
    st().setTerrainFeature("mountain", 0);
    expect(conta((i) => mapa().collision[i] === "wall")).toBe(0);
  });

  it("montanha e colina convivem — sliders independentes", () => {
    st().setTerrainFeature("hill", 50);
    st().setTerrainFeature("mountain", 50);
    expect(conta((i) => mapa().collision[i] === "wall")).toBeGreaterThan(0);
    expect(conta((i) => (mapa().heightmap[i] ?? 0) > 0.3 && mapa().collision[i] === "walkable")).toBeGreaterThan(0);
  });
});

describe("a estrada e a textura dela", () => {
  /**
   * Dois nós de estrada atravessando o campo.
   *
   * O nó é um SPAWN de `kind: "road_node"` (ver `addSpawn`) — a ferramenta
   * Caminho põe um por clique. Aqui vão direto no mapa: o que se testa é a
   * geração, não o clique.
   */
  function traçar() {
    st().setSpawnKind("road");
    st().setTool("spawn");
    st().addSpawn(5, 30);
    st().addSpawn(50, 30);
    st().generateRoads();
  }

  it("nasce em terra batida por padrão", () => {
    traçar();
    expect(st().roadCells.length).toBeGreaterThan(0);
    expect(conta((i) => mapa().surface[i] === "dirt")).toBeGreaterThan(0);
  });

  it("trocar a textura REDESENHA o traçado inteiro", () => {
    traçar();
    const antes = st().roadCells.length;
    st().setRoadSurface("stone");
    expect(conta((i) => mapa().surface[i] === "stone")).toBeGreaterThan(0);
    // e a via continua do mesmo tamanho: só a superfície mudou
    expect(st().roadCells.length).toBe(antes);
  });

  it("a textura ANTIGA some — a estrada não engorda a cada troca", () => {
    /**
     * O erro que a `roadSurfaceAplicada` evita: a reversão compara com a
     * superfície que está NO CHÃO, não com a recém-escolhida. Comparando com a
     * nova, o traçado velho sobreviveria e cada troca deixaria um rastro.
     */
    traçar();
    st().setRoadSurface("stone");
    expect(conta((i) => mapa().surface[i] === "dirt")).toBe(0);
    st().setRoadSurface("sand");
    expect(conta((i) => mapa().surface[i] === "stone")).toBe(0);
    expect(conta((i) => mapa().surface[i] === "sand")).toBeGreaterThan(0);
  });

  it("a estrada continua ANDÁVEL em qualquer textura", () => {
    // a superfície é aparência; passagem é outra coisa, e uma via de pedra que
    // bloqueasse seria uma parede com cara de estrada
    traçar();
    for (const sup of ["stone", "sand", "grass"] as const) {
      st().setRoadSurface(sup);
      for (const i of st().roadCells) expect(mapa().collision[i]).toBe("walkable");
    }
  });
});

describe("o rio pelos NÓS", () => {
  /** dois nós de rio no mapa */
  function comNos(a: [number, number], b: [number, number]) {
    st().setSpawnKind("river");
    st().setTool("spawn");
    st().addSpawn(a[0], a[1]);
    st().addSpawn(b[0], b[1]);
  }

  it("sem nó nenhum, o rio ainda atravessa o mapa", () => {
    // o atalho de "quero um rio, não importa onde" continua valendo
    st().generateRiver();
    expect(st().riverCells.length).toBeGreaterThan(0);
  });

  it("com dois nós, o rio passa PERTO deles", () => {
    comNos([10, 10], [45, 45]);
    st().setRiverWidth(1);
    st().generateRiver();
    const perto = (col: number, row: number) =>
      st().riverCells.some((i) => Math.hypot((i % W) - col, Math.floor(i / W) - row) < 4);
    expect(perto(10, 10)).toBe(true);
    expect(perto(45, 45)).toBe(true);
  });

  it("o traçado é ESTÁVEL — regerar sem mexer nos nós dá o mesmo rio", () => {
    /**
     * O seed de cada trecho vem do PAR DE IDS dos nós, não de `Math.random()`.
     * É o que torna a ferramenta utilizável: ajustar um nó redesenha só os
     * trechos que saem dele, em vez de re-sortear o rio inteiro a cada clique.
     */
    comNos([10, 10], [45, 45]);
    st().generateRiver();
    const primeiro = [...st().riverCells].sort((a, b) => a - b);
    st().generateRiver();
    expect([...st().riverCells].sort((a, b) => a - b)).toEqual(primeiro);
  });

  it("a largura vale em CÉLULAS, e o miolo bloqueia", () => {
    comNos([10, 30], [45, 30]);
    st().setRiverWidth(0);
    st().generateRiver();
    const fio = st().riverCells.length;
    // fio de água: atravessável em qualquer ponto
    for (const i of st().riverCells) expect(mapa().collision[i]).toBe("water");

    st().setRiverWidth(2);
    st().generateRiver();
    expect(st().riverCells.length).toBeGreaterThan(fio);
    // a partir da largura 1 o miolo vira canal fundo
    expect(st().riverCells.some((i) => mapa().collision[i] === "wall")).toBe(true);
    // e sobra margem rasa dos dois lados
    expect(st().riverCells.some((i) => mapa().collision[i] === "water")).toBe(true);
  });

  it("o rio não abre passagem no bloqueio", () => {
    // água do rAthena é ANDÁVEL: um rio cortando a moldura furaria o mapa
    const m = mapa();
    const i = 20 * W + 20;
    useEditorStore.setState({
      map: { ...m, collision: m.collision.map((c, k) => (k === i ? "wall" : c)) } as typeof m,
    });
    comNos([10, 20], [45, 20]);
    st().setRiverWidth(2);
    st().generateRiver();
    expect(mapa().collision[i]).toBe("wall");
  });
});
