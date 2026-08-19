import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Qualidade GLOBAL de VFX (pedido 2026-08-19-c: "não uma config isolada de
 * Fire Lance, uma config de qualidade de efeitos") — MESMO padrão de
 * `audio/audioSettingsStore.ts` (preferência de DISPOSITIVO/navegador,
 * `persist` em `localStorage` puro, sem o adapter `charAtual`: trocar de
 * personagem não deveria resetar o que o jogador ajustou).
 *
 * Hoje só Fire Lance lê isto (`fire-lance/fireLanceRenderMode.ts`) — os 3
 * nomes de tier (`"low"|"medium"|"high"`) são os MESMOS que
 * `fireLanceVfxDefGpu.tsx: TIER_SPECS`/`CAST_TIER_SPECS` já usavam antes
 * desta store existir (`FireLanceGpuTier` virou alias de `VfxQualityTier`,
 * nunca uma segunda enumeração). Uma skill nova com tiers próprios pode
 * ler daqui livremente — é exatamente o motivo desta store ser global e
 * não `fireLanceQualityStore.ts`.
 */
export type VfxQualityTier = "low" | "medium" | "high";

interface VfxQualityState {
  tier: VfxQualityTier;
  setTier: (t: VfxQualityTier) => void;
}

/** `"high"` — pedido explícito ("Default: HIGH, pra preservar o
 * comportamento visual atual"): quem nunca abriu Configurações continua
 * vendo exatamente o visual de produção de sempre. */
const DEFAULT_TIER: VfxQualityTier = "high";

export const useVfxQuality = create<VfxQualityState>()(
  persist(
    (set) => ({
      tier: DEFAULT_TIER,
      setTier: (t) => set({ tier: t }),
    }),
    {
      name: "ragnarok:vfx-quality",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ tier: s.tier }),
    },
  ),
);

/** leitura fora do React — mesmo padrão de `audio/audioSettingsStore.ts:
 * getMusicVolume`, pra módulo-singleton (`fireLanceRenderMode.ts`) não
 * precisar chamar `useVfxQuality.getState()` espalhado. */
export function getVfxQualityTier(): VfxQualityTier {
  return useVfxQuality.getState().tier;
}
