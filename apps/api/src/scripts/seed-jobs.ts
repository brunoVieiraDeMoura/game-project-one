import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { JobClassSchema } from "@ragnarok/game-data";
import { env } from "../env.js";
import { jobClassToRow } from "../store/job-class-row.js";

/**
 * Seed da tabela job_classes a partir de tools/legacy-migration/output/
 * job-classes.json. Upsert por id — re-rodar sobrescreve edições do admin
 * (uso: carga inicial / re-import).
 *
 * Duas passadas por causa do FK parent_class_id → job_classes.id:
 * primeiro todos sem parent, depois update com os parents.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOBS_PATH = join(
  __dirname, "..", "..", "..", "..",
  "tools", "legacy-migration", "output", "job-classes.json",
);
const BATCH_SIZE = 100;

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em apps/api/.env");
  process.exit(1);
}

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const raw = JSON.parse(readFileSync(JOBS_PATH, "utf-8")) as unknown[];
const rows = raw.map((entry) => jobClassToRow(JobClassSchema.parse(entry)));
console.log(`${rows.length} classes lidas de ${JOBS_PATH}`);

// passada 1: sem parent (evita violação de FK em qualquer ordem)
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({ ...r, parent_class_id: null }));
  const { error } = await client.from("job_classes").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error(`lote ${i}: ${error.message}`);
    process.exit(1);
  }
}

// passada 2: aplica parents
for (const row of rows) {
  if (row.parent_class_id === null) continue;
  const { error } = await client
    .from("job_classes")
    .update({ parent_class_id: row.parent_class_id })
    .eq("id", row.id);
  if (error) {
    console.error(`parent de ${row.id}: ${error.message}`);
    process.exit(1);
  }
}

const { count, error: countError } = await client
  .from("job_classes")
  .select("id", { count: "exact", head: true });
if (countError) throw new Error(countError.message);
console.log(`seed ok — tabela job_classes tem ${count} linhas`);
