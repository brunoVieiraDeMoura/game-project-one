import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { SkillSchema, type Skill } from "@ragnarok/game-data";
import { WEAPON_SUBTYPE_MAP, AMMO_SUBTYPE_MAP, toSnake, flagArray } from "./mappings";

/**
 * skill_db migration: rathena/db/<ruleset>/skill_db.yml → skills.json
 * matching @ragnarok/game-data SkillSchema.
 *
 * Usage: pnpm migrate:skills [--ruleset re|pre-re] [--out <path>]
 *
 * Per-level semantics ported from rathena/src/map/skill.cpp
 * SkillDatabase::parseNode (line ~14708): scalar applies to all levels; a
 * Level list sets listed levels (unlisted intermediates = 0) and levels past
 * the highest listed one are extrapolated — linear trend when one is
 * detectable, otherwise repeat of the last value.
 *
 * Damage formulas do NOT live in skill_db.yml (they are C++ in
 * battle.cpp) — every damage skill gets damageFormula.needsReview = true
 * with a legacySource pointer instead of a guessed expression (soul.txt §3;
 * extraction happens in Fase 6). Same for applied-status chance/magnitude.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

type LevelEntry = { Level: number } & Record<string, unknown>;

interface RawSkill {
  Id: number;
  Name: string;
  Description: string;
  MaxLevel: number;
  Type?: string;
  TargetType?: string;
  DamageFlags?: Record<string, boolean>;
  Flags?: Record<string, boolean>;
  Range?: number | LevelEntry[];
  Hit?: string;
  HitCount?: number | LevelEntry[];
  Element?: string | LevelEntry[];
  SplashArea?: number | LevelEntry[];
  ActiveInstance?: number | LevelEntry[];
  Knockback?: number | LevelEntry[];
  GiveAp?: number | LevelEntry[];
  CopyFlags?: { Skill?: Record<string, boolean>; RemoveRequirement?: Record<string, boolean> };
  NoNearNPC?: { AdditionalRange?: number; Type?: Record<string, boolean> };
  CastCancel?: boolean;
  CastDefenseReduction?: number;
  CastTime?: number | LevelEntry[];
  AfterCastActDelay?: number | LevelEntry[];
  AfterCastWalkDelay?: number | LevelEntry[];
  Duration1?: number | LevelEntry[];
  Duration2?: number | LevelEntry[];
  Cooldown?: number | LevelEntry[];
  FixedCastTime?: number | LevelEntry[];
  CastTimeFlags?: Record<string, boolean>;
  CastDelayFlags?: Record<string, boolean>;
  Requires?: {
    HpCost?: number | LevelEntry[];
    SpCost?: number | LevelEntry[];
    ApCost?: number | LevelEntry[];
    HpRateCost?: number | LevelEntry[];
    SpRateCost?: number | LevelEntry[];
    ApRateCost?: number | LevelEntry[];
    MaxHpTrigger?: number | LevelEntry[];
    ZenyCost?: number | LevelEntry[];
    Weapon?: Record<string, boolean>;
    Ammo?: Record<string, boolean>;
    AmmoAmount?: number | LevelEntry[];
    State?: string;
    Status?: Record<string, boolean>;
    SpiritSphereCost?: number | LevelEntry[];
    ItemCost?: { Item: string; Amount: number; Level?: number }[];
    Equipment?: Record<string, boolean>;
  };
  Unit?: {
    Id: string;
    AlternateId?: string;
    Layout?: number | LevelEntry[];
    Range?: number | LevelEntry[];
    Interval?: number;
    Target?: string;
    Flag?: Record<string, boolean>;
  };
  Status?: string;
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
  Weapon: "weapon",
  Endowed: "endowed",
  Random: "random",
};

const HIT_MAP: Record<string, "single" | "multi_hit"> = {
  Single: "single",
  Multi_Hit: "multi_hit",
};

/** TargetType → soul.txt type/target pair. Trap = utility acting on an existing trap. */
const TARGET_TYPE_MAP: Record<string, { type: Skill["type"]; target: Skill["target"] }> = {
  Passive: { type: "passive", target: "self" },
  Attack: { type: "damage", target: "enemy" },
  Ground: { type: "area", target: "ground" },
  Self: { type: "self_buff", target: "self" },
  Support: { type: "support", target: "ally" },
  Trap: { type: "support", target: "trap" },
};

/**
 * rAthena SkillDatabase::parseNode semantics. Returns scalar when the value
 * is uniform across levels, otherwise an array of length maxLevel.
 */
