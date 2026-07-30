import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { JobClassSchema, type JobClass } from "@ragnarok/game-data";

/**
 * Job/class migration: rathena/db/<ruleset>/{job_stats,job_basepoints,job_exp,
 * job_aspd,skill_tree}.yml → job-classes.json matching JobClassSchema.
 *
 * Usage: pnpm migrate:jobs [--ruleset re|pre-re] [--out <path>]
 *
 * Job numeric ids come from `enum e_job` in rathena/src/common/mmo.hpp
 * (parsed, not hand-copied). Skill numeric ids come from skill_db.yml
 * (Id/Name only). Skill trees are flattened through Inherit, honoring
 * Exclude (excluded skills stay on the owning class, are not inherited).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

/** rAthena src/map/map.hpp `#define MAX_LEVEL 275` — fallback when a job has
 * no MaxBaseLevel/MaxJobLevel in job_exp.yml (cosmetic jobs). */
const RATHENA_MAX_LEVEL = 275;

/** BaseASPD weapon keys → ItemSubType (+ bare_hand/shield). */
const ASPD_WEAPON_MAP: Record<string, string> = {
  Fist: "fist",
  Dagger: "dagger",
  "1hSword": "1h_sword",
  "2hSword": "2h_sword",
  "1hSpear": "1h_spear",
  "2hSpear": "2h_spear",
  "1hAxe": "1h_axe",
  "2hAxe": "2h_axe",
  Mace: "mace",
  "2hMace": "2h_mace",
  Staff: "staff",
  "2hStaff": "2h_staff",
  Bow: "bow",
  Knuckle: "knuckle",
  Musical: "musical",
  Whip: "whip",
  Book: "book",
  Katar: "katar",
  Revolver: "revolver",
  Rifle: "rifle",
  Gatling: "gatling",
  Shotgun: "shotgun",
  Grenade: "grenade",
  Huuma: "huuma",
  Shield: "shield",
};

const BASE_STAT_KEYS = ["Str", "Agi", "Vit", "Int", "Dex", "Luk"] as const;
const TRAIT_STAT_KEYS = ["Pow", "Sta", "Wis", "Spl", "Con", "Crt"] as const;

interface LevelValue {
  Level: number;
}

interface RawStatsGroup {
  Jobs: Record<string, boolean>;
  MaxWeight?: number;
  HpFactor?: number;
  HpIncrease?: number;
  SpFactor?: number;
  SpIncrease?: number;
  BonusStats?: (LevelValue & Record<string, number>)[];
}

interface RawBasepointsGroup {
  Jobs: Record<string, boolean>;
  BaseHp?: (LevelValue & { Hp: number })[];
  BaseSp?: (LevelValue & { Sp: number })[];
  BaseAp?: (LevelValue & { Ap: number })[];
}

interface RawExpGroup {
  Jobs: Record<string, boolean>;
  MaxBaseLevel?: number;
  BaseExp?: (LevelValue & { Exp: number })[];
  MaxJobLevel?: number;
  JobExp?: (LevelValue & { Exp: number })[];
}

interface RawAspdGroup {
  Jobs: Record<string, boolean>;
  BaseASPD?: Record<string, number>;
}

interface RawTreeSkill {
  Name: string;
  MaxLevel: number;
  Exclude?: boolean;
  Requires?: { Name: string; Level: number }[];
}

interface RawTreeEntry {
  Job: string;
  Inherit?: Record<string, boolean>;
  Tree?: RawTreeSkill[];
}

/** Parse `enum e_job` from mmo.hpp → Map<lowercased yml name, numeric id>. */
function parseJobIds(): Map<string, number> {
  const src = readFileSync(join(REPO_ROOT, "rathena", "src", "common", "mmo.hpp"), "utf-8");
  const start = src.indexOf("enum e_job {");
  const end = src.indexOf("};", start);
  const block = src.slice(start, end);

  const ids = new Map<string, number>();
  let next = 0;
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*JOB_([A-Z0-9_]+)\s*(?:=\s*(\d+))?\s*,?\s*$/);
    if (!m) continue;
    const name = m[1]!;
    if (m[2] !== undefined) next = Number(m[2]);
    if (!name.startsWith("MAX")) ids.set(name.toLowerCase(), next);
    next++;
  }
  return ids;
}

