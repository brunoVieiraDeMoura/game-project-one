import type { VfxInstanceRuntime } from "../types";

/**
 * Alongamento genérico de "queda vertical" (Fire Lance, reconstrução
 * 2026-08-19-b: "losango de fogo grande, alonga durante a queda") — MESMO
 * espírito de `dropOffset.ts`/`flightOffset.ts`/`orbitOffset.ts`: zero `if
 * FIRE_LANCE` em renderer nenhum, lê só `payload.fallMs` (o MESMO campo que
 * `dropOffset.ts` já usa pra posição) + `payload.stretchFrom`/`stretchTo`.
 * Sem os três, devolve `1` (quad normal) — nunca muda quem não pediu stretch.
 *
 * Curva DIFERENTE de `dropOffset` de propósito: a posição usa `smoothstep`
 * (ease simétrico, começa e termina devagar — natural pra um objeto que
 * PARTE do repouso E pousa suave); o stretch usa `u*u` (ease-in puro,
 * acelera até o fim) — a lança fica cada vez MAIS alongada conforme "ganha
 * velocidade" visualmente, não desacelera perto do chão como a posição.
 * `aStretch` (`instancedBillboardBase.ts`) aplica isto no eixo VERTICAL DA
 * TELA, depois da rotação — independente do losango estar rotacionado 45°
 * ou não.
 */
export function computeDropStretch(instance: VfxInstanceRuntime, elapsedMs: number): number {
  const fallMs = instance.spawnOptions.payload?.fallMs;
  if (typeof fallMs !== "number" || fallMs <= 0) return 1;
  const stretchFrom = Number(instance.spawnOptions.payload?.stretchFrom ?? 1);
  const stretchTo = Number(instance.spawnOptions.payload?.stretchTo ?? 1);
  const u = Math.max(0, Math.min(1, elapsedMs / fallMs));
  const eased = u * u;
  return stretchFrom + (stretchTo - stretchFrom) * eased;
}
