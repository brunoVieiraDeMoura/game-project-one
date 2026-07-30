import { describe, expect, it } from "vitest";
import { hexToWorld } from "../hex/hexGrid";
import { SQUARE_SIZE, squareToWorld, worldToSquare } from "./squareGrid";

describe("squareGrid", () => {
  it("célula fracionária vira posição CONTÍNUA (o bug do salto lateral)", () => {
    // Andar para o norte é variar `row` mantendo `col`. Com a célula fracionária
    // que a interpolação produz, o X tem que ficar parado o percurso inteiro.
    let maxSalto = 0;
    let anterior = squareToWorld(10, 2).x;
    for (let row = 2; row <= 4; row += 0.1) {
      const x = squareToWorld(10, row).x;
      maxSalto = Math.max(maxSalto, Math.abs(x - anterior));
      anterior = x;
    }
    expect(maxSalto).toBeLessThan(1e-9);
  });

  it("a grade hexagonal SALTA no mesmo percurso — é o que se está corrigindo", () => {
    // Documenta a causa: `hexToWorld` usa `0.5 * (row & 1)`, e `&` trunca para
    // inteiro. O termo de paridade é degrau, não rampa: ao cruzar row inteiro o
    // X pula meia coluna num frame só.
    let maxSalto = 0;
    let anterior = hexToWorld(10, 2).x;
    for (let row = 2; row <= 4; row += 0.1) {
      const x = hexToWorld(10, row).x;
      maxSalto = Math.max(maxSalto, Math.abs(x - anterior));
      anterior = x;
    }
    expect(maxSalto).toBeGreaterThan(0.9);
  });

  it("célula é isotrópica: um passo mede o mesmo nos dois eixos", () => {
    const a = squareToWorld(5, 5);
    const leste = squareToWorld(6, 5);
    const sul = squareToWorld(5, 6);
    expect(leste.x - a.x).toBeCloseTo(SQUARE_SIZE, 10);
    expect(sul.z - a.z).toBeCloseTo(SQUARE_SIZE, 10);
  });

  it("worldToSquare desfaz squareToWorld em qualquer célula", () => {
    for (let col = 0; col < 400; col += 37) {
      for (let row = 0; row < 400; row += 41) {
        const w = squareToWorld(col, row);
        expect(worldToSquare(w.x, w.z)).toEqual({ col, row });
      }
    }
  });

  it("qualquer ponto dentro da célula devolve a mesma célula", () => {
    const { x, z } = squareToWorld(12, 30);
    const meio = SQUARE_SIZE / 2 - 1e-6;
    for (const dx of [-meio, 0, meio]) {
      for (const dz of [-meio, 0, meio]) {
        expect(worldToSquare(x + dx, z + dz)).toEqual({ col: 12, row: 30 });
      }
    }
  });
});
