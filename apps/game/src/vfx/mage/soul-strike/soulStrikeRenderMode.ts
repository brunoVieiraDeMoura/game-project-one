import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import {
  SOUL_STRIKE_IMPACT_GPU_DEF,
  SOUL_STRIKE_CAST_VFX_ID,
  soulStrikeCastGpuDef,
  soulStrikeProjectileGpuDef,
  soulStrikeImpactBurstGpuDef,
  type SoulStrikeGpuTier,
} from "./soulStrikeVfxDefGpu";
import { useVfxQuality, getVfxQualityTier } from "../../vfxQualityStore";
import "./soulStrikeDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU + tier de qualidade pra Esferas Espirituais/Soul Strike
 * (reconstrução 2026-08-19-z) — MESMO padrão bind/unbind + tier de
 * `fire-lance/fireLanceRenderMode.ts` (ver aquele arquivo pro raciocínio
 * completo, não duplicado aqui).
 *
 * As 3 composições de esfera/burst (`soul_strike_sphere_<tier>`/
 * `soul_strike_impact_burst_<tier>`) são registradas TODAS de uma vez, ids
 * distintos por tier — o driver (`soulStrikeMultiHit.ts: spawnSoulStrikeHits`)
 * escolhe qual id tocar A CADA CHAMADA lendo `soulStrikeQualityTier()`.
 *
 * O CAST é diferente: só existe UM id estável (`SOUL_STRIKE_CAST_VFX_ID`),
 * porque `bindSkillVfx("MG_SOULSTRIKE","cast",...)` é uma ligação ESTÁTICA
 * — trocar de tier precisa RE-REGISTRAR a receita sob o MESMO id, por isso
 * este módulo assina `useVfxQuality` e reaplica a cada mudança.
 *
 * **GPU é o padrão de produção**; tier default = `"high"` (default da
 * store global). `window.__soulStrikeRenderBench` continua disponível em
 * dev pra comparar DOM/GPU e forçar tier sem depender da UI.
 */
export type SoulStrikeRenderMode = "dom" | "gpu";

const ALL_TIERS: readonly SoulStrikeGpuTier[] = ["low", "medium", "high"];
defineVfx(SOUL_STRIKE_IMPACT_GPU_DEF);
for (const t of ALL_TIERS) {
  defineVfx(soulStrikeProjectileGpuDef(t));
  defineVfx(soulStrikeImpactBurstGpuDef(t));
}

let mode: SoulStrikeRenderMode = "gpu";
let devTierOverride: SoulStrikeGpuTier | null = null;

/** tier EFETIVO — override de dev vence, senão a config global. Lido pelo
 * driver em CADA cast, nunca cacheado. */
export function soulStrikeQualityTier(): SoulStrikeGpuTier {
  return devTierOverride ?? getVfxQualityTier();
}

/** reaplica a composição do CAST pro tier efetivo ATUAL. */
function applyCastTier(): void {
  defineVfx(soulStrikeCastGpuDef(soulStrikeQualityTier()));
}

export function setSoulStrikeRenderMode(next: SoulStrikeRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_SOULSTRIKE", "impact", SOUL_STRIKE_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_SOULSTRIKE", "cast", SOUL_STRIKE_CAST_VFX_ID);
  } else {
    unbindSkillVfx("MG_SOULSTRIKE", "impact");
    unbindSkillVfx("MG_SOULSTRIKE", "cast");
  }
}

export function soulStrikeRenderMode(): SoulStrikeRenderMode {
  return mode;
}

/** override de DEV — nunca escreve na store global. */
export function setSoulStrikeQualityTier(next: SoulStrikeGpuTier): void {
  devTierOverride = next;
  applyCastTier();
}

/** volta a seguir a config global (some o override de dev). */
export function clearSoulStrikeQualityOverride(): void {
  devTierOverride = null;
  applyCastTier();
}

setSoulStrikeRenderMode(mode); // aplica o padrão de produção no module-load
applyCastTier(); // registra o cast pro tier efetivo inicial (config global, default "high")

// reaplica o CAST sempre que a config GLOBAL mudar — só quando não há
// override de dev ativo.
useVfxQuality.subscribe(() => {
  if (devTierOverride === null) applyCastTier();
});

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __soulStrikeRenderBench?: unknown }).__soulStrikeRenderBench = {
    set: setSoulStrikeRenderMode,
    get: soulStrikeRenderMode,
    setTier: setSoulStrikeQualityTier,
    getTier: soulStrikeQualityTier,
    clearTierOverride: clearSoulStrikeQualityOverride,
  };
}
