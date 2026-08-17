import { defineVfx } from "../../core/registry";
import type { VfxDefinition } from "../../core/types";
import { THUNDER_STORM_CAST_GPU_DEF, THUNDER_STORM_IMPACT_GPU_DEF } from "./thunderStormVfxDefGpu";
import "./thunderStormDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU pra Thunder Storm — mesmo padrão de `fireBallRenderMode.ts`
 * /`oracleRenderMode.ts`/`fireWallRenderMode.ts`. `thunderStormVfxDef.tsx`
 * (DOM real) nunca importado aqui. Cast+impact trocam JUNTOS (um só
 * `mode`) — não faz sentido testar "cast GPU + impact DOM" em produção.
 *
 * **GPU é o padrão de produção** — aplicado no module-load abaixo (troca
 * Light Bolt junto, que compartilha `thunder_storm_cast`).
 */
const THUNDER_STORM_CAST_DOM_DEF: VfxDefinition = {
  id: "thunder_storm_cast",
  renderer: "dom",
  anchor: "caster-tip",
  dom: { art: "thunder_storm_cast" },
};
const THUNDER_STORM_IMPACT_DOM_DEF: VfxDefinition = {
  id: "thunder_storm_impact",
  renderer: "dom",
  anchor: "entity",
  dom: { art: "thunder_storm_impact" },
  coalesce: { by: "target", windowMs: 400 },
};

export type ThunderStormRenderMode = "dom" | "gpu";

let mode: ThunderStormRenderMode = "gpu";

export function setThunderStormRenderMode(next: ThunderStormRenderMode): void {
  mode = next;
  defineVfx(next === "dom" ? THUNDER_STORM_CAST_DOM_DEF : THUNDER_STORM_CAST_GPU_DEF);
  defineVfx(next === "dom" ? THUNDER_STORM_IMPACT_DOM_DEF : THUNDER_STORM_IMPACT_GPU_DEF);
}

export function thunderStormRenderMode(): ThunderStormRenderMode {
  return mode;
}

setThunderStormRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __thunderStormRenderBench?: unknown }).__thunderStormRenderBench = {
    set: setThunderStormRenderMode,
    get: thunderStormRenderMode,
  };
}
