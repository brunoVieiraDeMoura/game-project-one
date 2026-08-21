import { useEffect, useRef, useState } from "react";
import { vfxManager } from "../core/manager";
import { ensureMonsterDrops, dropRateFor } from "../../net/monsterDropCatalog";
import { tocarSomDeRaridade } from "../../audio/itemSfx";
import { rarityTierForChance, type LootRarityTier } from "./lootRarityTiers";
import { lootRarityVfxId } from "./lootRarityVfxDefGpu";
import type { VfxHandle } from "../core/types";

/**
 * Aura de raridade de UM item no chão — dirigida pela % REAL da entrada de
 * loot que gerou aquele drop específico (`mobId` do pacote de item-no-chão,
 * patch rAthena 2026-08-21 — ver `docs/claude-context/01-rathena-connection-
 * and-world-sync.md`), nunca uma classificação fixa por itemId. O mesmo
 * itemId dropado por monstros diferentes, em % diferentes, mostra auras
 * diferentes — pedido explícito do usuário.
 *
 * Sem `mobId` (item que não veio de morte de monstro — jogado por jogador,
 * recompensa etc.) não desenha nada: sem entrada de loot, sem raridade
 * inventada (mesma regra de `ITEM_NAME_FALLBACK`/`getItemDisplayName`, nunca
 * mascarar "sem dado" com um valor plausível).
 *
 * `freshDrop === false` (pedido do usuário 2026-08-21) também não desenha
 * nada: um monstro looter (mode_looter, ex. Poring) que pega um item raro do
 * chão e é morto depois RE-DROPA aquele item — o rAthena preserva o `mobId`
 * ORIGINAL nesse re-drop (então a % continuaria "certa"), mas o efeito não
 * pode repetir, senão o mesmo drop raro acende a aura/toca o som toda vez
 * que passa de mão em mão. `freshDrop === undefined` (dado ausente, ex. os 2
 * opcodes não patcheados) continua permissivo — mesma tolerância que `mobId`
 * ausente já tem, nunca um "sem dado = bloqueado".
 *
 * `net/monsterDropCatalog` não é reativo (`Record` de módulo, não um store
 * zustand) — `ensureMonsterDrops` devolve uma Promise só pra este componente
 * saber QUANDO `dropRateFor` já responde de verdade, sem duplicar o cache
 * num store novo.
 *
 * `__forceLootTier` (dev, mesmo padrão de `__mira`/`__three` em
 * `PlayView.tsx`): `window.__forceLootTier = "legendary"` no console faz
 * TODO item novo nascer nesse tier, pulando mobId/fetch/dropRateFor —
 * ferramenta de teste manual, nunca lido em produção sem alguém setar.
 */
declare global {
  interface Window {
    __forceLootTier?: LootRarityTier | null;
    /** último drop resolvido (dev, sobrescrito a cada item) — pra inspecionar
     * via console sem log nenhum (`window.__lastLootResolved`), mesmo
     * espírito de `__mira`/`__three` em `PlayView.tsx`. */
    __lastLootResolved?: { mobId: number; itemId: number; rate: number; tier: LootRarityTier } | null;
  }
}
if (typeof window !== "undefined") window.__forceLootTier = window.__forceLootTier ?? null;

export function LootRarityAura({
  mobId,
  freshDrop,
  itemId,
  position,
}: {
  mobId: number | undefined;
  freshDrop: boolean | undefined;
  itemId: number;
  position: { x: number; y: number; z: number };
}) {
  const [tier, setTier] = useState<LootRarityTier | null>(null);
  const handleRef = useRef<VfxHandle | null>(null);

  useEffect(() => {
    const forced = typeof window !== "undefined" ? window.__forceLootTier : undefined;
    if (forced) {
      setTier(forced);
      return;
    }

    if (freshDrop === false) return; // re-drop de item looted — nunca repete o efeito
    if (mobId === undefined || mobId <= 0) return;
    let cancelado = false;
    ensureMonsterDrops(mobId).then(() => {
      if (cancelado) return;
      const rate = dropRateFor(mobId, itemId);
      if (rate === undefined) return;
      const t = rarityTierForChance(rate);
      if (typeof window !== "undefined") window.__lastLootResolved = { mobId, itemId, rate, tier: t };
      setTier(t);
    });
    return () => {
      cancelado = true;
    };
  }, [mobId, itemId, freshDrop]);

  useEffect(() => {
    if (tier === null) return;
    // som de raridade — só épico/lendário/mítico (audio/itemSfx.ts:
    // RARITY_SFX não tem entrada pros tiers baixos, `tocarSomDeRaridade`
    // vira no-op sozinho). Uma vez por drop: este efeito só roda de novo se
    // `tier` mudar, e `tier` só sai de `null` uma vez por item.
    tocarSomDeRaridade(tier);
    handleRef.current = vfxManager.play(lootRarityVfxId(tier), { position }) ?? null;
    return () => {
      if (handleRef.current) {
        vfxManager.stop(handleRef.current, "unmount");
        handleRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);

  return null;
}
