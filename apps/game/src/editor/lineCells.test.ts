import { describe, expect, it } from "vitest";
import { lineCells } from "./lineCells";

describe("lineCells", () => {
  it("ponto parado devolve só a própria célula", () => {
    expect(lineCells(5, 5, 5, 5)).toEqual([[5, 5]]);
  });

  it("inclui as duas pontas", () => {
    const cells = lineCells(0, 0, 4, 0);
    expect(cells[0]).toEqual([0, 0]);
    expect(cells[cells.length - 1]).toEqual([4, 0]);
  });

  it("linha horizontal não pula nenhuma coluna", () => {
    const cells = lineCells(0, 0, 5, 0);
    expect(cells.map((c) => c[0])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(cells.every((c) => c[1] === 0)).toBe(true);
  });

  it("linha vertical não pula nenhuma linha", () => {
    const cells = lineCells(0, 0, 0, 5);
    expect(cells.map((c) => c[1])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("diagonal 45° é uma célula por passo, sem repetir", () => {
    const cells = lineCells(0, 0, 4, 4);
    expect(cells).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it("salto grande (arrasto rápido) cobre TODAS as células intermediárrias, sem furo", () => {
    const cells = lineCells(10, 10, 15, 12);
    // nenhum degrau de coluna maior que 1 entre passos consecutivos
    for (let i = 1; i < cells.length; i++) {
      const [x0] = cells[i - 1]!;
      const [x1] = cells[i]!;
      expect(Math.abs(x1 - x0)).toBeLessThanOrEqual(1);
    }
    expect(cells[0]).toEqual([10, 10]);
    expect(cells[cells.length - 1]).toEqual([15, 12]);
  });

  it("funciona em qualquer direção (sx/sy negativos)", () => {
    const cells = lineCells(5, 5, 0, 0);
    expect(cells[0]).toEqual([5, 5]);
    expect(cells[cells.length - 1]).toEqual([0, 0]);
    expect(cells.length).toBe(6);
  });
});
