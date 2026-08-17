import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `enum efst_type` (rathena/src/map/status.hpp) → efst.json (numeric EFST id
 * → nome do enum, ex. `{"0":"EFST_PROVOKE"}`).
 *
 * Por que existe: o pacote de status-icon do rAthena (ZC_MSG_STATE_CHANGE4/5,
 * "auditoria buffs/debuffs" 2026-08-14) manda só o id NUMÉRICO — o servidor já
 * traduz SC_* pra EFST_* antes de montar o pacote (`status_db.getIcon`). O
 * catálogo migrado (`statuses.json`) guarda o campo `icon` como o NOME do
 * enum (`"EFST_PROVOKE"`), não o número — esta tabela é a ponte que falta
 * entre os dois, pro `apps/api` resolver id→status sem adivinhar.
 *
 * Usage: pnpm migrate:efst
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

const START_MARKER = "@APIHOOK_START(EFST_ENUM)";
const END_MARKER = "@APIHOOK_END";

/**
 * Ordem de declaração do enum C++ = id numérico, com resets explícitos
 * (`NOME = N`) — semântica de enum de verdade, não índice de linha (o bloco
 * TEM saltos: `EFST_SILVERVEIN_RUSH_POSTDELAY = 596`, `EFST_BLOCK = 1688`,
 * ~19 no total). Mesmo padrão de `migrate-jobs.ts: parseJobIds` (contador +
 * reset em `=`), só que aqui com valor podendo ser negativo (`EFST_BLANK =
 * -1`) e comentário à direita (`EFST_OVERCOMING_CRISIS,	//1671`).
 *
 * `EFST_BLANK` e `EFST_MAX` são sentinelas, não status reais — descartados do
 * mapa final mas ainda avançam o contador (mesma regra que exclui `JOB_MAX`
 * em `parseJobIds`).
 */
export function parseEfstIds(source: string): Map<number, string> {
  const start = source.indexOf(START_MARKER);
  if (start < 0) throw new Error(`marcador "${START_MARKER}" não encontrado em status.hpp`);
  const end = source.indexOf(END_MARKER, start);
  if (end < 0) throw new Error(`marcador "${END_MARKER}" não encontrado em status.hpp`);
  const block = source.slice(start, end);

  const ids = new Map<number, string>();
  let next = 0;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*(-?\d+))?\s*,?\s*$/);
    if (!m) continue;
    const name = m[1]!;
    if (m[2] !== undefined) next = Number(m[2]);
    if (name !== "EFST_BLANK" && name !== "EFST_MAX") ids.set(next, name);
    next++;
  }
  return ids;
}

function main() {
  const src = readFileSync(join(REPO_ROOT, "rathena", "src", "map", "status.hpp"), "utf-8");
  const ids = parseEfstIds(src);

  const out: Record<string, string> = {};
  for (const [id, name] of [...ids.entries()].sort((a, b) => a[0] - b[0])) out[String(id)] = name;

  const outDir = join(__dirname, "..", "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "efst.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`efst.json: ${ids.size} ids → ${outPath}`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("migrate-efst.ts");
if (isMain) main();
