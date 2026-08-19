import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { fireBallImpactGpuDef, fireBallCastGpuDef, type FireBallGpuTier } from "./fireBallVfxDefGpu";
import { useVfxQuality, getVfxQualityTier } from "../../vfxQualityStore";
import type { VfxDefinition } from "../../core/types";

/**
 * Flag DOM↔GPU + tier de qualidade pra Fire Ball (reconstrução 2026-08-19-v)
 * — Fire Ball NÃO é multi-hit (`HitCount:1`, verificado no `skill_db.yml`),
 * então não precisa do padrão "N ids por tier + driver escolhe a cada
 * chamada" que Fire Lance/Cold Bolt/Eletrocutar usam pro PROJÉTIL. 1 cast =
 * 1 instância inteira (projétil+trail+impacto+AoE, ver docblock de
 * `fireBallVfxDefGpu.tsx`), então basta o padrão que Fire Lance JÁ usa pro
 * próprio CAST (`fireLanceRenderMode.ts: applyCastTier`): 2 ids ESTÁVEIS
 * (`fireball_impact`/`fireball_cast`), `bindSkillVfx` fixo, e troca de tier
 * RE-REGISTRA a receita sob os MESMOS ids (`defineVfx` "registra OU
 * SUBSTITUI") toda vez que a config GLOBAL muda — nenhum driver novo, nenhum
 * `setTimeout`.
 *
 * `fireBallVfxDef.tsx` (a versão DOM real) NUNCA é importado/tocado por
 * este arquivo — só re-registra as MESMAS duas `VfxDefinition` sob outra
 * receita, exatamente como sempre.
 *
 * **GPU é o padrão de produção**; tier default = `"high"` (default da
 * store global, preserva o visual de sempre pra quem nunca abriu
 * Configurações). `window.__fireBallRenderBench` continua disponível em
 * dev pra comparar DOM/GPU e forçar tier sem depender da UI.
 */
export type FireBallRenderMode = "dom" | "gpu";

let mode: FireBallRenderMode = "gpu";
let devTierOverride: FireBallGpuTier | null = null;

/** tier EFETIVO — override de dev vence, senão a config global. */
export function fireBallQualityTier(): FireBallGpuTier {
  return devTierOverride ?? getVfxQualityTier();
}

/** reaplica AMBAS as composições (impacto+cast) pro tier efetivo atual —
 * chamado no module-load, em toda mudança da store global, e em todo
 * `setFireBallQualityTier` de dev. Só faz sentido em modo GPU (DOM não tem
 * tier); chamado de qualquer forma, sem custo — `defineVfx` de um id que o
 * modo DOM não usa não afeta nada visível. */
function applyTier(): void {
  const tier = fireBallQualityTier();
  defineVfx(fireBallImpactGpuDef(tier));
  defineVfx(fireBallCastGpuDef(tier));
}

const FIREBALL_FLIGHT_MS = 480;
const IMPACT_AT_MS = FIREBALL_FLIGHT_MS * 0.95;
const IMPACT_TAIL_MS = 700;

const FIREBALL_CAST_DOM_DEF: VfxDefinition = {
  id: "fireball_cast",
  renderer: "dom",
  anchor: "caster-tip",
  dom: { art: "fireball_cast" },
};

const FIREBALL_IMPACT_DOM_DEF: VfxDefinition = {
  id: "fireball_impact",
  renderer: "dom",
  anchor: "caster-to-target",
  dom: { art: "fireball_impact" },
  lifetimeMs: IMPACT_AT_MS + IMPACT_TAIL_MS,
};

export function setFireBallRenderMode(next: FireBallRenderMode): void {
  mode = next;
  bindSkillVfx("MG_FIREBALL", "cast", "fireball_cast");
  bindSkillVfx("MG_FIREBALL", "impact", "fireball_impact");
  if (next === "gpu") {
    applyTier();
  } else {
    defineVfx(FIREBALL_CAST_DOM_DEF);
    defineVfx(FIREBALL_IMPACT_DOM_DEF);
  }
}

export function fireBallRenderMode(): FireBallRenderMode {
  return mode;
}

/** override de DEV — nunca escreve na store global. */
export function setFireBallQualityTier(next: FireBallGpuTier): void {
  devTierOverride = next;
  if (mode === "gpu") applyTier();
}

/** volta a seguir a config global (some o override de dev). */
export function clearFireBallQualityOverride(): void {
  devTierOverride = null;
  if (mode === "gpu") applyTier();
}

setFireBallRenderMode(mode); // aplica o padrão de produção no module-load

// reaplica sempre que a config GLOBAL mudar — só quando não há override de
// dev ativo (dev tem prioridade explícita enquanto durar).
useVfxQuality.subscribe(() => {
  if (devTierOverride === null && mode === "gpu") applyTier();
});

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __fireBallRenderBench?: unknown }).__fireBallRenderBench = {
    set: setFireBallRenderMode,
    get: fireBallRenderMode,
    setTier: setFireBallQualityTier,
    getTier: fireBallQualityTier,
    clearTierOverride: clearFireBallQualityOverride,
  };
}
