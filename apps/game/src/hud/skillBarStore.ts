import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ATAQUE_BASICO_ID } from "../net/ataqueBasico";
import { usePlayerStore } from "../net/playerStore";

/**
 * Quais skills/itens o jogador colocou em cada slot da barra.
 *
 * No Ragnarok a barra é ARRUMADA PELO JOGADOR (arrasta da janela de
 * habilidades ou do inventário), não preenchida sozinha — e a arrumação
 * sobrevive ao relog. Aqui ela mora no navegador: o rAthena guarda hotkeys no
 * servidor (ZC.SHORTCUT_KEY_LIST), mas isso é um passo à frente; enquanto não
 * estiver ligado, guardar local é melhor que reembaralhar a cada login.
 *
 * 27 slots = 3 páginas de 9, como no RO.
 */
export const SKILL_SLOTS = 27;

/**
 * `id` é a chave de identidade de cada tipo — skill id do rAthena para
 * `"skill"`, `itemId` do catálogo para `"item"`/`"ammo"` — NUNCA o índice do
 * inventário: o índice é volátil (o mesmo item pode reaparecer noutro slot da
 * bolsa depois de um stack zerar e ser pego de novo), e a skill já guardava
 * por id pela mesma razão. `id: 0` é o vazio, para os três tipos.
 *
 * `"ammo"` é um tipo À PARTE de `"item"`, mesmo os dois sendo "coisa achada
 * no inventário por itemId": o gatilho é DIFERENTE (equipar, não usar/
 * consumir — `SkillBar.trigger`) e não pode ser confundido com o de item
 * comum, que manda `CZ.USE_ITEM`. Munição continua item de verdade (tipo
 * `IT_AMMO`, categoria Etc no inventário) — só o SLOT DA BARRA é um tipo
 * próprio, para o clique saber que ação tomar sem checar `item.type` de novo.
 */
export interface SkillBarSlot {
  kind: "skill" | "item" | "ammo";
  id: number;
}

const SLOT_VAZIO: SkillBarSlot = { kind: "skill", id: 0 };

interface SkillBarState {
  slots: SkillBarSlot[];
  /** slot vira skill */
  assign: (slot: number, skillId: number) => void;
  /** slot vira item (consumível arrastado do inventário) */
  assignItem: (slot: number, itemId: number) => void;
  /** slot vira munição (arraste do Etc — clique EQUIPA, não usa) */
  assignAmmo: (slot: number, itemId: number) => void;
  clear: (slot: number) => void;
  swap: (from: number, to: number) => void;
  reset: () => void;
}

const EMPTY = Array.from({ length: SKILL_SLOTS }, (): SkillBarSlot => ({ ...SLOT_VAZIO }));

/**
 * A barra NASCE com o Ataque Básico no primeiro slot.
 *
 * Ele é do cliente, não do rAthena, então não aparece na janela de habilidades
 * (que é montada a partir do que o servidor manda) e não haveria de onde
 * arrastá-lo. Deixá-lo posto é o que o torna alcançável; daí em diante ele se
 * move, troca e sai como qualquer outro, e a escolha persiste.
 */
function comAtaqueBasico(): SkillBarSlot[] {
  const slots = EMPTY.map((s) => ({ ...s }));
  slots[0] = { kind: "skill", id: ATAQUE_BASICO_ID };
  return slots;
}

