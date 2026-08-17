import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { STONE_CURSE_IMPACT_GPU_DEF, STONE_CURSE_CAST_GPU_DEF } from "./stoneCurseVfxDefGpu";

/**
 * Flag DOM↔GPU pra Stone Curse — MESMO padrão bind/unbind de Cold Bolt.
 * **GPU é o padrão de produção** — aplicado no module-load abaixo.
 */
defineVfx(STONE_CURSE_IMPACT_GPU_DEF);
defineVfx(STONE_CURSE_CAST_GPU_DEF);

export type StoneCurseRenderMode = "dom" | "gpu";

let mode: StoneCurseRenderMode = "gpu";

export function setStoneCurseRenderMode(next: StoneCurseRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_STONECURSE", "impact", STONE_CURSE_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_STONECURSE", "cast", STONE_CURSE_CAST_GPU_DEF.id);
  } else {
    unbindSkillVfx("MG_STONECURSE", "impact");
    unbindSkillVfx("MG_STONECURSE", "cast");
  }
}

export function stoneCurseRenderMode(): StoneCurseRenderMode {
  return mode;
}

setStoneCurseRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __stoneCurseRenderBench?: unknown }).__stoneCurseRenderBench = {
    set: setStoneCurseRenderMode,
    get: stoneCurseRenderMode,
  };
}
