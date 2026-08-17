import type { VfxAnimation } from "./types";

/**
 * Playback de frames — pura função do tempo, sem estado próprio (o
 * chamador guarda `elapsedMs`, este módulo só resolve QUAL frame mostrar).
 * Mesmo formato para `once`/`loop`/`pingpong` (item 19 do pedido).
 */
export interface VfxFrameResult {
  frameName: string;
  frameIndex: number;
  /** true quando `mode:"once"` já passou do último frame — quem chama usa
   * isto pra decidir fim de vida/transição, nunca um segundo timer. */
  finished: boolean;
}

export function computeFrame(anim: VfxAnimation, elapsedMs: number): VfxFrameResult {
  const count = anim.frames.length;
  if (count === 0) return { frameName: "", frameIndex: -1, finished: true };
  const frameDurationMs = 1000 / Math.max(1, anim.fps);
  const rawIndex = Math.floor(elapsedMs / frameDurationMs);

  if (anim.mode === "once") {
    const clamped = Math.min(count - 1, Math.max(0, rawIndex));
    return { frameName: anim.frames[clamped]!, frameIndex: clamped, finished: rawIndex >= count };
  }

  if (anim.mode === "pingpong") {
    const cycle = (count - 1) * 2 || 1;
    const pos = rawIndex % cycle;
    const index = pos < count ? pos : cycle - pos;
    return { frameName: anim.frames[index]!, frameIndex: index, finished: false };
  }

  // loop
  const index = ((rawIndex % count) + count) % count;
  return { frameName: anim.frames[index]!, frameIndex: index, finished: false };
}

/** duração de um ciclo completo, em ms — `Infinity` para `loop`/`pingpong`
 * (não têm fim natural; quem controla a vida é `lifetimeMs`/coalescência,
 * não a animação). */
export function animationCycleMs(anim: VfxAnimation): number {
  if (anim.mode !== "once") return Number.POSITIVE_INFINITY;
  return (anim.frames.length / Math.max(1, anim.fps)) * 1000;
}
