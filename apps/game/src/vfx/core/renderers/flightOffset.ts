import type { VfxInstanceRuntime } from "../types";

export interface FlightOffset {
  x: number;
  y: number;
  z: number;
}

const ZERO: FlightOffset = { x: 0, y: 0, z: 0 };

/**
 * Deslocamento local genérico de "voo caster→alvo" (Fase 5, protótipo GPU
 * da Fire Ball, leia1.txt item 4: "não coloque `if FIRE_BALL` dentro dos
 * renderers"). Qualquer skill com `anchor:"caster-to-target"` e
 * `payload.flightMs` numérico ganha a interpolação automaticamente — lê só
 * `instance.casterOffset` (offset congelado no spawn, já resolvido por
 * `anchor.ts`, MESMO dado que `SoulStrikeImpact.tsx`/o art DOM da Fire Ball
 * já usam) e `elapsedMs` (já passado pra todo `onInstanceUpdate`). Sem os
 * dois, devolve zero — nunca muda o comportamento de quem não pediu voo
 * (todas as skills DOM continuam calculando a própria trajetória, este
 * helper só existe pros renderers GPU que quiserem o mesmo efeito sem
 * duplicar a fórmula em cada um).
 *
 * Mesma curva (`smoothstep`) que `fireBallVfxDef.tsx: ballLocalPos` já usa
 * — não uma segunda fórmula inventada.
 */
export function computeFlightOffset(instance: VfxInstanceRuntime, elapsedMs: number): FlightOffset {
  const flightMs = instance.spawnOptions.payload?.flightMs;
  if (typeof flightMs !== "number" || flightMs <= 0 || !instance.casterOffset) return ZERO;
  const u = Math.max(0, Math.min(1, elapsedMs / flightMs));
  const eased = u * u * (3 - 2 * u);
  const arriveY = Number(instance.spawnOptions.payload?.arriveY ?? 0);
  return {
    x: instance.casterOffset.x * (1 - eased),
    y: instance.casterOffset.y * (1 - eased) + arriveY * eased,
    z: instance.casterOffset.z * (1 - eased),
  };
}
