import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { JobClass } from "@ragnarok/game-data";
import type { JobClassListQuery, JobClassListResult, JobClassRepository } from "./job-class-repository";
import { jobClassToRow, rowToJobClass, type JobClassRow } from "./job-class-row";

const PG_UNIQUE_VIOLATION = "23505";

/** Mesmo cap silencioso do PostgREST que `supabase-skill-repository.ts`
 * documenta — chamadas internas "pega tudo" (`list({pageSize: 100_000})`)
 * precisam paginar em loop acima disso. */
const SUPABASE_MAX_ROWS = 1000;

function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

/** JobClassRepository backed by hosted Supabase (service role, same as items). */
export class SupabaseJobClassRepository implements JobClassRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async list({ page, pageSize, search }: JobClassListQuery): Promise<JobClassListResult> {
    const buildQuery = () => {
      let query = this.client.from("job_classes").select("*", { count: "exact" });
      if (search) {
        const q = sanitizeSearch(search);
        if (q) {
          const filters = [`name.ilike.*${q}*`];
          if (/^\d+$/.test(q)) filters.push(`id.eq.${q}`);
          query = query.or(filters.join(","));
        }
      }
      return query.order("id");
    };

    const start = (page - 1) * pageSize;
    const rows: JobClassRow[] = [];
    let total = 0;
    for (let offset = start; offset < start + pageSize; offset += SUPABASE_MAX_ROWS) {
      const end = Math.min(offset + SUPABASE_MAX_ROWS, start + pageSize) - 1;
      const { data, error, count } = await buildQuery().range(offset, end);
      if (error && error.code === "PGRST103") break;
      if (error) throw new Error(`supabase list failed: ${error.message}`);
      total = count ?? 0;
      const chunk = data as JobClassRow[];
      rows.push(...chunk);
      if (chunk.length < end - offset + 1) break;
    }
    return {
      jobClasses: rows.map(rowToJobClass),
      total,
      page,
      pageSize,
    };
  }

  async get(id: number): Promise<JobClass | undefined> {
    const { data, error } = await this.client.from("job_classes").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get failed: ${error.message}`);
    return data ? rowToJobClass(data as JobClassRow) : undefined;
  }

  async create(jobClass: JobClass): Promise<JobClass> {
    const { error } = await this.client.from("job_classes").insert(jobClassToRow(jobClass));
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`job class ${jobClass.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase create failed: ${error.message}`);
    return jobClass;
  }

  async update(id: number, jobClass: JobClass): Promise<JobClass | undefined> {
    const row = { ...jobClassToRow(jobClass), updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("job_classes").update(row).eq("id", id).select("id");
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`job class ${jobClass.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase update failed: ${error.message}`);
    return data && data.length > 0 ? jobClass : undefined;
  }

  async remove(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("job_classes").delete().eq("id", id).select("id");
    if (error) throw new Error(`supabase remove failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