/** Parse skill_db.yml → Map<skill aegis name, numeric id>. */
function parseSkillIds(dbDir: string): Map<string, number> {
  const doc = parseYaml(readFileSync(join(dbDir, "skill_db.yml"), "utf-8"), {
    maxAliasCount: -1,
    uniqueKeys: false,
  }) as { Body?: { Id: number; Name: string }[] };
  const ids = new Map<string, number>();
  for (const entry of doc.Body ?? []) ids.set(entry.Name, entry.Id);
  return ids;
}

function loadYaml<T>(dbDir: string, file: string): T[] {
  const full = join(dbDir, file);
  if (!existsSync(full)) {
    console.warn(`missing ${full}`);
    return [];
  }
  const doc = parseYaml(readFileSync(full, "utf-8"), { maxAliasCount: -1, uniqueKeys: false }) as {
    Body?: T[];
  };
  return doc.Body ?? [];
}

function jobNames(group: { Jobs: Record<string, boolean> }): string[] {
  return Object.entries(group.Jobs)
    .filter(([, on]) => on)
    .map(([name]) => name);
}

/** Dense per-level array from {Level, value} entries (index 0 = level 1).
 * 3rd/4th-job tables start above level 1 (e.g. Rune_Knight BaseHp starts at
 * 99) — the leading gap is zero-filled with a single warning. Interior holes
 * are filled with the previous value and warned individually. */
function toLevelArray<T extends LevelValue>(
  entries: T[] | undefined,
  valueKey: keyof T & string,
  warnings: string[],
  context: string,
): number[] {
  if (!entries || entries.length === 0) return [];
  const minLevel = Math.min(...entries.map((e) => e.Level));
  const maxLevel = Math.max(...entries.map((e) => e.Level));
  const out: number[] = new Array(maxLevel);
  for (const e of entries) out[e.Level - 1] = e[valueKey] as number;
  for (let i = 0; i < minLevel - 1; i++) out[i] = 0;
  if (minLevel > 1) warnings.push(`${context}: table starts at level ${minLevel} (levels below zero-filled)`);
  for (let i = minLevel - 1; i < out.length; i++) {
    if (out[i] === undefined) {
      out[i] = out[i - 1]!;
      warnings.push(`${context}: hole at level ${i + 1} (filled with previous value)`);
    }
  }
  return out;
}

interface JobAccumulator {
  name: string;
  maxWeight: number;
  hpFactor: number;
  hpIncrease: number;
  spFactor: number;
  spIncrease: number;
  bonusStats: { level: number; stats: Record<string, number>; traits: Record<string, number> }[];
  baseHp: number[];
  baseSp: number[];
  maxBaseLevel?: number;
  maxJobLevel?: number;
  baseExp: number[];
  jobExp: number[];
  aspd: { weaponType: string; baseAspd: number }[];
}

