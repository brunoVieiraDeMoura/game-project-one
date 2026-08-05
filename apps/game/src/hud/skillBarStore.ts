import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ATAQUE_BASICO_ID } from "../net/ataqueBasico";

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

/**
 * A barra NASCE com o Ataque Básico no primeiro slot.
 *
 * Ele é do cliente, não do rAthena, então não aparece na janela de habilidades
 * (que é montada a partir do que o servidor manda) e não haveria de onde
 * arrastá-lo. Deixá-lo posto é o que o torna alcançável; daí em diante ele se
 * move, troca e sai como qualquer outro, e a escolha persiste.
 */
function comAtaqueBasico(): number[] {
  const slots = [...EMPTY];
  slots[0] = ATAQUE_BASICO_ID;
  return slots;
}

export const useSkillBar = create<SkillBarState>()(
  persist(
    (set) => ({
      slots: comAtaqueBasico(),

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

      reset: () => set({ slots: comAtaqueBasico() }),
    }),
    {
      name: "ragnarok:skillbar",
      /**
       * Quem já tinha barra salva também ganha o Ataque Básico.
       *
       * Sem a migração, só quem instalasse o jogo do zero teria acesso a ele —
       * e a barra de quem já jogava ficaria sem nenhum caminho até a skill. Ele
       * entra no primeiro slot LIVRE para não atropelar o que a pessoa arrumou;
       * com a barra cheia, não entra (e aí ela pode abrir espaço à mão).
       */
      version: 1,
      migrate: (guardado, versao) => {
        const estado = guardado as { slots?: number[] } | undefined;
        if (versao >= 1 || !estado?.slots) return guardado as never;
        const slots = [...estado.slots];
        if (!slots.includes(ATAQUE_BASICO_ID)) {
          const livre = slots.indexOf(0);
          if (livre !== -1) slots[livre] = ATAQUE_BASICO_ID;
        }
        return { ...estado, slots } as never;
      },
    },
  ),
);
