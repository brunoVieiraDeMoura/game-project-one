/**
 * Distance LOD (Fase 5, item 12 do pedido) — mecanismo DISTINTO de frustum
 * culling e de performance budget (item 9/10: "são mecanismos diferentes e
 * não devem ser tratados como uma única coisa"). Frustum culling decide
 * "desenha ou não desenha"; LOD decide "quão detalhado", pra quem CONTINUA
 * visível mas está longe.
 *
 * `manager.ts` computa `distância(câmera, instância)` todo quadro e escreve
 * o tier resultante em `VfxInstanceRuntime.lod` — SEMPRE, sem custo condicional,
 * porque é só uma classificação (não hysteresis, não liga/desliga nada,
 * zero risco de "flapping" entre quadros).
 *
 * `DEFAULT_LOD_THRESHOLDS` usa `Infinity` nos dois limiares — o tier
 * resultante é SEMPRE `"full"` até alguém chamar `manager.setLodThresholds()`
 * com números reais. Pedido explícito do usuário (2026-08-16): "não quero
 * ainda reduzir visual arbitrariamente nem calibrar números no chute — o
 * budget/LOD deve existir para medir e calibrar depois". Nenhum renderer
 * consome `lod` ainda — o campo existe, é computado corretamente, e fica
 * pronto pra ligar numa migração futura sem mexer no manager de novo.
 */
export type VfxLodTier = "full" | "reduced" | "core";

export interface VfxLodThresholds {
  /** distância (unidades de mundo) a partir da qual o tier vira "reduced" */
  reducedAtDistance: number;
  /** distância a partir da qual o tier vira "core" — sempre >= reducedAtDistance */
  coreAtDistance: number;
}

export const DEFAULT_LOD_THRESHOLDS: VfxLodThresholds = {
  reducedAtDistance: Infinity,
  coreAtDistance: Infinity,
};

export function lodTierFor(distance: number, thresholds: VfxLodThresholds): VfxLodTier {
  if (distance >= thresholds.coreAtDistance) return "core";
  if (distance >= thresholds.reducedAtDistance) return "reduced";
  return "full";
}