/**
 * Área de uma skill de CHÃO, que não mora no `SplashArea`.
 *
 * Skill que planta unidade no chão guarda a área em dois lugares, e são
 * mecanismos diferentes:
 *
 *  • **`Unit.Layout`** — quantas CÉLULAS de unidade são plantadas, e ele é o
 *    RAIO: `skill_init_unit_layout` (skill.cpp:14122) monta o quadrado de lado
 *    `2i+1` com deslocamentos de `−i` a `+i`. Layout 4, da Storm Gust, é o 9×9
 *    que todo mundo conhece;
 *  • **`Unit.Range`** — quão longe CADA célula plantada bate. É o que dá a área
 *    da Thunderstorm, que não tem `Layout` nenhum: uma unidade só, batendo a 2
 *    de distância — o 5×5 clássico.
 *
 * Para a prévia de mira interessa a pegada visível, então vale o que existir,
 * nessa ordem. Lendo só o `SplashArea`, TODA skill de chão saía com área zero —
 * e a prévia não tinha o que desenhar justamente onde ela mais importa.
 *
 * `-1` é o layout ESPECIAL (parede, linha, cruz — formas montadas à mão em
 * `skill_init_unit_layout`); ali não existe raio, e devolver um número seria
 * desenhar um círculo que não é o que a skill pega.
 */
export function raioDaUnidade(
  unit: { Layout?: number | LevelEntry[]; Range?: number | LevelEntry[] } | undefined,
  maxLevel: number,
): number | number[] | undefined {
  return semNegativos(perLevelInt(unit?.Layout, "Size", maxLevel)) ?? semNegativos(perLevelInt(unit?.Range, "Size", maxLevel));
}

/** `-1` (forma especial) não é raio: vira "não sei desenhar isto" */
export function semNegativos(v: number | number[] | undefined): number | number[] | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return v < 0 ? undefined : v;
  return v.map((n) => (n < 0 ? 0 : n));
}

function perLevelInt(
  raw: number | LevelEntry[] | undefined,
  valueKey: string,
  maxLevel: number,
): number | number[] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "number") return raw;

  const arr = new Array<number>(maxLevel).fill(0);
  let maxListed = 0;
  for (const entry of raw) {
    const lv = entry.Level;
    const value = Number(entry[valueKey] ?? 0);
    if (lv >= 1 && lv <= maxLevel) {
      arr[lv - 1] = value;
      maxListed = Math.max(maxListed, lv);
    }
  }

  if (maxListed > 0 && maxListed < maxLevel) {
    // linear-trend extrapolation (skill.cpp parseNode): find the smallest
    // step whose difference is constant across the listed values
    let extrapolated = false;
    for (let step = 1; step <= Math.floor(maxListed / 2); step++) {
      let diff = arr[maxListed - 1]! - arr[maxListed - step - 1]!;
      let j;
      for (j = maxListed - 1; j >= step; j--) {
        if (arr[j]! - arr[j - step]! !== diff) break;
      }
      if (j >= step) continue;
      for (let i = maxListed; i < maxLevel; i++) {
        arr[i] = arr[i - step]! + diff;
        if (arr[i]! < 1 && arr[i - 1]! >= 0) {
          arr[i] = 1;
          diff = 0;
          step = 1;
        }
      }
      extrapolated = true;
      break;
    }
    if (!extrapolated) {
      for (let i = maxListed; i < maxLevel; i++) arr[i] = arr[maxListed - 1]!;
    }
  }

  return arr.every((v) => v === arr[0]) ? arr[0]! : arr;
}

