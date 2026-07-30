import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Quais skills o jogador colocou em cada slot da barra.
 *
 * No Ragnarok a barra é ARRUMADA PELO JOGADOR (arrasta da janela de
 * habilidades), não preenchida sozinha — e a arrumação sobrevive ao relog. Aqui
 * ela mora no navegador: o rAthena guarda hotkeys no servidor
 * (ZC.SHORTCUT_KEY_LIST), mas isso é um passo à frente; enquanto não estiver
 * ligado, guardar local é melhor que reembaralhar a cada login.
 *
 * 27 slots = 3 páginas de 9, como no RO.
 */
export const SKILL_SLOTS = 27;

interface SkillBarState {
  /** índice do slot → id da skill (0 = vazio) */
  slots: number[];
  assign: (slot: number, skillId: number) => void;
  clear: (slot: number) => void;
  swap: (from: number, to: number) => void;
  reset: () => void;
}

const EMPTY = Array.from({ length: SKILL_SLOTS }, () => 0);

export const useSkillBar = create<SkillBarState>()(
  persist(
    (set) => ({
      slots: EMPTY,

      assign: (slot, skillId) =>
        set((s) => {
          const slots = [...s.slots];
          // a mesma skill não fica em dois lugares (o RO também move, não copia)
          const previous = slots.indexOf(skillId);
          if (previous !== -1) slots[previous] = 0;
          slots[slot] = skillId;
          return { slots };
        }),

      clear: (slot) =>
        set((s) => {
          const slots = [...s.slots];
          slots[slot] = 0;
          return { slots };
        }),

      swap: (from, to) =>
        set((s) => {
          const slots = [...s.slots];
          const tmp = slots[to] ?? 0;
          slots[to] = slots[from] ?? 0;
          slots[from] = tmp;
          return { slots };
        }),

      reset: () => set({ slots: EMPTY }),
    }),
    { name: "ragnarok:skillbar" },
  ),
);
