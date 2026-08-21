/**
 * "Quão importante é atualizar/desenhar esta entidade AGORA" — módulo puro,
 * substrato compartilhado para LOD de animação (T3) e buckets de frequência
 * de entidade (T4), generalizando `vfx/core/budget.ts: priorityFor` (que
 * continua existindo e sendo o chamador do VFX — este módulo não o
 * substitui, ele extrai o que era específico de VFX pro que qualquer
 * consumidor de "distância → quão devagar posso atualizar isto" precisa).
 *
 * Mesma filosofia de `vfx/core/lod.ts`: computa SEMPRE, sem custo
 * condicional (é só uma classificação). Thresholds e taxas por default são
 * NO-OP (`Infinity` / sempre 60) até alguém calibrar com benchmark real —
 * pedido do usuário registrado em `vfx/core/lod.ts`: "não quero ainda
 * reduzir visual arbitrariamente nem calibrar números no chute".
 *
 * ## Por que só distância, sem um eixo separado de "tamanho em tela"
 *
 * A câmera deste jogo é over-the-shoulder de FOV fixo (`play/FollowCamera`)
 * com zoom por distância (scroll aproxima a CÂMERA, não muda o FOV). Todo
 * lugar que já precisa de "isto está perto o bastante para importar" mede
 * distância ATÉ A CÂMERA, não até o jogador (`net/NetEntity.tsx: visivel`,
 * `play/aimAssist.ts`) — então aproximar a câmera de um mob já encolhe a
 * distância-até-câmera dele exatamente como encolheria o tamanho dele em
 * tela. Um segundo eixo mediria a mesma coisa duas vezes.
 */

export type ImportanceTier = "full" | "reduced" | "core";

export interface ImportanceThresholds {
  /** distância (unidades de mundo, até a CÂMERA) a partir da qual vira "reduced" */
  reducedAtDistance: number;
  /** distância a partir da qual vira "core" — sempre >= reducedAtDistance */
  coreAtDistance: number;
}

export const DEFAULT_IMPORTANCE_THRESHOLDS: ImportanceThresholds = {
  reducedAtDistance: Infinity,
  coreAtDistance: Infinity,
};

export interface ImportanceInput {
  /** é a entidade do próprio jogador local — nunca degrada. */
  isSelf: boolean;
  /**
   * É o alvo selecionado (Tab/clique) OU está atacando o jogador local
   * (`net/ameacas.estaMeAtacando`) — nunca degrada, mesmo longe: é quem o
   * jogador está OLHANDO ou de quem está apanhando. Resolvido pelo
   * chamador, não lido daqui — mesmo padrão de `VfxPriorityInput` em
   * `vfx/core/budget.ts`, que também recebe booleano já decidido em vez de
   * importar o store.
   */
  isCritical: boolean;
  distanceToCamera: number;
}

export function importanceTierFor(
  input: ImportanceInput,
  thresholds: ImportanceThresholds = DEFAULT_IMPORTANCE_THRESHOLDS,
): ImportanceTier {
  if (input.isSelf || input.isCritical) return "full";
  if (input.distanceToCamera >= thresholds.coreAtDistance) return "core";
  if (input.distanceToCamera >= thresholds.reducedAtDistance) return "reduced";
  return "full";
}

/** taxa (Hz) por tier — cada consumidor (T3 animação, T4 plaquinha/barra)
 * tem a PRÓPRIA tabela, porque o custo por tier é diferente em cada um; isto
 * aqui é só o formato + o default seguro (todo tier a 60 Hz, ou seja,
 * nenhuma redução) até haver dado de benchmark para calibrar de verdade. */
export interface ImportanceRates {
  full: number;
  reduced: number;
  core: number;
}

export const DEFAULT_IMPORTANCE_RATES: ImportanceRates = { full: 60, reduced: 60, core: 60 };

export function updateRateFor(tier: ImportanceTier, rates: ImportanceRates = DEFAULT_IMPORTANCE_RATES): number {
  return rates[tier];
}

/**
 * Hz → intervalo em ms entre atualizações — o número que um acumulador de
 * `dt` (ref, nunca estado — mesmo padrão de `aVista` em `assets.ts`) compara
 * contra o que já se passou. `0`/negativo devolve `Infinity` (nunca
 * atualiza) em vez de `0`/dividir por zero, que faria "taxa zero" virar
 * "toda hora" em vez de "nunca".
 */
export function intervalMsFor(updateHz: number): number {
  return updateHz > 0 ? 1000 / updateHz : Infinity;
}
