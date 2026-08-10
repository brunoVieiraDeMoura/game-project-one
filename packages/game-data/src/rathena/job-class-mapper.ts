import { type JobStatsDoc, type RawJobBodyEntry, JOB_ASPD_WEAPON_KEYS } from "./job-stats-yaml";
import { type SkillTreeDoc, type RawSkillTreeEntry, type RawSkillTreeSkill } from "./skill-tree-yaml";
import { JobClassSchema, type JobClass } from "../job-class";

/**
 * Mapper — `JobClass` (modelo interno único, leia1.txt requisito 1) ↔ os 5
 * formatos oficiais (JOB_STATS ×4 categorias + SKILL_TREE_DB). Cada arquivo
 * oficial tem sua função de mapeamento própria (requisito 2); todas leem e
 * escrevem no MESMO `JobClass`.
 *
 * `game-data` não toca em filesystem (é usado no browser). Resolução de
 * nome↔id de job (`enum e_job`, mmo.hpp) e de skill (aegis name↔Id,
 * skill_db.yml) entra por INJEÇÃO — quem orquestra (tools/legacy-migration
 * na leitura, apps/api no Writer) já tem esse parse ao vivo pronto
 * (migrate-jobs.ts:106-134). Nunca copiar a lista de ~200 jobs à mão aqui —
 * é exatamente o "por tentativa e erro" que a instrução do usuário proíbe.
 */

export interface JobIdResolver {
  idOf(rawJobName: string): number | undefined;
  nameOf(id: number): string | undefined;
}

export interface SkillIdResolver {
  idOf(aegisName: string): number | undefined;
  nameOf(id: number): string | undefined;
}

export interface JobMapWarning {
  job: string;
  message: string;
}

