import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { StatusEffectDefSchema, type StatusEffectDef } from "@ragnarok/game-data";
import { toSnake, flagArray } from "./mappings";
import { parseItemScript } from "./parse-item-script";

/**
 * status.yml migration: rathena/db/<ruleset>/status.yml → statuses.json
 * matching @ragnarok/game-data StatusEffectDefSchema.
 *
 * Usage: pnpm migrate:statuses [--ruleset re|pre-re] [--out <path>]
 *
 * id = rAthena SC name lowercased (matches statusId already emitted by the
 * item migration). Flag maps become snake_case string arrays; the Script
 * field goes through the same typed-effect pipeline as item scripts
 * (recognized → effects, rest → unmappedEffects — never dropped).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

interface RawStatus {
  Status: string;
  Icon?: string;
  DurationLookup?: string;
  States?: Record<string, boolean>;
  CalcFlags?: Record<string, boolean>;
  Opt1?: string;
  Opt2?: Record<string, boolean>;
  Opt3?: Record<string, boolean>;
  Options?: Record<string, boolean>;
  Flags?: Record<string, boolean>;
  MinRate?: number;
  MinDuration?: number;
  Fail?: Record<string, boolean>;
  EndOnStart?: Record<string, boolean>;
  EndReturn?: Record<string, boolean>;
  EndOnEnd?: Record<string, boolean>;
  Script?: string;
}

/** status-name-keyed map → array of catalog ids */
function statusIdArray(raw: Record<string, boolean> | undefined): string[] {
  if (!raw) return [];
  return Object.entries(raw)
    .filter(([, v]) => v === true)
    .map(([k]) => k.toLowerCase());
}

function main() {
  const args = process.argv.slice(2);
  const rulesetIdx = args.indexOf("--ruleset");
  const ruleset = rulesetIdx >= 0 ? args[rulesetIdx + 1] : "re";
  const outIdx = args.indexOf("--out");
  const outPath =
    outIdx >= 0 && args[outIdx + 1]
      ? args[outIdx + 1]!
      : join(__dirname, "..", "output", "statuses.json");

  const sourcePath = join(REPO_ROOT, "rathena", "db", ruleset === "pre-re" ? "pre-re" : "re", "status.yml");
  const doc = parseYaml(readFileSync(sourcePath, "utf8")) as { Body: RawStatus[] };

  const statuses: StatusEffectDef[] = [];
  const invalid: { status: string; error: string }[] = [];
  let withUnmappedScript = 0;

  for (const raw of doc.Body) {
    const flags = flagArray(raw.Flags);
    const effects = parseItemScript(raw.Script);
    if (effects && effects.unmappedEffects.length > 0) withUnmappedScript++;

    const candidate = {
      id: raw.Status.toLowerCase(),
      name: raw.Status.replace(/_/g, " "),
      category: flags.includes("debuff") ? ("debuff" as const) : ("neutral" as const),
      states: flagArray(raw.States),
      calcFlags: flagArray(raw.CalcFlags),
      opt1: raw.Opt1 ? toSnake(raw.Opt1) : undefined,
      opt2: flagArray(raw.Opt2),
      opt3: flagArray(raw.Opt3),
      options: flagArray(raw.Options),
      flags,
      durationLookupSkill: raw.DurationLookup,
      minRate: raw.MinRate,
      minDurationMs: raw.MinDuration,
      failOn: statusIdArray(raw.Fail),
      endOnStart: statusIdArray(raw.EndOnStart),
      endReturn: statusIdArray(raw.EndReturn),
      endOnEnd: statusIdArray(raw.EndOnEnd),
      effects,
      icon: raw.Icon,
    };

    const parsed = StatusEffectDefSchema.safeParse(candidate);
    if (parsed.success) {
      statuses.push(parsed.data);
    } else {
      invalid.push({ status: raw.Status, error: parsed.error.message });
    }
  }

  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(statuses, null, 1));
  writeFileSync(
    join(outDir, "statuses-migration-report.json"),
    JSON.stringify(
      {
        source: sourcePath,
        total: doc.Body.length,
        migrated: statuses.length,
        invalid,
        withUnmappedScript,
        note: "unmappedEffects = fragmentos de Script não reconhecidos, revisar manualmente (nunca descartados)",
      },
      null,
      2,
    ),
  );

  console.log(`statuses: ${statuses.length}/${doc.Body.length} migrados, ${invalid.length} inválidos`);
  console.log(`${withUnmappedScript} com fragmentos de Script flagged pra revisão`);
  console.log(`saída: ${outPath}`);
}

main();
