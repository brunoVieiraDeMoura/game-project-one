import { describe, expect, it } from "vitest";
import { BAG_GRID, BAG_NOME_MAX, encurtarNome } from "./bag";

/**
 * O nome sob o slot do inventário.
 *
 * Nome de item do RO passa de trinta caracteres, e sem teto ele empurrava a
 * faixa e estourava a moldura — era o Alt+E "quebrado".
 */

describe("encurtarNome", () => {
  it("nome curto passa inteiro", () => {
    expect(encurtarNome("Jellopy")).toBe("Jellopy");
  });

  it("no limite, não corta", () => {
    const doze = "Wing Of Fly!";
    expect(doze).toHaveLength(BAG_NOME_MAX);
    expect(encurtarNome(doze)).toBe(doze);
  });

  it("acima do limite: tira os três últimos que sobram e concatena", () => {
    // nove de nome + "..." = doze, que é o teto
    expect(encurtarNome("Old Blue Box")).toBe("Old Blue Box");
    expect(encurtarNome("Old Violet Box")).toBe("Old Viole...");
  });

  it("o resultado NUNCA passa do teto", () => {
    for (const n of ["a", "Red Potion", "Cotton Shirt [1]", "Immaterial Sword", "x".repeat(120)]) {
      expect(encurtarNome(n).length).toBeLessThanOrEqual(BAG_NOME_MAX);
    }
  });
});

describe("a grade", () => {
  it("são TRÊS colunas", () => {
    // quatro espremiam o slot além do que a arte desenha pro campo — o
    // "Alt+E estourando o container" do relato
    expect(BAG_GRID.cols).toBe(3);
  });

  it("a barra de rolagem tem vão reservado", () => {
    // sem reservar, a barra ficaria por cima da última coluna de slots
    expect(BAG_GRID.barra).toBeGreaterThan(0);
    expect(BAG_GRID.barraGap).toBeGreaterThan(0);
  });
});
