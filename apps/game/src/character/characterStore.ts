import { create } from "zustand";

/**
 * Ficha do personagem jogável (Bloco: dados reais). O visual continua o Knight
 * do kit, mas os DADOS herdam do Swordman real do admin (/job-classes): tabela
 * de HP/SP, ASPD base da arma e árvore de skills. Os sub-stats derivados
 * (ATK/MATK/HIT/FLEE/CRIT/ASPD/DEF/MDEF) saem das fórmulas renewal do
 * engine-core — mesma fonte do /balancing. Preenchido uma vez pelo loader.
 */

export interface CharAttrs {
  str: number;
  agi: number;
  vit: number;
  int: number;
  dex: number;
  luk: number;
}

export interface DerivedStats {
  atk: number;
  matk: number;
  hit: number;
  flee: number;
  /** crítico em % */
  crit: number;
  /** ASPD (display renewal) */
  aspd: number;
  /** soft def (def2) */
  def: number;
  /** soft mdef (mdef2) */
  mdef: number;
}

export interface CharSkill {
  id: number;
  name: string;
  level: number;
  maxLevel: number;
}

export interface CharacterData {
  jobId: number;
  jobName: string;
  level: number;
  jobLevel: number;
  attrs: CharAttrs;
  maxHp: number;
  maxSp: number;
  derived: DerivedStats;
  skills: CharSkill[];
}

interface CharacterState {
  data: CharacterData | null;
  setData: (d: CharacterData) => void;
}

export const useCharacterStore = create<CharacterState>((set) => ({
  data: null,
  setData: (data) => set({ data }),
}));
