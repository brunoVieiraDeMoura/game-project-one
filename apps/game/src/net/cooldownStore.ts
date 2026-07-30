import { create } from "zustand";

/**
 * Recarga das skills, como o SERVIDOR a informa (ZC_SKILL_POSTDELAY).
 *
 * Guarda-se o INSTANTE em que termina, não quanto falta: o que falta muda a
 * cada quadro e passar isso por `setState` repintaria o HUD 60 vezes por
 * segundo. Quem desenha o cronômetro lê o fim e anima sozinho.
 *
 * O relógio é `performance.now()`, o mesmo que o resto do cliente usa para
 * interpolar movimento — `Date.now()` pula quando o sistema acerta a hora.
 */
interface CooldownState {
  /** skillId → instante (performance.now) em que a recarga acaba */
  ends: Record<number, number>;
  /** skillId → duração total, para desenhar a fração que falta */
  total: Record<number, number>;
  start: (skillId: number, durationMs: number) => void;
  clear: () => void;
}

export const useCooldownStore = create<CooldownState>((set) => ({
  ends: {},
  total: {},
  start: (skillId, durationMs) =>
    set((s) => {
      // duração 0 é o servidor AVISANDO que a recarga acabou (rAthena manda
      // isso ao limpar o delay); tratar como início deixaria o slot travado
      if (durationMs <= 0) {
        const { [skillId]: _fim, ...ends } = s.ends;
        const { [skillId]: _dur, ...total } = s.total;
        return { ends, total };
      }
      return {
        ends: { ...s.ends, [skillId]: performance.now() + durationMs },
        total: { ...s.total, [skillId]: durationMs },
      };
    }),
  clear: () => set({ ends: {}, total: {} }),
}));
