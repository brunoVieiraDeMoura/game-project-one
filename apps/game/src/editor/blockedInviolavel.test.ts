import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Regra dura do projeto, dita pelo usuário em maiúsculas:
 * **borda e buraco NÃO podem ser acessíveis andando**.
 *
 * São terreno de cenário — moldura do mapa e ravina — e podem ser esculpidos em
 * altura à vontade, mas nenhum caminho do editor pode convertê-los em chão
 * andável. Cada teste aqui fecha uma das portas por onde isso escapava.
 */
const W = 24;
const H = 24;
const idx = (col: number, row: number) => row * W + col;

function mapaImportado(): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  // moldura de 2 células (borda)
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) if (c < 2 || r < 2 || c >= W - 2 || r >= H - 2) collision[idx(c, r)] = "wall";
  // ravina 2×2 no miolo (buraco)
  for (const [c, r] of [
    [11, 11],
    [12, 11],
    [11, 12],
    [12, 12],
  ] as Array<[number, number]>) {
    collision[idx(c, r)] = "cliff";
  }
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
const mapa = () => st().map!;
/** nenhuma célula que era bloqueada virou andável */
function bloqueiosIntactos() {
  const base = mapaImportado().collision;
  const agora = mapa().collision;
  const furos: number[] = [];
  for (let i = 0; i < base.length; i++) {
    if ((base[i] === "wall" || base[i] === "cliff") && (agora[i] === "walkable" || agora[i] === "water")) furos.push(i);
  }
  return furos;
}

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], roadCells: [], riverCells: [], fordCells: [] });
  st().init(mapaImportado());
});

describe("altura em borda e buraco", () => {
  it('escopo "Borda" sobe o paredão bem acima do chão, sem abrir passagem', () => {
    st().setEditScope("border");
    st().setBrush("raise");
    st().setBrushSize(2);
    st().setBrushStrength(1);
    for (let k = 0; k < 5; k++) st().paintCell(0, 8); // cinco pinceladas
    // altura é fracionária desde que o pincel virou proporcional: o que importa é
    // que a soma das pinceladas levantou o paredão bem acima do chão
    expect(mapa().heightmap[idx(0, 8)]).toBeGreaterThan(3);
    expect(mapa().collision[idx(0, 8)]).toBe("wall");
    expect(bloqueiosIntactos()).toEqual([]);
  });

  it('escopo "Buraco" afunda a ravina e ela continua ravina', () => {
    st().setEditScope("hole");
    st().setBrush("lower");
    st().setBrushSize(1);
    st().setBrushStrength(1);
    st().paintCell(11, 11);
    st().paintCell(11, 11);
    expect(mapa().heightmap[idx(11, 11)]).toBeLessThan(-0.5);
    expect(mapa().collision[idx(11, 11)]).toBe("cliff");
  });

  it('em "Dentro" o relevo sobe o chão e ele permanece andável', () => {
    st().setEditScope("inside");
    st().setBrush("raise");
    st().setBrushSize(2);
    st().paintCell(8, 8);
    expect(mapa().heightmap[idx(8, 8)]).toBeGreaterThan(0);
    expect(mapa().collision[idx(8, 8)]).toBe("walkable"); // dá para andar em cima
    expect(bloqueiosIntactos()).toEqual([]);
  });

  it('"Tudo" alcança dentro, borda E buraco de uma vez', () => {
    // é o que o nome promete: antes "Tudo" poupava o bloqueio e acabava se
    // comportando igual a "Dentro" — suavizar pegava só o miolo
    st().setEditScope("all");
    st().setBrush("raise");
    st().setBrushSize(5);
    st().setBrushStrength(1);
    st().paintCell(11, 11); // em cima da ravina
    st().paintCell(1, 8); // em cima da moldura
    expect(mapa().heightmap[idx(11, 11)]).not.toBe(0); // buraco moldado
    expect(mapa().heightmap[idx(1, 8)]).not.toBe(0); // borda moldada
    // e nada disso abre passagem
    expect(mapa().collision[idx(11, 11)]).toBe("cliff");
    expect(mapa().collision[idx(1, 8)]).toBe("wall");
    expect(bloqueiosIntactos()).toEqual([]);
  });

  it('"Dentro" continua sendo o escopo que POUPA o bloqueio', () => {
    st().setEditScope("inside");
    st().setBrush("raise");
    st().setBrushSize(5);
    st().setBrushStrength(1);
    st().paintCell(9, 9); // disco alcança a ravina em (11,11)
    expect(mapa().heightmap[idx(11, 11)]).toBe(0);
    expect(mapa().collision[idx(11, 11)]).toBe("cliff");
  });

  it('suavizar em "Tudo" alcança a célula de buraco', () => {
    // ravina com altura própria: suavizar tem que puxá-la para a média dos
    // vizinhos. Antes o pincel simplesmente pulava a célula bloqueada.
    const m = mapaImportado();
    (m.heightmap as number[])[idx(11, 11)] = 5;
    st().init(m);
    st().setEditScope("all");
    st().setBrush("smooth");
    st().setBrushSize(3);
    st().setBrushStrength(1);
    st().paintCell(11, 11);
    expect(mapa().heightmap[idx(11, 11)]).toBeLessThan(5);
    expect(mapa().collision[idx(11, 11)]).toBe("cliff");
    expect(bloqueiosIntactos()).toEqual([]);
  });
});

describe("nenhum caminho abre passagem", () => {
  it("pincel de superfície em qualquer escopo", () => {
    for (const escopo of ["all", "inside", "border", "hole"] as const) {
      st().init(mapaImportado());
      st().setEditScope(escopo);
      for (const b of ["grass", "water"] as const) {
        st().setBrush(b);
        st().setBrushSize(4);
        st().paintCell(1, 8); // borda
        st().paintCell(11, 11); // buraco
      }
      expect(bloqueiosIntactos(), `escopo ${escopo}`).toEqual([]);
    }
  });

  it("limpar terreno bloqueado poupa o BURACO", () => {
    // ravina de 1 célula: seria uma mancha "small", candidata à limpeza
    const m = mapaImportado();
    (m.collision as string[])[idx(6, 6)] = "cliff";
    st().init(m);
    st().setEditScope("all");
    st().clearSmallBlocked();
    expect(mapa().collision[idx(6, 6)]).toBe("cliff");
  });

  it("limpar terreno bloqueado ainda varre arbusto de parede", () => {
    const m = mapaImportado();
    (m.collision as string[])[idx(7, 7)] = "wall"; // moita isolada
    st().init(m);
    st().setEditScope("all");
    st().clearSmallBlocked();
    expect(mapa().collision[idx(7, 7)]).toBe("walkable");
  });

  it("rio não corta a moldura nem a ravina", () => {
    st().setEditScope("all");
    st().generateRiver();
    expect(bloqueiosIntactos()).toEqual([]);
  });

  it("estrada não corta a moldura nem a ravina", () => {
    st().setEditScope("all");
    st().generateRoads();
    expect(bloqueiosIntactos()).toEqual([]);
  });

  it("relevo procedural (colinas e lagos) não corta bloqueio", () => {
    for (const escopo of ["all", "inside", "border", "hole"] as const) {
      st().init(mapaImportado());
      st().setEditScope(escopo);
      st().setTerrainFeature("hill", 90);
      st().setTerrainFeature("lake", 90);
      expect(bloqueiosIntactos(), `escopo ${escopo}`).toEqual([]);
    }
  });
});
