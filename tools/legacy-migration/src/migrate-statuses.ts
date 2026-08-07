import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { StatusEffectDefSchema, type StatusEffectDef, type StatusGroup } from "@ragnarok/game-data";
import { toSnake, flagArray } from "./mappings";
import { parseItemScript } from "./parse-item-script";
import { parseStatusChangeDoc, type StatusDocEntry } from "./parse-status-doc";

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

/**
 * `options` que são disfarce VISUAL (esconder/revelar) vs TRANSFORMAÇÃO
 * (troca de sprite/traje). Listas pequenas e fechadas — os 14 valores que
 * `status.yml` realmente usa (medido em tools/legacy-migration/output).
 */
const VISUAL_OPTIONS = new Set(["cloak", "sight", "hide", "ruwach", "chase_walk", "invisible", "flying"]);
const TRANSFORM_OPTIONS = new Set(["wedding", "orcish", "xmas", "summer", "summer2", "hanbok", "oktoberfest"]);
const VELOCITY_CALC = new Set(["speed", "aspd", "dspd"]);
const DEFENSE_CALC = new Set(["def", "def2", "mdef", "m_def2", "flee", "flee2", "res", "mres"]);
const OFFENSE_CALC = new Set(["watk", "matk", "batk", "atk_ele", "hit", "cri", "crate", "patk", "smatk"]);

/**
 * Grupo funcional determinístico, por SINAL já presente no registro — nunca
 * por palpite. Ordem importa: `opt1` (CC exclusivo, não-empilhável) vence
 * `states` (trava mais branda, tipo não-consumir-item), que vence os
 * `calcFlags` (qual família de stat o status mexe). Sem sinal nenhum, "outro"
 * — medido: é o resultado de ~69% do catálogo, porque a maioria dos status do
 * rAthena não tem NENHUM desses campos preenchidos (o efeito mora só em
 * `status.cpp`, fora do que foi migrado). Não é bug de classificação, é o que
 * os dados realmente dizem.
 */
function statusGroup(candidate: {
  opt1?: string | undefined;
  states: string[];
  options: string[];
  calcFlags: string[];
}): StatusGroup {
  if (candidate.opt1) return "controle";
  if (candidate.options.some((o) => VISUAL_OPTIONS.has(o))) return "visibilidade";
  if (candidate.options.some((o) => TRANSFORM_OPTIONS.has(o))) return "transformacao";
  if (candidate.options.length > 0) return "visibilidade";
  if (candidate.states.length > 0) return "estado_especial";
  if (candidate.calcFlags.some((c) => VELOCITY_CALC.has(c))) return "velocidade";
  if (candidate.calcFlags.some((c) => DEFENSE_CALC.has(c))) return "defesa";
  if (candidate.calcFlags.some((c) => OFFENSE_CALC.has(c))) return "ataque";
  if (candidate.calcFlags.some((c) => c.endsWith("_ele"))) return "elemento";
  return "outro";
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

  // rathena/doc/status_change.txt: enriquecimento ADITIVO (status.yml não tem
  // description nem params — ver comentário de parse-status-doc.ts). Falha ao
  // ler não é fatal: a migração segue sem description/params, como sempre foi.
  const docPath = join(REPO_ROOT, "rathena", "doc", "status_change.txt");
  let statusDoc = new Map<string, StatusDocEntry>();
  try {
    statusDoc = parseStatusChangeDoc(readFileSync(docPath, "utf8"));
  } catch (err) {
    console.warn(`[migrate:statuses] não deu pra ler ${docPath}: ${(err as Error).message}`);
  }

  const statuses: StatusEffectDef[] = [];
  const invalid: { status: string; error: string }[] = [];
  let withUnmappedScript = 0;
  let withDescription = 0;
  const byGroup: Record<string, number> = {};

  for (const raw of doc.Body) {
    const flags = flagArray(raw.Flags);
    const effects = parseItemScript(raw.Script);
    if (effects && effects.unmappedEffects.length > 0) withUnmappedScript++;

    const id = raw.Status.toLowerCase();
    const states = flagArray(raw.States);
    const opt1 = raw.Opt1 ? toSnake(raw.Opt1) : undefined;
    const docEntry = statusDoc.get(id);
    if (docEntry?.desc) withDescription++;

    // `debuff` alarga o sinal antigo (só `flags.debuff`, que dava 962 neutro /
    // 57 debuff / 0 buff — o próprio problema que motivou esta revisão):
    // CC exclusivo (opt1) e trava de estado (`no_*`) também são penalidade.
    // `buff` continua NUNCA derivado — sem sinal confiável em status.yml pra
    // distinguir buff de neutro, é curadoria manual do admin (Section 5.2).
    const category = flags.includes("debuff") || opt1 || states.some((s) => s.startsWith("no_")) ? "debuff" : "neutral";

    const candidate = {
      id,
      name: raw.Status.replace(/_/g, " "),
      category: category as "debuff" | "neutral",
      states,
      calcFlags: flagArray(raw.CalcFlags),
      opt1,
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
      description: docEntry?.desc || undefined,
      params: docEntry?.params ?? [],
      group: statusGroup({ opt1, states, options: flagArray(raw.Options), calcFlags: flagArray(raw.CalcFlags) }),
    };
    byGroup[candidate.group] = (byGroup[candidate.group] ?? 0) + 1;

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
        docSource: docPath,
        total: doc.Body.length,
        migrated: statuses.length,
        invalid,
        withUnmappedScript,
        withDescription,
        withoutDescription: statuses.length - withDescription,
        byGroup,
        note: "unmappedEffects = fragmentos de Script não reconhecidos, revisar manualmente (nunca descartados). description/params vêm de rathena/doc/status_change.txt (enriquecimento aditivo, cobertura parcial — nem todo SC_* tem desc: preenchido no doc). group é derivado por sinal estrutural (opt1/states/calcFlags/options); 'outro' é o resultado honesto quando não há nenhum.",
      },
      null,
      2,
    ),
  );

  console.log(`statuses: ${statuses.length}/${doc.Body.length} migrados, ${invalid.length} inválidos`);
  console.log(`${withUnmappedScript} com fragmentos de Script flagged pra revisão`);
  console.log(`${withDescription}/${statuses.length} com description (rathena/doc/status_change.txt)`);
  console.log("por grupo:", byGroup);
  console.log(`saída: ${outPath}`);
}

main();
