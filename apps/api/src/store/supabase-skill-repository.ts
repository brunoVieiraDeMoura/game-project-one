import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Skill } from "@ragnarok/game-data";
import type { SkillListQuery, SkillListResult, SkillRepository } from "./skill-repository";
import { skillToRow, rowToSkill, type SkillRow } from "./skill-row";

const PG_UNIQUE_VIOLATION = "23505";

/** PostgREST capa `range()` nesse tanto de linhas por request, mesmo pedindo
 * mais (sem erro — trunca calado). Chamadas internas tipo
 * `list({pageSize: 100_000})` (JobDatabaseWriter "pega tudo pro resolver")
 * precisam paginar em loop acima disso, ou perdem silenciosamente qualquer
 * skill com id fora das primeiras 1000 (skill_id alto = exatamente as
 * skills custom, GP_BLINK/GPQA_BOLT inclusive). */
const SUPABASE_MAX_ROWS = 1000;

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
    const buildQuery = () => {
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
      return query.order("id");
    };

    const start = (page - 1) * pageSize;
    const rows: SkillRow[] = [];
    let total = 0;
    // pageSize maior que o cap do PostgREST (1000) precisa de várias
    // requests em range() — uma só request devolveria a fatia truncada.
    for (let offset = start; offset < start + pageSize; offset += SUPABASE_MAX_ROWS) {
      const end = Math.min(offset + SUPABASE_MAX_ROWS, start + pageSize) - 1;
      const { data, error, count } = await buildQuery().range(offset, end);
      if (error && error.code === "PGRST103") break;
      if (error) throw new Error(`supabase list failed: ${error.message}`);
      total = count ?? 0;
      const chunk = data as SkillRow[];
      rows.push(...chunk);
      if (chunk.length < end - offset + 1) break; // acabaram as linhas
    }
    return {
      skills: rows.map(rowToSkill),
      total,
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

  async setIcon(id: number, filename: string | null): Promise<Skill | undefined> {
    const { data, error } = await this.client
      .from("skills")
      .update({ icon: filename, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`supabase setIcon failed: ${error.message}`);
    return data ? rowToSkill(data as SkillRow) : undefined;
  }
}
