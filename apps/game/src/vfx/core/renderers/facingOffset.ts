import type { VfxInstanceRuntime } from "../types";
import type { FlightOffset } from "./flightOffset";

const ZERO: FlightOffset = { x: 0, y: 0, z: 0 };

/**
 * Desvio PERSISTENTE (sem envelope de tempo) na direção de `casterOffset`
 * (Cúpula Fantasma, 2026-08-19-zj: "animação de block na direção de onde o
 * hit veio") — diferente de `flightOffset.ts`/`curveOffset.ts`, que
 * interpolam/oscilam ao longo do voo, este é um deslocamento FIXO: útil pra
 * um flash reativo que nasce já na posição final (ex.: escudo aparecendo do
 * lado do personagem que está de frente pro atacante), sem fase de voo
 * nenhuma.
 *
 * Lê `instance.casterOffset` (mesmo campo que `anchor:"caster-to-target"`
 * já resolve — aqui reaproveitado com um sentido diferente: "source" é o
 * ATACANTE, "target" é quem bloqueou, então `casterOffset` já aponta do
 * defensor pro atacante) e normaliza — `payload.facingOffsetDistance`
 * decide o quão longe do centro o efeito nasce, `payload.facingOffsetHeight`
 * a altura (mundo). Sem `facingOffsetDistance`, devolve zero — nunca muda
 * quem não pedir isto.
 */
export function computeFacingOffset(instance: VfxInstanceRuntime): FlightOffset {
  const distance = instance.spawnOptions.payload?.facingOffsetDistance;
  if (typeof distance !== "number" || distance <= 0 || !instance.casterOffset) return ZERO;
  const { x: cx, z: cz } = instance.casterOffset;
  const len = Math.hypot(cx, cz);
  if (len < 1e-6) return ZERO;
  const height = Number(instance.spawnOptions.payload?.facingOffsetHeight ?? 0);
  return { x: (cx / len) * distance, y: height, z: (cz / len) * distance };
}
