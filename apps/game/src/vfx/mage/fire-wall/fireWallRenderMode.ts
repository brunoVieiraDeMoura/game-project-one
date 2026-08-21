import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { fireWallCellGpuDef, fireWallImpactGpuDef, type FireWallGpuTier } from "./fireWallVfxDefGpu";
import { useVfxQuality, getVfxQualityTier } from "../../vfxQualityStore";
import type { VfxDefinition } from "../../core/types";

/**
 * Flag DOM↔GPU + tier de qualidade pra Fire Wall — MESMO padrão de
 * `fireBallRenderMode.ts`: `applyTier()` re-registra AMBAS as composições
 * (célula+impacto) sob os MESMOS ids estáveis (`fire_wall`/
 * `fire_wall_impact`) toda vez que a config GLOBAL (`vfxQualityStore.ts`)
 * muda; override de dev tem prioridade enquanto durar.
 *
 * `fireWallVfxDef.tsx` (a versão DOM real, produção) NUNCA é importado/
 * tocado aqui — só re-registra a MESMA `VfxDefinition` "fire_wall" sob outra
 * receita, exatamente como sempre. `fire_wall_impact` é NOVO nesta rodada
 * (a versão DOM nunca teve reação de impacto própria — Fire Wall sempre
 * caiu no flash genérico/nada, ver docblock antigo de `fireWallVfxDef.tsx`:
 * "sem camada dom, Fire Wall não tem números de dano próprios") — por isso
 * só é vinculado em modo GPU; modo DOM explicitamente desliga o binding, não
 * ganha um efeito que nunca existiu na versão de produção real.
 *
 * **GPU é o padrão de produção**; tier default = `"high"` (default da store
 * global, preserva o visual mais cheio pra quem nunca abriu Configurações).
 */
export type FireWallRenderMode = "dom" | "gpu";

let mode: FireWallRenderMode = "gpu";
let devTierOverride: FireWallGpuTier | null = null;

/** tier EFETIVO — override de dev vence, senão a config global. */
export function fireWallQualityTier(): FireWallGpuTier {
  return devTierOverride ?? getVfxQualityTier();
}

/** reaplica AMBAS as composições (célula+impacto) pro tier efetivo atual —
 * chamado no module-load, em toda mudança da store global, e em todo
 * `setFireWallQualityTier` de dev. Só importa em modo GPU (DOM não tem
 * tier); chamado de qualquer forma, sem custo. */
function applyTier(): void {
  const tier = fireWallQualityTier();
  defineVfx(fireWallCellGpuDef(tier));
  defineVfx(fireWallImpactGpuDef(tier));
}

const FIRE_WALL_DOM_DEF: VfxDefinition = {
  id: "fire_wall",
  renderer: "dom",
  anchor: "cell",
  dom: { art: "fire_wall" },
};

export function setFireWallRenderMode(next: FireWallRenderMode): void {
  mode = next;
  bindSkillVfx("MG_FIREWALL", "area", "fire_wall");
  if (next === "gpu") {
    bindSkillVfx("MG_FIREWALL", "impact", "fire_wall_impact");
    applyTier();
  } else {
    defineVfx(FIRE_WALL_DOM_DEF);
    unbindSkillVfx("MG_FIREWALL", "impact");
  }
}

export function fireWallRenderMode(): FireWallRenderMode {
  return mode;
}

/** override de DEV — nunca escreve na store global. */
export function setFireWallQualityTier(next: FireWallGpuTier): void {
  devTierOverride = next;
  if (mode === "gpu") applyTier();
}

/** volta a seguir a config global (some o override de dev). */
export function clearFireWallQualityOverride(): void {
  devTierOverride = null;
  if (mode === "gpu") applyTier();
}

setFireWallRenderMode(mode); // aplica o padrão de produção no module-load

// reaplica sempre que a config GLOBAL mudar — só quando não há override de
// dev ativo (dev tem prioridade explícita enquanto durar).
useVfxQuality.subscribe(() => {
  if (devTierOverride === null && mode === "gpu") applyTier();
});

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __fireWallRenderBench?: unknown }).__fireWallRenderBench = {
    set: setFireWallRenderMode,
    get: fireWallRenderMode,
    setTier: setFireWallQualityTier,
    getTier: fireWallQualityTier,
    clearTierOverride: clearFireWallQualityOverride,
  };
}
