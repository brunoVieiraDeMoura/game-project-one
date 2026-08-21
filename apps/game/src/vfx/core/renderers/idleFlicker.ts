import type { VfxInstanceRuntime } from "../types";

export interface IdleFlickerEnvelope {
  scaleMul: number;
  opacityMul: number;
  /** radianos — somado direto em cima de `payload.rotation`/`spawnOptions.rotation`
   * no `SpriteRenderer`, mesma unidade que `aRotation` já usa (`cos(aRotation)`/
   * `sin(aRotation)` no shader, ver `instancedBillboardBase.ts`). */
  rotationRad: number;
}

const ONE: IdleFlickerEnvelope = { scaleMul: 1, opacityMul: 1, rotationRad: 0 };

/**
 * Envelope genérico "queimando continuamente" (Fire Wall, pedido "fogo vivo
 * no chão" — chamas sobem/diminuem/oscilam/inclinam, nunca um único sprite
 * escalando pra cima e pra baixo) — MESMO espírito de `burstEnvelope.ts`/
 * `castChargeEnvelope.ts`: lê só `payload.idleFlicker`(flag)/
 * `idleFlickerHz1`/`idleFlickerHz2`/`idleFlickerScaleAmp`/
 * `idleFlickerOpacityAmp`/`idleFlickerRotationAmp`, devolve `{1,1,0}` (no-op)
 * sem a flag — nenhuma outra skill com `renderer:"sprite"` muda.
 *
 * Diferente de `castChargeEnvelope`: NUNCA normaliza contra
 * `instance.expiresAt`/`bornAt` — Fire Wall vive até `skill:ground-gone`
 * (`expiresAt` fica `null` no lado do Core, área do servidor sem prazo
 * conhecido), então qualquer envelope que precise de uma duração TOTAL pra
 * calcular a curva (`castChargeEnvelope`, `dropStretch`, `burstEnvelope`) é
 * um no-op permanente numa instância assim. Este lê só `elapsedMs` puro —
 * funciona igual em uma instância de 300ms ou de 5 minutos.
 *
 * Fase seedada por `instance.instanceId` (mesmo truque que
 * `ParticleRenderer.buildParticles` já usa pra distribuir embers por
 * instância) — cada célula de uma parede pulsa fora de sincronia com as
 * vizinhas sem precisar de nenhum dado novo vindo do spawn. Duas senoides
 * somadas (frequências DIFERENTES, pesos 0.6/0.4) em vez de uma só — uma
 * única senoide lê como "respiração" mecânica; a soma de duas lê como fogo
 * vivo (picos irregulares, nunca um ciclo perfeitamente repetido de curto
 * período perceptível).
 */
export function computeIdleFlicker(instance: VfxInstanceRuntime, elapsedMs: number): IdleFlickerEnvelope {
  if (instance.spawnOptions.payload?.idleFlicker !== true) return ONE;

  const phase = ((instance.instanceId % 1000) / 1000) * Math.PI * 2;
  const hz1 = Number(instance.spawnOptions.payload?.idleFlickerHz1 ?? 2.2);
  const hz2 = Number(instance.spawnOptions.payload?.idleFlickerHz2 ?? 3.7);
  const scaleAmp = Number(instance.spawnOptions.payload?.idleFlickerScaleAmp ?? 0);
  const opacityAmp = Number(instance.spawnOptions.payload?.idleFlickerOpacityAmp ?? 0);
  const rotationAmp = Number(instance.spawnOptions.payload?.idleFlickerRotationAmp ?? 0);

  const t = elapsedMs / 1000;
  const wave = Math.sin(t * Math.PI * 2 * hz1 + phase) * 0.6 + Math.sin(t * Math.PI * 2 * hz2 + phase * 1.7) * 0.4;

  return {
    scaleMul: Math.max(0.05, 1 + wave * scaleAmp),
    opacityMul: Math.max(0, 1 + wave * opacityAmp),
    rotationRad: wave * rotationAmp,
  };
}
