import { existsSync, readFileSync } from "node:fs";

/** numeric EFST id (do pacote ZC_MSG_STATE_CHANGE4/5) → nome do enum
 * (`"EFST_PROVOKE"`), gerado por `pnpm --filter @ragnarok/legacy-migration
 * migrate:efst` a partir de `rathena/src/map/status.hpp`. */
export type EfstTable = Map<number, string>;

export function loadEfstTable(path: string): EfstTable {
  const table: EfstTable = new Map();
  if (!existsSync(path)) return table;
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
  for (const [id, name] of Object.entries(raw)) table.set(Number(id), name);
  return table;
}
