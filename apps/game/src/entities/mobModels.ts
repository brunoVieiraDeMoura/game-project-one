import type { CharacterKey } from "../assets";

/**
 * mobId (mob_db do rAthena) → modelo 3D.
 *
 * O projeto ainda não tem modelo por monstro: o esqueleto do KayKit é o
 * stand-in de todo mundo, como combinado (tenta-entender.txt §2). Isto é
 * APARÊNCIA e nada mais — HP, dano, drop e IA continuam sendo do servidor, do
 * mob_db de verdade. Trocar a linha do Poring por um modelo próprio no futuro
 * não muda uma vírgula de gameplay.
 */
export interface MobModel {
  character: CharacterKey;
  /** multiplicador sobre o charScale (Poring é uma bolinha, Baphomet não). */
  scale: number;
}

const MOB_MODELS: Record<number, MobModel> = {
  1002: { character: "skeleton_minion", scale: 0.7 }, // Poring
  1113: { character: "skeleton_minion", scale: 0.7 }, // Drops
  1031: { character: "skeleton_warrior", scale: 0.9 }, // Poporing
  1063: { character: "skeleton_minion", scale: 0.8 }, // Lunatic
  1049: { character: "skeleton_warrior", scale: 1.0 }, // Picky
  1052: { character: "skeleton_warrior", scale: 1.0 }, // Rocker
};

const FALLBACK: MobModel = { character: "skeleton_warrior", scale: 1 };

export function mobModel(mobId: number): MobModel {
  return MOB_MODELS[mobId] ?? FALLBACK;
}

/** NPCs também não têm modelo próprio: o Knight faz o papel por enquanto. */
export const NPC_MODEL: MobModel = { character: "knight", scale: 1 };
