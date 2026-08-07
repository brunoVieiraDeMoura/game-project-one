import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap, SurfaceType } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Módulo 6 (Assets) — `paintProps` (o pincel de espalhar decoração) passa a
 * usar a MESMA regra central que a geração procedural (`podeNascer`), o
 * mesmo índice espacial (`areaIndex`), e checa o escopo de edição CÉLULA A
 * CÉLULA, não só no centro do pincel. Antes desta correção, nenhum destes
 * três testes passava.
 */
const W = 30;
const H = 30;
const idx = (col: number, row: number) => row * W + col;

function campo(surf: SurfaceType | SurfaceType[] = "grass", collision: GameMap["collision"] | string = "walkable"): GameMap {
  const n = W * H;
  const surface = Array.isArray(surf) ? surf : new Array<SurfaceType>(n).fill(surf);
  const col = Array.isArray(collision) ? collision : new Array(n).fill(collision);
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision: col as GameMap["collision"],
    surface,
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const mapa = () => st().map!;

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
});

describe("paintProps respeita a superfície (podeNascer), como a geração procedural", () => {
  it("árvore NÃO nasce em campo de neve", () => {
    st().init(campo("snow"));
    st().setAsset("hex_tree_single_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(2);
    st().beginStroke();
    st().paintProps(15, 15);
    expect(mapa().props).toHaveLength(0);
  });

  it("árvore nasce normalmente em campo de grama", () => {
    st().init(campo("grass"));
    st().setAsset("hex_tree_single_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(2);
    st().beginStroke();
    st().paintProps(15, 15);
    expect(mapa().props.length).toBeGreaterThan(0);
  });
});

describe("paintProps nunca planta em célula bloqueada ou de água", () => {
  it("célula 'wall' isolada no meio da grama fica livre de props", () => {
    const m = campo("grass");
    m.collision[idx(15, 15)] = "wall";
    st().init(m);
    st().setAsset("hex_rock_single_a"); // rock aceita grass, então só a colisão barra
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(0); // só a célula 15,15
    st().beginStroke();
    st().paintProps(15, 15);
    expect(mapa().props).toHaveLength(0);
  });

  it("categoria sem regra de superfície (ponte, fora de SCATTER_CATEGORIES) ainda assim exige chão andável", () => {
    const m = campo("grass");
    m.collision[idx(15, 15)] = "water";
    st().init(m);
    // "bridge" não está em SCATTER_CATEGORIES (podeNascer não a cataloga) —
    // o fallback tem que continuar barrando água/bloqueio mesmo assim
    st().setAsset("hex_bridge_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(0);
    st().beginStroke();
    st().paintProps(15, 15);
    expect(mapa().props).toHaveLength(0);
  });

  it("categoria sem regra de superfície (ponte) planta normalmente em chão andável comum", () => {
    st().init(campo("grass"));
    st().setEditScope("all");
    st().setAsset("hex_bridge_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(0);
    st().beginStroke();
    st().paintProps(15, 15);
    expect(mapa().props.length).toBeGreaterThan(0);
  });
});

describe("paintProps confere o ESCOPO célula a célula, não só no centro", () => {
  it("escopo 'hole' sem nenhuma célula de buraco no mapa: nada é plantado, em raio nenhum", () => {
    st().init(campo("grass"));
    st().setEditScope("hole"); // não há nenhuma célula "cliff" neste mapa
    st().setAsset("hex_tree_single_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(4); // raio grande — testava furar o escopo pelo centro
    st().beginStroke();
    st().paintProps(15, 15);
    expect(mapa().props).toHaveLength(0);
  });

  it("escopo 'all' com o mesmo raio planta normalmente", () => {
    st().init(campo("grass"));
    st().setEditScope("all");
    st().setAsset("hex_tree_single_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(4);
    st().beginStroke();
    st().paintProps(15, 15);
    expect(mapa().props.length).toBeGreaterThan(0);
  });
});

describe("paintProps usa propBrushRadius, não brushSize", () => {
  it("brushSize grande não vaza pro pincel de decoração", () => {
    st().init(campo("grass"));
    st().setEditScope("all");
    st().setBrushSize(12); // pincel de TERRENO, raio máximo
    st().setPropBrushRadius(0); // pincel de DECORAÇÃO, só a célula clicada
    st().setAsset("hex_tree_single_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().beginStroke();
    st().paintProps(15, 15);
    // todo prop plantado tem que estar na célula 15,15 (ou vizinhança de 1
    // unidade do jitter), nunca espalhado pelo raio 12 do pincel de terreno
    for (const p of mapa().props) {
      expect(Math.abs(p.position[0] - 15 * 2)).toBeLessThan(2);
      expect(Math.abs(p.position[2] - 15 * 2)).toBeLessThan(2);
    }
  });
});

describe("paintProps não empilha props (índice espacial, igual ao gerador procedural)", () => {
  it("duas passadas na MESMA célula não duplicam o prop indefinidamente", () => {
    st().init(campo("grass"));
    st().setEditScope("all");
    st().setAsset("hex_tree_single_a");
    st().setPropPaint(true);
    st().setPropDensity(10);
    st().setPropBrushRadius(0);
    st().beginStroke();
    st().paintProps(15, 15);
    const depoisDaPrimeira = mapa().props.length;
    expect(depoisDaPrimeira).toBeGreaterThan(0);
    st().paintProps(15, 15); // mesma célula, sem soltar o traçado
    // a segunda passada não pode adicionar um vizinho colado no primeiro —
    // o índice de área bloqueia por raio real, não por célula
    expect(mapa().props.length).toBe(depoisDaPrimeira);
  });
});
