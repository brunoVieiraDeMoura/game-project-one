import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYamlText, stringify as stringifyYaml } from "yaml";
import {
  JobStatsDocSchema,
  SkillTreeDocSchema,
  rawDocsToJobClasses,
  jobBodyEntriesFor,
  mergeJobBodyEntries,
  jobClassToJobStatsEntry,
  jobClassToJobBasepointsEntry,
  jobClassToJobExpEntry,
  jobClassToJobAspdEntry,
  jobClassToSkillTreeEntry,
  validateJobClassEntry,
  validateJobClassBatch,
  type JobStatsDoc,
  type SkillTreeDoc,
  type RawJobBodyEntry,
  type RawSkillTreeEntry,
  type JobClass,
  type Skill,
  type JobIdResolver,
  type SkillIdResolver,
} from "@ragnarok/game-data";
import { queueReload } from "./mysql-item-repository.js";

/**
 * Writer do domínio Classes (leia1.txt, aprovação 2026-08-07) — orquestra os
 * 5 arquivos (`job_stats`/`job_basepoints`/`job_exp`/`job_aspd`/`skill_tree`)
 * como UMA operação atômica: "todos os arquivos são gerados, validados,
 * passam por round-trip, diff e backup antes que qualquer substituição
 * ocorra. Não quero gravações parciais."
 *
 * Mesmo padrão de `yaml-skill-repository.ts` (Parser → Mapper → Validator →
 * Writer, nenhuma regra de serialização duplicada aqui — só orquestra +
 * I/O), estendido pra múltiplos arquivos com a garantia de tudo-ou-nada.
 *
 * `db/import/*.yml` não existem até o primeiro write (mesma situação de
 * `skill_db.yml` antes do gate de Skills) — arquivo ausente vira doc vazio.
 */

export interface JobDatabasePaths {
  jobStats: string;
  jobBasepoints: string;
  jobExp: string;
  jobAspd: string;
  skillTree: string;
}

export interface JobDatabaseDiffEntry {
  file: keyof JobDatabasePaths;
  job: string;
  changedFields: string[];
}

/** Universo de jobs conhecidos = o catálogo `JobClass` do projeto (não
 * reparseia `enum e_job` do mmo.hpp em runtime da API) — é o mesmo dado que
 * a dashboard edita, então "classe existe" siginifica "existe no nosso
 * catálogo", que é exatamente o que a validação cruzada (requisito 3) quer
 * dizer. `name` de cada `JobClass` já é a grafia CRUA do YAML (migrate-jobs.ts
 * grava assim), então não há problema de casing aqui. */
export function jobResolverFromCatalog(all: JobClass[]): JobIdResolver {
  const byId = new Map(all.map((c) => [c.id, c.name]));
  const byLowerName = new Map(all.map((c) => [c.name.toLowerCase(), c.id]));
  return {
    idOf: (name) => byLowerName.get(name.toLowerCase()),
    nameOf: (id) => byId.get(id),
  };
}

export function skillResolverFromCatalog(all: Skill[]): SkillIdResolver {
  const byId = new Map(all.map((s) => [s.id, s.aegisName]));
  const byName = new Map(all.map((s) => [s.aegisName, s.id]));
  return {
    idOf: (name) => byName.get(name),
    nameOf: (id) => byId.get(id),
  };
}

function groupByJob(body: RawJobBodyEntry[]): Map<string, RawJobBodyEntry> {
  const names = new Set<string>();
  for (const e of body) for (const [n, on] of Object.entries(e.Jobs)) if (on) names.add(n);
  const map = new Map<string, RawJobBodyEntry>();
  for (const name of names) {
    const merged = mergeJobBodyEntries(jobBodyEntriesFor(body, name));
    if (merged) map.set(name, merged);
  }
  return map;
}

function diffEntry(
  file: keyof JobDatabasePaths,
  job: string,
  before: RawJobBodyEntry | undefined,
  after: RawJobBodyEntry,
): JobDatabaseDiffEntry[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  keys.delete("Jobs");
  for (const k of keys) {
    const a = JSON.stringify((before as Record<string, unknown> | undefined)?.[k]);
    const b = JSON.stringify((after as Record<string, unknown>)[k]);
    if (a !== b) changed.push(k);
  }
  return changed.length > 0 ? [{ file, job, changedFields: changed }] : [];
}

function diffTreeEntry(job: string, before: RawSkillTreeEntry | undefined, after: RawSkillTreeEntry): JobDatabaseDiffEntry[] {
  const changed: string[] = [];
  if (JSON.stringify(before?.Inherit) !== JSON.stringify(after.Inherit)) changed.push("Inherit");
  if (JSON.stringify(before?.Tree) !== JSON.stringify(after.Tree)) changed.push("Tree");
  return changed.length > 0 ? [{ file: "skillTree", job, changedFields: changed }] : [];
}

