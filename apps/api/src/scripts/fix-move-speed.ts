/**
 * `server_config.gameplay.moveSpeed` estava em 3 (default do schema: 20) —
 * achado da auditoria de showcase (velocidade "não padrão" em TODO mapa,
 * gpqa01 incluso, porque é config global, não por mapa). Só este campo muda;
 * o resto (renderDistance, groundColor, fogFracs, jumpHeight…) já foi
 * ajustado de propósito em algum momento e fica intacto.
 *
 *   pnpm --filter @ragnarok/api fix:move-speed
 *
 * Roda direto no Supabase (service role), mesmo padrão de link-legacy-map.ts.
 */
import { createClient } from "@supabase/supabase-js";
import { ServerConfigSchema } from "@ragnarok/game-data";
import { env } from "../env.js";

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em apps/api/.env");
  process.exit(1);
}

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
const ROW_ID = 1;

const { data, error } = await supabase.from("server_config").select("config").eq("id", ROW_ID).maybeSingle();
if (error || !data) {
  console.error("server_config não encontrado:", error?.message);
  process.exit(1);
}

const atual = ServerConfigSchema.parse(data.config);
console.log(`moveSpeed atual: ${atual.gameplay.moveSpeed} → 20`);

const novo = { ...atual, gameplay: { ...atual.gameplay, moveSpeed: 20 } };
const { error: saveError } = await supabase
  .from("server_config")
  .upsert({ id: ROW_ID, config: novo, updated_at: new Date().toISOString() });
if (saveError) {
  console.error("falha ao salvar:", saveError.message);
  process.exit(1);
}
console.log("gravado. resto da config (renderDistance, groundColor, fogFracs, jumpHeight…) intacto.");
