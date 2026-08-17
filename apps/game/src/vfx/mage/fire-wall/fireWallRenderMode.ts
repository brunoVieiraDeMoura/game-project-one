import { defineVfx } from "../../core/registry";
import type { VfxDefinition } from "../../core/types";
import { FIRE_WALL_GPU_DEF } from "./fireWallVfxDefGpu";

/**
 * Flag DOM↔GPU pra Fire Wall, MESMO padrão de `fire-ball/fireBallRenderMode.
 * ts`/`oracle/oracleRenderMode.ts` — `fireWallVfxDef.tsx` (a versão DOM
 * real, em produção) nunca é importado/tocado aqui; `defineVfx` "registra
 * OU SUBSTITUI" a mesma `VfxDefinition` id (`fire_wall`), então trocar de
 * modo só troca a receita de desenho, nunca dano/duração/rede (área
 * continua 100% decidida pelo servidor, `skill:ground`/`skill:ground-gone`).
 *
 * **GPU é o padrão de produção** — aplicado no module-load abaixo.
 */
const FIRE_WALL_DOM_DEF: VfxDefinition = {
  id: "fire_wall",
  renderer: "dom",
  anchor: "cell",
  dom: { art: "fire_wall" },
};

export type FireWallRenderMode = "dom" | "gpu";

let mode: FireWallRenderMode = "gpu";

export function setFireWallRenderMode(next: FireWallRenderMode): void {
  mode = next;
  defineVfx(next === "dom" ? FIRE_WALL_DOM_DEF : FIRE_WALL_GPU_DEF);
}

export function fireWallRenderMode(): FireWallRenderMode {
  return mode;
}

setFireWallRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __fireWallRenderBench?: unknown }).__fireWallRenderBench = {
    set: setFireWallRenderMode,
    get: fireWallRenderMode,
  };
}
