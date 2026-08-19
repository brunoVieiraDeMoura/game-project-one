import type { VfxInstanceRuntime } from "../types";

export interface CastChargeEnvelope {
  scaleMul: number;
  opacityMul: number;
}

const ONE: CastChargeEnvelope = { scaleMul: 1, opacityMul: 1 };

/**
 * Envelope genérico "concentrando energia durante o cast" (Fire Lance,
 * pedido 2026-08-19-c: "efeito na ponta do cajado cresce + pulsa enquanto
 * castando") — MESMO espírito de `dropStretch.ts`/`burstEnvelope.ts`: lê só
 * `payload.castCharge`(flag)/`castGrowFrom`/`castGrowTo`/`castPulseHz`/
 * `castPulseAmp`, devolve `{scaleMul:1,opacityMul:1}` (no-op) sem a flag —
 * nenhuma outra skill com `anchor:"caster-tip"` (Cold Bolt/Thunder Storm/
 * Soul Strike/Stone Curse) muda de comportamento.
 *
 * Diferente de `burstEnvelope` (curto, "estoura e some"): usa o PRÓPRIO
 * lifecycle da instância (`instance.bornAt`/`instance.expiresAt`, já
 * setados a partir do `durationMs` REAL do cast — `net/useWorldEvents.ts:
 * onSkillCasting`, servidor) em vez de um payload de duração à parte —
 * cresce do início ao FIM do cast de verdade, nunca um tempo inventado.
 * `instance.expiresAt === null` (sem duração conhecida) devolve `1` — nunca
 * quebra um cast sem prazo.
 */
export function computeCastChargeEnvelope(instance: VfxInstanceRuntime, elapsedMs: number): CastChargeEnvelope {
  if (instance.spawnOptions.payload?.castCharge !== true || instance.expiresAt === null) return ONE;
  const totalMs = Math.max(1, instance.expiresAt - instance.bornAt);
  const u = Math.max(0, Math.min(1, elapsedMs / totalMs));
  // ease-out (`sqrt`): cresce rápido no início, achata perto do fim — "já
  // concentrado" bem antes do disparo, em vez de um pop repentino no talo.
  const growEase = Math.sqrt(u);
  const growFrom = Number(instance.spawnOptions.payload?.castGrowFrom ?? 0.4);
  const growTo = Number(instance.spawnOptions.payload?.castGrowTo ?? 1);
  const pulseHz = Number(instance.spawnOptions.payload?.castPulseHz ?? 0);
  const pulseAmp = Number(instance.spawnOptions.payload?.castPulseAmp ?? 0);
  const pulse = pulseHz > 0 ? Math.sin((elapsedMs / 1000) * Math.PI * 2 * pulseHz) * pulseAmp * growEase : 0;
  const scaleMul = Math.max(0.05, growFrom + (growTo - growFrom) * growEase + pulse);
  const opacityMul = 0.55 + growEase * 0.45;
  return { scaleMul, opacityMul };
}
