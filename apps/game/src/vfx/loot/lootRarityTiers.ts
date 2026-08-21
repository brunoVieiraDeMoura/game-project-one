/**
 * Raridade visual de item caído no chão, por FAIXA de porcentagem de drop
 * (pedido do usuário 2026-08-21: "camada visual de raridade baseada na
 * porcentagem de drop", nunca gameplay/loot table).
 *
 * A porcentagem usada é a da ENTRADA de loot que efetivamente gerou aquele
 * drop específico (não uma classificação fixa por itemId) — decisão
 * explícita do usuário: o mesmo item dropado de monstros diferentes, com
 * chances diferentes, mostra auras diferentes. Isso exige que o SERVIDOR
 * mande a chance junto com o drop (`net/GroundItems.tsx: GroundItemData.
 * dropChancePct`) — ver `docs/claude-context/01-rathena-connection-and-world-sync.md`
 * pra o pacote novo que carrega esse dado.
 */

export type LootRarityTier = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

/**
 * Limiares em % (0-100, mesma unidade de `MonsterDropSchema.chance` em
 * `packages/game-data/src/monster.ts`). Fronteira pertence ao lado MAIS
 * RARO (ex.: exatamente 10% é "incomum", não "comum") — só importa nas
 * bordas exatas, que a tabela real de drop_ratio quase nunca produz.
 */
const MYTHIC_MAX = 0.04;
const LEGENDARY_MAX = 0.15;
const EPIC_MAX = 0.5;
const RARE_MAX = 3;
const UNCOMMON_MAX = 10;

export function rarityTierForChance(chancePercent: number): LootRarityTier {
  if (chancePercent <= MYTHIC_MAX) return "mythic";
  if (chancePercent <= LEGENDARY_MAX) return "legendary";
  if (chancePercent <= EPIC_MAX) return "epic";
  if (chancePercent <= RARE_MAX) return "rare";
  if (chancePercent <= UNCOMMON_MAX) return "uncommon";
  return "common";
}
