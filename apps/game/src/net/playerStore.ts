import { create } from "zustand";

/**
 * O personagem como o SERVIDOR o descreve: HP/SP, exp, zeny, peso, atributos e
 * inventário.
 *
 * É a fonte da verdade quando há sessão — o `characterStore` (ficha montada a
 * partir do admin) só vale no modo local/demo. O rAthena não manda um "bloco de
 * personagem" a cada mudança: manda diferenças (`self:stat`), e de vez em quando
 * a janela de status inteira (`self:status`). Por isso aqui é tudo campo solto
 * com merge, não um objeto substituído.
 */

export interface InventoryItem {
  index: number;
  itemId: number;
  amount: number;
  type: number;
  identified: boolean;
  refine: number;
  equipped: boolean;
  cards: number[];
}

export interface ServerStats {
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  baseLevel: number;
  jobLevel: number;
  baseExp: number;
  nextBaseExp: number;
  jobExp: number;
  nextJobExp: number;
  zeny: number;
  weight: number;
  maxWeight: number;
  statusPoint: number;
  skillPoint: number;
  str: number;
  agi: number;
  vit: number;
  int: number;
  dex: number;
  luk: number;
  /** custo em pontos para subir mais 1 (o número no "+" do RO) */
  upStr: number;
  upAgi: number;
  upVit: number;
  upInt: number;
  upDex: number;
  upLuk: number;
  atk: number;
  atkBonus: number;
  matkMin: number;
  matkMax: number;
  def: number;
  defBonus: number;
  mdef: number;
  mdefBonus: number;
  hit: number;
  flee: number;
  fleeBonus: number;
  critical: number;
  aspd: number;
  class: number;
  speed: number;
}

const EMPTY_STATS: ServerStats = {
  hp: 0,
  maxHp: 1,
  sp: 0,
  maxSp: 1,
  baseLevel: 1,
  jobLevel: 1,
  baseExp: 0,
  nextBaseExp: 1,
  jobExp: 0,
  nextJobExp: 1,
  zeny: 0,
  weight: 0,
  maxWeight: 1,
  statusPoint: 0,
  skillPoint: 0,
  str: 1,
  agi: 1,
  vit: 1,
  int: 1,
  dex: 1,
  luk: 1,
  upStr: 2,
  upAgi: 2,
  upVit: 2,
  upInt: 2,
  upDex: 2,
  upLuk: 2,
  atk: 0,
  atkBonus: 0,
  matkMin: 0,
  matkMax: 0,
  def: 0,
  defBonus: 0,
  mdef: 0,
  mdefBonus: 0,
  hit: 0,
  flee: 0,
  fleeBonus: 0,
  critical: 0,
  aspd: 0,
  class: 0,
  speed: 150,
};

export interface PlayerSkill {
  id: number;
  name: string;
  level: number;
  spCost: number;
  range: number;
  upgradable: boolean;
}

interface PlayerState {
  /** true depois do primeiro pacote de status — antes disso o HUD não tem o que mostrar */
  known: boolean;
  stats: ServerStats;
  inventory: InventoryItem[];
  skills: PlayerSkill[];
  charName: string;

  setCharName: (name: string) => void;
  /** semeia com a ficha da seleção de personagem (ver seedFromChar) */
  seedFromChar: (char: {
    name: string;
    level: number;
    jobLevel: number;
    baseExp: number;
    jobExp: number;
    zeny: number;
    hp: number;
    maxHp: number;
    sp: number;
    maxSp: number;
    str: number;
    agi: number;
    vit: number;
    int: number;
    dex: number;
    luk: number;
    job: number;
  }) => void;
  applyStat: (name: string, value: number, bonus?: number) => void;
  applyStatus: (block: Partial<ServerStats>) => void;
  setInventory: (items: InventoryItem[]) => void;
  setSkills: (skills: PlayerSkill[]) => void;
  addItem: (item: InventoryItem) => void;
  removeItem: (index: number, amount: number) => void;
  reset: () => void;
}

/** Campos com par base+bônus: o pacote traz os dois, guardamos separados. */
const BONUS_FIELD: Record<string, keyof ServerStats> = {
  atk: "atkBonus",
  def: "defBonus",
  mdef: "mdefBonus",
  flee: "fleeBonus",
};

export const usePlayerStore = create<PlayerState>((set) => ({
  known: false,
  stats: EMPTY_STATS,
  inventory: [],
  skills: [],
  charName: "",

  setCharName: (charName) => set({ charName }),

  /**
   * Nível, zeny e classe NÃO vêm em pacote de status: o rAthena só manda
   * `PAR_CHANGE` quando eles MUDAM. O valor inicial está na lista de
   * personagens do char-server — é de lá que o cliente oficial tira também.
   * Sem semear aqui, o HUD abria "Nv 1" ao lado de 56.030 de HP.
   */
  seedFromChar: (char) =>
    set((s) => ({
      charName: char.name,
      known: true,
      stats: {
        ...s.stats,
        baseLevel: char.level,
        jobLevel: char.jobLevel,
        baseExp: char.baseExp,
        jobExp: char.jobExp,
        zeny: char.zeny,
        hp: char.hp,
        maxHp: char.maxHp,
        sp: char.sp,
        maxSp: char.maxSp,
        str: char.str,
        agi: char.agi,
        vit: char.vit,
        int: char.int,
        dex: char.dex,
        luk: char.luk,
        class: char.job,
      },
    })),

  applyStat: (name, value, bonus) =>
    set((s) => {
      if (!(name in s.stats)) {
        // parâmetro que ainda não mapeamos (statName devolve "sp_<id>"): ignorar
        // é melhor que inventar um campo — o servidor manda dezenas deles.
        return s;
      }
      const stats = { ...s.stats, [name]: value };
      const bonusField = BONUS_FIELD[name];
      if (bonusField && bonus !== undefined) {
        (stats as Record<string, number>)[bonusField] = bonus;
      }
      return { stats, known: true };
    }),

  applyStatus: (block) => set((s) => ({ stats: { ...s.stats, ...block }, known: true })),

  setInventory: (inventory) => set({ inventory }),

  setSkills: (skills) => set({ skills: [...skills].sort((a, b) => a.id - b.id) }),

  addItem: (item) =>
    set((s) => {
      const existing = s.inventory.findIndex((i) => i.index === item.index);
      if (existing === -1) return { inventory: [...s.inventory, item] };
      // empilhável: o servidor manda a quantidade PEGA, não o total do slot
      const merged = [...s.inventory];
      merged[existing] = { ...merged[existing]!, amount: merged[existing]!.amount + item.amount };
      return { inventory: merged };
    }),

  removeItem: (index, amount) =>
    set((s) => ({
      inventory: s.inventory
        .map((i) => (i.index === index ? { ...i, amount: i.amount - amount } : i))
        .filter((i) => i.amount > 0),
    })),

  // charName sobrevive ao reset: ele vem da seleção de personagem, ANTES de a
  // cena montar, e o reset roda no desmonte da cena (que o StrictMode faz de
  // propósito no dev). Zerar aqui apagava o nome do HUD logo na entrada.
  reset: () => set({ known: false, stats: EMPTY_STATS, inventory: [], skills: [] }),
}));

// espelho no console (como __world/__vfx): "o HUD está errado ou o pacote não
// chegou?" só se responde vendo o estado cru
if (import.meta.env.DEV) {
  (window as unknown as { __player?: () => unknown }).__player = () => {
    const s = usePlayerStore.getState();
    return { conhecido: s.known, nome: s.charName, stats: s.stats, itens: s.inventory.length, skills: s.skills.length };
  };
}
