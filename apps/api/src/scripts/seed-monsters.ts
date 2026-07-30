import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { MonsterSchema, type Monster } from "@ragnarok/game-data";
import { env } from "../env.js";
import { monsterToRow, monsterToDropRows } from "../store/monster-row.js";

/**
 * Seed das tabelas monsters + monster_drops a partir de
 * tools/legacy-migration/output/monsters.json. Upsert por id; drops são
 * reescritos (delete geral + insert). Re-rodar sobrescreve edições do admin
 * (uso: carga inicial / re-import).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONSTERS_PATH = join(
  __dirname, "..", "..", "..", "..",
  "tools", "legacy-migration", "output", "monsters.json",
);
const BATCH_SIZE = 200;

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em apps/api/.env");
  process.exit(1);
}

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const raw = JSON.parse(readFileSync(MONSTERS_PATH, "utf-8")) as unknown[];
const monsters: Monster[] = raw.map((entry) => MonsterSchema.parse(entry));
console.log(`${monsters.length} monstros lidos de ${MONSTERS_PATH}`);

for (let i = 0; i < monsters.length; i += BATCH_SIZE) {
  const batch = monsters.slice(i, i + BATCH_SIZE).map(monsterToRow);
  const { error } = await client.from("monsters").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error(`lote monsters ${i}: ${error.message}`);
    process.exit(1);
  }
}

// drops: reescrita total (idempotente e simples pra carga inicial)
{
  const { error } = await client.from("monster_drops").delete().gte("monster_id", 0);
  if (error) {
    console.error(`limpeza de monster_drops: ${error.message}`);
    process.exit(1);
  }
}
const allDrops = monsters.flatMap(monsterToDropRows);
for (let i = 0; i < allDrops.length; i += 500) {
  const batch = allDrops.slice(i, i + 500);
  const { error } = await client.from("monster_drops").insert(batch);
  if (error) {
    console.error(`lote drops ${i}: ${error.message}`);
    process.exit(1);
  }
}

const { count } = await client.from("monsters").select("id", { count: "exact", head: true });
const { count: dropCount } = await client.from("monster_drops").select("id", { count: "exact", head: true });
console.log(`seed ok — monsters: ${count} linhas, monster_drops: ${dropCount} linhas`);
