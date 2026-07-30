import { create } from "zustand";

/**
 * Efeitos visuais de skill vindos do servidor.
 *
 * O projeto ainda não tem arte de efeito por skill (o RO original usa .str
 * animados, que não existem aqui). Então o desenho é genérico e derivado do que
 * o pacote diz — área, buff ou impacto — e a identidade visual entra depois,
 * trocando o registro em `skillVfx.ts`. O que NÃO se faz é inventar
 * comportamento: duração, alvo e posição são do rAthena.
 */

export type VfxKind = "impact" | "buff" | "area" | "cast";

export interface VfxInstance {
  id: number;
  kind: VfxKind;
  skillId: number;
  /** entidade onde o efeito nasce (impacto/buff) */
  gid?: number;
  /** célula do servidor (área/cast no chão) */
  cell?: { x: number; y: number };
  /** ms — quando expira; efeitos de área vivem até o servidor mandar sumir */
  expiresAt: number;
  /** gid da unidade de skill no chão (para casar com o "sumiu") */
  unitGid?: number;
}

interface VfxState {
  effects: VfxInstance[];
  spawn: (effect: Omit<VfxInstance, "id">) => void;
  removeUnit: (unitGid: number) => void;
  prune: (now: number) => void;
  reset: () => void;
}

let nextId = 1;

export const useVfxStore = create<VfxState>((set) => ({
  effects: [],

  spawn: (effect) => set((s) => ({ effects: [...s.effects, { ...effect, id: nextId++ }] })),

  removeUnit: (unitGid) => set((s) => ({ effects: s.effects.filter((e) => e.unitGid !== unitGid) })),

  prune: (now) =>
    set((s) => {
      // Efeito de área não expira sozinho (expiresAt = Infinity): quem manda
      // sumir é o servidor, com ZC.SKILL_DISAPPEAR.
      const alive = s.effects.filter((e) => e.expiresAt > now);
      return alive.length === s.effects.length ? s : { effects: alive };
    }),

  reset: () => set({ effects: [] }),
}));

// espelho no console (mesmo espírito do __world/__netEntities): sem isso,
// depurar "o efeito nasceu?" vira olhar pixel na tela
if (import.meta.env.DEV) {
  (window as unknown as { __vfx?: () => unknown }).__vfx = () =>
    useVfxStore.getState().effects.map((e) => ({
      tipo: e.kind,
      skill: e.skillId,
      gid: e.gid,
      celula: e.cell,
    }));
}
