import { useMemo } from "react";
import { gateway } from "./gateway";
import { usePlayerStore, type InventoryItem } from "./playerStore";
import type { ItemInfo } from "./itemCatalog";
import { diffStats, useStatusDelta } from "./statusDeltaStore";

/**
 * Projeção do estado autoritativo — NÃO é uma fonte de verdade paralela.
 *
 * "Quem está em cada slot" é sempre derivado do `playerStore.inventory` (que
 * só muda quando o rAthena confirma, via `inv:list`/`item:equip-result`), na
 * hora da leitura. Não existe um `equipment: {...}` guardado em algum lugar
 * que possa divergir do inventário — só existiria uma cópia a menos se
 * ninguém nunca esquecesse de manter as duas em sincronia.
 *
 * Os dez slots clássicos do RO, exceto CALÇA (ainda não existe no jogo — item
 * 6/7 do pedido: a chave fica de fora até o dia em que existir, em vez de
 * apontar para um bit que não representa nada) e AMMO (sem slot na arte
 * atual; o bit já está aqui pronto para o dia em que a Fase 5 desenhar o
 * terceiro slotzinho perto do escudo).
 */
export type EquipSlotKey = "helmet" | "face" | "body" | "coat" | "foot" | "ring1" | "ring2" | "weapon" | "shield";

/**
 * Bitmask EQP_* (rathena/src/common/mmo.hpp:336-353) — CONFERIDO no source,
 * não adivinhado. `ring1`/`ring2` mapeiam ACC_R/ACC_L: qual acessório cai em
 * qual dos dois é o SERVIDOR quem escolhe (o pedido de equipar manda
 * `position: 0`, "onde couber"), e é exatamente esse bit que o ACK devolve —
 * não há ambiguidade para o cliente resolver.
 */
export const EQUIP_SLOT_BITS: Record<EquipSlotKey, number> = {
  helmet: 0x0100, // EQP_HEAD_TOP
  face: 0x0001, // EQP_HEAD_LOW
  body: 0x0010, // EQP_ARMOR
  coat: 0x0004, // EQP_GARMENT
  foot: 0x0040, // EQP_SHOES
  ring1: 0x0008, // EQP_ACC_R
  ring2: 0x0080, // EQP_ACC_L
  weapon: 0x0002, // EQP_HAND_R
  shield: 0x0020, // EQP_HAND_L
};

/** reservado para a Fase 5 (flecha) — não tem slot na arte ainda */
export const EQP_AMMO = 0x8000;

/**
 * Um item de arma de DUAS MÃOS carrega HAND_R|HAND_L ao mesmo tempo — por
 * isso é uma varredura de bit, não um `Map` por índice: o mesmo item pode
 * ocupar dois slots visuais ao mesmo tempo (o escudo mostra o punho vazio,
 * como no RO de verdade).
 */
export function equippedBySlot(inventory: InventoryItem[]): Partial<Record<EquipSlotKey, InventoryItem>> {
  const out: Partial<Record<EquipSlotKey, InventoryItem>> = {};
  for (const item of inventory) {
    if (!item.equipped || item.location === 0) continue;
    for (const key of Object.keys(EQUIP_SLOT_BITS) as EquipSlotKey[]) {
      if ((item.location & EQUIP_SLOT_BITS[key]) === EQUIP_SLOT_BITS[key]) out[key] = item;
    }
  }
  return out;
}

export function useEquipment(): Partial<Record<EquipSlotKey, InventoryItem>> {
  const inventory = usePlayerStore((s) => s.inventory);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => equippedBySlot(inventory), [inventory]);
}

/**
 * Pedidos de equipar/desequipar em voo, por índice de inventário.
 *
 * Mesmo padrão do `net/itemCatalog` (`pendentes`, módulo fora do React): o
 * problema é o mesmo — spammar duplo clique manda vários `CZ.REQ_WEAR_EQUIP`
 * antes do primeiro ACK voltar. Fica LIMPO só quando `item:equip-result`
 * chega (sucesso OU falha) — nunca por palpite do cliente sobre quanto tempo
 * um pedido deveria levar.
 */
const emVoo = new Set<number>();

export function equipPending(index: number): boolean {
  return emVoo.has(index);
}

export function clearEquipPending(index: number): void {
  emVoo.delete(index);
}

export function requestEquip(index: number): void {
  if (emVoo.has(index)) return;
  emVoo.add(index);
  beginStatusWatch();
  gateway().emit("item:equip", { index });
}

export function requestUnequip(index: number): void {
  if (emVoo.has(index)) return;
  emVoo.add(index);
  beginStatusWatch();
  gateway().emit("item:unequip", { index });
}

/**
 * Antes/depois do status para o indicador de ±10s (`net/statusDeltaStore`).
 *
 * `settleStatusWatch` é chamado pelo handler de `item:equip-result`
 * (`net/useWorldEvents`), NUNCA por um timer que começa junto com o request —
 * "não mostrar o indicador como confirmado antes do ACK" só vale se o relógio
 * do delta só começar a contar DEPOIS que o ACK chegou.
 *
 * O atraso de `SETTLE_MS` depois do ACK existe porque o ACK e os pacotes de
 * status recalculado (`PAR_CHANGE`/`STATUS_CHANGE`/`COUPLESTATUS`) são
 * MENSAGENS SEPARADAS — o rAthena manda o resultado do equip e só then os
 * novos números, no mesmo burst de TCP mas não no mesmo pacote. Ler
 * `playerStore.stats` na hora do ACK pegaria o valor ANTIGO.
 */
let statusBefore: ReturnType<typeof usePlayerStore.getState>["stats"] | null = null;
const SETTLE_MS = 220;

function beginStatusWatch(): void {
  statusBefore = usePlayerStore.getState().stats;
}

export function settleStatusWatch(): void {
  const before = statusBefore;
  statusBefore = null;
  if (!before) return;
  setTimeout(() => {
    const after = usePlayerStore.getState().stats;
    const deltas = diffStats(before, after);
    if (Object.keys(deltas).length > 0) useStatusDelta.getState().show(deltas);
  }, SETTLE_MS);
}

/**
 * Checagem RASA do cliente — só o que é óbvio sem duplicar `pc_isequip`
 * (battle.cpp/pc.cpp tem dezenas de condições: classe, sexo, upper, cartas
 * bloqueando slot etc). O rAthena continua sendo a autoridade final; isto é
 * só para não abrir uma requisição que qualquer jogador reconheceria como
 * boba (tipo de item errado, nível baixo demais).
 *
 * Compatibilidade de CLASSE fica de fora de propósito: `ItemInfo.jobs` vem do
 * item_db como string ("all", "novice", "swordman"...) e não há, hoje, uma
 * tabela que traduza o `class` numérico do rAthena (`playerStore.stats.class`)
 * para essas mesmas strings — inventar a tradução aqui arriscaria bloquear um
 * equip válido ou liberar um inválido, os dois piores que não checar. Fica
 * como pendência explícita, não como lacuna silenciosa.
 */
export function precheckEquip(
  info: ItemInfo | undefined,
  baseLevel: number,
): { ok: true } | { ok: false; reason: string } {
  if (!info) return { ok: true }; // catálogo ainda não respondeu — não é motivo para bloquear
  if (info.equipLevelMin > 0 && baseLevel < info.equipLevelMin) {
    return { ok: false, reason: `Requer nível ${info.equipLevelMin}` };
  }
  if (info.equipLevelMax > 0 && baseLevel > info.equipLevelMax) {
    return { ok: false, reason: `Só até nível ${info.equipLevelMax}` };
  }
  return { ok: true };
}
