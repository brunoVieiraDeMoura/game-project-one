import { describe, expect, it } from "vitest";
import { createSeededRng } from "./particleMath";

describe("vfx/core particleMath — createSeededRng", () => {
  it("mesmo seed produz exatamente a MESMA sequência (regressão visual: nenhuma skill pode mudar de forma)", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("reproduz a fórmula LCG original (9301/49297/233280) byte a byte", () => {
    const rnd = createSeededRng(1000);
    let s = 1000;
    const original = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 20; i++) expect(rnd()).toBe(original());
  });

  it("valores sempre em [0, 1)", () => {
    const rnd = createSeededRng(7919);
    for (let i = 0; i < 200; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("seeds diferentes produzem sequências diferentes", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    expect(a()).not.toBe(b());
  });
});
