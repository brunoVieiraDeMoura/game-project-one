import { create } from "zustand";

/**
 * Qual missão está sendo rastreada e qual está aberta na janela.
 *
 * Mora num store e não no estado da `QuestsWindow` porque DUAS telas precisam
 * concordar: o painel fixo da esquerda (`hud/QuestTracker`) e a janela (Alt+U).
 * Marcar no painel tem que acender na janela, e vice-versa.
 *
 * `rastreada` é UM id, não uma lista — é o que garante "só uma ativa por vez"
 * sem nenhuma checagem: rastrear outra simplesmente sobrescreve.
 */
interface QuestUiState {
  /** id da missão rastreada; `null` = nenhuma */
  rastreada: string | null;
  /** id da missão aberta na janela (o painel da esquerda também escolhe) */
  aberta: string | null;

  /** rastreia, ou desmarca se já era ela */
  rastrear: (id: string) => void;
  abrir: (id: string) => void;
  /** deixa de rastrear (usado pelo "Abandonar") */
  parar: (id: string) => void;
}

export const useQuestUi = create<QuestUiState>((set) => ({
  rastreada: null,
  aberta: null,

  rastrear: (id) => set((s) => ({ rastreada: s.rastreada === id ? null : id })),
  abrir: (aberta) => set({ aberta }),
  parar: (id) => set((s) => (s.rastreada === id ? { rastreada: null } : {})),
}));
