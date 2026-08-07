import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StatusEffectDef } from "@ragnarok/game-data";
import type { StatusListQuery, StatusListResult, StatusRepository } from "./status-repository";
import { statusToRow, rowToStatus, type StatusRow } from "./status-row";

const PG_UNIQUE_VIOLATION = "23505";

function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

/** StatusRepository backed by hosted Supabase (service role, same as items). */
export class SupabaseStatusRepository implements StatusRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async list({ page, pageSize, search, category, group }: StatusListQuery): Promise<StatusListResult> {
    let query = this.client.from("statuses").select("*", { count: "exact" });
    if (category) query = query.eq("category", category);
    if (group) query = query.eq("status_group", group);
    if (search) {
      const q = sanitizeSearch(search);
      if (q) {
        query = query.or([`id.ilike.*${q}*`, `name.ilike.*${q}*`].join(","));
      }
    }
    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.order("id").range(start, start + pageSize - 1);
    if (error && error.code === "PGRST103") {
      return { statuses: [], total: count ?? 0, page, pageSize };
    }
    if (error) throw new Error(`supabase list failed: ${error.message}`);
    return {
      statuses: (data as StatusRow[]).map(rowToStatus),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<StatusEffectDef | undefined> {
    const { data, error } = await this.client.from("statuses").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get failed: ${error.message}`);
    return data ? rowToStatus(data as StatusRow) : undefined;
  }

  async create(status: StatusEffectDef): Promise<StatusEffectDef> {
    const { error } = await this.client.from("statuses").insert(statusToRow(status));
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`status ${status.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase create failed: ${error.message}`);
    return status;
  }

  async update(id: string, status: StatusEffectDef): Promise<StatusEffectDef | undefined> {
    const row = { ...statusToRow(status), updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("statuses").update(row).eq("id", id).select("id");
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`status ${status.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase update failed: ${error.message}`);
    return data && data.length > 0 ? status : undefined;
  }

  async remove(id: string): Promise<boolean> {
    const { data, error } = await this.client.from("statuses").delete().eq("id", id).select("id");
    if (error) throw new Error(`supabase remove failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
