import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * O buraco tem que SOBREVIVER ao pincel.
 *
 * Relato do usuário: "quando eu uso qualquer ferramenta no B — grama, água,
 * subir, qualquer uma — some o buraco". Eram duas portas para o mesmo estrago:
 *  • superfície gravava `collision = walkable` (SURFACE_COLLISION.grass),
 *    apagando o `cliff`;
 *  • relevo gravava nível ≠ 0 na célula bloqueada, e como altura autorada tem
 *    prioridade sobre o palpite por tipo (`visualLevel`), a ravina virava chão.
 */
function mapaQuadradoComBuraco(): GameMap {
  const W = 20;
  const H = 20;
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const i = (col: number, row: number) => row * W + col;
  // moldura bloqueada (para existir a região "borda")
  for (let c = 0; c < W; c++) {
    collision[i(c, 0)] = "wall";
    collision[i(c, H - 1)] = "wall";
  }
  for (let r = 0; r < H; r++) {
    collision[i(0, r)] = "wall";
    collision[i(W - 1, r)] = "wall";
  }
  // ravina 2×2 no miolo
  for (const [c, r] of [
    [9, 9],
    [10, 9],
    [9, 10],
    [10, 10],
  ] as Array<[number, number]>) {
    collision[i(c, r)] = "cliff";
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

const idx = (col: number, row: number) => row * 20 + col;
const mapa = () => useEditorStore.getState().map!;

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
  useEditorStore.getState().init(mapaQuadradoComBuraco());
});

describe("pincel x buraco", () => {
  it("grama de raio grande em cima da ravina não abre passagem", () => {
    const s = useEditorStore.getState();
    s.setEditScope("all");
    s.setBrush("grass");
    s.setBrushSize(3);
    s.paintCell(9, 9);
    // a colisão da ravina fica; só a cor mudou
    for (const [c, r] of [
      [9, 9],
      [10, 9],
      [9, 10],
      [10, 10],
    ] as Array<[number, number]>) {
      expect(mapa().collision[idx(c, r)]).toBe("cliff");
    }
    // e a célula andável ao lado recebeu a pincelada
    expect(mapa().surface[idx(6, 9)]).toBe("grass");
  });

  it('"subir" perto da ravina não grava altura nela (era o "some o buraco")', () => {
    const s = useEditorStore.getState();
    // "Dentro" é o escopo que POUPA o bloqueio; em "Tudo" o relevo molda a
    // ravina de propósito (é o que o nome promete)
    s.setEditScope("inside");
    s.setBrush("raise");
    s.setBrushSize(4);
    s.paintCell(7, 9); // disco alcança a ravina
    expect(mapa().heightmap[idx(9, 9)]).toBe(0);
    expect(mapa().heightmap[idx(10, 10)]).toBe(0);
    // o chão em volta subiu (fracionário: o pincel é proporcional)
    expect(mapa().heightmap[idx(7, 9)]).toBeGreaterThan(0);
  });

  it('escopo "Dentro" ignora a ravina mesmo com o pincel em cima dela', () => {
    const s = useEditorStore.getState();
    s.setEditScope("inside");
    s.setBrush("water");
    s.setBrushSize(2);
    s.paintCell(9, 9);
    expect(mapa().collision[idx(9, 9)]).toBe("cliff");
    expect(mapa().surface[idx(9, 9)]).not.toBe("water");
  });

  it('escopo "Buraco" pinta a ravina e NÃO encosta no chão em volta', () => {
    const s = useEditorStore.getState();
    s.setEditScope("hole");
    s.setBrush("cliffDown");
    s.setBrushSize(3);
    s.paintCell(9, 9);
    expect(mapa().heightmap[idx(9, 9)]).toBe(-1);
    expect(mapa().heightmap[idx(10, 10)]).toBe(-1);
    expect(mapa().heightmap[idx(6, 9)]).toBe(0); // chão andável intocado
    expect(mapa().collision[idx(9, 9)]).toBe("cliff"); // bloqueio permanece
  });

  it('escopo "Borda" não deixa o pincel entrar no miolo', () => {
    const s = useEditorStore.getState();
    s.setEditScope("border");
    // "water" e não "grass": ao criar `surface` vazia o store preenche tudo com
    // grama, então grama não distingue quem recebeu a pincelada de quem não
    s.setBrush("water");
    s.setBrushSize(3);
    s.paintCell(2, 2); // disco pega moldura e miolo
    expect(mapa().surface[idx(0, 2)]).toBe("water"); // moldura recebeu
    expect(mapa().surface[idx(4, 4)]).toBe("grass"); // miolo, não
    expect(mapa().collision[idx(0, 2)]).toBe("wall"); // e continua parede
  });
});