export const useSkillBar = create<SkillBarState>()(
  persist(
    (set) => ({
      slots: comAtaqueBasico(),

      assign: (slot, skillId) =>
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          // a mesma skill não fica em dois lugares (o RO também move, não copia)
          const previous = slots.findIndex((x) => x.kind === "skill" && x.id === skillId);
          if (previous !== -1) slots[previous] = { ...SLOT_VAZIO };
          slots[slot] = { kind: "skill", id: skillId };
          return { slots };
        }),

      assignItem: (slot, itemId) =>
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          // mesma regra do assign: o mesmo item não fica em dois lugares
          const previous = slots.findIndex((x) => x.kind === "item" && x.id === itemId);
          if (previous !== -1) slots[previous] = { ...SLOT_VAZIO };
          slots[slot] = { kind: "item", id: itemId };
          return { slots };
        }),

      assignAmmo: (slot, itemId) =>
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          const previous = slots.findIndex((x) => x.kind === "ammo" && x.id === itemId);
          if (previous !== -1) slots[previous] = { ...SLOT_VAZIO };
          slots[slot] = { kind: "ammo", id: itemId };
          return { slots };
        }),

      clear: (slot) =>
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          slots[slot] = { ...SLOT_VAZIO };
          return { slots };
        }),

      swap: (from, to) =>
        set((s) => {
          const slots = s.slots.map((x) => ({ ...x }));
          const tmp = slots[to] ?? { ...SLOT_VAZIO };
          slots[to] = slots[from] ?? { ...SLOT_VAZIO };
          slots[from] = tmp;
          return { slots };
        }),

      reset: () => set({ slots: comAtaqueBasico() }),
    }),
    {
      name: "ragnarok:skillbar",
      /**
       * v1→v2: `slots` era `number[]` (id de skill cru); virou
       * `SkillBarSlot[]` para caber item além de skill. Quem guardava um
       * array de números recebe o MESMO id de volta, só embrulhado —
       * `kind: "skill"` é a única leitura possível de um número puro, porque
       * "item" não existia antes desta versão.
       *
       * v0→v1 continua embutida aqui (não é um passo separado): quem nunca
       * teve o Ataque Básico ganha ele no primeiro slot livre, ANTES da
       * conversão de forma — assim uma migração cobre os dois saltos de quem
       * pulou direto de v0 para v2.
       */
      version: 2,
      migrate: (guardado, versao) => {
        if (versao >= 2) return guardado as never;
        const estado = guardado as { slots?: number[] } | undefined;
        if (!estado?.slots) return guardado as never;
        const nums = [...estado.slots];
        if (versao < 1 && !nums.includes(ATAQUE_BASICO_ID)) {
          const livre = nums.indexOf(0);
          if (livre !== -1) nums[livre] = ATAQUE_BASICO_ID;
        }
        const slots: SkillBarSlot[] = nums.map((id) => ({ kind: "skill", id }));
        return { ...estado, slots } as never;
      },
    },
  ),
);

/**
 * Item removido/trocado/zerado no inventário não pode deixar a hotbar
 * apontando para nada.
 *
 * Mora fora do React, como a reação do Ataque Básico em `net/ataqueBasico.ts`
 * — é regra de sessão, não de componente montado. A base é o `playerStore`,
 * que É o estado autoritativo (só muda quando o servidor manda `inv:remove`/
 * `ITEMLIST`): a limpeza aqui não é o cliente "achando" que chegou a 0, é
 * reagir ao que o servidor já confirmou.
 */
usePlayerStore.subscribe((estado, anterior) => {
  if (estado.inventory === anterior.inventory) return;
  const presentes = new Set(estado.inventory.map((it) => it.itemId));
  const bar = useSkillBar.getState();
  bar.slots.forEach((slot, i) => {
    if (slot.kind === "item" && slot.id !== 0 && !presentes.has(slot.id)) bar.clear(i);
  });
  // "ammo" fica de FORA de propósito: a pilha pode zerar e voltar (comprou
  // mais, pegou no chão), e o atalho tem que continuar apontando pro mesmo
  // itemId quando isso acontecer — é o "quick-switch" pedido, não um slot de
  // usar-e-sumir como os itens comuns.
});

// mesmo espírito do __world/__player/__basico: "o atalho ainda está
// configurado?" é a pergunta que a tela sozinha não responde quando o slot
// está vazio (a pilha zerou) — sem isto, "o atalho sumiu" e "a pilha zerou"
// pareciam a mesma coisa de fora.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __hotbar?: () => SkillBarSlot[] }).__hotbar = () => useSkillBar.getState().slots;
}