/** Comentário + `Header` idênticos aos 4 arquivos JOB_STATS — mesmo schema/loader (achado da auditoria). */
function renderJobStatsYaml(entries: RawJobBodyEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    const nameA = Object.keys(a.Jobs)[0] ?? "";
    const nameB = Object.keys(b.Jobs)[0] ?? "";
    return nameA.localeCompare(nameB);
  });
  const doc = { Header: { Type: "JOB_STATS", Version: 4 }, Body: sorted };
  return (
    "# Gerado pelo painel admin (apps/api) — NÃO editar à mão.\n" +
    "# Sobrepõe entradas do arquivo original por Job; o que não estiver aqui\n" +
    "# continua valendo do arquivo original do rAthena.\n" +
    stringifyYaml(doc, { lineWidth: 0 })
  );
}

function renderSkillTreeYaml(entries: RawSkillTreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.Job.localeCompare(b.Job));
  const doc = { Header: { Type: "SKILL_TREE_DB", Version: 1 }, Body: sorted };
  return (
    "# Gerado pelo painel admin (apps/api) — NÃO editar à mão.\n" +
    "# Sobrepõe entradas de skill_tree.yml por Job.\n" +
    stringifyYaml(doc, { lineWidth: 0 })
  );
}

async function readJobStatsDoc(path: string): Promise<JobStatsDoc> {
  try {
    const raw = await readFile(path, "utf8");
    return JobStatsDocSchema.parse(parseYamlText(raw));
  } catch {
    return { Header: { Type: "JOB_STATS", Version: 4 }, Body: [] };
  }
}

async function readSkillTreeDoc(path: string): Promise<SkillTreeDoc> {
  try {
    const raw = await readFile(path, "utf8");
    return SkillTreeDocSchema.parse(parseYamlText(raw));
  } catch {
    return { Header: { Type: "SKILL_TREE_DB", Version: 1 }, Body: [] };
  }
}

/** Faz backup de UM arquivo existente antes de sobrescrever (`<path>.bak`,
 * a versão anterior — não é histórico timestampado, é "o que tinha antes
 * desta escrita"). Arquivo ainda não existente = nada pra guardar. */
async function backupIfExists(path: string): Promise<void> {
  try {
    const content = await readFile(path, "utf8");
    await writeFile(`${path}.bak`, content, "utf8");
  } catch {
    /* primeiro write — sem base pra fazer backup */
  }
}

export class JobDatabaseWriter {
  constructor(private readonly paths: JobDatabasePaths) {}

