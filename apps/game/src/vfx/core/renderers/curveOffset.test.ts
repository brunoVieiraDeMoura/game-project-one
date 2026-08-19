import { describe, expect, it } from "vitest";
import { computeCurveOffset } from "./curveOffset";
import type { VfxInstanceRuntime } from "../types";

function fakeInstance(payload: Record<string, unknown>, casterOffset: { x: number; y: number; z: number } | null = { x: 0, y: 0, z: -2.5 }): VfxInstanceRuntime {
  return { spawnOptions: { payload }, casterOffset } as unknown as VfxInstanceRuntime;
}

describe("vfx/core/renderers/curveOffset — computeCurveOffset", () => {
  it("sem flightMs/casterOffset/curveLateral: zero, nunca muda quem não pediu curva (Fire Ball/Soul Strike sem curva continuam retos)", () => {
    expect(computeCurveOffset(fakeInstance({}), 100)).toEqual({ x: 0, y: 0, z: 0 });
    expect(computeCurveOffset(fakeInstance({ flightMs: 500, curveLateral: 2 }, null), 100)).toEqual({ x: 0, y: 0, z: 0 });
    expect(computeCurveOffset(fakeInstance({ flightMs: 500 }), 100)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("envelope sin(π·u): zero no nascimento E na chegada, pico no meio do voo", () => {
    const instance = fakeInstance({ flightMs: 500, curveLateral: 3 });
    expect(computeCurveOffset(instance, 0).x).toBeCloseTo(0, 6);
    expect(computeCurveOffset(instance, 500).x).toBeCloseTo(0, 6); // chegada — SEMPRE converge no alvo
    const mid = computeCurveOffset(instance, 250);
    expect(Math.abs(mid.x)).toBeGreaterThan(0); // pico visível no meio
  });

  it("direção lateral é perpendicular à reta caster→alvo, nunca eixo mundial fixo (item 17 do pedido)", () => {
    // caster atrás do alvo no eixo Z (casterOffset aponta alvo→caster) —
    // reta caster→alvo aponta +Z, lateral é o eixo X.
    const alongZ = fakeInstance({ flightMs: 500, curveLateral: 2 }, { x: 0, y: 0, z: -5 });
    const midZ = computeCurveOffset(alongZ, 250);
    expect(Math.abs(midZ.x)).toBeGreaterThan(0.1);
    expect(midZ.z).toBeCloseTo(0, 6);

    // caster ao lado do alvo no eixo X — reta caster→alvo aponta +X,
    // lateral vira o eixo Z (a curva "gira junto" com a orientação real do
    // cast, não fica travada no mundo).
    const alongX = fakeInstance({ flightMs: 500, curveLateral: 2 }, { x: -5, y: 0, z: 0 });
    const midX = computeCurveOffset(alongX, 250);
    expect(Math.abs(midX.z)).toBeGreaterThan(0.1);
    expect(midX.x).toBeCloseTo(0, 6);
  });

  it("sinal de curveLateral inverte o lado — normalizedIndex negativo/positivo saem em direções opostas", () => {
    const left = fakeInstance({ flightMs: 500, curveLateral: -2 });
    const right = fakeInstance({ flightMs: 500, curveLateral: 2 });
    const l = computeCurveOffset(left, 250);
    const r = computeCurveOffset(right, 250);
    expect(l.x).toBeCloseTo(-r.x, 6);
    expect(Math.abs(l.x)).toBeGreaterThan(0);
  });

  it("curveVertical soma um pequeno arco em Y, mesmo envelope", () => {
    const instance = fakeInstance({ flightMs: 500, curveVertical: 0.4 });
    expect(computeCurveOffset(instance, 0).y).toBeCloseTo(0, 6);
    expect(computeCurveOffset(instance, 500).y).toBeCloseTo(0, 6);
    expect(computeCurveOffset(instance, 250).y).toBeCloseTo(0.4, 6);
  });
});
