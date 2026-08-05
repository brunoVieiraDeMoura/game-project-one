import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GameMapSchema, MAP_SCHEMA_VERSION, type GameMap, type MapSpawn } from "@ragnarok/map-format";

/**
 * Migração de mapas: rathena/db/<ruleset>/map_cache.dat → um GameMap JSON por
 * mapa. Formato do cache confirmado em rathena/src/map/map.cpp:156-167 +
 * tool/mapcache.cpp e bytes reais do arquivo:
 *
 *   main_header (8 bytes, struct padded): file_size u32 @0, map_count u16 @4
 *   por mapa: map_info (20 bytes): name[12] @0, xs i16 @12, ys i16 @14,
 *             len i32 @16; seguido de `len` bytes de células zlib-deflate.
 *   células descomprimidas: 1 byte por célula (tipo 0/1/3/5), row-major.
 *
 * IMPORTANTE: o cache NÃO guarda altura (só o .gat do cliente tem, e o cliente
 * não está no repo — soul.txt: visuais recriados, não migrados). heightmap sai
 * zerado e flagged; o editor do admin pode autorar depois. waterLevel = null
 * (a reclassificação água já está embutida no tipo 3 pelo próprio rAthena).
 *
 * Spawns são enriquecidos a partir de monsters.json (spawns de mob por mapa) e
 * dos warps de npcs.json — dados já migrados, não adivinhados.
 *
 * Usage: pnpm migrate:maps [--ruleset re|pre-re] [--out <dir>]
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const MAP_NAME_LENGTH = 12; // rathena/src/common/mmo.hpp:163
const MAIN_HEADER_SIZE = 8; // struct padded (u32 + u16 + 2 pad) — confirmado nos bytes
const MAP_INFO_SIZE = 20;
const CELL_SIZE = 5; // convenção RO (skill-map-format; não verificado no fonte)

/** tipo de célula do gat/cache → CollisionType (map.cpp:3285-3296 map_gat2cell):
 *  0/2/4/6 = walkable+shootable (2/4/6 são variantes "???" mas andáveis),
 *  1 = não-andável (wall), 3 = água andável, 5 = gap não-andável mas atirável (cliff). */
const CELL_TYPE_TO_COLLISION: Record<number, GameMap["collision"][number]> = {
  0: "walkable",
  1: "wall",
  2: "walkable",
  3: "water",
  4: "walkable",
  5: "cliff",
  6: "walkable",
};

interface MobSpawnEntry {
  mapId: string;
  amount: number;
  respawnTimeMs: number;
  area?: { x: number; y: number; xs: number; ys: number };
  boss: boolean;
}
interface MigratedMonster {
  id: number;
  aegisName: string;
  spawns: MobSpawnEntry[];
}
interface MigratedNpc {
  id: string;
  name: string;
  mapId: string;
  position: [number, number, number];
  warp?: { mapId: string; position: [number, number, number]; triggerSpan: { xs: number; ys: number } };
}

