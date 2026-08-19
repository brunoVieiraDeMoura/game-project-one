import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { FROST_DIVER_IMPACT_GPU_DEF } from "./frostDiverVfxDefGpu";
import { COLD_BOLT_CAST_VFX_ID } from "../cold-bolt/coldBoltVfxDefGpu";

/**
 * Flag DOM↔GPU pra Frost Diver — MESMO padrão bind/unbind de Cold Bolt.
 *
 * Cast: Congelar sempre reaproveitou o cast de gelo da Cold Bolt de
 * propósito, mesma identidade (DOM: `vfx/SkillVfx.tsx: CAST_VFX.
 * MG_FROSTDIVER → ColdBoltCastFrost`) — em GPU o mesmo reuso continua,
 * agora apontando pro `cold_bolt_cast_gpu` já registrado em
 * `coldBoltRenderMode.ts` (2026-08-19). Nenhuma composição nova.
 *
 * **GPU é o padrão de produção** — aplicado no module-load abaixo.
 */
defineVfx(FROST_DIVER_IMPACT_GPU_DEF);

export type FrostDiverRenderMode = "dom" | "gpu";

let mode: FrostDiverRenderMode = "gpu";

export function setFrostDiverRenderMode(next: FrostDiverRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_FROSTDIVER", "impact", FROST_DIVER_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_FROSTDIVER", "cast", COLD_BOLT_CAST_VFX_ID);
  } else {
    unbindSkillVfx("MG_FROSTDIVER", "impact");
    unbindSkillVfx("MG_FROSTDIVER", "cast");
  }
}

export function frostDiverRenderMode(): FrostDiverRenderMode {
  return mode;
}

setFrostDiverRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __frostDiverRenderBench?: unknown }).__frostDiverRenderBench = {
    set: setFrostDiverRenderMode,
    get: frostDiverRenderMode,
  };
}
