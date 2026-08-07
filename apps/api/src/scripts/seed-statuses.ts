import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { StatusEffectDefSchema } from "@ragnarok/game-data";
import { env } from "../env.js";
import { statusToRow } from "../store/status-row.js";

/**
 * Seed da tabela statuses a partir de tools/legacy-migration/output/
 * statuses.json. Upsert por id — re-rodar sobrescreve edições do admin
 * (uso: carga inicial / re-import).
 *
 * `--only-derived`: grava só description/params/status_group (os campos que
 * migrate:statuses recalcula do rathena/doc/status_change.txt e da regra de
 * grupo). NUNCA inclui `category` — é o campo que o admin edita à mão pra
 * promover um status a "buff" (não há sinal confiável em status.yml pra
 * derivar isso, ver packages/game-data/src/status.ts). Rodar o seed cheio
 * uma vez (pra aplicar a categoria "debuff" alargada) e depois só
 * --only-derived preserva qualquer curadoria manual subsequente.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATUSES_PATH = join(
  __dirname, "..", "..", "..", "..",
  "tools", "legacy-migration", "output", "statuses.json",
);
const BATCH_SIZE = 200;

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em apps/api/.env");
  process.exit(1);
}

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const onlyDerived = process.argv.includes("--only-derived");

const raw = JSON.parse(readFileSync(STATUSES_PATH, "utf-8")) as unknown[];
const rows = raw.map((entry) => {
  const full = statusToRow(StatusEffectDefSchema.parse(entry));
  if (!onlyDerived) return full;
  return {
    id: full.id,
    description: full.description,
    params: full.params,
    status_group: full.status_group,
  };
});
console.log(`${rows.length} statuses lidos de ${STATUSES_PATH}${onlyDerived ? " (--only-derived: description/params/status_group só)" : ""}`);

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const { error } = await client.from("statuses").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error(`lote ${i}: ${error.message}`);
    process.exit(1);
  }
}

const { count, error: countError } = await client
  .from("statuses")
  .select("id", { count: "exact", head: true });
if (countError) throw new Error(countError.message);
console.log(`seed ok — tabela statuses tem ${count} linhas`);
