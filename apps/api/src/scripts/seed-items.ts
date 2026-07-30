import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ItemSchema } from "@ragnarok/game-data";
import { env } from "../env.js";
import { itemToRow } from "../store/item-row.js";

/**
 * Seeds the hosted Supabase `items` table from the legacy migration output
 * (tools/legacy-migration/output/items.json). Upsert by id — safe to re-run;
 * re-running overwrites admin edits with legacy values, so it's meant for
 * initial load / full re-import only.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITEMS_PATH = join(
  __dirname, "..", "..", "..", "..",
  "tools", "legacy-migration", "output", "items.json",
);
const BATCH_SIZE = 500;

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em apps/api/.env");
  process.exit(1);
}

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const raw = JSON.parse(readFileSync(ITEMS_PATH, "utf-8")) as unknown[];
const rows = raw.map((entry) => itemToRow(ItemSchema.parse(entry)));
console.log(`${rows.length} itens lidos de ${ITEMS_PATH}`);

let done = 0;
for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const { error } = await client.from("items").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error(`lote ${i}-${i + batch.length}: ${error.message}`);
    process.exit(1);
  }
  done += batch.length;
  if (done % 5000 < BATCH_SIZE || done === rows.length) {
    console.log(`${done}/${rows.length}`);
  }
}

const { count, error: countError } = await client
  .from("items")
  .select("id", { count: "exact", head: true });
if (countError) throw new Error(countError.message);
console.log(`seed ok — tabela items tem ${count} linhas`);
