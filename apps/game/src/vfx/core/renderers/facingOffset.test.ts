import { describe, expect, it } from "vitest";
import { computeFacingOffset } from "./facingOffset";
import type { VfxInstanceRuntime } from "../types";

function fakeInstance(payload: Record<string, unknown>, casterOffset: { x: number; y: number; z: number } | null = { x: 3, y: 0, z: 0 }): VfxInstanceRuntime {
  return { spawnOptions: { payload }, casterOffset } as unknown as VfxInstanceRuntime;
}

describe("vfx/core/renderers/facingOffset — computeFacingOffset", () => {
  it("sem facingOffsetDistance/casterOffset: zero, nunca muda quem não pediu (todo flash existente continua no centro do alvo)", () => {
    expect(computeFacingOffset(fakeInstance({}))).toEqual({ x: 0, y: 0, z: 0 });
    expect(computeFacingOffset(fakeInstance({ facingOffsetDistance: 0.5 }, null))).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("desvio na direção NORMALIZADA de casterOffset, magnitude = facingOffsetDistance", () => {
    const instance = fakeInstance({ facingOffsetDistance: 2 }, { x: 3, y: 0, z: 4 }); // len=5
    const offset = computeFacingOffset(instance);
    expect(offset.x).toBeCloseTo((3 / 5) * 2, 6);
    expect(offset.z).toBeCloseTo((4 / 5) * 2, 6);
  });

  it("facingOffsetHeight soma altura fixa (mundo), independente da direção XZ", () => {
    const instance = fakeInstance({ facingOffsetDistance: 1, facingOffsetHeight: 1.2 }, { x: 1, y: 0, z: 0 });
    expect(computeFacingOffset(instance).y).toBeCloseTo(1.2, 6);
  });

  it("casterOffset degenerado (comprimento ~0, atacante em cima do alvo): zero, nunca NaN", () => {
    const instance = fakeInstance({ facingOffsetDistance: 1 }, { x: 0, y: 0, z: 0 });
    const offset = computeFacingOffset(instance);
    expect(offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(Number.isNaN(offset.x)).toBe(false);
  });
});
