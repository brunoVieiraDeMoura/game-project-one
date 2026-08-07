import { npcKind, type Npc, type NpcKind, type NpcOrigin } from "@ragnarok/game-data";

export { npcKind };
export type { NpcKind };

export interface NpcListQuery {
  page: number;
  pageSize: number;
  /** name/id substring */
  search?: string | undefined;
  kind?: NpcKind | undefined;
  mapId?: string | undefined;
  origin?: NpcOrigin | undefined;
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
