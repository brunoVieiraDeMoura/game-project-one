import { defineVfx } from "../../core/registry";
import type { VfxDefinition } from "../../core/types";
import { GHOST_DOME_GPU_DEF } from "./ghostDomeVfxDefGpu";

/**
 * Flag DOM↔GPU pra Cúpula Fantasma — MESMO padrão de
 * `fire-ball/fireBallRenderMode.ts`/`fire-wall/fireWallRenderMode.ts`
 * (`defineVfx` registra OU SUBSTITUI a MESMA `VfxDefinition` id
 * "ghost_dome"). `ghostDomeVfxDef.tsx` (DOM real) nunca tocado aqui.
 *
 * **GPU é o padrão de produção** — aplicado no module-load abaixo.
 */
const GHOST_DOME_DOM_DEF: VfxDefinition = {
  id: "ghost_dome",
  renderer: "dom",
  anchor: "cell",
  dom: { art: "ghost_dome" },
};

export type GhostDomeRenderMode = "dom" | "gpu";

let mode: GhostDomeRenderMode = "gpu";

export function setGhostDomeRenderMode(next: GhostDomeRenderMode): void {
  mode = next;
  defineVfx(next === "dom" ? GHOST_DOME_DOM_DEF : GHOST_DOME_GPU_DEF);
}

export function ghostDomeRenderMode(): GhostDomeRenderMode {
  return mode;
}

setGhostDomeRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __ghostDomeRenderBench?: unknown }).__ghostDomeRenderBench = {
    set: setGhostDomeRenderMode,
    get: ghostDomeRenderMode,
  };
}
