import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// apps/api/.env — optional; without it the API falls back to the JSON store.
try {
  process.loadEnvFile(join(__dirname, "..", ".env"));
} catch {
  // no .env file
}

export const env = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

  /**
   * MariaDB do rAthena (WSL). Com estas variáveis, itens e monstros são lidos
   * e gravados NAS TABELAS DO SERVIDOR (`item_db_re`/`mob_db_re`) — é o que
   * transforma o admin em editor do jogo de verdade. Sem elas, a API cai no
   * Supabase/JSON como antes.
   */
  roDbHost: process.env.RO_DB_HOST,
  roDbPort: Number(process.env.RO_DB_PORT ?? 3306),
  roDbUser: process.env.RO_DB_USER ?? "gameproject",
  roDbPassword: process.env.RO_DB_PASSWORD ?? "gameproject",
  roDbName: process.env.RO_DB_NAME ?? "gameproject",
};