function main() {
  const args = process.argv.slice(2);
  const ruleset = args.includes("--ruleset") ? args[args.indexOf("--ruleset") + 1] : "re";
  const outPath = args.includes("--out")
    ? args[args.indexOf("--out") + 1]!
    : join(__dirname, "..", "output", "job-classes.json");
  if (ruleset !== "re" && ruleset !== "pre-re") {
    console.error(`invalid --ruleset ${ruleset} (expected re | pre-re)`);
    process.exit(1);
  }

  const dbDir = join(REPO_ROOT, "rathena", "db", ruleset);
  const warnings: string[] = [];
  const jobIds = parseJobIds();
  const skillIds = parseSkillIds(dbDir);

  const jobs = new Map<string, JobAccumulator>();
  const acc = (name: string): JobAccumulator => {
    const key = name.toLowerCase();
    let j = jobs.get(key);
    if (!j) {
      // rAthena job db defaults: MaxWeight 20000, HpIncrease 500, SpIncrease 100
      j = {
        name,
        maxWeight: 20000,
        hpFactor: 0,
        hpIncrease: 500,
        spFactor: 0,
        spIncrease: 100,
        bonusStats: [],
        baseHp: [],
        baseSp: [],
        baseExp: [],
        jobExp: [],
        aspd: [],
      };
      jobs.set(key, j);
    }
    return j;
  };

  for (const group of loadYaml<RawStatsGroup>(dbDir, "job_stats.yml")) {
    for (const name of jobNames(group)) {
      const j = acc(name);
      if (group.MaxWeight !== undefined) j.maxWeight = group.MaxWeight;
      if (group.HpFactor !== undefined) j.hpFactor = group.HpFactor;
      if (group.HpIncrease !== undefined) j.hpIncrease = group.HpIncrease;
      if (group.SpFactor !== undefined) j.spFactor = group.SpFactor;
      if (group.SpIncrease !== undefined) j.spIncrease = group.SpIncrease;
      for (const bonus of group.BonusStats ?? []) {
        const stats: Record<string, number> = {};
        const traits: Record<string, number> = {};
        for (const k of BASE_STAT_KEYS) if (bonus[k] !== undefined) stats[k.toLowerCase()] = bonus[k]!;
        for (const k of TRAIT_STAT_KEYS) if (bonus[k] !== undefined) traits[k.toLowerCase()] = bonus[k]!;
        const unknown = Object.keys(bonus).filter(
          (k) => k !== "Level" && !BASE_STAT_KEYS.includes(k as never) && !TRAIT_STAT_KEYS.includes(k as never),
        );
        for (const k of unknown) warnings.push(`job ${name}: unknown BonusStats key ${k}`);
        j.bonusStats.push({ level: bonus.Level, stats, traits });
      }
    }
  }

  for (const group of loadYaml<RawBasepointsGroup>(dbDir, "job_basepoints.yml")) {
    for (const name of jobNames(group)) {
      const j = acc(name);
      if (group.BaseHp) j.baseHp = toLevelArray(group.BaseHp, "Hp", warnings, `job ${name} BaseHp`);
      if (group.BaseSp) j.baseSp = toLevelArray(group.BaseSp, "Sp", warnings, `job ${name} BaseSp`);
      // BaseAp (4th jobs): schema has no AP yet — flag, don't drop silently
      if (group.BaseAp) warnings.push(`job ${name}: BaseAp table present — schema has no AP support yet (needs review)`);
    }
  }

  for (const group of loadYaml<RawExpGroup>(dbDir, "job_exp.yml")) {
    for (const name of jobNames(group)) {
      const j = acc(name);
      if (group.MaxBaseLevel !== undefined) j.maxBaseLevel = group.MaxBaseLevel;
      if (group.MaxJobLevel !== undefined) j.maxJobLevel = group.MaxJobLevel;
      if (group.BaseExp) j.baseExp = toLevelArray(group.BaseExp, "Exp", warnings, `job ${name} BaseExp`);
      if (group.JobExp) j.jobExp = toLevelArray(group.JobExp, "Exp", warnings, `job ${name} JobExp`);
    }
  }

  for (const group of loadYaml<RawAspdGroup>(dbDir, "job_aspd.yml")) {
    for (const name of jobNames(group)) {
      const j = acc(name);
      for (const [weapon, value] of Object.entries(group.BaseASPD ?? {})) {
        const mapped = ASPD_WEAPON_MAP[weapon];
        if (!mapped) {
          warnings.push(`job ${name}: unknown BaseASPD weapon ${weapon}`);
          continue;
        }
        j.aspd.push({ weaponType: mapped, baseAspd: value });
      }
    }
  }

  // skill trees: flatten inheritance, honoring Exclude
  const treeByJob = new Map<string, RawTreeEntry>();
  for (const entry of loadYaml<RawTreeEntry>(dbDir, "skill_tree.yml")) {
    treeByJob.set(entry.Job.toLowerCase(), entry);
  }

  const inheritDepth = (jobKey: string, seen = new Set<string>()): number => {
    if (seen.has(jobKey)) return 0;
    seen.add(jobKey);
    const entry = treeByJob.get(jobKey);
    if (!entry?.Inherit) return 0;
    let max = 0;
    for (const parent of Object.keys(entry.Inherit)) {
      max = Math.max(max, 1 + inheritDepth(parent.toLowerCase(), seen));
    }
    return max;
  };

  const resolveTree = (jobKey: string, isRoot: boolean, seen = new Set<string>()): Map<string, RawTreeSkill> => {
    const out = new Map<string, RawTreeSkill>();
    if (seen.has(jobKey)) return out;
    seen.add(jobKey);
    const entry = treeByJob.get(jobKey);
    if (!entry) return out;
    for (const parent of Object.keys(entry.Inherit ?? {})) {
      for (const [name, skill] of resolveTree(parent.toLowerCase(), false, seen)) out.set(name, skill);
    }
    for (const skill of entry.Tree ?? []) {
      if (!isRoot && skill.Exclude) continue; // Exclude = not passed down via Inherit
      out.set(skill.Name, skill);
    }
    if (isRoot) {
      // own excluded skills belong to the class itself
      for (const skill of entry.Tree ?? []) out.set(skill.Name, skill);
      // MaxLevel 0 = the job removes an inherited skill from its tree
      for (const [name, skill] of out) if (skill.MaxLevel === 0) out.delete(name);
    }
    return out;
  };

  const parentOf = (jobKey: string): string | null => {
    const entry = treeByJob.get(jobKey);
    const parents = Object.keys(entry?.Inherit ?? {}).map((p) => p.toLowerCase());
    if (parents.length === 0) return null;
    // job progression parent = deepest inherit chain (e.g. Knight: Novice+Swordman → Swordman)
    return parents.reduce((best, p) => (inheritDepth(p) > inheritDepth(best) ? p : best));
  };

  const output: JobClass[] = [];
  const invalid: { name: string; errors: string }[] = [];
  const skippedNoId: string[] = [];

  for (const [key, j] of jobs) {
    const id = jobIds.get(key);
    if (id === undefined) {
      skippedNoId.push(j.name);
      continue;
    }

    const skills: JobClass["skills"] = [];
    for (const [skillName, skill] of resolveTree(key, true)) {
      const skillId = skillIds.get(skillName);
      if (skillId === undefined) {
        warnings.push(`job ${j.name}: skill ${skillName} not in skill_db (skipped, needs review)`);
        continue;
      }
      const requires: { skillId: number; level: number }[] = [];
      for (const req of skill.Requires ?? []) {
        const reqId = skillIds.get(req.Name);
        if (reqId === undefined) {
          warnings.push(`job ${j.name}: requirement ${req.Name} not in skill_db (skipped, needs review)`);
          continue;
        }
        requires.push({ skillId: reqId, level: req.Level });
      }
      skills.push({ skillId, maxLevel: skill.MaxLevel, requires });
    }

    const parentKey = parentOf(key);
    const parentClassId = parentKey !== null ? (jobIds.get(parentKey) ?? null) : null;

    if (j.maxBaseLevel === undefined && j.baseExp.length === 0) {
      warnings.push(`job ${j.name}: no exp data — MaxBaseLevel fallback ${RATHENA_MAX_LEVEL} (MAX_LEVEL, map.hpp)`);
    }

    const jobClass = {
      id,
      name: j.name,
      parentClassId,
      maxBaseLevel: j.maxBaseLevel ?? (j.baseExp.length > 0 ? j.baseExp.length : RATHENA_MAX_LEVEL),
      maxJobLevel: j.maxJobLevel ?? (j.jobExp.length > 0 ? j.jobExp.length : RATHENA_MAX_LEVEL),
      // renewal char creation: all base stats start at 1 (rathena char creation)
      baseStats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
      bonusStatsPerLevel: j.bonusStats.map((b) => ({
        level: b.level,
        stats: b.stats,
        ...(Object.keys(b.traits).length > 0 ? { traits: b.traits } : {}),
      })),
      baseHpByLevel: j.baseHp,
      baseSpByLevel: j.baseSp,
      // UNCLEAR-FORMULA: linear/exponential growth params from job_stats.yml
      // (HpIncrease/HpFactor) — only used when no explicit table exists; formula
      // must be validated against rathena/src/map/status.cpp before engine use.
      hpGrowth: j.baseHp.length === 0 ? { base: 0, perLevel: j.hpIncrease, factor: j.hpFactor } : undefined,
      spGrowth: j.baseSp.length === 0 ? { base: 0, perLevel: j.spIncrease, factor: j.spFactor } : undefined,
      maxWeight: j.maxWeight,
      baseExpByLevel: j.baseExp,
      jobExpByLevel: j.jobExp,
      allowedWeapons: [],
      allowedArmorTags: [],
      skills,
      aspdModifiers: j.aspd,
    };

    const result = JobClassSchema.safeParse(jobClass);
    if (result.success) output.push(result.data);
    else invalid.push({ name: j.name, errors: JSON.stringify(result.error.issues.slice(0, 3)) });
  }

  output.sort((a, b) => a.id - b.id);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 1), "utf-8");
  writeFileSync(
    join(dirname(outPath), "jobs-migration-report.json"),
    JSON.stringify(
      {
        ruleset,
        total: output.length,
        invalid: invalid.length,
        invalidSamples: invalid.slice(0, 20),
        skippedNoId,
        warnings: [...new Set(warnings)].slice(0, 300),
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(
    `done: ${output.length} classes ok, ${invalid.length} invalid, ${skippedNoId.length} sem id (${skippedNoId.join(", ") || "-"}), ${warnings.length} warnings`,
  );
  console.log(`output: ${outPath}`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("migrate-jobs.ts");
if (isMain) main();
