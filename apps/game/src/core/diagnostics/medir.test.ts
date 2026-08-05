import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMIAR_MS, escreverColunaDeTroca, medir, zerarMedidas } from "./medir";
import { confirmarQuadro, eventosOrdenados, forcarFlag, limpar, quadro } from "./flightRecorder";

/**
 * O cronômetro que nomeia o que sobra do quadro.
 *
 * Quatro `frameLongo` de 561 a 633 ms (`voo-1785946990938.json`) saíram com
 * `contextoMs`, `descarteMs`, `modeloMs` e `renderMs` **zerados** e
 * `sceneFilhos: 0`: o custo não é desenho nem GPU, é o commit que troca a cena.
 * Adivinhar qual parte dele custa seria fácil e provavelmente errado — foi assim
 * que a hipótese do contexto WebGL (8 ms, medido) sobreviveu duas rodadas.
 */

let relogio: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  limpar();
  zerarMedidas();
  forcarFlag(true);
  relogio = vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("medir", () => {
  it("é TRANSPARENTE — devolve o que a função devolveu", () => {
    // é isso que permite embrulhar uma chamada existente sem tocar em mais nada
    expect(medir("x", () => 42)).toBe(42);
    expect(medir("y", () => ({ a: 1 }))).toEqual({ a: 1 });
  });

  it("acumula no quadro e ZERA quando a coluna é escrita", () => {
    relogio.mockReturnValue(0);
    medir("caro", () => {
      relogio.mockReturnValue(120);
    });
    escreverColunaDeTroca();
    expect(quadro().trocaMs).toBe(120);

    // o quadro seguinte não pode herdar: seria custo contado duas vezes
    confirmarQuadro();
    escreverColunaDeTroca();
    expect(quadro().trocaMs).toBe(0);
  });

  it("soma várias medidas do MESMO quadro", () => {
    let t = 0;
    relogio.mockImplementation(() => t);
    medir("a", () => {
      t += 30;
    });
    medir("b", () => {
      t += 50;
    });
    escreverColunaDeTroca();
    expect(quadro().trocaMs).toBe(80);
  });

  it("só o que passa do limiar vira EVENTO — laço quente não enche o anel", () => {
    let t = 0;
    relogio.mockImplementation(() => t);
    medir("barato", () => {
      t += LIMIAR_MS - 1;
    });
    expect(eventosOrdenados()).toHaveLength(0);

    medir("caro", () => {
      t += LIMIAR_MS + 1;
    });
    const ev = eventosOrdenados();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.cat).toBe("cena");
    expect(ev[0]!.dados).toMatchObject({ rotulo: "caro" });
  });

  it("cronometra mesmo quando a função ESTOURA, e deixa o erro subir", () => {
    let t = 0;
    relogio.mockImplementation(() => t);
    expect(() =>
      medir("quebrou", () => {
        t += 100;
        throw new Error("zod");
      }),
    ).toThrow("zod");
    // engolir o erro esconderia um mapa inválido atrás de uma medição
    escreverColunaDeTroca();
    expect(quadro().trocaMs).toBe(100);
  });
});
