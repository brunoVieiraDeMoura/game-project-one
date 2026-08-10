import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  JobStatsDocSchema,
  SkillTreeDocSchema,
  RawJobBodyEntrySchema,
  rawDocsToJobClasses,
  jobBodyEntriesFor,
  mergeJobBodyEntries,
  jobClassToJobStatsEntry,
  jobClassToJobBasepointsEntry,
  jobClassToJobExpEntry,
  jobClassToJobAspdEntry,
  jobClassToSkillTreeEntry,
  jobStatsToJobClassPart,
  jobBasepointsToJobClassPart,
  jobExpToJobClassPart,
  jobAspdToJobClassPart,
  skillTreeToJobClassPart,
  type RawJobDocs,
  type JobIdResolver,
  type SkillIdResolver,
} from "@ragnarok/game-data";
import { parseJobIds, parseSkillIds } from "./migrate-jobs";

/**
 * Gate do Mapper de Classes (leia1.txt, aprovação de 2026-08-07): antes do
 * Writer, prova que `JobClass` (modelo interno único) e os 5 formatos
 * oficiais convertem nos DOIS sentidos sem perder informação representável
 * (requisito 5 — round-trip obrigatório) e que os campos sem representação
 * no dashboard sobrevivem via merge com o `base` (requisito 4).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const DB_DIR = join(REPO_ROOT, "rathena", "db", "re");

function loadDoc(file: string): unknown {
  return parseYaml(readFileSync(join(DB_DIR, file), "utf8"));
}

function loadDocs(): RawJobDocs {
  return {
    jobStats: JobStatsDocSchema.parse(loadDoc("job_stats.yml")),
    jobBasepoints: JobStatsDocSchema.parse(loadDoc("job_basepoints.yml")),
    jobExp: JobStatsDocSchema.parse(loadDoc("job_exp.yml")),
    jobAspd: JobStatsDocSchema.parse(loadDoc("job_aspd.yml")),
    skillTree: SkillTreeDocSchema.parse(loadDoc("skill_tree.yml")),
  };
}

/** Resolver construído dos DADOS reais (nunca deriva grafia do enum
 * mecanicamente — mesma armadilha de casing que a auditoria de Skills achou
 * em `Unit.Id`/`BaseASPD`). `parseJobIds` (mmo.hpp) dá o id via busca
 * case-insensitive; a grafia exibida/reescrita é a que os arquivos
 * realmente usam, capturada por varredura. */
function buildJobResolver(docs: RawJobDocs): JobIdResolver {
  const idByLower = parseJobIds();
  const nameByLower = new Map<string, string>();
  const record = (name: string) => {
    const lower = name.toLowerCase();
    if (!nameByLower.has(lower)) nameByLower.set(lower, name);
  };
  for (const body of [docs.jobStats.Body, docs.jobBasepoints.Body, docs.jobExp.Body, docs.jobAspd.Body]) {
    for (const e of body) for (const n of Object.keys(e.Jobs)) record(n);
  }
  for (const e of docs.skillTree.Body) {
    record(e.Job);
    for (const n of Object.keys(e.Inherit ?? {})) record(n);
  }
  const nameById = new Map<number, string>();
  for (const [lower, name] of nameByLower) {
    const id = idByLower.get(lower);
    if (id !== undefined) nameById.set(id, name);
  }
  return {
    idOf: (name: string) => idByLower.get(name.toLowerCase()),
    nameOf: (id: number) => nameById.get(id),
  };
}

function buildSkillResolver(): SkillIdResolver {
  const byName = parseSkillIds(DB_DIR);
  const byId = new Map<number, string>();
  for (const [name, id] of byName) if (!byId.has(id)) byId.set(id, name);
  return {
    idOf: (name: string) => byName.get(name),
    nameOf: (id: number) => byId.get(id),
  };
}

