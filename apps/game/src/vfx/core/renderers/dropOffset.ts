import type { VfxInstanceRuntime } from "../types";

export interface DropOffset {
  x: number;
  y: number;
  z: number;
}

const ZERO: DropOffset = { x: 0, y: 0, z: 0 };

/**
 * Deslocamento local genérico de "queda vertical" (reconstrução visual
 * Fire Lance/Cold Bolt, 2026-08-19: "losango/fragmento caindo do céu").
 * MESMO espírito de `flightOffset.ts`/`orbitOffset.ts` — zero `if
 * FIRE_LANCE`/`if COLD_BOLT` em renderer nenhum, qualquer skill futura que
 * queira "algo caindo de cima" ganha de graça só passando `payload.fallMs`.
 *
 * Diferente de `flightOffset.ts`: não depende de `casterOffset`/caster
 * nenhum — é só uma queda vertical PURA, de `payload.fallHeight` (unidades
 * de célula, acima da âncora) até `payload.arriveY` (default 0, no chão da
 * âncora), ao longo de `payload.fallMs`. Sem os dois campos numéricos,
 * devolve zero (nunca muda quem não pediu queda).
 */
export function computeDropOffset(instance: VfxInstanceRuntime, elapsedMs: number): DropOffset {
  const fallMs = instance.spawnOptions.payload?.fallMs;
  const fallHeight = instance.spawnOptions.payload?.fallHeight;
  if (typeof fallMs !== "number" || fallMs <= 0 || typeof fallHeight !== "number") return ZERO;
  const arriveY = Number(instance.spawnOptions.payload?.arriveY ?? 0);
  const u = Math.max(0, Math.min(1, elapsedMs / fallMs));
  const eased = u * u * (3 - 2 * u);
  return { x: 0, y: fallHeight * (1 - eased) + arriveY * eased, z: 0 };
}
