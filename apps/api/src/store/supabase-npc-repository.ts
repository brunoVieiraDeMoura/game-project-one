import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Npc } from "@ragnarok/game-data";
import type { NpcListQuery, NpcListResult, NpcRepository } from "./npc-repository";
import { npcToRow, rowToNpc, type NpcRow } from "./npc-row";

const PG_UNIQUE_VIOLATION = "23505";

function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

/** escapa `%`/`_`/`\` (metacaracteres do LIKE do Postgres) — `relPath` vem
 * sempre de um `legacyRef` já existente no catálogo, nunca de input de
 * usuário livre, mas escapar custa nada e evita um match falso-positivo se
 * um nome de arquivo algum dia tiver um desses caracteres. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** NpcRepository backed by hosted Supabase (service role, same as items). */
export class SupabaseNpcRepository implements NpcRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async list({ page, pageSize, search, kind, mapId, origin }: NpcListQuery): Promise<NpcListResult> {
    let query = this.client.from("npcs").select("*", { count: "exact" });
    if (search) {
      const q = sanitizeSearch(search);
      if (q) query = query.or([`name.ilike.*${q}*`, `id.ilike.*${q}*`].join(","));
    }
    if (kind) query = query.eq("kind", kind);
    if (mapId) query = query.eq("map_id", mapId);
    if (origin) query = query.eq("origin", origin);
    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.order("id").range(start, start + pageSize - 1);
    if (error && error.code === "PGRST103") {
      return { npcs: [], total: count ?? 0, page, pageSize };
    }
    if (error) throw new Error(`supabase list failed: ${error.message}`);
    return {
      npcs: (data as NpcRow[]).map(rowToNpc),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<Npc | undefined> {
    const { data, error } = await this.client.from("npcs").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get failed: ${error.message}`);
    return data ? rowToNpc(data as NpcRow) : undefined;
  }

  async create(npc: Npc): Promise<Npc> {
    const { error } = await this.client.from("npcs").insert(npcToRow(npc));
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`npc ${npc.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase create failed: ${error.message}`);
    return npc;
  }

  async update(id: string, npc: Npc): Promise<Npc | undefined> {
    const row = { ...npcToRow(npc), updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("npcs").update(row).eq("id", id).select("id");
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`npc ${npc.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase update failed: ${error.message}`);
    return data && data.length > 0 ? npc : undefined;
  }

  async remove(id: string): Promise<boolean> {
    const { data, error } = await this.client.from("npcs").delete().eq("id", id).select("id");
    if (error) throw new Error(`supabase remove failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async listByLegacyRefFile(relPath: string): Promise<Npc[]> {
    const { data, error } = await this.client.from("npcs").select("*").like("legacy_ref", `${escapeLike(relPath)}:%`);
    if (error) throw new Error(`supabase listByLegacyRefFile failed: ${error.message}`);
    return (data as NpcRow[]).map(rowToNpc);
  }
}
