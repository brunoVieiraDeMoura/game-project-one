import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";

/**
 * `clearAll` — a folha em branco.
 *
 * O mapa importado do rAthena chega com o cinturão de mata, as ravinas e o que
 * foi autorado por cima. Quem vai refazer o mapa do zero com os assets do
 * projeto precisa do contrário: campo plano vazio.
 *
 * O que este teste protege não é o "apagar" (isso é fácil), é o que tem de
 * SOBREVIVER: sem `legacy` o /play deixa de saber a que mapa do servidor esta
 * cena corresponde, e sem `size`/`terrainMode` ela deixa de ser um mapa do
 * rAthena. E protege o desfazer: é a única rede de quem clicou por engano.
 */

const W = 24;
const H = 16;

function mapaImportado(): GameMap {
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const surface: string[] = new Array(n).fill("grass");
  const heightmap: number[] = new Array(n).fill(0);

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = row * W + col;
      // cinturão de mata na moldura, como todo mapa importado tem
      if (col < 2 || row < 2 || col >= W - 2 || row >= H - 2) {
        collision[i] = "wall";
        surface[i] = "stone";
        heightmap[i] = 1;
      }
      // ravina no miolo
      if (row === 8 && col > 5 && col < 18) {
        collision[i] = "cliff";
        heightmap[i] = -2;
      }
    }
  }

  return {
    id: "prt_fild08",
    name: "Campo de Prontera",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap,
    collision,
    surface,
    terrainStyle: { grass: { variant: "campo" } },
    waterLevel: null,
    ramps: [{ cells: [1, 2, 3], level: 1 }],
    props: [{ id: "p1", asset: "tree", position: [4, 0, 4] }],
    spawns: [{ id: "s1", kind: "monster", position: [6, 0, 6] }],
    triggers: [{ id: "t1", kind: "warp", col: 3, row: 3, w: 2, h: 2 }],
    legacy: { mapName: "prt_fild08", originX: 0, originY: 0 },
  } as unknown as GameMap;
}

beforeEach(() => {
  useEditorStore.setState({ past: [], future: [] });
  useEditorStore.getState().init(mapaImportado());
});

describe("clearAll — zerar o mapa inteiro", () => {
  it("deixa TODA célula andável, grama e no nível 0", () => {
    useEditorStore.getState().clearAll();
    const m = useEditorStore.getState().map!;

    expect(m.collision).toHaveLength(W * H);
    expect(m.surface).toHaveLength(W * H);
    expect(m.heightmap).toHaveLength(W * H);
    expect(new Set(m.collision)).toEqual(new Set(["walkable"]));
    expect(new Set(m.surface)).toEqual(new Set(["grass"]));
    expect(new Set(m.heightmap)).toEqual(new Set([0]));
  });

  it("apaga props, spawns, gatilhos e rampas", () => {
    useEditorStore.getState().clearAll();
    const m = useEditorStore.getState().map!;
    expect(m.props).toEqual([]);
    expect(m.spawns).toEqual([]);
    expect(m.triggers).toEqual([]);
    expect(m.ramps).toEqual([]);
  });

  it("preserva a identidade do mapa — sem `legacy` o /play perde o vínculo com o servidor", () => {
    const antes = useEditorStore.getState().map!;
    useEditorStore.getState().clearAll();
    const m = useEditorStore.getState().map!;

    expect(m.id).toBe("prt_fild08");
    expect(m.name).toBe(antes.name);
    expect(m.size).toEqual({ width: W, height: H });
    expect(m.cellSize).toBe(2);
    expect(m.terrainMode).toBe("square");
    expect(m.legacy).toEqual({ mapName: "prt_fild08", originX: 0, originY: 0 });
    // aparência escolhida não é terreno
    expect(m.terrainStyle).toEqual(antes.terrainStyle);
  });

  it("os três arrays são NOVOS — o culling de chunk compara identidade", () => {
    const antes = useEditorStore.getState().map!;
    useEditorStore.getState().clearAll();
    const m = useEditorStore.getState().map!;
    expect(m.collision).not.toBe(antes.collision);
    expect(m.surface).not.toBe(antes.surface);
    expect(m.heightmap).not.toBe(antes.heightmap);
  });

  it("desfaz por Ctrl+Z, célula a célula", () => {
    const antes = useEditorStore.getState().map!;
    const collisionAntes = [...antes.collision];
    const heightAntes = [...antes.heightmap];

    useEditorStore.getState().clearAll();
    useEditorStore.getState().undo();

    const m = useEditorStore.getState().map!;
    expect([...m.collision]).toEqual(collisionAntes);
    expect([...m.heightmap]).toEqual(heightAntes);
    expect(m.props).toHaveLength(1);
    expect(m.spawns).toHaveLength(1);
  });

  it("marca o mapa como não salvo", () => {
    expect(useEditorStore.getState().dirty).toBe(false);
    useEditorStore.getState().clearAll();
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("zera as camadas procedurais — senão a regeneração caça props que não existem mais", () => {
    useEditorStore.setState({ roadCells: [1, 2], riverCells: [3], procAmounts: { "inside:tree": 40 } });
    useEditorStore.getState().clearAll();
    const s = useEditorStore.getState();
    expect(s.roadCells).toEqual([]);
    expect(s.riverCells).toEqual([]);
    expect(s.procAmounts).toEqual({});
  });
});
