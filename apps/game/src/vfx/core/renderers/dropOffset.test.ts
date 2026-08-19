import { describe, expect, it } from "vitest";
import { computeDropOffset } from "./dropOffset";
import type { VfxInstanceRuntime } from "../types";

function fakeInstance(payload: Record<string, unknown>, targetScale = 1): VfxInstanceRuntime {
  return {
    spawnOptions: { payload },
    targetScale,
  } as unknown as VfxInstanceRuntime;
}

describe("vfx/core/renderers/dropOffset — computeDropOffset", () => {
  it("sem fallMs/fallHeight: zero, nunca muda quem não pediu queda", () => {
    expect(computeDropOffset(fakeInstance({}), 100)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("arriveY numérico simples (Fire Lance/Cold Bolt: chão, arriveY=0) — comportamento preservado", () => {
    const instance = fakeInstance({ fallMs: 500, fallHeight: 8, arriveY: 0 }, 1.7);
    const atArrival = computeDropOffset(instance, 500);
    expect(atArrival.y).toBe(0); // 0 * qualquer targetScale continua 0
  });

  it("arriveYByTarget ausente: arriveY NUNCA escala pelo targetScale (default preservado)", () => {
    const instance = fakeInstance({ fallMs: 500, fallHeight: 8, arriveY: 1.75 }, 3);
    const atArrival = computeDropOffset(instance, 500);
    expect(atArrival.y).toBe(1.75); // NÃO 5.25 — flag ausente = sem mudança
  });

  it("arriveYByTarget:true (Eletrocutar — cabeça): arriveY escala pelo targetScale real do alvo", () => {
    const poring = fakeInstance({ fallMs: 260, fallHeight: 8, arriveY: 1.75, arriveYByTarget: true }, 0.7);
    const boss = fakeInstance({ fallMs: 260, fallHeight: 8, arriveY: 1.75, arriveYByTarget: true }, 2.5);

    expect(computeDropOffset(poring, 260).y).toBeCloseTo(1.75 * 0.7, 6);
    expect(computeDropOffset(boss, 260).y).toBeCloseTo(1.75 * 2.5, 6);
    // Boss (maior) recebe o raio numa altura maior que o Poring — a cabeça
    // de verdade acompanha o tamanho do alvo, não uma coordenada fixa.
    expect(computeDropOffset(boss, 260).y).toBeGreaterThan(computeDropOffset(poring, 260).y);
  });

  it("no meio da queda (elapsedMs < fallMs): ainda em trânsito, entre fallHeight e o arrive escalado", () => {
    const instance = fakeInstance({ fallMs: 260, fallHeight: 8, arriveY: 1.75, arriveYByTarget: true }, 2);
    const meio = computeDropOffset(instance, 130);
    expect(meio.y).toBeLessThan(8);
    expect(meio.y).toBeGreaterThan(1.75 * 2);
  });
});
