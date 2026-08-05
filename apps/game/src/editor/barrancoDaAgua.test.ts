import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Água criada à mão abre BARRANCO na terra ao lado (next-change.txt, item 1):
 *
 * ```
 * terra       terra
 * ____        ___
 *     \______/  <- declive
 *      agua
 * ```
 *
 * Sem isso o campo terminava num degrau seco sobre a lâmina — o mesmo murinho
 * que o rio gerado já tinha deixado de fazer. Os dois usam o mesmo helper, de
 * propósito: rio gerado e rio pintado não podem divergir.
 */
const W = 30;
const H = 30;
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
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const mapa = () => st().map!;

/** perfil de altura numa linha que atravessa a água */
function perfil(row: number, de: number, ate: number) {
  const out: { col: number; h: number; s: string }[] = [];
  for (let col = de; col <= ate; col++) {
    out.push({ col, h: Number((mapa().heightmap[idx(col, row)] ?? 0).toFixed(3)), s: mapa().surface[idx(col, row)]! });
  }
  return out;
}

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
  st().init(campoPlano());
  st().setEditScope("all");
});

describe("barranco em volta da água pintada", () => {
  it("o lago afunda e a terra ao lado DESCE até ele", () => {
    st().setBrush("water");
    st().setBrushSize(3);
    st().beginStroke();
    st().paintCell(15, 15);

    const linha = perfil(15, 8, 15);
    const agua = linha.filter((p) => p.s === "water");
    expect(agua.length).toBeGreaterThan(0);
    // o leito do lago está abaixo do campo
    expect(agua[0]!.h).toBeLessThan(0);

    // entre o campo intocado e a água há alturas INTERMEDIÁRIAS — o declive
    const terra = linha.filter((p) => p.s !== "water");
    const intermediarias = terra.filter((p) => p.h < -1e-6 && p.h > agua[0]!.h + 1e-6);
    expect(intermediarias.length).toBeGreaterThan(0);
  });

  it("o declive é MONOTÔNICO: nunca sobe indo para a água", () => {
    st().setBrush("water");
    st().setBrushSize(3);
    st().beginStroke();
    st().paintCell(15, 15);
    const linha = perfil(15, 9, 15);
    for (let i = 1; i < linha.length; i++) {
      expect(linha[i]!.h).toBeLessThanOrEqual(linha[i - 1]!.h + 1e-9);
    }
  });

  it("o lago é uma BACIA: o meio é mais fundo que a beira", () => {
    st().setBrush("water");
    st().setBrushSize(6);
    st().beginStroke();
    st().paintCell(15, 15);

    const linha = perfil(15, 8, 15);
    const agua = linha.filter((p) => p.s === "water");
    const beira = agua[0]!.h;
    const meio = agua[agua.length - 1]!.h;
    expect(meio).toBeLessThan(beira - 0.4);
    // profundidade em degraus, não em salto: a lâmina lê o leito para escolher a
    // cor, e um leito chapado dá azul chapado de ponta a ponta
    const alturas = agua.map((p) => p.h);
    for (let i = 1; i < alturas.length; i++) expect(alturas[i]!).toBeLessThanOrEqual(alturas[i - 1]! + 1e-9);
    expect(new Set(alturas).size).toBeGreaterThan(2);
  });

  it("a margem termina na LINHA D'ÁGUA, sem degrau nem fosso", () => {
    st().setBrush("water");
    st().setBrushSize(4);
    st().beginStroke();
    st().paintCell(15, 15);

    const linha = perfil(15, 6, 15);
    const terra = linha.filter((p) => p.s !== "water");
    const ultima = terra[terra.length - 1]!.h; // a que encosta na água
    // lâmina = beira do leito + folga (LAMINA_ACIMA_DO_RASO)
    const lamina = -0.85 + 0.25;
    expect(Math.abs(ultima - lamina)).toBeLessThan(0.2);
    // e ela está claramente ABAIXO do campo: é o que faz a água parecer afundada
    expect(ultima).toBeLessThan(-0.4);
  });

  it("alargar o lago aprofunda o meio, sem degrau na emenda", () => {
    st().setBrush("water");
    st().setBrushSize(3);
    st().beginStroke();
    st().paintCell(15, 15);
    // a beira do lago pequeno: depois de alargar, ela fica LONGE da terra
    const antes = mapa().heightmap[idx(17, 15)]!;
    st().beginStroke();
    st().paintCell(19, 15);
    expect(mapa().heightmap[idx(17, 15)]!).toBeLessThan(antes - 0.4);
  });

  it("o rio raso também abre barranco", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(2);
    st().beginStroke();
    st().paintCell(15, 15);
    const linha = perfil(15, 10, 15);
    const terra = linha.filter((p) => p.s !== "river");
    expect(terra.some((p) => p.h < -1e-6)).toBe(true);
  });

  it("o barranco NÃO cava célula bloqueada", () => {
    const m = campoPlano();
    const collision = [...(m.collision as string[])];
    for (let row = 10; row < 20; row++) collision[idx(12, row)] = "wall";
    st().init({ ...m, collision } as unknown as GameMap);
    st().setBrush("water");
    st().setBrushSize(3);
    st().beginStroke();
    st().paintCell(15, 15);
    for (let row = 10; row < 20; row++) {
      expect(mapa().heightmap[idx(12, row)]).toBe(0);
      expect(mapa().collision[idx(12, row)]).toBe("wall");
    }
  });
});
