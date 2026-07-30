import type { Npc } from "@ragnarok/game-data";

/** classificação derivada pro filtro do admin */
export type NpcKind = "warp" | "shop" | "dialogue" | "duplicate" | "other";

export function npcKind(npc: Npc): NpcKind {
  if (npc.warp) return "warp";
  if (npc.shop) return "shop";
  if (npc.duplicateOf) return "duplicate";
  if (npc.dialogue.length > 0) return "dialogue";
  return "other";
}

export interface NpcListQuery {
  page: number;
  pageSize: number;
  /** name/id substring */
  search?: string | undefined;
  kind?: NpcKind | undefined;
  mapId?: string | undefined;
}

export interface NpcListResult {
  npcs: Npc[];
  total: number;
  page: number;
  pageSize: number;
}

/** Storage abstraction for the NPCs module — same pattern as ItemRepository. */
export interface NpcRepository {
  list(query: NpcListQuery): Promise<NpcListResult>;
  get(id: string): Promise<Npc | undefined>;
  create(npc: Npc): Promise<Npc>;
  update(id: string, npc: Npc): Promise<Npc | undefined>;
  remove(id: string): Promise<boolean>;
}