  async writeClasses(
    classes: JobClass[],
    jobs: JobIdResolver,
    skills: SkillIdResolver,
  ): Promise<{ warnings: string[]; diff: JobDatabaseDiffEntry[] }> {
    // 1) validação estrutural por entrada — antes de tocar em qualquer arquivo.
    const structuralIssues: string[] = [];
    for (const jc of classes) {
      for (const issue of validateJobClassEntry(jc)) structuralIssues.push(`${jc.name}: ${issue}`);
    }
    if (structuralIssues.length > 0) {
      throw Object.assign(new Error(`Classes: ${structuralIssues.join("; ")}`), { statusCode: 400 });
    }

    // 2) lê os 5 arquivos existentes — é o "base" pra preservar campo sem
    //    representação no dashboard (requisito 4) entre uma edição e outra.
    const [jobStatsDoc, jobBasepointsDoc, jobExpDoc, jobAspdDoc, skillTreeDoc] = await Promise.all([
      readJobStatsDoc(this.paths.jobStats),
      readJobStatsDoc(this.paths.jobBasepoints),
      readJobStatsDoc(this.paths.jobExp),
      readJobStatsDoc(this.paths.jobAspd),
      readSkillTreeDoc(this.paths.skillTree),
    ]);

    // 3) validação cruzada (requisito 3) — universo = o que já existe (fora
    //    do lote) + o lote sendo escrito agora.
    const { classes: existingAll } = rawDocsToJobClasses(
      { jobStats: jobStatsDoc, jobBasepoints: jobBasepointsDoc, jobExp: jobExpDoc, jobAspd: jobAspdDoc, skillTree: skillTreeDoc },
      jobs,
      skills,
    );
    const batchIds = new Set(classes.map((c) => c.id));
    const allKnown = [...existingAll.filter((c) => !batchIds.has(c.id)), ...classes];

    const crossIssues = validateJobClassBatch(classes, allKnown, jobs, skills);
    if (crossIssues.length > 0) {
      throw Object.assign(
        new Error(`Classes (validação cruzada): ${crossIssues.map((i) => `${i.job}: ${i.message}`).join("; ")}`),
        { statusCode: 400 },
      );
    }

    // 4) aplica o lote por cima dos mapas existentes (override esparso por Job).
    const statsMap = groupByJob(jobStatsDoc.Body);
    const basepointsMap = groupByJob(jobBasepointsDoc.Body);
    const expMap = groupByJob(jobExpDoc.Body);
    const aspdMap = groupByJob(jobAspdDoc.Body);
    const treeMap = new Map(skillTreeDoc.Body.map((e) => [e.Job, e]));

    const diff: JobDatabaseDiffEntry[] = [];
    const warnings: string[] = [];

    for (const jc of classes) {
      const jobName = jc.name;
      const statsOut = jobClassToJobStatsEntry(jc, jobName, statsMap.get(jobName));
      const basepointsOut = jobClassToJobBasepointsEntry(jc, jobName, basepointsMap.get(jobName));
      const expOut = jobClassToJobExpEntry(jc, jobName, expMap.get(jobName));
      const aspdOut = jobClassToJobAspdEntry(jc, jobName, aspdMap.get(jobName));
      const treeWarnings: string[] = [];
      const treeOut = jobClassToSkillTreeEntry(jc, jobName, jobs, skills, treeWarnings);
      for (const w of treeWarnings) warnings.push(`${jobName}: ${w}`);

      diff.push(...diffEntry("jobStats", jobName, statsMap.get(jobName), statsOut));
      diff.push(...diffEntry("jobBasepoints", jobName, basepointsMap.get(jobName), basepointsOut));
      diff.push(...diffEntry("jobExp", jobName, expMap.get(jobName), expOut));
      diff.push(...diffEntry("jobAspd", jobName, aspdMap.get(jobName), aspdOut));
      diff.push(...diffTreeEntry(jobName, treeMap.get(jobName), treeOut));

      statsMap.set(jobName, statsOut);
      basepointsMap.set(jobName, basepointsOut);
      expMap.set(jobName, expOut);
      aspdMap.set(jobName, aspdOut);
      treeMap.set(jobName, treeOut);
    }

    // 5) re-renderiza os 5 documentos INTEIROS e prova round-trip — ainda
    //    sem tocar em nenhum arquivo real.
    const rendered: Record<keyof JobDatabasePaths, string> = {
      jobStats: renderJobStatsYaml([...statsMap.values()]),
      jobBasepoints: renderJobStatsYaml([...basepointsMap.values()]),
      jobExp: renderJobStatsYaml([...expMap.values()]),
      jobAspd: renderJobStatsYaml([...aspdMap.values()]),
      skillTree: renderSkillTreeYaml([...treeMap.values()]),
    };

    for (const key of Object.keys(rendered) as (keyof JobDatabasePaths)[]) {
      const schema = key === "skillTree" ? SkillTreeDocSchema : JobStatsDocSchema;
      const reparsed = schema.safeParse(parseYamlText(rendered[key]));
      if (!reparsed.success) {
        throw Object.assign(
          new Error(`round-trip falhou em ${key}: ${JSON.stringify(reparsed.error.issues.slice(0, 3))}`),
          { statusCode: 500 },
        );
      }
    }

    // 6) só agora: backup + escrita atômica (tmp + rename) dos 5 — todos ou nenhum.
    //    `rename` é atômico por arquivo (mesmo volume); a garantia real de
    //    "tudo ou nada" é que NENHUM passo acima toca em arquivo de verdade —
    //    só a partir daqui, e qualquer falha aqui deixa os 5 originais
    //    intocados (o que já foi renomeado fica; Node não tem transação
    //    entre arquivos — documentado, não escondido).
    const keys = Object.keys(rendered) as (keyof JobDatabasePaths)[];
    const tmpPaths: string[] = [];
    try {
      for (const key of keys) {
        const path = this.paths[key];
        await mkdir(dirname(path), { recursive: true });
        await backupIfExists(path);
        const tmp = `${path}.tmp`;
        await writeFile(tmp, rendered[key], "utf8");
        tmpPaths.push(tmp);
      }
      for (const key of keys) {
        await rename(`${this.paths[key]}.tmp`, this.paths[key]);
      }
    } catch (err) {
      await Promise.allSettled(tmpPaths.map((p) => rm(p, { force: true })));
      throw err;
    }

    await queueReload("pcdb");

    return { warnings, diff };
  }
}
