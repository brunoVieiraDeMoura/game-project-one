import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Item } from "@ragnarok/game-data";
import type { ItemListQuery, ItemListResult, ItemRepository } from "./item-repository";
import { itemToRow, rowToItem, type ItemRow } from "./item-row";

const PG_UNIQUE_VIOLATION = "23505";

/** Strip characters that break PostgREST or/ilike filter syntax. */
function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

/**
 * ItemRepository backed by the hosted Supabase project. Uses the service-role
 * key — only the API talks to the database, never the browser (RLS stays
 * closed with no policies).
 */
export class SupabaseItemRepository implements ItemRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async list({ page, pageSize, search }: ItemListQuery): Promise<ItemListResult> {
    let query = this.client.from("items").select("*", { count: "exact" });

    if (search) {
      const q = sanitizeSearch(search);
      if (q) {
        const filters = [`name.ilike.*${q}*`, `aegis_name.ilike.*${q}*`];
        if (/^\d+$/.test(q)) filters.push(`id.eq.${q}`);
        query = query.or(filters.join(","));
      }
    }

    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.order("id").range(start, start + pageSize - 1);
    if (error && error.code === "PGRST103") {
      // requested range past the last row — empty page, not an error
      return { items: [], total: count ?? 0, page, pageSize };
    }
    if (error) throw new Error(`supabase list failed: ${error.message}`);
    return {
      items: (data as ItemRow[]).map(rowToItem),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async get(id: number): Promise<Item | undefined> {
    const { data, error } = await this.client.from("items").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get failed: ${error.message}`);
    return data ? rowToItem(data as ItemRow) : undefined;
  }

  async create(item: Item): Promise<Item> {
    const { error } = await this.client.from("items").insert(itemToRow(item));
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`item ${item.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase create failed: ${error.message}`);
    return item;
  }

  async update(id: number, item: Item): Promise<Item | undefined> {
    const row = { ...itemToRow(item), updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("items").update(row).eq("id", id).select("id");
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`item ${item.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase update failed: ${error.message}`);
    return data && data.length > 0 ? item : undefined;
  }

  async remove(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("items").delete().eq("id", id).select("id");
    if (error) throw new Error(`supabase remove failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
