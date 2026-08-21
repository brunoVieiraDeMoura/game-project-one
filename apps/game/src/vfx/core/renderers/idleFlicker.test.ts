import { describe, expect, it } from "vitest";
import { computeIdleFlicker } from "./idleFlicker";
import type { VfxInstanceRuntime } from "../types";

function fakeInstance(payload: Record<string, unknown>, instanceId = 1): VfxInstanceRuntime {
  return {
    instanceId,
    spawnOptions: { payload },
  } as unknown as VfxInstanceRuntime;
}

describe("vfx/core/renderers/idleFlicker — computeIdleFlicker", () => {
  it("sem payload.idleFlicker: no-op, nunca muda quem não pediu flicker", () => {
    expect(computeIdleFlicker(fakeInstance({}), 500)).toEqual({ scaleMul: 1, opacityMul: 1, rotationRad: 0 });
  });

  it("idleFlicker:true sem amplitudes: no-op numérico (defaults de amplitude são 0)", () => {
    const r = computeIdleFlicker(fakeInstance({ idleFlicker: true }), 500);
    expect(r).toEqual({ scaleMul: 1, opacityMul: 1, rotationRad: 0 });
  });

  it("não depende de instance.expiresAt/bornAt — funciona em instância de vida infinita (Fire Wall)", () => {
    const instance = fakeInstance({ idleFlicker: true, idleFlickerScaleAmp: 0.1 });
    // sem expiresAt/bornAt no fake — se a função os lesse, isto quebraria/NaN
    const r = computeIdleFlicker(instance, 10_000);
    expect(Number.isFinite(r.scaleMul)).toBe(true);
  });

  it("determinístico: mesmo instanceId + mesmo elapsedMs produz exatamente o mesmo resultado", () => {
    const a = computeIdleFlicker(fakeInstance({ idleFlicker: true, idleFlickerScaleAmp: 0.08 }, 42), 1234);
    const b = computeIdleFlicker(fakeInstance({ idleFlicker: true, idleFlickerScaleAmp: 0.08 }, 42), 1234);
    expect(a).toEqual(b);
  });

  it("instanceId diferentes (células de uma mesma parede) nunca pulsam em fase idêntica", () => {
    const a = computeIdleFlicker(fakeInstance({ idleFlicker: true, idleFlickerScaleAmp: 0.08 }, 10), 900);
    const b = computeIdleFlicker(fakeInstance({ idleFlicker: true, idleFlickerScaleAmp: 0.08 }, 11), 900);
    expect(a.scaleMul).not.toBe(b.scaleMul);
  });

  it("amplitude pequena: scaleMul/opacityMul ficam dentro de uma faixa razoável, nunca explodem", () => {
    const instance = fakeInstance({ idleFlicker: true, idleFlickerScaleAmp: 0.1, idleFlickerOpacityAmp: 0.15 });
    for (let t = 0; t < 5000; t += 137) {
      const r = computeIdleFlicker(instance, t);
      expect(r.scaleMul).toBeGreaterThan(0.5);
      expect(r.scaleMul).toBeLessThan(1.5);
      expect(r.opacityMul).toBeGreaterThanOrEqual(0);
      expect(r.opacityMul).toBeLessThan(1.5);
    }
  });

  it("opacityMul nunca fica negativo mesmo com amplitude grande (clamp em 0)", () => {
    const instance = fakeInstance({ idleFlicker: true, idleFlickerOpacityAmp: 5 });
    for (let t = 0; t < 3000; t += 97) {
      expect(computeIdleFlicker(instance, t).opacityMul).toBeGreaterThanOrEqual(0);
    }
  });

  it("rotationRad segue idleFlickerRotationAmp, zero sem o campo", () => {
    const semRotacao = computeIdleFlicker(fakeInstance({ idleFlicker: true, idleFlickerScaleAmp: 0.1 }), 500);
    expect(semRotacao.rotationRad).toBe(0);

    const comRotacao = computeIdleFlicker(fakeInstance({ idleFlicker: true, idleFlickerRotationAmp: 0.05 }), 500);
    expect(Math.abs(comRotacao.rotationRad)).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});
