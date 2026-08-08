import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NpcCatalogs } from "@ragnarok/game-data";

/**
 * Catálogos Node-side pro Validator de NPC (puro em `game-data`, este
 * arquivo só lê arquivo e devolve funções de consulta). Fontes:
 *
 * - mapas: `rathena/db/map_index.txt` — lista AUTORITATIVA de todo mapa que
 *   o servidor reconhece (1.295 nomes), não o subconjunto já migrado pro
 *   editor 3D (esses são só os mapas com CENA — `warp`/`goto`/`monster` no
 *   script valem pro mapa do RATHENA, que é mais amplo).
 * - itens/skills/monstros: `tools/legacy-migration/output/{items,skills,
 *   monsters}.json` — já migrados nas fases anteriores do pipeline.
 */

export function loadMapCatalog(rathenaRoot: string): Set<string> {
  const text = readFileSync(join(rathenaRoot, "db", "map_index.txt"), "utf8");
  const names = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//")) continue;
    const name = line.split(/\s+/)[0];
    if (name) names.add(name);
  }
  return names;
}

export function loadIdCatalog(outputDir: string, file: string): Set<number> {
  const rows = JSON.parse(readFileSync(join(outputDir, file), "utf8")) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

export interface NpcNameIndexEntry {
  labels: Set<string | null>;
}

/** índice cross-NPC pra `donpcevent` — construído a partir do MESMO corpus
 * que está sendo validado (não há catálogo "oficial" de NPCs fora dele
 * ainda; o `npcs.json` da migração antiga não tem `eventHandlers`). Chave
 * pelo nome completo E pelo nome de exibição (depois de `#`/`::`), mesma
 * regra de `idByFullName` em `migrate-npcs.ts`. */
export function buildNpcEventIndex(entries: { name: string; labels: (string | null)[] }[]): Map<string, NpcNameIndexEntry> {
  const index = new Map<string, NpcNameIndexEntry>();
  const add = (key: string, labels: (string | null)[]) => {
    let entry = index.get(key);
    if (!entry) {
      entry = { labels: new Set() };
      index.set(key, entry);
    }
    for (const l of labels) entry.labels.add(l);
  };
  for (const { name, labels } of entries) {
    add(name, labels);
    const ex = name.includes("::") ? name.split("::").pop()! : name.includes("#") ? name.split("#").pop()! : undefined;
    if (ex && ex !== name) add(ex, labels);
  }
  return index;
}

export function makeCatalogs(
  maps: Set<string>,
  items: Set<number>,
  skills: Set<number>,
  monsters: Set<number>,
  npcEventIndex?: Map<string, NpcNameIndexEntry>,
): NpcCatalogs {
  return {
    mapExists: (mapId) => maps.has(mapId),
    itemExists: (itemId) => items.has(itemId),
    skillExists: (skillId) => skills.has(skillId),
    monsterExists: (monsterId) => monsters.has(monsterId),
    npcEventExists: npcEventIndex
      ? (npcName, label) => {
          const entry = npcEventIndex.get(npcName);
          if (!entry) return false;
          return entry.labels.has(label);
        }
      : undefined,
  };
}
