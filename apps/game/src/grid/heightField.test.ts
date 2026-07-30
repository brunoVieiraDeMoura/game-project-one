import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { cornerLevel, cornerNormal, sampleHeight } from "./heightField";
import { SQUARE_SIZE, squareLevelToY } from "./squareGrid";

/**
 * O relevo tem que ser um CAMPO CONTÍNUO, não uma pilha de blocos.
 *
 * Era o pedido: "não quero um jogo igual Roblox todo quadrado, quero que as
 * montanhas se pareçam montanhas". A altura mora nas células, mas é lida nos
 * CANTOS (média das células que se encontram ali), então duas células vizinhas
 * compartilham dois vértices e a superfície inclina em vez de escalonar.
 */
const W = 12;
const H = 12;
const idx = (col: number, row: number) => row * W + col;

function mapa(patch?: (h: number[], c: string[]) => void): GameMap {
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  const collision: string[] = new Array(n).fill("walkable");
  patch?.(heightmap, collision);
  return {
    size: { width: W, height: H },
    heightmap,
    collision,
    surface: [],
  } as unknown as GameMap;
}

describe("cornerLevel", () => {
  it("canto entre uma célula alta e o chão fica no MEIO — é a inclinação", () => {
    const m = mapa((h) => {
      h[idx(5, 5)] = 4;
    });
    // canto inferior-direito da célula alta: só ela é alta entre as 4 vizinhas
    expect(cornerLevel(m, 6, 6, false)).toBeCloseTo(1); // (4+0+0+0)/4
    // canto no meio de duas células altas seria mais alto
    const m2 = mapa((h) => {
      h[idx(5, 5)] = 4;
      h[idx(6, 5)] = 4;
    });
    expect(cornerLevel(m2, 6, 6, false)).toBeCloseTo(2); // (4+4+0+0)/4
  });

  it("bloqueio NÃO se mistura com chão: a parede não vira rampa", () => {
    const m = mapa((h, c) => {
      c[idx(5, 5)] = "wall";
      h[idx(5, 5)] = 3;
    });
    // pedindo o canto do grupo "chão", a parede de altura 3 é ignorada
    expect(cornerLevel(m, 5, 5, false)).toBeCloseTo(0);
    // e pedindo o canto do grupo "bloqueio", só a parede conta
    expect(cornerLevel(m, 5, 5, true)).toBeCloseTo(3);
  });

  it("no meio de um platô o canto é o próprio nível (sem afundar a beirada)", () => {
    const m = mapa((h) => {
      for (let r = 2; r <= 8; r++) for (let c = 2; c <= 8; c++) h[idx(c, r)] = 5;
    });
    expect(cornerLevel(m, 5, 5, false)).toBeCloseTo(5);
  });
});

describe("sampleHeight", () => {
  it("é contínuo: andar meia célula não pula de nível", () => {
    const m = mapa((h) => {
      for (let r = 0; r < H; r++) for (let c = 6; c < W; c++) h[idx(c, r)] = 6;
    });
    let maiorSalto = 0;
    let anterior = sampleHeight(m, 4 * SQUARE_SIZE, 5 * SQUARE_SIZE);
    for (let x = 4; x <= 9; x += 0.1) {
      const y = sampleHeight(m, x * SQUARE_SIZE, 5 * SQUARE_SIZE);
      maiorSalto = Math.max(maiorSalto, Math.abs(y - anterior));
      anterior = y;
    }
    // um degrau de 6 níveis daria um salto do tamanho de squareLevelToY(6);
    // no campo contínuo cada passo de 0,1 célula sobe uma fração disso
    expect(maiorSalto).toBeLessThan(squareLevelToY(1));
  });

  it("terreno plano dá altura plana", () => {
    const m = mapa();
    for (const [x, z] of [
      [0, 0],
      [7.3, 2.9],
      [11.9, 11.9],
    ]) {
      expect(sampleHeight(m, x! * SQUARE_SIZE, z! * SQUARE_SIZE)).toBeCloseTo(0);
    }
  });

  it("fora dos limites não explode (prende na borda)", () => {
    const m = mapa((h) => {
      h[idx(0, 0)] = 2;
    });
    expect(Number.isFinite(sampleHeight(m, -50, -50))).toBe(true);
    expect(Number.isFinite(sampleHeight(m, 1e6, 1e6))).toBe(true);
  });
});

describe("cornerNormal", () => {
  it("terreno plano aponta para cima", () => {
    const [nx, ny, nz] = cornerNormal(mapa(), 5, 5, false);
    expect(ny).toBeCloseTo(1);
    expect(nx).toBeCloseTo(0);
    expect(nz).toBeCloseTo(0);
  });

  it("na encosta a normal se inclina para o lado da descida", () => {
    // rampa subindo no eixo X
    const m = mapa((h) => {
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) h[idx(c, r)] = c;
    });
    const [nx, ny, nz] = cornerNormal(m, 6, 6, false);
    expect(nx).toBeLessThan(0); // aponta contra a subida
    expect(ny).toBeGreaterThan(0);
    expect(Math.abs(nz)).toBeLessThan(1e-6);
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1);
  });

  it("é sempre unitária, em qualquer relevo", () => {
    const m = mapa((h) => {
      for (let i = 0; i < h.length; i++) h[i] = Math.sin(i) * 4;
    });
    for (const [c, r] of [
      [1, 1],
      [6, 3],
      [11, 11],
    ]) {
      const n = cornerNormal(m, c!, r!, false);
      expect(Math.hypot(...n)).toBeCloseTo(1);
    }
  });
});
