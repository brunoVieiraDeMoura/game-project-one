import type { VfxInstanceRuntime } from "../types";

export interface CurveOffset {
  x: number;
  y: number;
  z: number;
}

const ZERO: CurveOffset = { x: 0, y: 0, z: 0 };

/**
 * Desvio lateral/vertical genérico pra um voo caster→alvo (Esferas
 * Espirituais, 2026-08-19-z: "trajetórias não são linhas retas — espalham,
 * fazem curva suave, convergem no alvo") — MESMO espírito de
 * `flightOffset.ts`/`dropOffset.ts`/`orbitOffset.ts`: lê só
 * `instance.casterOffset` (já resolvido por `anchor.ts`, mesma fonte que
 * `flightOffset.ts` usa) + `payload.flightMs`/`curveLateral`/
 * `curveVertical`. Sem os três primeiros, devolve zero — nunca muda quem
 * não pediu curva (Fire Ball/Soul Strike ANTES desta skill nunca passavam
 * `curveLateral`, continuam voando reto).
 *
 * Envelope `sin(π·u)` — zero nas DUAS pontas (nasce alinhado com a ponta do
 * cajado, chega exatamente no alvo), pico no meio do voo: é o "abre e
 * depois converge" pedido, sem nenhum sistema de path novo. `curveLateral`
 * já vem PRONTO do chamador com sinal+magnitude (tipicamente
 * `normalizedIndex * curveAmount` — `-1`=esquerda, `0`=centro, `+1`=direita,
 * calculado uma vez no driver a partir do índice do hit, nunca por quadro).
 *
 * A direção "lateral" é sempre relativa à reta caster→alvo (perpendicular a
 * `casterOffset` no plano XZ), nunca ao eixo mundial X — a skill funciona
 * igual não importa pra onde o personagem esteja olhando (pedido item 17).
 */
export function computeCurveOffset(instance: VfxInstanceRuntime, elapsedMs: number): CurveOffset {
  const flightMs = instance.spawnOptions.payload?.flightMs;
  if (typeof flightMs !== "number" || flightMs <= 0 || !instance.casterOffset) return ZERO;
  const lateral = Number(instance.spawnOptions.payload?.curveLateral ?? 0);
  const vertical = Number(instance.spawnOptions.payload?.curveVertical ?? 0);
  if (lateral === 0 && vertical === 0) return ZERO;

  const u = Math.max(0, Math.min(1, elapsedMs / flightMs));
  const env = Math.sin(Math.PI * u);

  const { x: cx, z: cz } = instance.casterOffset;
  const len = Math.hypot(cx, cz) || 1;
  // forward = direção caster→alvo (casterOffset aponta alvo→caster, então
  // o sentido do voo é o oposto, normalizado).
  const fx = -cx / len;
  const fz = -cz / len;
  // lateral = perpendicular de `forward` no plano XZ (rotação de 90°) —
  // convenção fixa (nunca recalculada por sinal aleatório): índice negativo
  // sai por um lado, positivo pelo outro, sempre o MESMO lado entre casts.
  const lx = -fz;
  const lz = fx;

  return {
    x: lx * lateral * env,
    y: vertical * env,
    z: lz * lateral * env,
  };
}
