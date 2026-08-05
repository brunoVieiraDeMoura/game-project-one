import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { buildWaterGeometry } from "./squareChunks";

/**
 * A lâmina d'água segue o LEITO num rio, e fica plana num lago.
 *
 * Um nível único por corpo é certo para água parada e errado para água
 * corrente: num rio descendo a encosta a lâmina cortava o terreno — enterrada em
 * cima, boiando embaixo —, e o que sobrava era uma lasca de água subindo o morro
 * (referência `Desktop/ref/agua-bugada.jpg`).
 *
 * O dado que separa os dois já existia: `surface: "water"` é massa parada e
 * `"river"` é canal corrente.
 */
const W = 24;
const H = 24;
const idx = (col: number, row: number) => row * W + col;

function mapaBase(): GameMap {
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

/** alturas Y dos vértices da lâmina */
function alturasDaLamina(map: GameMap): number[] {
  const geo = buildWaterGeometry(map, 0, 0);
  if (!geo) return [];
  const pos = geo.getAttribute("position");
  const ys: number[] = [];
  for (let i = 0; i < pos.count; i++) ys.push(pos.getY(i));
  geo.dispose();
  return ys;
}

describe("lâmina d'água", () => {
  it("RIO em declive: a lâmina desce junto com o leito", () => {
    const m = mapaBase();
    const surface = [...(m.surface as string[])];
    const heightmap = [...(m.heightmap as number[])];
    // canal descendo de 4 para 0 ao longo das colunas
    for (let row = 10; row < 13; row++) {
      for (let col = 2; col < 22; col++) {
        surface[idx(col, row)] = "river";
        (m.collision as string[])[idx(col, row)] = "water";
        heightmap[idx(col, row)] = 4 - (col - 2) * 0.2;
      }
    }
    const map = { ...m, surface, heightmap } as unknown as GameMap;
    const ys = alturasDaLamina(map);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    // o leito cai ~4 níveis; a lâmina tem de acompanhar
    expect(max - min).toBeGreaterThan(3);
  });

  it("LAGO: a lâmina é plana, mesmo com o leito irregular", () => {
    const m = mapaBase();
    const surface = [...(m.surface as string[])];
    const heightmap = [...(m.heightmap as number[])];
    for (let row = 8; row < 16; row++) {
      for (let col = 8; col < 16; col++) {
        surface[idx(col, row)] = "water";
        (m.collision as string[])[idx(col, row)] = "water";
        // fundo esburacado de propósito
        heightmap[idx(col, row)] = -1 - ((col * 7 + row * 3) % 5) * 0.4;
      }
    }
    const map = { ...m, surface, heightmap } as unknown as GameMap;
    const ys = alturasDaLamina(map);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-6);
  });

  it("afundar o lago inteiro afunda a lâmina junto", () => {
    const fazer = (fundo: number) => {
      const m = mapaBase();
      const surface = [...(m.surface as string[])];
      const heightmap = [...(m.heightmap as number[])];
      for (let row = 8; row < 16; row++)
        for (let col = 8; col < 16; col++) {
          surface[idx(col, row)] = "water";
          (m.collision as string[])[idx(col, row)] = "water";
          heightmap[idx(col, row)] = fundo;
        }
      return alturasDaLamina({ ...m, surface, heightmap } as unknown as GameMap)[0]!;
    };
    expect(fazer(-4)).toBeLessThan(fazer(-1) - 2.5);
  });
});

/**
 * Erguer ou afundar o CHÃO de um pedaço de água (referência
 * `Desktop/ref/agua-bugada.jpg`, item 1).
 *
 * O relato: "quando eu rebaixo ou subo o chão da água como terreno, fica sempre
 * uma textura de água flutuando — faça ou a textura acompanhar ou remova-a".
 * As duas coisas, e cada uma resolve metade:
 *
 * • a célula erguida ACIMA da lâmina deixa de desenhar água (vira ilha);
 * • e ela deixa de mandar no nível do corpo, senão UMA célula erguida levantava
 *   a lâmina inteira e a água do lago todo passava a boiar.
 */
describe("chão da água mexido", () => {
  const comLago = (mexer?: (h: number[], surface: string[], collision: string[]) => void): GameMap => {
    const m = mapaBase();
    const surface = [...(m.surface as string[])];
    const collision = [...(m.collision as string[])];
    const heightmap = [...(m.heightmap as number[])];
    for (let row = 6; row < 18; row++)
      for (let col = 6; col < 18; col++) {
        const i = idx(col, row);
        surface[i] = "water";
        collision[i] = "water";
        heightmap[i] = -1;
      }
    mexer?.(heightmap, surface, collision);
    return { ...m, surface, heightmap, collision } as unknown as GameMap;
  };

  /** quantos quads a lâmina desenha (4 vértices por célula com água) */
  const celulasComAgua = (map: GameMap) => {
    const geo = buildWaterGeometry(map, 0, 0);
    if (!geo) return 0;
    const n = geo.getAttribute("position").count / 4;
    geo.dispose();
    return n;
  };

  it("célula erguida acima da lâmina NÃO desenha água", () => {
    const antes = celulasComAgua(comLago());
    // ergue um bloco de 3×3 no meio do lago até bem acima da linha d'água
    const depois = celulasComAgua(
      comLago((h) => {
        for (let row = 10; row < 13; row++) for (let col = 10; col < 13; col++) h[idx(col, row)] = 2;
      }),
    );
    expect(depois).toBe(antes - 9);
  });

  it("erguer um pedaço NÃO levanta a lâmina do resto", () => {
    const plano = alturasDaLamina(comLago())[0]!;
    const comIlha = alturasDaLamina(
      comLago((h) => {
        for (let row = 10; row < 13; row++) for (let col = 10; col < 13; col++) h[idx(col, row)] = 2;
      }),
    );
    // a água que sobrou continua na MESMA altura de antes
    expect(Math.max(...comIlha)).toBeCloseTo(plano, 5);
  });

  it("afundar o pedaço mantém a lâmina e só aprofunda", () => {
    const plano = alturasDaLamina(comLago())[0]!;
    const comCova = alturasDaLamina(
      comLago((h) => {
        for (let row = 10; row < 13; row++) for (let col = 10; col < 13; col++) h[idx(col, row)] = -4;
      }),
    );
    expect(Math.max(...comCova)).toBeCloseTo(plano, 5);
    expect(Math.min(...comCova)).toBeCloseTo(plano, 5);
  });

  it("afundar o lago INTEIRO leva a lâmina junto (não pode ficar boiando)", () => {
    const alto = alturasDaLamina(comLago())[0]!;
    const baixo = alturasDaLamina(comLago((h) => {
      for (let row = 6; row < 18; row++) for (let col = 6; col < 18; col++) h[idx(col, row)] = -3;
    }))[0]!;
    expect(baixo).toBeLessThan(alto - 1.5);
  });
});
