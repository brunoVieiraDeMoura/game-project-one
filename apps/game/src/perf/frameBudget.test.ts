import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { beginFrame, consume, remaining, shouldDegrade } from "./frameBudget";
import * as FrameBudgetModule from "./frameBudget";

/**
 * T5a — revisão de semântica do `FrameBudget` ANTES de qualquer consumidor
 * real usá-lo (`leia1.txt`). Cada `describe` abaixo prova uma das garantias
 * do contrato, não só o comportamento aritmético.
 */

describe("frameBudget — beginFrame/consume/remaining: semântica básica", () => {
  it("beginFrame zera o orçamento com o total pedido", () => {
    const s = beginFrame(6);
    expect(s.totalMs).toBe(6);
    expect(remaining(s)).toBe(6);
  });

  it("consume registra custo JÁ MEDIDO — remaining cai pelo valor exato consumido", () => {
    const s = beginFrame(6);
    consume(s, 2.5);
    expect(remaining(s)).toBeCloseTo(3.5, 5);
    consume(s, 1);
    expect(remaining(s)).toBeCloseTo(2.5, 5);
  });

  it("remaining nunca fica negativo, mesmo consumindo além do total", () => {
    const s = beginFrame(6);
    consume(s, 50);
    expect(remaining(s)).toBe(0);
  });

  it("consume(ms) negativo nunca DEVOLVE orçamento (tratado como 0)", () => {
    const s = beginFrame(6);
    consume(s, 2);
    consume(s, -100);
    expect(remaining(s)).toBeCloseTo(4, 5);
  });

  it("beginFrame(total negativo) nunca cria orçamento negativo", () => {
    const s = beginFrame(-5);
    expect(s.totalMs).toBe(0);
    expect(remaining(s)).toBe(0);
  });

  it("dois beginFrame() são estados INDEPENDENTES — nenhum estado escondido de módulo", () => {
    const a = beginFrame(6);
    const b = beginFrame(6);
    consume(a, 5);
    expect(remaining(a)).toBeCloseTo(1, 5);
    expect(remaining(b)).toBe(6); // `b` não viu o consumo de `a`
  });
});

describe("frameBudget — consume() nunca é reserva", () => {
  it("consume() só soma ao usado — não agenda, não devolve handle, não tem efeito colateral observável além de usedMs", () => {
    const s = beginFrame(10);
    const retorno = consume(s, 3);
    expect(retorno).toBeUndefined(); // não devolve uma "promessa"/Reserva — é fato consumado, ponto
    expect(s.usedMs).toBeCloseTo(3, 5);
  });

  it("não existe reservar()/Reserva exportado — API mínima até um consumidor real precisar", () => {
    const mod: Record<string, unknown> = FrameBudgetModule;
    expect(mod.reservar).toBeUndefined();
    expect(mod.Reserva).toBeUndefined();
  });
});

describe("frameBudget — shouldDegrade: prioridade + restante, nunca decide sozinho", () => {
  it("prioridade 0 (crítico) NUNCA degrada, mesmo com o orçamento inteiramente gasto", () => {
    const s = beginFrame(6);
    consume(s, 100);
    expect(remaining(s)).toBe(0);
    expect(shouldDegrade(s, 0)).toBe(false);
  });

  it("prioridade > 0 degrada quando o orçamento acabou", () => {
    const s = beginFrame(6);
    consume(s, 100);
    expect(shouldDegrade(s, 1)).toBe(true);
    expect(shouldDegrade(s, 3)).toBe(true);
  });

  it("prioridade > 0 NÃO degrada enquanto ainda sobra orçamento", () => {
    const s = beginFrame(6);
    consume(s, 2);
    expect(shouldDegrade(s, 1)).toBe(false);
  });

  it("shouldDegrade só INFORMA — não muda o estado (chamável repetidamente sem side effect)", () => {
    const s = beginFrame(6);
    consume(s, 100);
    shouldDegrade(s, 1);
    shouldDegrade(s, 1);
    expect(s.usedMs).toBeCloseTo(100, 5); // não moveu nada além do que consume() já tinha somado
  });
});

describe("frameBudget — fallback: subsistema funciona SEM o módulo", () => {
  /**
   * Simula o padrão de integração que T5b vai usar em `SquareTerrain.tsx`/
   * `moveTarget.ts`/`vfx/core/manager.ts`: `budget` é OPCIONAL, e sem ele o
   * consumidor cai no PRÓPRIO teto atual — nunca quebra, nunca depende do
   * módulo existir. Isto prova a garantia "camada adicional de coordenação,
   * nunca ponto único de falha" do contrato, não só descreve.
   */
  const ORCAMENTO_PROPRIO_MS = 6;

  function deveriaParar(usadoMs: number, budget?: FrameBudgetStateLike): boolean {
    if (budget) return shouldDegrade(budget, 1);
    return usadoMs >= ORCAMENTO_PROPRIO_MS; // fallback: teto de sempre, sem o módulo
  }

  it("sem budget (undefined): usa o teto próprio do subsistema, funciona igual a antes do FrameBudget existir", () => {
    expect(deveriaParar(5)).toBe(false);
    expect(deveriaParar(7)).toBe(true);
  });

  it("com budget: a decisão vem do FrameBudget compartilhado, não do teto próprio", () => {
    const s = beginFrame(6);
    consume(s, 100); // orçamento GLOBAL do quadro já foi gasto por outro subsistema
    // o subsistema mediu só 1ms de trabalho PRÓPRIO (bem abaixo do seu teto
    // de 6), mas o quadro como um todo já não tem mais espaço
    expect(deveriaParar(1, s)).toBe(true);
  });
});

type FrameBudgetStateLike = ReturnType<typeof beginFrame>;

describe("frameBudget — guarda de arquitetura: nunca importa subsistema", () => {
  /**
   * Verifica os `import ... from "..."` de verdade, não o texto do arquivo
   * inteiro — o docblock CITA `grid/SquareTerrain.tsx` de propósito (é o
   * exemplo que justifica o design), e isso é documentação desejada, não um
   * acoplamento. O que a regra proíbe é uma linha `import` apontando pra
   * dentro de um subsistema de cena.
   */
  it("frameBudget.ts não tem NENHUM `import` — é aritmética pura, zero dependência", () => {
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(aqui, "frameBudget.ts"), "utf8");
    const linhasDeImport = src
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("import "));
    expect(linhasDeImport).toEqual([]);
  });
});