describe("Mapper de Classes — JobClass ↔ 5 formatos oficiais", () => {
  const docs = loadDocs();
  const jobs = buildJobResolver(docs);
  const skills = buildSkillResolver();

  it("monta JobClass[] a partir dos 5 documentos, sem erro de schema em nenhuma classe", () => {
    const { classes, warnings } = rawDocsToJobClasses(docs, jobs, skills);
    expect(classes.length).toBeGreaterThan(30);
    const schemaErrors = warnings.filter((w) => w.message.startsWith("schema inválido"));
    expect(schemaErrors).toEqual([]);
  });

  it("achado da auditoria: Tree[].BaseLevel/JobLevel sobrevivem no skills[] resultante (não são mais descartados)", () => {
    const { classes } = rawDocsToJobClasses(docs, jobs, skills);
    const withBaseLevel = classes.flatMap((c) => c.skills).filter((s) => s.baseLevel !== undefined);
    const withJobLevel = classes.flatMap((c) => c.skills).filter((s) => s.jobLevel !== undefined);
    expect(withBaseLevel.length).toBeGreaterThan(0);
    expect(withJobLevel.length).toBeGreaterThan(0);
  });

  it("Rune_Knight: skillTreeInherit contém Novice+Swordman+Knight (Inherit não-transitivo, já achatado nos dados)", () => {
    const { classes } = rawDocsToJobClasses(docs, jobs, skills);
    const runeKnight = classes.find((c) => c.name === "Rune_Knight");
    expect(runeKnight).toBeDefined();
    const inheritedNames = runeKnight!.skillTreeInherit.map((id) => jobs.nameOf(id));
    expect(inheritedNames).toEqual(expect.arrayContaining(["Novice", "Swordman", "Knight"]));
  });

  it("round-trip por categoria: raw → JobClassPart → raw, estruturalmente equivalente (Swordman)", () => {
    const jobName = "Swordman";
    // MESMO merge que o Mapper usa internamente (rawDocsToJobClasses) — um
    // `.find()` ingênuo pegaria só a PRIMEIRA entrada de grupo e divergiria
    // sempre que o job aparecer em mais de uma entrada `Jobs:` na categoria.
    const statsEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobStats.Body, jobName));
    const basepointsEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobBasepoints.Body, jobName));
    const expEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobExp.Body, jobName));
    const aspdEntry = mergeJobBodyEntries(jobBodyEntriesFor(docs.jobAspd.Body, jobName));
    const treeEntry = docs.skillTree.Body.find((e) => e.Job === jobName);

    const { classes } = rawDocsToJobClasses(docs, jobs, skills);
    const jc = classes.find((c) => c.name === jobName)!;
    expect(jc).toBeDefined();

    const statsOut = jobClassToJobStatsEntry(jc, jobName, statsEntry);
    const basepointsOut = jobClassToJobBasepointsEntry(jc, jobName, basepointsEntry);
    const expOut = jobClassToJobExpEntry(jc, jobName, expEntry);
    const aspdWarnings: string[] = [];
    const aspdOut = jobClassToJobAspdEntry(jc, jobName, aspdEntry, aspdWarnings);
    const treeWarnings: string[] = [];
    const treeOut = jobClassToSkillTreeEntry(jc, jobName, jobs, skills, treeWarnings);

    // reparseia cada emissão pelo MESMO schema oficial (não um schema à parte)
    expect(RawJobBodyEntrySchema.safeParse(statsOut).success).toBe(true);
    expect(RawJobBodyEntrySchema.safeParse(basepointsOut).success).toBe(true);
    expect(RawJobBodyEntrySchema.safeParse(expOut).success).toBe(true);
    expect(RawJobBodyEntrySchema.safeParse(aspdOut).success).toBe(true);
    expect(aspdWarnings).toEqual([]); // dado real do Swordman: todo weaponType já está nos 25 reais

    // reparseia raw→JobClassPart de novo a partir do que foi ESCRITO e compara com o original
    const rtWarnings: string[] = [];
    expect(jobStatsToJobClassPart(statsOut)).toEqual(jobStatsToJobClassPart(statsEntry));
    expect(jobBasepointsToJobClassPart(basepointsOut, rtWarnings, jobName)).toEqual(
      jobBasepointsToJobClassPart(basepointsEntry, [], jobName),
    );
    expect(jobExpToJobClassPart(expOut, [], jobName)).toEqual(jobExpToJobClassPart(expEntry, [], jobName));
    expect(jobAspdToJobClassPart(aspdOut, [], jobName)).toEqual(jobAspdToJobClassPart(aspdEntry, [], jobName));
    expect(skillTreeToJobClassPart(treeOut, skills, jobs, [], jobName)).toEqual(
      skillTreeToJobClassPart(treeEntry, skills, jobs, [], jobName),
    );
  });

  it("requisito 4 — campos sem representação no dashboard (ApFactor/MaxStats/BaseAp/AlternateOutfits) sobrevivem via merge com o base", () => {
    // procura uma entrada real de job_stats.yml com ApFactor ou MaxStats (4º job)
    const withAp = docs.jobStats.Body.find((e) => e.ApFactor !== undefined || e.MaxStats !== undefined);
    if (!withAp) return; // dataset sem 4º job com AP — nada a provar aqui
    const jobName = Object.keys(withAp.Jobs).find((n) => withAp.Jobs[n])!;
    const { classes } = rawDocsToJobClasses(docs, jobs, skills);
    const jc = classes.find((c) => c.name === jobName);
    if (!jc) return;
    const out = jobClassToJobStatsEntry(jc, jobName, withAp);
    expect(out.ApFactor).toBe(withAp.ApFactor);
    expect(out.ApIncrease).toBe(withAp.ApIncrease);
    expect(out.MaxStats).toEqual(withAp.MaxStats);
  });

  it("requisito 4 — BaseAp (job_basepoints) sobrevive via merge com o base mesmo sem campo no dashboard", () => {
    const withBaseAp = docs.jobBasepoints.Body.find((e) => e.BaseAp !== undefined);
    if (!withBaseAp) return;
    const jobName = Object.keys(withBaseAp.Jobs).find((n) => withBaseAp.Jobs[n])!;
    const { classes } = rawDocsToJobClasses(docs, jobs, skills);
    const jc = classes.find((c) => c.name === jobName);
    if (!jc) return;
    const out = jobClassToJobBasepointsEntry(jc, jobName, withBaseAp);
    expect(out.BaseAp).toEqual(withBaseAp.BaseAp);
  });
});
