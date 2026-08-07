import { npcKind, npcOrigin, NpcSchema, type Npc } from "@ragnarok/game-data";

/** NpcSchema ↔ `npcs` row (20260721000001_npcs.sql). `kind` e `origin` são
 * derivados no write (funcional / pasta de origem no rAthena) pra filtro
 * indexado — nenhum dos dois é campo do schema, os dois somem no round-trip
 * de leitura (ver `rowToNpc`). */

export interface NpcRow {
  id: string;
  name: string;
  kind: string;
  origin: string;
  sprite: string;
  map_id: string;
  position: unknown;
  direction: number;
  dialogue_entry: string | null;
  dialogue: unknown;
  quest_triggers: unknown;
  shop: unknown | null;
  warp: unknown | null;
  quest_board: unknown;
  touch_area: unknown | null;
  duplicate_of: string | null;
  legacy_ref: string | null;
}

export function npcToRow(n: Npc): NpcRow {
  return {
    id: n.id,
    name: n.name,
    kind: npcKind(n),
    origin: npcOrigin(n),
    sprite: n.sprite,
    map_id: n.mapId,
    position: n.position,
    direction: n.direction,
    dialogue_entry: n.dialogueEntry,
    dialogue: n.dialogue,
    quest_triggers: n.questTriggers,
    shop: n.shop ?? null,
    warp: n.warp ?? null,
    quest_board: n.questBoard,
    touch_area: n.touchArea ?? null,
    duplicate_of: n.duplicateOf ?? null,
    legacy_ref: n.legacyRef ?? null,
  };
}

export function rowToNpc(row: NpcRow): Npc {
  return NpcSchema.parse({
    id: row.id,
    name: row.name,
    sprite: row.sprite,
    mapId: row.map_id,
    position: row.position,
    direction: row.direction,
    dialogueEntry: row.dialogue_entry,
    dialogue: row.dialogue,
    questTriggers: row.quest_triggers,
    shop: row.shop ?? undefined,
    warp: row.warp ?? undefined,
    questBoard: row.quest_board,
    touchArea: row.touch_area ?? undefined,
    duplicateOf: row.duplicate_of ?? undefined,
    legacyRef: row.legacy_ref ?? undefined,
  });
}
