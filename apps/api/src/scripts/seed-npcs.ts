import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { NpcSchema } from "@ragnarok/game-data";
import { env } from "../env.js";
import { npcToRow } from "../store/npc-row.js";

/**
 * Seed da tabela npcs a partir de tools/legacy-migration/output/npcs.json.
 * Upsert por id — re-rodar sobrescreve edições do admin (uso: carga inicial /
 * re-import).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const NPCS_PATH = join(
  __dirname, "..", "..", "..", "..",
  "tools", "legacy-migration", "output", "npcs.json",
);
const BATCH_SIZE = 200;

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em apps/api/.env");
  process.exit(1);
}

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const raw = JSON.parse(readFileSync(NPCS_PATH, "utf-8")) as unknown[];
const rows = raw.map((entry) => npcToRow(NpcSchema.parse(entry)));
console.log(`${rows.length} NPCs lidos de ${NPCS_PATH}`);

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  const { error } = await client.from("npcs").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error(`lote ${i}: ${error.message}`);
    process.exit(1);
  }
}

const { count, error: countError } = await client
  .from("npcs")
  .select("id", { count: "exact", head: true });
if (countError) throw new Error(countError.message);
console.log(`seed ok — tabela npcs tem ${count} linhas`);
