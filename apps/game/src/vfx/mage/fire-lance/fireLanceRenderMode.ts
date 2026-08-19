import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import {
  FIRE_LANCE_IMPACT_GPU_DEF,
  FIRE_LANCE_CAST_VFX_ID,
  fireLanceCastGpuDef,
  fireLanceProjectileGpuDef,
  fireLanceImpactBurstGpuDef,
  type FireLanceGpuTier,
} from "./fireLanceVfxDefGpu";
import { useVfxQuality, getVfxQualityTier } from "../../vfxQualityStore";
import "./fireLanceDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU + tier de qualidade pra Fire Lance (reconstrução
 * 2026-08-19-b/c) — MESMO padrão bind/unbind de sempre pro impact(dom)/cast,
 * mais um segundo eixo (tier) exclusivo do projétil/burst/cast dedicados,
 * agora alimentado pela config GLOBAL de qualidade
 * (`vfx/vfxQualityStore.ts`, "Configurações → Qualidade dos efeitos") em
 * vez de um estado local só desta skill.
 *
 * As 3 composições de projétil/burst (`fire_lance_bolt_<tier>`/
 * `fire_lance_impact_burst_<tier>`) são registradas TODAS de uma vez, ids
 * distintos por tier — o driver (`fireLanceMultiHit.ts: spawnFireLanceHits`)
 * escolhe qual id tocar A CADA CHAMADA lendo `fireLanceQualityTier()`,
 * nunca troca registro em runtime pra essas duas.
 *
 * O CAST é diferente: só existe UM id estável (`FIRE_LANCE_CAST_VFX_ID`),
 * porque `bindSkillVfx("MG_FIREBOLT","cast",...)` é uma ligação ESTÁTICA
 * (aegis→vfxId) — trocar de tier precisa RE-REGISTRAR a receita sob o
 * MESMO id (`defineVfx` substitui, mesmo padrão de `oracleRenderMode.ts`),
 * por isso este módulo assina `useVfxQuality` e reaplica a cada mudança.
 *
 * **GPU é o padrão de produção**; tier default = `"high"` (mesmo default
 * de `vfxQualityStore.ts`, preserva o visual de sempre pra quem nunca abriu
 * Configurações). `window.__fireLanceRenderBench.setTier(...)` continua
 * disponível em dev — um OVERRIDE LOCAL que vence a config global (só
 * neste módulo, nunca escreve na store — não some ao trocar de tier na UI,
 * mas também nunca é persistido), pra comparação A/B sem depender da UI.
 */
export type FireLanceRenderMode = "dom" | "gpu";

const ALL_TIERS: readonly FireLanceGpuTier[] = ["low", "medium", "high"];
defineVfx(FIRE_LANCE_IMPACT_GPU_DEF);
for (const t of ALL_TIERS) {
  defineVfx(fireLanceProjectileGpuDef(t));
  defineVfx(fireLanceImpactBurstGpuDef(t));
}

let mode: FireLanceRenderMode = "gpu";
let devTierOverride: FireLanceGpuTier | null = null;

/** tier EFETIVO — override de dev vence, senão a config global. Lido pelo
 * driver (`fireLanceMultiHit.ts`) em CADA cast, nunca cacheado. */
export function fireLanceQualityTier(): FireLanceGpuTier {
  return devTierOverride ?? getVfxQualityTier();
}

/** reaplica a composição do CAST pro tier efetivo ATUAL — chamado no
 * module-load, em toda mudança da store global, e em todo
 * `setFireLanceQualityTier` de dev. */
function applyCastTier(): void {
  defineVfx(fireLanceCastGpuDef(fireLanceQualityTier()));
}

export function setFireLanceRenderMode(next: FireLanceRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_FIREBOLT", "impact", FIRE_LANCE_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_FIREBOLT", "cast", FIRE_LANCE_CAST_VFX_ID);
  } else {
    unbindSkillVfx("MG_FIREBOLT", "impact");
    unbindSkillVfx("MG_FIREBOLT", "cast");
  }
}

export function fireLanceRenderMode(): FireLanceRenderMode {
  return mode;
}

/** override de DEV — nunca escreve na store global (`window.
 * __fireLanceRenderBench.setTier`, comparação A/B sem afetar a preferência
 * persistida do jogador). */
export function setFireLanceQualityTier(next: FireLanceGpuTier): void {
  devTierOverride = next;
  applyCastTier();
}

/** volta a seguir a config global (some o override de dev). */
export function clearFireLanceQualityOverride(): void {
  devTierOverride = null;
  applyCastTier();
}

setFireLanceRenderMode(mode); // aplica o padrão de produção no module-load
applyCastTier(); // registra o cast pro tier efetivo inicial (config global, default "high")

// reaplica o CAST sempre que a config GLOBAL mudar — só quando não há
// override de dev ativo (dev tem prioridade explícita enquanto durar).
useVfxQuality.subscribe(() => {
  if (devTierOverride === null) applyCastTier();
});

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __fireLanceRenderBench?: unknown }).__fireLanceRenderBench = {
    set: setFireLanceRenderMode,
    get: fireLanceRenderMode,
    setTier: setFireLanceQualityTier,
    getTier: fireLanceQualityTier,
    clearTierOverride: clearFireLanceQualityOverride,
  };
}