function compact<T extends object>(obj: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

const BASE_STAT_KEYS = ["Str", "Agi", "Vit", "Int", "Dex", "Luk"] as const;
const TRAIT_STAT_KEYS = ["Pow", "Sta", "Wis", "Spl", "Con", "Crt"] as const;

/** `BaseASPD` weapon keys ↔ `ItemSubType` (+ bare_hand/shield). Mesma tabela
 * que `tools/legacy-migration/src/migrate-jobs.ts` já usava — promovida aqui
 * pra ficar junto do resto do Mapper (mesma razão de duplicar em vez de
 * importar entre pacotes que `skill-db-mapper.ts` já documenta). */
const ASPD_WEAPON_MAP: Record<(typeof JOB_ASPD_WEAPON_KEYS)[number], string> = {
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
const REV_ASPD_WEAPON: Record<string, (typeof JOB_ASPD_WEAPON_KEYS)[number]> = {};
for (const [raw, mapped] of Object.entries(ASPD_WEAPON_MAP)) REV_ASPD_WEAPON[mapped] = raw as never;
// "bare_hand" é literal vestigial do schema (nunca produzido pelo migrador
// antigo — Fist sempre virou "fist"); aceito na volta por segurança.
REV_ASPD_WEAPON.bare_hand = "Fist";

/** rAthena src/map/map.hpp `#define MAX_LEVEL 275` — fallback quando não há
 * MaxBaseLevel/MaxJobLevel em job_exp.yml (jobs cosméticos). */
const RATHENA_MAX_LEVEL = 275;

// ---------------------------------------------------------------------------
// Tabelas por nível: sparse {Level,Value}[] (raw) ↔ array denso (JobClass)
// ---------------------------------------------------------------------------

/** `RawLevelValue`/`RawBonusStatsEntry` (job-stats-yaml.ts) constroem a chave
 * de valor via `[valueKey: string]`/`Object.fromEntries` — TS infere um
 * índice genérico em vez da chave literal ("Hp"/"Str"/...), então o
 * consumo aqui usa um shape solto e confia na validação do zod (que É
 * literal) pra correção real, não no compilador. */
type RawLevelRow = { Level: number } & Record<string, number>;

/** Índice 0 = nível 1. 3º/4º job costuma começar acima do nível 1 (ex.
 * Rune_Knight BaseHp começa em 99) — o vão inicial é zero-preenchido com um
 * aviso; buracos no meio herdam o valor anterior, cada um com aviso próprio. */
function toLevelArray(
  entries: RawLevelRow[] | undefined,
  valueKey: string,
  context: string,
  warnings: string[],
): number[] {
  if (!entries || entries.length === 0) return [];
  const minLevel = Math.min(...entries.map((e) => e.Level));
  const maxLevel = Math.max(...entries.map((e) => e.Level));
  const out: number[] = new Array(maxLevel);
  for (const e of entries) out[e.Level - 1] = e[valueKey]!;
  for (let i = 0; i < minLevel - 1; i++) out[i] = 0;
  if (minLevel > 1) warnings.push(`${context}: tabela começa no nível ${minLevel} (níveis abaixo zero-preenchidos)`);
  for (let i = minLevel - 1; i < out.length; i++) {
    if (out[i] === undefined) {
      out[i] = out[i - 1]!;
      warnings.push(`${context}: buraco no nível ${i + 1} (preenchido com valor anterior)`);
    }
  }
  return out;
}

function fromLevelArray(arr: number[], valueKey: string): RawLevelRow[] {
  return arr.map((v, i) => ({ Level: i + 1, [valueKey]: v }) as RawLevelRow);
}

// ---------------------------------------------------------------------------
// Merge de entradas repetidas do MESMO job dentro de um arquivo — idioma
// "campo ausente não apaga o que já foi setado" (job-stats-yaml.ts, mesma
// regra documentada pro dispatcher entre arquivos). Simplificação assumida:
// last-wins por campo INTEIRO (não faz merge por índice de nível dentro de
// BaseHp/BaseExp/etc.) — o db/re real nunca lista o mesmo job duas vezes na
// mesma categoria, então esse caminho é defensivo, não exercitado por dado
// real. Documentado, não escondido.
// ---------------------------------------------------------------------------

export function jobBodyEntriesFor(body: RawJobBodyEntry[], jobName: string): RawJobBodyEntry[] {
  return body.filter((e) => e.Jobs[jobName] === true);
}

export function mergeJobBodyEntries(entries: RawJobBodyEntry[]): RawJobBodyEntry | undefined {
  if (entries.length === 0) return undefined;
  let merged: RawJobBodyEntry = { Jobs: entries[0]!.Jobs };
  for (const e of entries) merged = { ...merged, ...compact(e), Jobs: merged.Jobs };
  return merged;
}

// ---------------------------------------------------------------------------
// job_stats.yml — MaxWeight / HpFactor+HpIncrease / SpFactor+SpIncrease / BonusStats
// ---------------------------------------------------------------------------

export function jobStatsToJobClassPart(entry: RawJobBodyEntry | undefined) {
  const bonusRows = (entry?.BonusStats ?? []) as unknown as RawLevelRow[];
  const bonusStatsPerLevel: JobClass["bonusStatsPerLevel"] = bonusRows.map((b) => {
    const stats: Record<string, number> = {};
    const traits: Record<string, number> = {};
    for (const k of BASE_STAT_KEYS) if (b[k] !== undefined) stats[k.toLowerCase()] = b[k]!;
    for (const k of TRAIT_STAT_KEYS) if (b[k] !== undefined) traits[k.toLowerCase()] = b[k]!;
    return {
      level: b.Level,
      stats: stats as JobClass["bonusStatsPerLevel"][number]["stats"],
      ...(Object.keys(traits).length > 0 ? { traits } : {}),
    };
  });
  const hasHpGrowth = entry?.HpFactor !== undefined || entry?.HpIncrease !== undefined;
  const hasSpGrowth = entry?.SpFactor !== undefined || entry?.SpIncrease !== undefined;
  return {
    maxWeight: entry?.MaxWeight,
    // UNCLEAR-FORMULA (mesma ressalva de migrate-jobs.ts): default 500/100 é
    // o default rAthena documentado quando o campo falta mas o grupo existe.
    hpGrowth: hasHpGrowth ? { base: 0, perLevel: entry?.HpIncrease ?? 500, factor: entry?.HpFactor ?? 0 } : undefined,
    spGrowth: hasSpGrowth ? { base: 0, perLevel: entry?.SpIncrease ?? 100, factor: entry?.SpFactor ?? 0 } : undefined,
    bonusStatsPerLevel,
  };
}

function toRawBonusStats(b: JobClass["bonusStatsPerLevel"][number]) {
  const out: Record<string, number> = { Level: b.level };
  for (const k of BASE_STAT_KEYS) {
    const v = (b.stats as Record<string, number>)[k.toLowerCase()];
    if (v !== undefined) out[k] = v;
  }
  for (const k of TRAIT_STAT_KEYS) {
    const v = b.traits?.[k.toLowerCase()];
    if (v !== undefined) out[k] = v;
  }
  return out as never;
}

/** `base`: entrada existente do MESMO job neste arquivo (override esparso —
 * mesma estratégia do Writer de Skills). Campos sem representação no
 * dashboard (`ApFactor`/`ApIncrease`/`MaxStats`/`AlternateOutfits`) são
 * preservados do `base` INTOCADOS — requisito 4 (preservação de dados). */
export function jobClassToJobStatsEntry(
  jc: JobClass,
  jobName: string,
  base?: RawJobBodyEntry,
): RawJobBodyEntry {
  return compact({
    Jobs: { [jobName]: true },
    MaxWeight: jc.maxWeight,
    HpFactor: jc.hpGrowth?.factor ?? base?.HpFactor,
    HpIncrease: jc.hpGrowth?.perLevel ?? base?.HpIncrease,
    SpFactor: jc.spGrowth?.factor ?? base?.SpFactor,
    SpIncrease: jc.spGrowth?.perLevel ?? base?.SpIncrease,
    BonusStats: jc.bonusStatsPerLevel.length > 0 ? jc.bonusStatsPerLevel.map(toRawBonusStats) : base?.BonusStats,
    // não representados no dashboard — nunca descartados (requisito 4)
    ApFactor: base?.ApFactor,
    ApIncrease: base?.ApIncrease,
    MaxStats: base?.MaxStats,
    AlternateOutfits: base?.AlternateOutfits,
  });
}

// ---------------------------------------------------------------------------
// job_basepoints.yml — BaseHp / BaseSp (BaseAp sem campo no dashboard ainda)
// ---------------------------------------------------------------------------

export function jobBasepointsToJobClassPart(entry: RawJobBodyEntry | undefined, warnings: string[], jobName: string) {
  return {
    baseHpByLevel: toLevelArray(entry?.BaseHp as RawLevelRow[] | undefined, "Hp", `job ${jobName} BaseHp`, warnings),
    baseSpByLevel: toLevelArray(entry?.BaseSp as RawLevelRow[] | undefined, "Sp", `job ${jobName} BaseSp`, warnings),
  };
}

export function jobClassToJobBasepointsEntry(
  jc: JobClass,
  jobName: string,
  base?: RawJobBodyEntry,
): RawJobBodyEntry {
  return compact({
    Jobs: { [jobName]: true },
    BaseHp: (jc.baseHpByLevel.length > 0 ? fromLevelArray(jc.baseHpByLevel, "Hp") : base?.BaseHp) as never,
    BaseSp: (jc.baseSpByLevel.length > 0 ? fromLevelArray(jc.baseSpByLevel, "Sp") : base?.BaseSp) as never,
    // BaseAp (4º job/AP): schema ainda não tem campo — preservado do base,
    // nunca descartado (requisito 4; mesma ressalva de migrate-jobs.ts:266).
    BaseAp: base?.BaseAp,
  });
}

// ---------------------------------------------------------------------------
// job_exp.yml — MaxBaseLevel / MaxJobLevel / BaseExp / JobExp
// ---------------------------------------------------------------------------

export function jobExpToJobClassPart(entry: RawJobBodyEntry | undefined, warnings: string[], jobName: string) {
  return {
    maxBaseLevel: entry?.MaxBaseLevel,
    maxJobLevel: entry?.MaxJobLevel,
    baseExpByLevel: toLevelArray(entry?.BaseExp as RawLevelRow[] | undefined, "Exp", `job ${jobName} BaseExp`, warnings),
    jobExpByLevel: toLevelArray(entry?.JobExp as RawLevelRow[] | undefined, "Exp", `job ${jobName} JobExp`, warnings),
  };
}

export function jobClassToJobExpEntry(jc: JobClass, jobName: string, base?: RawJobBodyEntry): RawJobBodyEntry {
  return compact({
    Jobs: { [jobName]: true },
    MaxBaseLevel: jc.maxBaseLevel,
    MaxJobLevel: jc.maxJobLevel,
    BaseExp: (jc.baseExpByLevel.length > 0 ? fromLevelArray(jc.baseExpByLevel, "Exp") : base?.BaseExp) as never,
    JobExp: (jc.jobExpByLevel.length > 0 ? fromLevelArray(jc.jobExpByLevel, "Exp") : base?.JobExp) as never,
  });
}

// ---------------------------------------------------------------------------
// job_aspd.yml — BaseASPD
// ---------------------------------------------------------------------------

export function jobAspdToJobClassPart(entry: RawJobBodyEntry | undefined, warnings: string[], jobName: string) {
  const aspdModifiers: JobClass["aspdModifiers"] = [];
  for (const [weapon, value] of Object.entries(entry?.BaseASPD ?? {})) {
    const mapped = ASPD_WEAPON_MAP[weapon as (typeof JOB_ASPD_WEAPON_KEYS)[number]];
    if (!mapped) {
      warnings.push(`job ${jobName}: arma desconhecida em BaseASPD: ${weapon}`);
      continue;
    }
    aspdModifiers.push({ weaponType: mapped as never, baseAspd: value });
  }
  return { aspdModifiers };
}

export function jobClassToJobAspdEntry(
  jc: JobClass,
  jobName: string,
  base: RawJobBodyEntry | undefined,
  warnings: string[],
): RawJobBodyEntry {
  let baseAspd: Record<string, number> | undefined;
  if (jc.aspdModifiers.length > 0) {
    baseAspd = {};
    for (const m of jc.aspdModifiers) {
      const key = REV_ASPD_WEAPON[m.weaponType];
      if (key) {
        baseAspd[key] = m.baseAspd;
      } else {
        // A17: weaponType fora dos 25 reais de JOB_ASPD_WEAPON_KEYS (ex.:
        // tipos de munição/carta do ItemSubTypeSchema, que o Select oferece
        // mas BaseASPD não representa) — era descartado sem aviso nenhum;
        // o lado READ (`jobAspdToJobClassPart` acima) já avisava, o WRITE não.
        warnings.push(`job ${jobName}: weaponType "${m.weaponType}" sem correspondência em BaseASPD — não gravado`);
      }
    }
  } else {
    baseAspd = base?.BaseASPD;
  }
  return compact({ Jobs: { [jobName]: true }, BaseASPD: baseAspd });
}

// ---------------------------------------------------------------------------
// skill_tree.yml — Tree (própria, não achatada) + Inherit
// ---------------------------------------------------------------------------

export function skillTreeToJobClassPart(
  entry: RawSkillTreeEntry | undefined,
  skills: SkillIdResolver,
  jobs: JobIdResolver,
  warnings: string[],
  jobName: string,
) {
  const out: JobClass["skills"] = [];
  for (const t of entry?.Tree ?? []) {
    const skillId = skills.idOf(t.Name);
    if (skillId === undefined) {
      warnings.push(`job ${jobName}: skill ${t.Name} não existe no skill_db (pulado, needs review)`);
      continue;
    }
    const requires: { skillId: number; level: number }[] = [];
    for (const r of t.Requires ?? []) {
      const reqId = skills.idOf(r.Name);
      if (reqId === undefined) {
        warnings.push(`job ${jobName}: pré-requisito ${r.Name} não existe no skill_db (pulado, needs review)`);
        continue;
      }
      requires.push({ skillId: reqId, level: r.Level });
    }
    out.push({
      skillId,
      maxLevel: t.MaxLevel,
      requires,
      baseLevel: t.BaseLevel,
      jobLevel: t.JobLevel,
      exclude: t.Exclude,
    });
  }

  const skillTreeInherit: number[] = [];
  for (const [parentName, on] of Object.entries(entry?.Inherit ?? {})) {
    if (!on) {
      warnings.push(`job ${jobName}: Inherit.${parentName} = false (não representável no modelo interno, ignorado)`);
      continue;
    }
    const parentId = jobs.idOf(parentName);
    if (parentId === undefined) {
      warnings.push(`job ${jobName}: Inherit referencia job desconhecido ${parentName}`);
      continue;
    }
    skillTreeInherit.push(parentId);
  }

  return { skills: out, skillTreeInherit };
}

function rawTreeSkillFromEntry(
  s: JobClass["skills"][number],
  skills: SkillIdResolver,
  warnings: string[],
  jobName: string,
): RawSkillTreeSkill | undefined {
  const name = skills.nameOf(s.skillId);
  if (!name) {
    warnings.push(`job ${jobName}: skillId ${s.skillId} sem nome aegis conhecido (pulado na exportação)`);
    return undefined;
  }
  const requires = s.requires
    .map((r) => {
      const reqName = skills.nameOf(r.skillId);
      if (!reqName) {
        warnings.push(`job ${jobName}: pré-requisito skillId ${r.skillId} sem nome aegis conhecido (pulado)`);
        return undefined;
      }
      return { Name: reqName, Level: r.level };
    })
    .filter((r): r is { Name: string; Level: number } => r !== undefined);
  return compact({
    Name: name,
    MaxLevel: s.maxLevel,
    Exclude: s.exclude || undefined,
    BaseLevel: s.baseLevel,
    JobLevel: s.jobLevel,
    Requires: requires.length > 0 ? requires : undefined,
  });
}

/** `skill_tree.yml` não tem campo sem representação no dashboard (Job/
 * Inherit/Tree são todos cobertos por `skills[]`/`skillTreeInherit`) —
 * diferente das 4 categorias JOB_STATS, aqui não há `base` pra preservar
 * nada de intocado; o `JobClass` é fonte completa. */
export function jobClassToSkillTreeEntry(
  jc: JobClass,
  jobName: string,
  jobs: JobIdResolver,
  skills: SkillIdResolver,
  warnings: string[],
): RawSkillTreeEntry {
  const inherit: Record<string, boolean> = {};
  for (const parentId of jc.skillTreeInherit) {
    const parentName = jobs.nameOf(parentId);
    if (!parentName) {
      warnings.push(`job ${jobName}: skillTreeInherit referencia job id ${parentId} sem nome conhecido (pulado)`);
      continue;
    }
    inherit[parentName] = true;
  }
  const tree = jc.skills
    .map((s) => rawTreeSkillFromEntry(s, skills, warnings, jobName))
    .filter((s): s is RawSkillTreeSkill => s !== undefined);
  return compact({
    Job: jobName,
    Inherit: Object.keys(inherit).length > 0 ? inherit : undefined,
    Tree: tree,
  });
}

// ---------------------------------------------------------------------------
// Montagem em lote — os 5 documentos oficiais → JobClass[]
// ---------------------------------------------------------------------------

export interface RawJobDocs {
  jobStats: JobStatsDoc;
  jobBasepoints: JobStatsDoc;
  jobExp: JobStatsDoc;
  jobAspd: JobStatsDoc;
  skillTree: SkillTreeDoc;
}

function collectJobNames(docs: RawJobDocs): string[] {
  const names = new Set<string>();
  for (const body of [docs.jobStats.Body, docs.jobBasepoints.Body, docs.jobExp.Body, docs.jobAspd.Body]) {
    for (const entry of body) for (const [name, on] of Object.entries(entry.Jobs)) if (on) names.add(name);
  }
  for (const entry of docs.skillTree.Body) names.add(entry.Job);
  return [...names];
}

/** Pai de progressão (UI, um só) por profundidade de herança — o
 * ancestral com a cadeia `Inherit` mais funda vence (ex.: Knight tem
 * Inherit {Novice,Swordman} → o pai de progressão é Swordman, não Novice).
 * Distinto de `skillTreeInherit` (múltiplo, é o `Inherit:` cru do YAML). */
function deriveParentClassId(jobName: string, treeBody: RawSkillTreeEntry[], jobs: JobIdResolver): number | null {
  const byJob = new Map(treeBody.map((e) => [e.Job, e]));
  const depth = (name: string, seen: Set<string>): number => {
    if (seen.has(name)) return 0;
    seen.add(name);
    const entry = byJob.get(name);
    if (!entry?.Inherit) return 0;
    let max = 0;
    for (const [parent, on] of Object.entries(entry.Inherit)) {
      if (!on) continue;
      max = Math.max(max, 1 + depth(parent, seen));
    }
    return max;
  };
  const entry = byJob.get(jobName);
  const parents = Object.entries(entry?.Inherit ?? {})
    .filter(([, on]) => on)
    .map(([n]) => n);
  if (parents.length === 0) return null;
  const best = parents.reduce((a, b) => (depth(b, new Set()) > depth(a, new Set()) ? b : a));
  return jobs.idOf(best) ?? null;
}

export function rawDocsToJobClasses(
  docs: RawJobDocs,
  jobs: JobIdResolver,
  skills: SkillIdResolver,
): { classes: JobClass[]; warnings: JobMapWarning[] } {
  const warnings: JobMapWarning[] = [];
  const skillTreeByJob = new Map(docs.skillTree.Body.map((e) => [e.Job, e]));
  const classes: JobClass[] = [];

  for (const jobName of collectJobNames(docs)) {
    const id = jobs.idOf(jobName);
    if (id === undefined) {
      warnings.push({ job: jobName, message: "sem id em enum e_job (mmo.hpp) — pulado" });
      continue;
    }

    const statsEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobStats.Body, jobName));
    const basepointsEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobBasepoints.Body, jobName));
    const expEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobExp.Body, jobName));
    const aspdEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobAspd.Body, jobName));
    const treeEntry = skillTreeByJob.get(jobName);

    const levelWarnings: string[] = [];
    const statsPart = jobStatsToJobClassPart(statsEntry);
    const basepointsPart = jobBasepointsToJobClassPart(basepointsEntry, levelWarnings, jobName);
    const expPart = jobExpToJobClassPart(expEntry, levelWarnings, jobName);
    const aspdPart = jobAspdToJobClassPart(aspdEntry, levelWarnings, jobName);
    const treePart = skillTreeToJobClassPart(treeEntry, skills, jobs, levelWarnings, jobName);
    for (const message of levelWarnings) warnings.push({ job: jobName, message });

    if (expPart.maxBaseLevel === undefined && expPart.baseExpByLevel.length === 0) {
      warnings.push({
        job: jobName,
        message: `sem dado de exp — MaxBaseLevel cai no fallback ${RATHENA_MAX_LEVEL} (MAX_LEVEL, map.hpp)`,
      });
    }

    const candidate = {
      id,
      name: jobName,
      parentClassId: deriveParentClassId(jobName, docs.skillTree.Body, jobs),
      maxBaseLevel: expPart.maxBaseLevel ?? (expPart.baseExpByLevel.length > 0 ? expPart.baseExpByLevel.length : RATHENA_MAX_LEVEL),
      maxJobLevel: expPart.maxJobLevel ?? (expPart.jobExpByLevel.length > 0 ? expPart.jobExpByLevel.length : RATHENA_MAX_LEVEL),
      // renewal: criação de personagem começa todo atributo em 1 — não vem de nenhum dos 5 arquivos.
      baseStats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
      bonusStatsPerLevel: statsPart.bonusStatsPerLevel,
      baseHpByLevel: basepointsPart.baseHpByLevel,
      baseSpByLevel: basepointsPart.baseSpByLevel,
      hpGrowth: basepointsPart.baseHpByLevel.length === 0 ? statsPart.hpGrowth : undefined,
      spGrowth: basepointsPart.baseSpByLevel.length === 0 ? statsPart.spGrowth : undefined,
      maxWeight: statsPart.maxWeight ?? 20000,
      baseExpByLevel: expPart.baseExpByLevel,
      jobExpByLevel: expPart.jobExpByLevel,
      allowedWeapons: [],
      allowedArmorTags: [],
      skills: treePart.skills,
      skillTreeInherit: treePart.skillTreeInherit,
      aspdModifiers: aspdPart.aspdModifiers,
    };

    const parsed = JobClassSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push({ job: jobName, message: `schema inválido: ${JSON.stringify(parsed.error.issues.slice(0, 3))}` });
      continue;
    }
    classes.push(parsed.data);
  }

  classes.sort((a, b) => a.id - b.id);
  return { classes, warnings };
}
