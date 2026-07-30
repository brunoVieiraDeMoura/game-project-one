import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Monster } from "@ragnarok/game-data";
import type { MonsterListQuery, MonsterListResult, MonsterRepository } from "./monster-repository";
import { monsterToRow, monsterToDropRows, rowToMonster, type MonsterRow, type MonsterDropRow } from "./monster-row";

const PG_UNIQUE_VIOLATION = "23505";

function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

/**
 * MonsterRepository backed by hosted Supabase. Drops vivem na tabela filha
 * monster_drops (consulta reversa por índice em item_id); create/update
 * reescrevem as linhas filhas do monstro (delete + insert).
 */
export class SupabaseMonsterRepository implements MonsterRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private async dropsFor(monsterIds: number[]): Promise<Map<number, MonsterDropRow[]>> {
    const result = new Map<number, MonsterDropRow[]>();
    if (monsterIds.length === 0) return result;
    const { data, error } = await this.client
      .from("monster_drops")
      .select("*")
      .in("monster_id", monsterIds)
      .order("id");
    if (error) throw new Error(`supabase drops fetch failed: ${error.message}`);
    for (const row of data as (MonsterDropRow & { id: number })[]) {
      const list = result.get(row.monster_id) ?? [];
      list.push(row);
      result.set(row.monster_id, list);
    }
    return result;
  }

  async list({ page, pageSize, search, dropsItem }: MonsterListQuery): Promise<MonsterListResult> {
    let query = this.client.from("monsters").select("*", { count: "exact" });

    if (dropsItem !== undefined) {
      // consulta reversa: ids de monstros que dropam o item (tabela filha indexada)
      const { data: dropRows, error: dropError } = await this.client
        .from("monster_drops")
        .select("monster_id")
        .eq("item_id", dropsItem);
      if (dropError) throw new Error(`supabase reverse drop lookup failed: ${dropError.message}`);
      const ids = [...new Set((dropRows as { monster_id: number }[]).map((r) => r.monster_id))];
      if (ids.length === 0) return { monsters: [], total: 0, page, pageSize };
      query = query.in("id", ids);
    }

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
      return { monsters: [], total: count ?? 0, page, pageSize };
    }
    if (error) throw new Error(`supabase list failed: ${error.message}`);

    const rows = data as MonsterRow[];
    const dropsByMonster = await this.dropsFor(rows.map((r) => r.id));
    return {
      monsters: rows.map((r) => rowToMonster(r, dropsByMonster.get(r.id) ?? [])),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async get(id: number): Promise<Monster | undefined> {
    const { data, error } = await this.client.from("monsters").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get failed: ${error.message}`);
    if (!data) return undefined;
    const drops = await this.dropsFor([id]);
    return rowToMonster(data as MonsterRow, drops.get(id) ?? []);
  }

  private async writeDrops(monster: Monster): Promise<void> {
    const { error: delError } = await this.client.from("monster_drops").delete().eq("monster_id", monster.id);
    if (delError) throw new Error(`supabase drops delete failed: ${delError.message}`);
    const rows = monsterToDropRows(monster);
    if (rows.length > 0) {
      const { error } = await this.client.from("monster_drops").insert(rows);
      if (error) throw new Error(`supabase drops insert failed: ${error.message}`);
    }
  }

  async create(monster: Monster): Promise<Monster> {
    const { error } = await this.client.from("monsters").insert(monsterToRow(monster));
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`monster ${monster.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase create failed: ${error.message}`);
    await this.writeDrops(monster);
    return monster;
  }

  async update(id: number, monster: Monster): Promise<Monster | undefined> {
    const row = { ...monsterToRow(monster), updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("monsters").update(row).eq("id", id).select("id");
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`monster ${monster.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase update failed: ${error.message}`);
    if (!data || data.length === 0) return undefined;
    await this.writeDrops(monster);
    return monster;
  }

  async remove(id: number): Promise<boolean> {
    // monster_drops cai via FK on delete cascade
    const { data, error } = await this.client.from("monsters").delete().eq("id", id).select("id");
    if (error) throw new Error(`supabase remove failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
