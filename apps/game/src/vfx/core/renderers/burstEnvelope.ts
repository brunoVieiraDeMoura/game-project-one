import type { VfxInstanceRuntime } from "../types";

export interface BurstEnvelope {
  scaleMul: number;
  opacityMul: number;
}

const ONE: BurstEnvelope = { scaleMul: 1, opacityMul: 1 };
const HIDDEN: BurstEnvelope = { scaleMul: 0, opacityMul: 0 };

/**
 * Envelope genérico "spawn → expande rápido → pico → fade" (Fire Lance
 * impact, reconstrução 2026-08-19-b) — MESMO espírito de `dropOffset.ts`/
 * `dropStretch.ts`: lê só `payload.burstMs`/`burstScaleFrom`/`burstScaleTo`,
 * devolve `{scaleMul:1,opacityMul:1}` (no-op) sem eles. Nenhum renderer novo,
 * nenhum `if <SKILL>` — qualquer impacto GPU futuro que precise de "flash
 * que estoura e some" ganha de graça passando os 3 campos no payload.
 *
 * `scaleMul` cresce via ease-out (rápido no início, desacelera no pico —
 * "expansão rápida" do pedido); `opacityMul` cai via ease-in (fica brilhante
 * mais tempo, desaparece rápido no fim — "pico → fade", não um fade linear
 * that starts dimming immediately).
 *
 * `payload.burstStartMs` (Fire Ball, 2026-08-19-v: "projétil+trail+impacto
 * numa instância SÓ, mesma arquitetura de sempre — o flash de impacto não
 * pode aparecer enquanto a bola ainda está voando") — atraso, em ms desde o
 * SPAWN da instância, antes da curva de burst começar; a camada fica
 * totalmente invisível (`scaleMul:0,opacityMul:0`, nunca desenhada) até lá.
 * Ausente/`0` = comportamento de sempre (burst começa em `elapsedMs=0`,
 * MESMO de todo impacto dedicado — Fire Lance/Cold Bolt/Eletrocutar nunca
 * passam este campo, zero mudança pra eles).
 */
export function computeBurstEnvelope(instance: VfxInstanceRuntime, elapsedMs: number): BurstEnvelope {
  const burstMs = instance.spawnOptions.payload?.burstMs;
  if (typeof burstMs !== "number" || burstMs <= 0) return ONE;
  const startMs = Number(instance.spawnOptions.payload?.burstStartMs ?? 0);
  const local = elapsedMs - startMs;
  if (local < 0) return HIDDEN;
  const u = Math.max(0, Math.min(1, local / burstMs));
  const scaleFrom = Number(instance.spawnOptions.payload?.burstScaleFrom ?? 0.5);
  const scaleTo = Number(instance.spawnOptions.payload?.burstScaleTo ?? 2.2);
  const growEase = 1 - (1 - u) * (1 - u);
  const scaleMul = scaleFrom + (scaleTo - scaleFrom) * growEase;
  const opacityMul = 1 - u * u;
  return { scaleMul, opacityMul };
}
