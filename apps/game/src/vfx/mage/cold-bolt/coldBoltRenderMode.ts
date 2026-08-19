import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import {
  COLD_BOLT_IMPACT_GPU_DEF,
  COLD_BOLT_CAST_VFX_ID,
  coldBoltCastGpuDef,
  coldBoltProjectileGpuDef,
  coldBoltImpactBurstGpuDef,
  type ColdBoltGpuTier,
} from "./coldBoltVfxDefGpu";
import { useVfxQuality, getVfxQualityTier } from "../../vfxQualityStore";
import "./coldBoltDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU + tier de qualidade pra Cold Bolt (reconstrução
 * 2026-08-19-d) — MESMO padrão de `fire-lance/fireLanceRenderMode.ts`,
 * ver aquele arquivo pro raciocínio completo (config GLOBAL de qualidade,
 * override de dev que nunca persiste, cast re-registrado sob 1 id estável
 * a cada troca de tier). Não duplicado aqui.
 */
export type ColdBoltRenderMode = "dom" | "gpu";

const ALL_TIERS: readonly ColdBoltGpuTier[] = ["low", "medium", "high"];
defineVfx(COLD_BOLT_IMPACT_GPU_DEF);
for (const t of ALL_TIERS) {
  defineVfx(coldBoltProjectileGpuDef(t));
  defineVfx(coldBoltImpactBurstGpuDef(t));
}

let mode: ColdBoltRenderMode = "gpu";
let devTierOverride: ColdBoltGpuTier | null = null;

export function coldBoltQualityTier(): ColdBoltGpuTier {
  return devTierOverride ?? getVfxQualityTier();
}

function applyCastTier(): void {
  defineVfx(coldBoltCastGpuDef(coldBoltQualityTier()));
}

export function setColdBoltRenderMode(next: ColdBoltRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_COLDBOLT", "impact", COLD_BOLT_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_COLDBOLT", "cast", COLD_BOLT_CAST_VFX_ID);
  } else {
    unbindSkillVfx("MG_COLDBOLT", "impact");
    unbindSkillVfx("MG_COLDBOLT", "cast");
  }
}

export function coldBoltRenderMode(): ColdBoltRenderMode {
  return mode;
}

export function setColdBoltQualityTier(next: ColdBoltGpuTier): void {
  devTierOverride = next;
  applyCastTier();
}

export function clearColdBoltQualityOverride(): void {
  devTierOverride = null;
  applyCastTier();
}

setColdBoltRenderMode(mode); // aplica o padrão de produção no module-load
applyCastTier(); // registra o cast pro tier efetivo inicial (config global, default "high")

useVfxQuality.subscribe(() => {
  if (devTierOverride === null) applyCastTier();
});

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __coldBoltRenderBench?: unknown }).__coldBoltRenderBench = {
    set: setColdBoltRenderMode,
    get: coldBoltRenderMode,
    setTier: setColdBoltQualityTier,
    getTier: coldBoltQualityTier,
    clearTierOverride: clearColdBoltQualityOverride,
  };
}
