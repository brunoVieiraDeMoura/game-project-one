import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPORTANCE_RATES,
  DEFAULT_IMPORTANCE_THRESHOLDS,
  importanceTierFor,
  intervalMsFor,
  updateRateFor,
} from "./importancia";

describe("core/importancia — importanceTierFor", () => {
  it("thresholds padrão (Infinity/Infinity): sempre \"full\", qualquer distância", () => {
    expect(importanceTierFor({ isSelf: false, isCritical: false, distanceToCamera: 0 })).toBe("full");
    expect(importanceTierFor({ isSelf: false, isCritical: false, distanceToCamera: 1e9 })).toBe("full");
  });

  it("abaixo do limiar reduced: full", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(importanceTierFor({ isSelf: false, isCritical: false, distanceToCamera: 19.9 }, t)).toBe("full");
  });

  it("entre reduced e core: reduced", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(importanceTierFor({ isSelf: false, isCritical: false, distanceToCamera: 20 }, t)).toBe("reduced");
    expect(importanceTierFor({ isSelf: false, isCritical: false, distanceToCamera: 39.9 }, t)).toBe("reduced");
  });

  it("no limiar core ou além: core", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(importanceTierFor({ isSelf: false, isCritical: false, distanceToCamera: 40 }, t)).toBe("core");
    expect(importanceTierFor({ isSelf: false, isCritical: false, distanceToCamera: 1000 }, t)).toBe("core");
  });

  it("isSelf nunca degrada, mesmo longe além de coreAtDistance", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(importanceTierFor({ isSelf: true, isCritical: false, distanceToCamera: 1000 }, t)).toBe("full");
  });

  it("isCritical (alvo/ameaça) nunca degrada, mesmo longe", () => {
    const t = { reducedAtDistance: 20, coreAtDistance: 40 };
    expect(importanceTierFor({ isSelf: false, isCritical: true, distanceToCamera: 1000 }, t)).toBe("full");
  });
});

describe("core/importancia — updateRateFor / intervalMsFor", () => {
  it("rates padrão: 60Hz em todo tier (no-op)", () => {
    expect(updateRateFor("full")).toBe(60);
    expect(updateRateFor("reduced")).toBe(60);
    expect(updateRateFor("core")).toBe(60);
  });

  it("respeita tabela custom por tier", () => {
    const rates = { full: 60, reduced: 20, core: 5 };
    expect(updateRateFor("full", rates)).toBe(60);
    expect(updateRateFor("reduced", rates)).toBe(20);
    expect(updateRateFor("core", rates)).toBe(5);
  });

  it("intervalMsFor converte Hz em ms entre atualizações", () => {
    expect(intervalMsFor(60)).toBeCloseTo(16.666, 2);
    expect(intervalMsFor(20)).toBe(50);
    expect(intervalMsFor(5)).toBe(200);
  });

  it("intervalMsFor(0) e negativo nunca atualiza (Infinity), nunca dividir por zero", () => {
    expect(intervalMsFor(0)).toBe(Infinity);
    expect(intervalMsFor(-1)).toBe(Infinity);
  });

  it("DEFAULT_IMPORTANCE_RATES é o objeto que updateRateFor usa por padrão", () => {
    expect(updateRateFor("full")).toBe(DEFAULT_IMPORTANCE_RATES.full);
  });

  it("DEFAULT_IMPORTANCE_THRESHOLDS é Infinity nos dois limiares", () => {
    expect(DEFAULT_IMPORTANCE_THRESHOLDS.reducedAtDistance).toBe(Infinity);
    expect(DEFAULT_IMPORTANCE_THRESHOLDS.coreAtDistance).toBe(Infinity);
  });
});
