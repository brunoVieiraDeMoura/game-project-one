import { describe, expect, it } from "vitest";
import { computeBurstEnvelope } from "./burstEnvelope";
import type { VfxInstanceRuntime } from "../types";

function fakeInstance(payload: Record<string, unknown>): VfxInstanceRuntime {
  return { spawnOptions: { payload } } as unknown as VfxInstanceRuntime;
}

describe("vfx/core/renderers/burstEnvelope — computeBurstEnvelope", () => {
  it("sem burstMs: no-op, nunca muda quem não pediu burst", () => {
    expect(computeBurstEnvelope(fakeInstance({}), 100)).toEqual({ scaleMul: 1, opacityMul: 1 });
  });

  it("burstStartMs ausente (Fire Lance/Cold Bolt/Eletrocutar): burst começa em elapsedMs=0, comportamento preservado", () => {
    const instance = fakeInstance({ burstMs: 200, burstScaleFrom: 0.5, burstScaleTo: 2 });
    const atZero = computeBurstEnvelope(instance, 0);
    expect(atZero.scaleMul).toBeCloseTo(0.5, 6);
    expect(atZero.opacityMul).toBeCloseTo(1, 6);
  });

  it("burstStartMs (Fire Ball: flash só depois que a bola chega): totalmente invisível ANTES do início", () => {
    const instance = fakeInstance({ burstMs: 200, burstStartMs: 456 });
    expect(computeBurstEnvelope(instance, 0)).toEqual({ scaleMul: 0, opacityMul: 0 });
    expect(computeBurstEnvelope(instance, 455)).toEqual({ scaleMul: 0, opacityMul: 0 });
  });

  it("burstStartMs: curva normal reaparece a partir do início, relativa a ele (não ao spawn)", () => {
    const instance = fakeInstance({ burstMs: 200, burstStartMs: 456, burstScaleFrom: 0.5, burstScaleTo: 2 });
    const atStart = computeBurstEnvelope(instance, 456);
    const atZeroNoDelay = computeBurstEnvelope(fakeInstance({ burstMs: 200, burstScaleFrom: 0.5, burstScaleTo: 2 }), 0);
    expect(atStart).toEqual(atZeroNoDelay);

    const atPeak = computeBurstEnvelope(instance, 456 + 200);
    expect(atPeak.scaleMul).toBeCloseTo(2, 6);
    expect(atPeak.opacityMul).toBeCloseTo(0, 6);
  });
});
