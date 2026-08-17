import { describe, expect, it } from "vitest";
import { classifyHit, criticalScaleFor, CRITICAL_SCALE_MULTIPLIER } from "./hitVfxResolver";

describe("classifyHit", () => {
  it("normal — 1 hit real, sem crítico", () => {
    const c = classifyHit(1, 1, false);
    expect(c).toEqual({ hits: 1, multiplicity: "single", critical: false });
  });

  it("single — mesma forma de 'normal', é o mesmo caso (1 hit)", () => {
    const c = classifyHit(1, 5, false);
    expect(c.multiplicity).toBe("single");
    expect(c.hits).toBe(1);
  });

  it("multi 2", () => {
    const c = classifyHit(2, 1, false);
    expect(c).toEqual({ hits: 2, multiplicity: "multi", critical: false });
  });

  it("multi 5", () => {
    const c = classifyHit(5, 1, false);
    expect(c).toEqual({ hits: 5, multiplicity: "multi", critical: false });
  });

  it("multi 10", () => {
    const c = classifyHit(10, 1, false);
    expect(c).toEqual({ hits: 10, multiplicity: "multi", critical: false });
  });

  it("critical — single hit crítico continua single na multiplicidade (dimensão separada)", () => {
    const c = classifyHit(1, 1, true);
    expect(c).toEqual({ hits: 1, multiplicity: "single", critical: true });
  });

  it("multi + critical — as duas dimensões coexistem sem virar um hitType novo", () => {
    const c = classifyHit(5, 1, true);
    expect(c).toEqual({ hits: 5, multiplicity: "multi", critical: true });
  });

  it("count ausente — cai no fallback por nível, nunca quebra", () => {
    const c = classifyHit(undefined, 10, false);
    expect(c.hits).toBe(10); // getSkillProjectileCount(10) = 10
    expect(c.multiplicity).toBe("multi");
  });

  it("count inválido (0) — fallback por nível, nunca hits=0", () => {
    const c = classifyHit(0, 3, false);
    expect(c.hits).toBe(3);
  });

  it("count inválido (negativo) — fallback por nível (negativo não é um count real magico válido pra esta função; quem já normaliza sinal antes de chamar é o caller com Math.abs — aqui trata como inválido)", () => {
    const c = classifyHit(-5, 2, false);
    expect(c.hits).toBe(2);
  });

  it("count inválido (NaN) — fallback por nível", () => {
    const c = classifyHit(Number.NaN, 4, false);
    expect(c.hits).toBe(4);
  });

  it("count extremo — passa inteiro, esta camada NUNCA capa (budget visual é responsabilidade de quem renderiza)", () => {
    const c = classifyHit(999, 1, false);
    expect(c.hits).toBe(999);
    expect(c.multiplicity).toBe("multi");
  });

  it("count real fracionário — arredonda, nunca trunca silenciosamente errado", () => {
    const c = classifyHit(4.6, 1, false);
    expect(c.hits).toBe(5);
  });
});

describe("criticalScaleFor", () => {
  it("crítico escala pelo multiplicador compartilhado", () => {
    expect(criticalScaleFor(true)).toBe(CRITICAL_SCALE_MULTIPLIER);
  });

  it("não-crítico não escala", () => {
    expect(criticalScaleFor(false)).toBe(1);
  });
});
