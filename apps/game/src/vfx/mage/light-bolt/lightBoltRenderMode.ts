import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import {
  LIGHT_BOLT_IMPACT_GPU_DEF,
  lightBoltProjectileGpuDef,
  lightBoltImpactBurstGpuDef,
  LIGHT_BOLT_FRAME_COUNT,
  type LightBoltGpuTier,
} from "./lightBoltVfxDefGpu";
import { getVfxQualityTier } from "../../vfxQualityStore";
import "./lightBoltDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU + tier de qualidade pra Eletrocutar/Light Bolt (reconstrução
 * 2026-08-19-f) — MESMO padrão de `fire-lance/fireLanceRenderMode.ts`/
 * `cold-bolt/coldBoltRenderMode.ts` (ver aquele arquivo pro raciocínio
 * completo, não duplicado aqui) pro IMPACT (projétil+burst, 3 tiers,
 * registrados de uma vez, driver escolhe o id por chamada).
 *
 * O CAST é DIFERENTE das outras duas skills: continua 100% compartilhado
 * com Thunder Storm (`thunder_storm_cast`, `bindSkillVfx` de sempre) —
 * Eletrocutar NUNCA teve identidade de cast própria (a "nuvem elétrica na
 * ponta do cajado" já É a mesma de Thunder Storm por design desde a
 * migração original) e este pedido não pediu pra mudar isso, só o IMPACT
 * (queda + acerto na cabeça). Sem `applyCastTier`/re-registro nenhum aqui
 * por causa disso.
 */
export type LightBoltRenderMode = "dom" | "gpu";

const ALL_TIERS: readonly LightBoltGpuTier[] = ["low", "medium", "high"];
defineVfx(LIGHT_BOLT_IMPACT_GPU_DEF);
for (const t of ALL_TIERS) {
  // 1 definição por tier×quadro do atlas (2026-08-19-r) — o driver
  // (`lightBoltMultiHit.ts`) sorteia qual quadro tocar por HIT, tudo
  // pré-computado aqui no module-load (nenhum custo de runtime além de
  // escolher um índice).
  for (let f = 0; f < LIGHT_BOLT_FRAME_COUNT; f++) defineVfx(lightBoltProjectileGpuDef(t, f));
  defineVfx(lightBoltImpactBurstGpuDef(t));
}

let mode: LightBoltRenderMode = "gpu";
let devTierOverride: LightBoltGpuTier | null = null;

export function lightBoltQualityTier(): LightBoltGpuTier {
  return devTierOverride ?? getVfxQualityTier();
}

export function setLightBoltRenderMode(next: LightBoltRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_LIGHTNINGBOLT", "impact", LIGHT_BOLT_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_LIGHTNINGBOLT", "cast", "thunder_storm_cast");
  } else {
    unbindSkillVfx("MG_LIGHTNINGBOLT", "impact");
    unbindSkillVfx("MG_LIGHTNINGBOLT", "cast");
  }
}

export function lightBoltRenderMode(): LightBoltRenderMode {
  return mode;
}

export function setLightBoltQualityTier(next: LightBoltGpuTier): void {
  devTierOverride = next;
}

export function clearLightBoltQualityOverride(): void {
  devTierOverride = null;
}

setLightBoltRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __lightBoltRenderBench?: unknown }).__lightBoltRenderBench = {
    set: setLightBoltRenderMode,
    get: lightBoltRenderMode,
    setTier: setLightBoltQualityTier,
    getTier: lightBoltQualityTier,
    clearTierOverride: clearLightBoltQualityOverride,
  };
}
