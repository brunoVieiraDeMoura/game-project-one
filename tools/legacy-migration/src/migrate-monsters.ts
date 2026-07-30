import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { MonsterSchema, type Monster, type MonsterSpawn } from "@ragnarok/game-data";
import { toSnake, flagArray } from "./mappings";

/**
 * mob_db migration: rathena/db/<ruleset>/mob_db.yml + spawns dos arquivos
 * listados em rathena/npc/re/scripts_monsters.conf → monsters.json matching
 * @ragnarok/game-data MonsterSchema.
 *
 * Usage: pnpm migrate:monsters [--ruleset re|pre-re] [--out <path>]
 *
 * Renewal: Attack = base ATK, Attack2 = base MATK. Drops resolvidos por
 * aegisName → itemId via items.json (não resolvido = warning REVISAR, nunca
 * descartado em silêncio). aiMode/chasesAttacker derivados da tabela de
 * códigos Aegis em rathena/doc/mob_db_mode_list.txt (bits MD_*).
 * Skills de monstro (mob_skill_db.txt) ficam pra fase posterior — skills[]
 * vazio por enquanto.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
/** rathena/src/common/mmo.hpp:93 */
const DEFAULT_WALK_SPEED = 150;

interface RawDrop {
  Item: string;
  Rate: number;
  StealProtected?: boolean;
  RandomOptionGroup?: string;
  Index?: number;
}

interface RawMob {
  Id: number;
  AegisName: string;
  Name: string;
  JapaneseName?: string;
  Level?: number;
  Hp?: number;
  Sp?: number;
  BaseExp?: number;
  JobExp?: number;
  MvpExp?: number;
  Attack?: number;
  Attack2?: number;
  Defense?: number;
  MagicDefense?: number;
  Resistance?: number;
  MagicResistance?: number;
  Str?: number;
  Agi?: number;
  Vit?: number;
  Int?: number;
  Dex?: number;
  Luk?: number;
  AttackRange?: number;
  SkillRange?: number;
  ChaseRange?: number;
  Size?: string;
  Race?: string;
  RaceGroups?: Record<string, boolean>;
  Element?: string;
  ElementLevel?: number;
  WalkSpeed?: number;
  AttackDelay?: number;
  AttackMotion?: number;
  ClientAttackMotion?: number;
  DamageMotion?: number;
  DamageTaken?: number;
  GroupId?: number;
  Title?: string;
  Ai?: string | number;
  Class?: string;
  Modes?: Record<string, boolean>;
  MvpDrops?: RawDrop[];
  Drops?: RawDrop[];
}

const ELEMENT_MAP: Record<string, string> = {
  Neutral: "neutral",
  Water: "water",
  Earth: "earth",
  Fire: "fire",
  Wind: "wind",
  Poison: "poison",
  Holy: "holy",
  Dark: "shadow",
  Ghost: "ghost",
  Undead: "undead",
};

/** Aegis AI code → rA mode bits (rathena/doc/mob_db_mode_list.txt, linhas 123-143) */
const AI_MODE_BITS: Record<string, number> = {
  "01": 0x0081, "02": 0x0083, "03": 0x1089, "04": 0x3885, "05": 0x2085,
  "06": 0x0000, "07": 0x108b, "08": 0x7085, "09": 0x3095, "10": 0x0084,
  "11": 0x0084, "12": 0x2085, "13": 0x308d, "17": 0x0091, "19": 0x3095,
  "20": 0x3295, "21": 0x3695, "24": 0x00a1, "25": 0x0001, "26": 0xb695,
  "27": 0x8084,
  // MONSTER_TYPE_ABR_* (rathena/src/map/mob.hpp:180-181)
  Abr_Passive: 0x21, Abr_Offensive: 0xa5,
};
const MD_LOOTER = 0x0002;
const MD_AGGRESSIVE = 0x0004;
const MD_ASSIST = 0x0008;
const MD_CHANGETARGETCHASE = 0x2000;

function deriveAi(code: string): { aiMode: Monster["aiMode"]; chasesAttacker: boolean } {
  const bits = AI_MODE_BITS[code];
  if (bits === undefined) return { aiMode: "passive", chasesAttacker: false };
  if (code === "06") return { aiMode: "plant", chasesAttacker: false };
  const aiMode =
    bits & MD_AGGRESSIVE ? "aggressive" : bits & MD_LOOTER ? "looter" : bits & MD_ASSIST ? "assist" : "passive";
  return { aiMode, chasesAttacker: (bits & MD_CHANGETARGETCHASE) !== 0 };
}

/** linha de spawn permanente (npc.cpp:5230-5235):
 *  w1=<map>{,<x>,<y>{,<xs>,<ys>}}  w2=monster|boss_monster
 *  w3=<nome>{,<level>}  w4=<id>,<qtd>{,<delay1>{,<delay2>{,...}}}
 *  delay1 default 5000 (init em npc_parse_mob) */