function main() {
  const args = process.argv.slice(2);
  const rulesetIdx = args.indexOf("--ruleset");
  const ruleset = rulesetIdx >= 0 ? args[rulesetIdx + 1] : "re";
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : join(__dirname, "..", "output", "maps");
  const legacyOutDir = join(__dirname, "..", "output");
  // `--only prt_fild08,prontera` — o cache tem centenas de mapas e cada um
  // grande custa MB de JSON; regerar todos a cada ajuste é desperdício.
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 && args[onlyIdx + 1] ? new Set(args[onlyIdx + 1]!.split(",")) : null;

  /**
   * De qual cache ler.
   *
   * O rAthena guarda os mapas em DOIS arquivos, e o servidor lê os dois
   * (map.cpp:3920): `db/re/map_cache.dat` tem só os mapas específicos de
   * renewal — 8 no total, entre eles prt_fild08 e prontera — e
   * `db/map_cache.dat` tem o acervo inteiro, 1.288 mapas. Migrar só o primeiro
   * deixava o jogador cair em "mapa sem cena 3D" ao cruzar qualquer portal de
   * borda, porque o vizinho (moc_fild01, prt_fild07…) mora no outro arquivo.
   *
   * `--cache base|re|pre-re` escolhe. Sem `--only`, o base geraria 1.288 JSONs
   * (~1 GB), então ele exige o filtro.
   */
  const cacheIdx = args.indexOf("--cache");
  const cacheKind = cacheIdx >= 0 ? args[cacheIdx + 1] : ruleset === "pre-re" ? "pre-re" : "re";
  const cacheDir =
    cacheKind === "base" ? ["rathena", "db"] : ["rathena", "db", cacheKind === "pre-re" ? "pre-re" : "re"];
  const cachePath = join(REPO_ROOT, ...cacheDir, "map_cache.dat");
  if (cacheKind === "base" && !only) {
    console.error("--cache base sem --only geraria 1.288 mapas (~1 GB). Informe --only mapa1,mapa2.");
    process.exit(1);
  }
  const buf = readFileSync(cachePath);

  const mapCount = buf.readUInt16LE(4);
  const warnings: string[] = [];

  // índices de spawn a partir dos dados já migrados
  const spawnsByMap = new Map<string, MapSpawn[]>();
  const pushSpawn = (mapId: string, spawn: MapSpawn) => {
    const list = spawnsByMap.get(mapId) ?? [];
    list.push(spawn);
    spawnsByMap.set(mapId, list);
  };

  try {
    const monsters = JSON.parse(readFileSync(join(legacyOutDir, "monsters.json"), "utf8")) as MigratedMonster[];
    for (const mob of monsters) {
      for (const [i, sp] of mob.spawns.entries()) {
        const cx = sp.area ? sp.area.x : 0;
        const cy = sp.area ? sp.area.y : 0;
        pushSpawn(sp.mapId, {
          id: `mob-${mob.id}-${i}`,
          kind: "mob",
          refId: String(mob.id),
          position: [cx, 0, cy],
          count: sp.amount,
          respawnTimeMs: sp.respawnTimeMs,
          radius: sp.area ? Math.max(sp.area.xs, sp.area.ys) : 0,
        });
      }
    }
  } catch {
    warnings.push("monsters.json ausente — spawns de mob não enriquecidos (rodar migrate:monsters antes)");
  }

  try {
    const npcs = JSON.parse(readFileSync(join(legacyOutDir, "npcs.json"), "utf8")) as MigratedNpc[];
    for (const npc of npcs) {
      if (!npc.warp) continue;
      pushSpawn(npc.mapId, {
        id: `warp-${npc.id}`,
        kind: "warp",
        position: [npc.position[0], 0, npc.position[1]],
        target: { mapId: npc.warp.mapId, position: [npc.warp.position[0], 0, npc.warp.position[1]] },
      });
    }
  } catch {
    warnings.push("npcs.json ausente — warps não enriquecidos (rodar migrate:npcs antes)");
  }

  mkdirSync(outDir, { recursive: true });
  const maps: { id: string; width: number; height: number; spawns: number }[] = [];
  let offset = MAIN_HEADER_SIZE;

  for (let i = 0; i < mapCount; i++) {
    // name é null-terminated dentro de MAP_NAME_LENGTH bytes
    const nameEnd = buf.indexOf(0, offset);
    const name = buf.toString("ascii", offset, Math.min(nameEnd, offset + MAP_NAME_LENGTH));
    const xs = buf.readInt16LE(offset + 12);
    const ys = buf.readInt16LE(offset + 14);
    const len = buf.readInt32LE(offset + 16);
    const compressed = buf.subarray(offset + MAP_INFO_SIZE, offset + MAP_INFO_SIZE + len);
    offset += MAP_INFO_SIZE + len;

    if (only && !only.has(name)) continue;

    const cells = inflateSync(compressed);
    const expected = xs * ys;
    if (cells.length !== expected) {
      warnings.push(`${name}: células descomprimidas ${cells.length} ≠ ${expected} (xs*ys) — PULADO`);
      continue;
    }

    const collision: GameMap["collision"] = new Array(expected);
    for (let c = 0; c < expected; c++) {
      const type = cells[c]!;
      const mapped = CELL_TYPE_TO_COLLISION[type];
      if (!mapped) {
        warnings.push(`${name}: tipo de célula desconhecido ${type} na posição ${c} — tratado como wall`);
        collision[c] = "wall";
      } else {
        collision[c] = mapped;
      }
    }

    const candidate: GameMap = {
      id: name,
      name,
      size: { width: xs, height: ys },
      cellSize: CELL_SIZE,
      // Grade QUADRADA, uma célula = uma célula do rAthena. Antes isto saía como
      // "smooth" (plano legado) e o mapa 3D era uma janela de 32×32 autorada à
      // parte — o mundo jogado não correspondia ao mundo do servidor.
      terrainMode: "square",
      // altura ausente do cache (vem do .gat do cliente, fora do repo) — zerado,
      // flagged pra autoria no editor
      heightmap: new Array(expected).fill(0),
      collision,
      surface: [],
      // textura/escala por superfície são AUTORAIS (editor): o mapa importado
      // nasce com o padrão do cliente
      terrainStyle: {},
      waterLevel: null,
      props: [],
      spawns: spawnsByMap.get(name) ?? [],
      triggers: [],
      ramps: [],
      authoredHexScale: 1,
      lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
      // O mapa 3D É o mapa do servidor inteiro: a janela vira identidade, e
      // `clampToWindow` (net/legacyCells) nunca mais corta coordenada nenhuma.
      legacy: { mapName: name, originX: 0, originY: 0 },
      metadata: {
        sourceLegacyMap: name,
        version: MAP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
      },
    };

    const parsed = GameMapSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`${name}: inválido — ${parsed.error.message}`);
      continue;
    }
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(parsed.data));
    maps.push({ id: name, width: xs, height: ys, spawns: candidate.spawns.length });
  }

  writeFileSync(
    join(legacyOutDir, "maps-migration-report.json"),
    JSON.stringify(
      {
        source: cachePath,
        mapCount,
        migrated: maps.length,
        maps,
        warnings,
        note: "heightmap zerado: cache do rAthena não guarda altura (só o .gat do cliente, ausente do repo). waterLevel null: reclassificação de água já embutida no tipo 3.",
      },
      null,
      2,
    ),
  );

  console.log(`maps: ${maps.length}/${mapCount} migrados → ${outDir}`);
  console.log(`${warnings.length} warnings — ver maps-migration-report.json`);
}

main();