function main() {
  const args = process.argv.slice(2);
  const rulesetIdx = args.indexOf("--ruleset");
  const ruleset = rulesetIdx >= 0 ? args[rulesetIdx + 1] : "re";
  const outIdx = args.indexOf("--out");
  const outPath =
    outIdx >= 0 && args[outIdx + 1]
      ? args[outIdx + 1]!
      : join(__dirname, "..", "output", "skills.json");
  const outDir = dirname(outPath);

  const sourcePath = join(REPO_ROOT, "rathena", "db", ruleset === "pre-re" ? "pre-re" : "re", "skill_db.yml");
  const doc = parseYaml(readFileSync(sourcePath, "utf8")) as { Body: RawSkill[] };

  // item aegisName → id (for ItemCost/Equipment), from the already-migrated items
  const items = JSON.parse(readFileSync(join(outDir, "items.json"), "utf8")) as {
    id: number;
    aegisName: string;
  }[];
  const itemIdByAegis = new Map(items.map((i) => [i.aegisName.toLowerCase(), i.id]));

  // status catalog ids, to flag dangling references
  const statuses = JSON.parse(readFileSync(join(outDir, "statuses.json"), "utf8")) as { id: string }[];
  const statusIds = new Set(statuses.map((s) => s.id));

  const skills: Skill[] = [];
  const invalid: { skill: string; error: string }[] = [];
  const warnings: string[] = [];

  for (const raw of doc.Body) {
    const max = raw.MaxLevel;
    const warn = (msg: string) => warnings.push(`${raw.Name} (${raw.Id}): ${msg}`);

    const targetInfo = TARGET_TYPE_MAP[raw.TargetType ?? "Passive"];
    if (!targetInfo) {
      invalid.push({ skill: raw.Name, error: `TargetType desconhecido: ${raw.TargetType}` });
      continue;
    }

    const damageNature = raw.Type ? toSnake(raw.Type) : "none";
    const damageFlags = flagArray(raw.DamageFlags);

    let element: string | string[] | undefined;
    if (typeof raw.Element === "string") {
      element = ELEMENT_MAP[raw.Element];
      if (!element) warn(`Element desconhecido: ${raw.Element}`);
    } else if (Array.isArray(raw.Element)) {
      const arr = new Array<string>(max).fill("neutral");
      for (const entry of raw.Element) {
        const mapped = ELEMENT_MAP[String(entry["Element"])];
        if (!mapped) {
          warn(`Element desconhecido no nível ${entry.Level}: ${entry["Element"]}`);
          continue;
        }
        if (entry.Level >= 1 && entry.Level <= max) arr[entry.Level - 1] = mapped;
      }
      element = arr.every((v) => v === arr[0]) ? arr[0] : arr;
    }

    const req = raw.Requires;
    let requirements: Record<string, unknown> | undefined;
    if (req) {
      const itemsConsumed: { itemId: number; amount: number; level?: number }[] = [];
      for (const cost of req.ItemCost ?? []) {
        const id = itemIdByAegis.get(cost.Item.toLowerCase());
        if (id === undefined) {
          warn(`ItemCost não resolvido (item "${cost.Item}" não existe em items.json) — REVISAR`);
          continue;
        }
        itemsConsumed.push({ itemId: id, amount: cost.Amount, ...(cost.Level ? { level: cost.Level } : {}) });
      }
      const requiredEquipment: number[] = [];
      for (const aegis of Object.keys(req.Equipment ?? {})) {
        const id = itemIdByAegis.get(aegis.toLowerCase());
        if (id === undefined) {
          warn(`Equipment não resolvido (item "${aegis}") — REVISAR`);
          continue;
        }
        requiredEquipment.push(id);
      }
      const requiredWeapons: string[] = [];
      for (const w of Object.keys(req.Weapon ?? {})) {
        const mapped = WEAPON_SUBTYPE_MAP[w];
        if (!mapped) {
          warn(`Weapon requirement desconhecida: ${w}`);
          continue;
        }
        requiredWeapons.push(mapped);
      }
      const requiredAmmo: string[] = [];
      for (const a of Object.keys(req.Ammo ?? {})) {
        const mapped = AMMO_SUBTYPE_MAP[a];
        if (!mapped) {
          warn(`Ammo requirement desconhecida: ${a}`);
          continue;
        }
        requiredAmmo.push(mapped);
      }
      const requiredStatuses = Object.keys(req.Status ?? {}).map((s) => s.toLowerCase());
      for (const s of requiredStatuses) {
        if (!statusIds.has(s)) warn(`Requires.Status "${s}" não existe no catálogo de statuses — REVISAR`);
      }

      requirements = {
        itemsConsumed,
        requiredEquipment,
        requiredWeapons,
        requiredAmmo,
        ammoAmount: perLevelInt(req.AmmoAmount, "Amount", max),
        requiredState: req.State ? toSnake(req.State) : undefined,
        requiredStatuses,
        hpCost: perLevelInt(req.HpCost, "Amount", max),
        apCost: perLevelInt(req.ApCost, "Amount", max),
        hpRateCost: perLevelInt(req.HpRateCost, "Amount", max),
        spRateCost: perLevelInt(req.SpRateCost, "Amount", max),
        apRateCost: perLevelInt(req.ApRateCost, "Amount", max),
        maxHpTrigger: perLevelInt(req.MaxHpTrigger, "Amount", max),
        spiritSphereCost: perLevelInt(req.SpiritSphereCost, "Amount", max),
        zenyCost: perLevelInt(req.ZenyCost, "Amount", max),
      };
    }

    const duration1 = perLevelInt(raw.Duration1, "Time", max) ?? 0;

    const appliedStatuses: Record<string, unknown>[] = [];
    if (raw.Status) {
      const statusId = raw.Status.toLowerCase();
      if (!statusIds.has(statusId)) warn(`Status associado "${statusId}" não existe no catálogo — REVISAR`);
      appliedStatuses.push({
        statusId,
        // Duration1 é aproximação: alguns skills usam Duration2 pro status
        // (caso a caso em skill.cpp); chance/magnitude também vivem em C++ —
        // needsReview até a extração da Fase 6
        durationMs: duration1,
        needsReview: true,
      });
    }

    const hasDamage = damageNature !== "none" && !damageFlags.includes("no_damage");
    const damageFormula = hasDamage
      ? {
          expression: "",
          needsReview: true,
          legacySource: `rathena/src/map/battle.cpp (${raw.Name}) — fórmula em C++, não migrada; extração na Fase 6`,
        }
      : undefined;

    const candidate = {
      id: raw.Id,
      aegisName: raw.Name,
      name: raw.Description,
      maxLevel: max,
      type: targetInfo.type,
      damageNature,
      hitType: raw.Hit ? HIT_MAP[raw.Hit] ?? raw.Hit.toLowerCase() : "normal",
      element,
      damageFlags,
      flags: flagArray(raw.Flags),
      range: perLevelInt(raw.Range, "Size", max) ?? 0,
      hits: perLevelInt(raw.HitCount, "Count", max) ?? 1,
      areaRadius: perLevelInt(raw.SplashArea, "Area", max) ?? raioDaUnidade(raw.Unit, max),
      knockback: perLevelInt(raw.Knockback, "Amount", max),
      activeInstances: perLevelInt(raw.ActiveInstance, "Max", max),
      giveAp: perLevelInt(raw.GiveAp, "Amount", max),
      spCost: req ? perLevelInt(req.SpCost, "Amount", max) : undefined,
      castTimeMs: {
        variable: perLevelInt(raw.CastTime, "Time", max),
        fixed: perLevelInt(raw.FixedCastTime, "Time", max),
      },
      cooldownMs: perLevelInt(raw.Cooldown, "Time", max),
      afterCastDelayMs: perLevelInt(raw.AfterCastActDelay, "Time", max),
      afterCastWalkDelayMs: perLevelInt(raw.AfterCastWalkDelay, "Time", max),
      durationMs: duration1,
      duration2Ms: perLevelInt(raw.Duration2, "Time", max),
      interruptible: raw.CastCancel ?? true,
      castDefenseReduction: raw.CastDefenseReduction,
      castTimeFlags: flagArray(raw.CastTimeFlags),
      castDelayFlags: flagArray(raw.CastDelayFlags),
      requirements,
      target: targetInfo.target,
      copyFlags: raw.CopyFlags
        ? {
            skill: flagArray(raw.CopyFlags.Skill),
            removeRequirement: flagArray(raw.CopyFlags.RemoveRequirement),
          }
        : undefined,
      noNearNpc: raw.NoNearNPC
        ? {
            additionalRange: raw.NoNearNPC.AdditionalRange,
            type: flagArray(raw.NoNearNPC.Type),
          }
        : undefined,
      unit: raw.Unit
        ? {
            id: toSnake(raw.Unit.Id),
            alternateId: raw.Unit.AlternateId ? toSnake(raw.Unit.AlternateId) : undefined,
            layout: perLevelInt(raw.Unit.Layout, "Size", max),
            range: perLevelInt(raw.Unit.Range, "Size", max),
            intervalMs: raw.Unit.Interval,
            target: raw.Unit.Target ? toSnake(raw.Unit.Target) : undefined,
            flags: flagArray(raw.Unit.Flag),
          }
        : undefined,
      damageFormula,
      appliedStatuses,
    };

    const parsed = SkillSchema.safeParse(candidate);
    if (parsed.success) {
      skills.push(parsed.data);
    } else {
      invalid.push({ skill: raw.Name, error: parsed.error.message });
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(skills, null, 1));
  writeFileSync(
    join(outDir, "skills-migration-report.json"),
    JSON.stringify(
      {
        source: sourcePath,
        total: doc.Body.length,
        migrated: skills.length,
        invalid,
        damageFormulasNeedingReview: skills.filter((s) => s.damageFormula?.needsReview).length,
        appliedStatusesNeedingReview: skills.filter((s) => s.appliedStatuses.some((a) => a.needsReview)).length,
        warnings,
        note: "fórmulas de dano e chance/magnitude de status vivem em battle.cpp/skill.cpp — flagged needsReview, extração na Fase 6 (nunca adivinhado)",
      },
      null,
      2,
    ),
  );

  console.log(`skills: ${skills.length}/${doc.Body.length} migrados, ${invalid.length} inválidos`);
  console.log(`${warnings.length} warnings — ver skills-migration-report.json`);
  console.log(`saída: ${outPath}`);
}

main();
