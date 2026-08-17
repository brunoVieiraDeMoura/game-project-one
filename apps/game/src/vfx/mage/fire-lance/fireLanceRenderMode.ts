import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { FIRE_LANCE_IMPACT_GPU_DEF, FIRE_LANCE_CAST_GPU_DEF } from "./fireLanceVfxDefGpu";
import "./fireLanceDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU pra Fire Lance — MESMO padrão bind/unbind de
 * `cold-bolt/coldBoltRenderMode.ts` (não está no Core hoje).
 *
 * **GPU é o padrão de produção** — aplicado no module-load abaixo.
 */
defineVfx(FIRE_LANCE_IMPACT_GPU_DEF);
defineVfx(FIRE_LANCE_CAST_GPU_DEF);

/**
 * Fragmento de fogo caindo: usa o fragmento GENÉRICO compartilhado
 * (`vfx/mage/multiHitShardImpact.ts: GENERIC_HIT_SHARD_ID`), cor derivada
 * do `element` REAL da skill (`Fire`, skill_db) — nenhum registro/bind
 * próprio aqui (refatoração "Generic Hit VFX", 2026-08-19).
 */
export type FireLanceRenderMode = "dom" | "gpu";

let mode: FireLanceRenderMode = "gpu";

export function setFireLanceRenderMode(next: FireLanceRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_FIREBOLT", "impact", FIRE_LANCE_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_FIREBOLT", "cast", FIRE_LANCE_CAST_GPU_DEF.id);
  } else {
    unbindSkillVfx("MG_FIREBOLT", "impact");
    unbindSkillVfx("MG_FIREBOLT", "cast");
  }
}

export function fireLanceRenderMode(): FireLanceRenderMode {
  return mode;
}

setFireLanceRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __fireLanceRenderBench?: unknown }).__fireLanceRenderBench = {
    set: setFireLanceRenderMode,
    get: fireLanceRenderMode,
  };
}
