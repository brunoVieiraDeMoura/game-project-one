import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Skill } from "@ragnarok/game-data";
import type { SkillListQuery, SkillListResult, SkillRepository } from "./skill-repository";
import { skillToRow, rowToSkill, type SkillRow } from "./skill-row";

const PG_UNIQUE_VIOLATION = "23505";

function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

/** SkillRepository backed by hosted Supabase (service role, same as items). */
export class SupabaseSkillRepository implements SkillRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async list({ page, pageSize, search, classPrefix }: SkillListQuery): Promise<SkillListResult> {
    let query = this.client.from("skills").select("*", { count: "exact" });
    if (classPrefix && classPrefix.length > 0) query = query.in("class_prefix", classPrefix);
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
      return { skills: [], total: count ?? 0, page, pageSize };
    }
    if (error) throw new Error(`supabase list failed: ${error.message}`);
    return {
      skills: (data as SkillRow[]).map(rowToSkill),
      total: count ?? 0,
      page,
      pageSize,
    };
  }

  async get(id: number): Promise<Skill | undefined> {
    const { data, error } = await this.client.from("skills").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get failed: ${error.message}`);
    return data ? rowToSkill(data as SkillRow) : undefined;
  }

  async create(skill: Skill): Promise<Skill> {
    const { error } = await this.client.from("skills").insert(skillToRow(skill));
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`skill ${skill.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase create failed: ${error.message}`);
    return skill;
  }

  async update(id: number, skill: Skill): Promise<Skill | undefined> {
    const row = { ...skillToRow(skill), updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("skills").update(row).eq("id", id).select("id");
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`skill ${skill.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase update failed: ${error.message}`);
    return data && data.length > 0 ? skill : undefined;
  }

  async remove(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("skills").delete().eq("id", id).select("id");
    if (error) throw new Error(`supabase remove failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
