/**
 * Amarra um mapa 3D a um mapa do rAthena.
 *
 * O servidor manda a posição em célula do mapa legado (prt_fild08 é 400×400) e
 * o mapa 3D é só uma JANELA dessa grade. Este script grava qual mapa e onde
 * fica a janela — por padrão CENTRADA na célula informada, que é onde o
 * personagem nasce (start_point em rathena-conf/char_conf.txt).
 *
 *   pnpm --filter @ragnarok/api link:legacy-map novo_ms4yewiz prt_fild08 170 373
 *
 * Roda direto no Supabase (service role), igual aos seeds — não passa pela API
 * e portanto não precisa de token de admin.
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";
import { rowToMap, mapToRow, type MapRow } from "../store/map-row.js";

const [mapId, legacyName, centerXRaw, centerYRaw] = process.argv.slice(2);

if (!mapId || !legacyName || !centerXRaw || !centerYRaw) {
  console.error(
    "uso: link:legacy-map <mapa3d> <mapaRathena> <celulaX> <celulaY>\n" +
      "  ex: link:legacy-map novo_ms4yewiz prt_fild08 170 373",
  );
  process.exit(1);
}

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em apps/api/.env");
  process.exit(1);
}

const centerX = Number(centerXRaw);
const centerY = Number(centerYRaw);

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

const { data, error } = await supabase.from("maps").select("*").eq("id", mapId).single();
if (error || !data) {
  console.error(`mapa "${mapId}" não encontrado:`, error?.message);
  process.exit(1);
}

const map = rowToMap(data as MapRow);

// Janela centrada no ponto: o personagem nasce no meio do pedaço desenhado, não
// na quina. Nunca negativa (o mapa legado começa em 0,0).
const originX = Math.max(0, Math.round(centerX - map.size.width / 2));
const originY = Math.max(0, Math.round(centerY - map.size.height / 2));

const updated = mapToRow({ ...map, legacy: { mapName: legacyName, originX, originY } });

const { error: saveError } = await supabase.from("maps").update(updated).eq("id", mapId);
if (saveError) {
  console.error("falha ao salvar:", saveError.message);
  process.exit(1);
}

console.log(
  `${mapId} → ${legacyName}: janela ${map.size.width}×${map.size.height} a partir de (${originX},${originY}); ` +
    `célula (${centerX},${centerY}) cai em (${centerX - originX},${centerY - originY}) no mapa 3D`,
);
