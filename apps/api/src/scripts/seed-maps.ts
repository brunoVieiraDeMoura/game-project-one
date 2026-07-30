import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { GameMapSchema } from "@ragnarok/map-format";
import { env } from "../env.js";
import { mapToRow } from "../store/map-row.js";

/**
 * Seed da tabela maps a partir de tools/legacy-migration/output/maps (um JSON
 * por mapa). Upsert por id — re-rodar sobrescreve edições do editor (uso:
 * carga inicial / re-import).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = join(__dirname, "..", "..", "..", "..", "tools", "legacy-migration", "output", "maps");

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em apps/api/.env");
  process.exit(1);
}

const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json"));
console.log(`${files.length} mapas em ${MAPS_DIR}`);

for (const file of files) {
  const map = GameMapSchema.parse(JSON.parse(readFileSync(join(MAPS_DIR, file), "utf-8")));
  const { error } = await client.from("maps").upsert(mapToRow(map), { onConflict: "id" });
  if (error) {
    console.error(`${file}: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ${map.id} (${map.size.width}×${map.size.height}, ${map.spawns.length} spawns)`);
}

const { count, error: countError } = await client.from("maps").select("id", { count: "exact", head: true });
if (countError) throw new Error(countError.message);
console.log(`seed ok — tabela maps tem ${count} linhas`);