const SPAWN_RE =
  /^([a-zA-Z0-9_@-]+)(?:,(\d+),(\d+)(?:,(\d+),(\d+))?)?\t(monster|boss_monster)\t([^\t]+)\t ?([A-Za-z0-9_']+),(\d+)(?:,(\d+))?(?:,(\d+))?/;

function parseSpawns(warnings: string[], mobIdByAegis: Map<string, number>): Map<number, MonsterSpawn[]> {
  const confPath = join(REPO_ROOT, "rathena", "npc", "re", "scripts_monsters.conf");
  const files = readFileSync(confPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("npc:"))
    .map((l) => l.replace(/^npc:\s*/, "").trim());

  const spawnsByMob = new Map<number, MonsterSpawn[]>();
  let totalLines = 0;

  for (const rel of files) {
    const filePath = join(REPO_ROOT, "rathena", rel.replace(/\//g, "/"));
    if (!existsSync(filePath)) {
      warnings.push(`arquivo de spawn não encontrado: ${rel}`);
      continue;
    }
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("//")) continue;
      if (!/\t(monster|boss_monster)\t/.test(line)) continue;
      const m = line.match(SPAWN_RE);
      if (!m) {
        warnings.push(`linha de spawn não reconhecida em ${rel}: ${trimmed.slice(0, 80)} — REVISAR`);
        continue;
      }
      totalLines++;
      const [, mapId, xStr, yStr, xsStr, ysStr, kind, , idStr, amountStr, delay1Str, delay2Str] = m;
      // sprite pode ser id numérico ou AegisName (npc_parse_mob resolve os dois)
      const mobId = /^\d+$/.test(idStr!) ? Number(idStr) : mobIdByAegis.get(idStr!.toUpperCase());
      if (mobId === undefined) {
        warnings.push(`spawn com AegisName desconhecido "${idStr}" em ${rel} — REVISAR`);
        continue;
      }
      const x = Number(xStr ?? 0);
      const y = Number(yStr ?? 0);
      const spawn: MonsterSpawn = {
        mapId: mapId!,
        amount: Number(amountStr),
        respawnTimeMs: Number(delay1Str ?? 5000),
        respawnVarianceMs: Number(delay2Str ?? 0),
        boss: kind === "boss_monster",
        ...(x !== 0 || y !== 0
          ? { area: { x, y, xs: Number(xsStr ?? 0), ys: Number(ysStr ?? 0) } }
          : {}),
      };
      const list = spawnsByMob.get(mobId) ?? [];
      list.push(spawn);
      spawnsByMob.set(mobId, list);
    }
  }

  console.log(`${totalLines} linhas de spawn lidas de ${files.length} arquivos`);
  return spawnsByMob;
}

function main() {
  const args = process.argv.slice(2);
  const rulesetIdx = args.indexOf("--ruleset");
  const ruleset = rulesetIdx >= 0 ? args[rulesetIdx + 1] : "re";
  const outIdx = args.indexOf("--out");
  const outPath =
    outIdx >= 0 && args[outIdx + 1]
      ? args[outIdx + 1]!
      : join(__dirname, "..", "output", "monsters.json");
  const outDir = dirname(outPath);

  const sourcePath = join(REPO_ROOT, "rathena", "db", ruleset === "pre-re" ? "pre-re" : "re", "mob_db.yml");
  // uniqueKeys off: mob_db.yml tem chave duplicada (EP172ALPHA em RaceGroups,
  // linha ~105513) que o parser do rAthena tolera
  const doc = parseYaml(readFileSync(sourcePath, "utf8"), { uniqueKeys: false }) as { Body: RawMob[] };

  const items = JSON.parse(readFileSync(join(outDir, "items.json"), "utf8")) as {
    id: number;
    aegisName: string;
  }[];
  const itemIdByAegis = new Map(items.map((i) => [i.aegisName.toLowerCase(), i.id]));

  const warnings: string[] = [];
  const mobIdByAegis = new Map(doc.Body.map((m) => [m.AegisName.toUpperCase(), m.Id]));
  const spawnsByMob = parseSpawns(warnings, mobIdByAegis);

  const monsters: Monster[] = [];
  const invalid: { mob: string; error: string }[] = [];

  for (const raw of doc.Body) {
    const warn = (msg: string) => warnings.push(`${raw.AegisName} (${raw.Id}): ${msg}`);

    const mapDrops = (drops: RawDrop[] | undefined) => {
      const out: Record<string, unknown>[] = [];
      for (const d of drops ?? []) {
        const itemId = itemIdByAegis.get(d.Item.toLowerCase());
        if (itemId === undefined) {
          warn(`drop não resolvido (item "${d.Item}" não existe em items.json) — REVISAR`);
          continue;
        }
        out.push({
          itemId,
          rate: d.Rate / 100, // n/10000 → %
          stealProtected: d.StealProtected ?? false,
          randomOptionGroup: d.RandomOptionGroup,
          index: d.Index,
        });
      }
      return out;
    };

    const aiCode = raw.Ai !== undefined ? String(raw.Ai).padStart(2, "0") : "06";
    if (raw.Ai !== undefined && AI_MODE_BITS[aiCode] === undefined) {
      warn(`código de AI desconhecido: ${aiCode} — REVISAR`);
    }
    const { aiMode, chasesAttacker } = deriveAi(aiCode);
    const modes = flagArray(raw.Modes);
    const element = ELEMENT_MAP[raw.Element ?? "Neutral"];
    if (!element) warn(`elemento desconhecido: ${raw.Element}`);

    const candidate = {
      id: raw.Id,
      aegisName: raw.AegisName,
      name: raw.Name,
      level: raw.Level ?? 1,
      hp: raw.Hp ?? 1,
      sp: raw.Sp ?? 1,
      baseExp: raw.BaseExp ?? 0,
      jobExp: raw.JobExp ?? 0,
      mvpExp: raw.MvpExp ?? 0,
      stats: {
        str: raw.Str ?? 1,
        agi: raw.Agi ?? 1,
        vit: raw.Vit ?? 1,
        int: raw.Int ?? 1,
        dex: raw.Dex ?? 1,
        luk: raw.Luk ?? 1,
      },
      attackRange: Math.max(1, raw.AttackRange ?? 1),
      skillRange: raw.SkillRange ?? 0,
      chaseRange: raw.ChaseRange ?? 0,
      attack: raw.Attack ?? 0,
      magicAttack: raw.Attack2 ?? 0,
      defense: raw.Defense ?? 0,
      magicDefense: raw.MagicDefense ?? 0,
      resistance: raw.Resistance ?? 0,
      magicResistance: raw.MagicResistance ?? 0,
      walkSpeed: raw.WalkSpeed ?? DEFAULT_WALK_SPEED,
      attackDelayMs: raw.AttackDelay ?? 0,
      attackMotionMs: raw.AttackMotion ?? 0,
      clientAttackMotionMs: raw.ClientAttackMotion,
      damageMotionMs: raw.DamageMotion ?? 0,
      damageTaken: raw.DamageTaken ?? 100,
      ai: aiCode,
      aiMode,
      chasesAttacker,
      class: raw.Class ? toSnake(raw.Class) : "normal",
      modes,
      raceGroups: flagArray(raw.RaceGroups),
      groupId: raw.GroupId ?? 0,
      title: raw.Title,
      race: raw.Race ? toSnake(raw.Race) : "formless",
      element: { type: element ?? "neutral", level: raw.ElementLevel ?? 1 },
      size: raw.Size ? toSnake(raw.Size) : "small",
      drops: mapDrops(raw.Drops),
      mvp: raw.Modes?.Mvp === true,
      mvpDrops: mapDrops(raw.MvpDrops),
      skills: [],
      spawns: spawnsByMob.get(raw.Id) ?? [],
    };

    const parsed = MonsterSchema.safeParse(candidate);
    if (parsed.success) {
      monsters.push(parsed.data);
    } else {
      invalid.push({ mob: raw.AegisName, error: parsed.error.message });
    }
  }

  // spawns de ids que não existem no mob_db → nunca descartar em silêncio
  for (const mobId of spawnsByMob.keys()) {
    if (!monsters.some((m) => m.id === mobId)) {
      warnings.push(`spawn referencia mob id ${mobId} ausente do mob_db — REVISAR`);
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(monsters, null, 1));
  writeFileSync(
    join(outDir, "monsters-migration-report.json"),
    JSON.stringify(
      {
        source: sourcePath,
        total: doc.Body.length,
        migrated: monsters.length,
        invalid,
        withSpawns: monsters.filter((m) => m.spawns.length > 0).length,
        mvps: monsters.filter((m) => m.mvp).length,
        warnings,
        note: "skills de monstro (mob_skill_db.txt) não migradas nesta fase — skills[] vazio",
      },
      null,
      2,
    ),
  );

  console.log(`monsters: ${monsters.length}/${doc.Body.length} migrados, ${invalid.length} inválidos`);
  console.log(`${monsters.filter((m) => m.spawns.length > 0).length} com spawns; ${monsters.filter((m) => m.mvp).length} MVPs`);
  console.log(`${warnings.length} warnings — ver monsters-migration-report.json`);
  console.log(`saída: ${outPath}`);
}

main();
