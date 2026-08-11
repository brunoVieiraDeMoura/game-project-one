import type { CharacterKey } from "../assets";

/**
 * mobId (mob_db do rAthena) → modelo 3D.
 *
 * O projeto ainda não tem modelo por monstro pra todo mundo — só existem 2
 * modelos de monstro no acervo (`skeleton_warrior`/`skeleton_minion`, ver
 * `assets.ts` CHARACTER_URLS), então isto é APARÊNCIA por aproximação, não
 * um catálogo completo. HP, dano, drop e IA continuam sendo do servidor, do
 * mob_db de verdade — trocar a linha de um monstro por modelo próprio no
 * futuro não muda uma vírgula de gameplay.
 *
 * Os 6 primeiros (Poring/Drops/Poporing/Lunatic/Picky/Rocker) são o conjunto
 * original de demo/QA — nenhum deles é undead ou skeleton de verdade (Poring
 * é `race:"plant"`, Lunatic/Picky são `race:"brute"`, Rocker é
 * `race:"insect"` — conferido em `tools/legacy-migration/output/
 * monsters.json`), a escolha ali foi só "monstro fraco de mapa inicial vira
 * o esqueleto pequeno/grande que combina melhor". Preservados como estão.
 *
 * O bloco abaixo deles É baseado em dado real do catálogo: todo mobId com
 * `race === "undead"` E nome/aegisName batendo `/SKEL/i`/`/skeleton/i` —
 * ou seja, monstro que É LITERALMENTE um esqueleto na Ragnarok real, não uma
 * aproximação por "é undead" (Zumbi/Mumia/Ghoul também são undead mas não
 * são esqueletos visualmente, ficaram de fora de propósito). 35 mobIds,
 * cobrindo variantes de evento/instância/carta (prefixos G_/C1-C5_/P_/MD_/
 * ILL_ do mesmo monstro base) — cada um É um mobId de verdade que aparece em
 * jogo com esse número, não é preenchimento artificial. Dividido em 2 grupos
 * pelo próprio NOME real: "Skeleton Worker"/"Weak Skeleton" (claramente
 * menor/mais fraco pelo nome) → `skeleton_minion`; o resto (Soldier/Archer/
 * General/Pirate/etc., level mais alto) → `skeleton_warrior`. Sem isso,
 * todos já cairiam no FALLBACK (que também é `skeleton_warrior`) — a
 * diferença real que esta lista acrescenta é só o subgrupo "Worker"/"Weak"
 * virando o modelo menor.
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

  // --- esqueletos de verdade (race:"undead" + nome batendo skeleton) ---
  // grupo "menor" (nome diz Worker/Weak) → skeleton_minion
  1169: { character: "skeleton_minion", scale: 0.85 }, // Skeleton Worker
  1469: { character: "skeleton_minion", scale: 0.85 }, // Skeleton Worker (G_)
  2405: { character: "skeleton_minion", scale: 0.85 }, // Weak Skeleton
  2406: { character: "skeleton_minion", scale: 0.85 }, // Weak Soldier Skeleton
  2619: { character: "skeleton_minion", scale: 0.85 }, // Weak Skeleton Ringleader
  2660: { character: "skeleton_minion", scale: 0.85 }, // Elusive Skeleton Worker

  // grupo "guerreiro" (Soldier/Archer/General/Sailor/Pirate/Orc/Prisoner/etc.) → skeleton_warrior
  1016: { character: "skeleton_warrior", scale: 1.0 }, // Archer Skeleton
  1028: { character: "skeleton_warrior", scale: 1.0 }, // Soldier Skeleton
  1071: { character: "skeleton_warrior", scale: 1.0 }, // Pirate Skeleton
  1076: { character: "skeleton_warrior", scale: 1.0 }, // Skeleton
  1152: { character: "skeleton_warrior", scale: 1.0 }, // Orc Skeleton
  1196: { character: "skeleton_warrior", scale: 1.05 }, // Skeleton Prisoner
  1290: { character: "skeleton_warrior", scale: 1.15 }, // Skeleton General
  1420: { character: "skeleton_warrior", scale: 1.0 }, // Archer Skeleton (G_)
  1462: { character: "skeleton_warrior", scale: 1.0 }, // Orc Skeleton (G_)
  1479: { character: "skeleton_warrior", scale: 1.05 }, // Skeleton Prisoner (G_)
  1562: { character: "skeleton_warrior", scale: 1.0 }, // Soldier Skeleton (G_)
  1983: { character: "skeleton_warrior", scale: 1.0 }, // Orc Undead (I_ORC_SKELETON)
  2407: { character: "skeleton_warrior", scale: 1.0 }, // Sailor Skeleton
  2648: { character: "skeleton_warrior", scale: 1.0 }, // Soldier Skeleton Ringleader
  2649: { character: "skeleton_warrior", scale: 1.0 }, // Furious Soldier Skeleton
  2658: { character: "skeleton_warrior", scale: 1.15 }, // Skeleton General Ringleader
  2659: { character: "skeleton_warrior", scale: 1.15 }, // Furious Skeleton General
  2676: { character: "skeleton_warrior", scale: 1.0 }, // Swift Sailor Skeleton
  2724: { character: "skeleton_warrior", scale: 1.0 }, // Swift Orc Skeleton
  3445: { character: "skeleton_warrior", scale: 1.0 }, // Enchanted Archer Skeleton
  3446: { character: "skeleton_warrior", scale: 1.0 }, // Enchanted Skeleton
  3447: { character: "skeleton_warrior", scale: 1.0 }, // Enchanted Soldier Skeleton
  3637: { character: "skeleton_warrior", scale: 1.0 }, // Skeleton (MD_SKELETON_60)
  3638: { character: "skeleton_warrior", scale: 1.0 }, // Skeleton (MD_SKELETON_80)
  3639: { character: "skeleton_warrior", scale: 1.0 }, // Skeleton (MD_SKELETON_100)
  3640: { character: "skeleton_warrior", scale: 1.0 }, // Skeleton (MD_SKELETON_120)
  3641: { character: "skeleton_warrior", scale: 1.0 }, // Skeleton (MD_SKELETON_140)
  3642: { character: "skeleton_warrior", scale: 1.0 }, // Skeleton (MD_SKELETON_160)
  3763: { character: "skeleton_warrior", scale: 1.0 }, // Resentful Soldier (ILL_ARCHER_SKELETON)
};

/** Nunca falta modelo: monstro sem entrada explícita ainda tem que
 * aparecer em jogo — cai no guerreiro padrão, nunca quebra o render. */
const FALLBACK: MobModel = { character: "skeleton_warrior", scale: 1 };

export function mobModel(mobId: number): MobModel {
  return MOB_MODELS[mobId] ?? FALLBACK;
}

/** NPCs também não têm modelo próprio: o Knight faz o papel por enquanto. */
export const NPC_MODEL: MobModel = { character: "knight", scale: 1 };
