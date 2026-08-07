import { describe, expect, it } from "vitest";
import { raioLivre } from "./cameraCollision";

describe("raioLivre", () => {
  const centro = { x: 0, y: 0, z: 0 };
  const azimute = 0; // olha pro +z
  const pitch = 0.5;
  const r = 13;
  const rMin = 5;
  const margem = 1.1;

  it("chão plano: mantém o raio pedido", () => {
    const rr = raioLivre(centro, azimute, pitch, r, rMin, margem, () => 0);
    expect(rr).toBeCloseTo(r);
  });

  it("montanha no ponto do raio pedido: puxa a câmera pra dentro", () => {
    // chão bem alto SÓ perto do ponto que o raio r alcançaria
    const rr = raioLivre(centro, azimute, pitch, r, rMin, margem, (_x, z) => (z > 8 ? 999 : 0));
    expect(rr).toBeLessThan(r);
    expect(rr).toBeGreaterThanOrEqual(rMin);
  });

  it("montanha cobre até o piso: cai no rMin", () => {
    const rr = raioLivre(centro, azimute, pitch, r, rMin, margem, () => 999);
    expect(rr).toBe(rMin);
  });

  it("longe da montanha (azimute pro lado oposto): raio cheio", () => {
    const rr = raioLivre(centro, Math.PI, pitch, r, rMin, margem, (_x, z) => (z > 8 ? 999 : 0));
    expect(rr).toBeCloseTo(r);
  });
});
