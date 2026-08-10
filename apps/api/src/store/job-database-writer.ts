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
 * Writer do domínio Classes (leia1.txt, aprovação 2026-08-07) — orquestra
 * `job_stats.yml` + `skill_tree.yml` de `db/import/` como UMA operação
 * atômica: "todos os arquivos são gerados, validados, passam por
 * round-trip, diff e backup antes que qualquer substituição ocorra. Não
 * quero gravações parciais."
 *
 * **Achado antes do primeiro write real** (checado direto em
 * `rathena/db/job_stats.yml:87-119`, o DISPATCHER — não presumido): o
 * domínio JOB_STATS tem QUATRO arquivos em `db/re/` (job_stats/
 * job_basepoints/job_exp/job_aspd), mas o dispatcher só declara UM slot de
 * import: `db/import/job_stats.yml` (linha 119). Não existe
 * `db/import/job_basepoints.yml` nem os outros dois — escrever neles seria
 * silenciosamente ignorado pelo `JobDatabase::load()` (`pc.cpp`), porque
 * ele nunca é listado em `Footer.Imports`. `skill_tree.yml` é o loader
 * separado de sempre, com o próprio slot (`db/skill_tree.yml:49`).
 * Por isso só há DOIS arquivos físicos aqui, não cinco — as quatro
 * categorias JOB_STATS continuam com Mapper PRÓPRIO cada uma
 * (`job-class-mapper.ts`, requisito 2 do leia1.txt), só que os quatro
 * `RawJobBodyEntry` parciais são MESCLADOS num só antes de gravar, porque é
 * assim que o arquivo de override realmente existe no disco.
 *
 * Mesmo padrão de `yaml-skill-repository.ts` (Parser → Mapper → Validator →
 * Writer, nenhuma regra de serialização duplicada aqui — só orquestra +
 * I/O), estendido pra dois arquivos com a garantia de tudo-ou-nada.
 */

export interface JobDatabasePaths {
  /** `db/import/job_stats.yml` — domínio JOB_STATS inteiro (as 4 categorias
   * mescladas num arquivo só, porque é UM só o slot de import real). */
  jobStats: string;
  /** `db/import/skill_tree.yml` — loader separado, próprio slot de import. */
  skillTree: string;
}

/** `db/re/*.yml` (ou `db/pre-re`) — os arquivos-base do rAthena, os
 * VERDADEIROS 4+1 arquivos físicos do domínio (só o OVERRIDE é que tem 2).
 * Servem SÓ pra validação cruzada enxergar o universo INTEIRO de classes
 * (achado ao rodar o teste funcional: uma classe herdando de um job nunca
 * tocado por nenhum override — ex. Ninja herda de Novice — é perfeitamente
 * válida, porque Novice existe em db/re; sem isso o Validator rejeitava
 * override de QUALQUER classe cujo ancestral não estivesse TAMBÉM no lote).
 * NUNCA usadas como "base" de preservação de campo (requisito 4) — essa
 * continua sendo só o `db/import` existente, porque o servidor já mescla
 * db/re por baixo; copiar campo de lá pro override seria redundante. */
export interface JobDatabaseBaselinePaths {
  jobStats: string;
  jobBasepoints: string;
  jobExp: string;
  jobAspd: string;
  skillTree: string;
}

/** Rótulo lógico da categoria dentro do domínio JOB_STATS — só pra diff ficar
 * legível ("o que mudou"); as quatro caem no MESMO arquivo físico. */
export type JobStatsCategory = "jobStats" | "jobBasepoints" | "jobExp" | "jobAspd";

export interface JobDatabaseDiffEntry {
  file: JobStatsCategory | "skillTree";
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
  file: JobStatsCategory,
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

function renderJobStatsYaml(entries: RawJobBodyEntry[]): string {
  const sorted = [...entries].sort((a, b) => {
    const nameA = Object.keys(a.Jobs)[0] ?? "";
    const nameB = Object.keys(b.Jobs)[0] ?? "";
    return nameA.localeCompare(nameB);
  });
  const doc = { Header: { Type: "JOB_STATS", Version: 4 }, Body: sorted };
  return (
    "# Gerado pelo painel admin (apps/api) — NÃO editar à mão.\n" +
    "# Sobrepõe entradas do job_stats.yml original por Job (as quatro\n" +
    "# categorias — peso/HP/SP/ASPD/exp — mescladas aqui, porque o dispatcher\n" +
    "# só declara ESTE slot de import pro domínio JOB_STATS inteiro).\n" +
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
  constructor(
    private readonly paths: JobDatabasePaths,
    private readonly baseline?: JobDatabaseBaselinePaths,
  ) {}

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

    // 2) lê os 2 arquivos existentes — é o "base" pra preservar campo sem
    //    representação no dashboard (requisito 4) entre uma edição e outra.
    const [jobStatsDoc, skillTreeDoc] = await Promise.all([
      readJobStatsDoc(this.paths.jobStats),
      readSkillTreeDoc(this.paths.skillTree),
    ]);

    // 3) validação cruzada (requisito 3) — universo = a base do rAthena
    //    (db/re, se fornecida — pra classe não-tocada por override nenhum
    //    continuar existindo pra fins de referência) + o que já existe em
    //    db/import (fora do lote) + o lote sendo escrito agora, nessa ordem
    //    de prioridade (o lote sempre vence, é a versão mais nova). As 4
    //    categorias JOB_STATS do override vêm do MESMO doc (só há um
    //    arquivo), então passam repetidas ao Mapper — ele já sabe mesclar
    //    por Job.
    const { classes: overrideAll } = rawDocsToJobClasses(
      { jobStats: jobStatsDoc, jobBasepoints: jobStatsDoc, jobExp: jobStatsDoc, jobAspd: jobStatsDoc, skillTree: skillTreeDoc },
      jobs,
      skills,
    );
    let baselineAll: JobClass[] = [];
    if (this.baseline) {
      const [baseJobStats, baseJobBasepoints, baseJobExp, baseJobAspd, baseSkillTree] = await Promise.all([
        readJobStatsDoc(this.baseline.jobStats),
        readJobStatsDoc(this.baseline.jobBasepoints),
        readJobStatsDoc(this.baseline.jobExp),
        readJobStatsDoc(this.baseline.jobAspd),
        readSkillTreeDoc(this.baseline.skillTree),
      ]);
      baselineAll = rawDocsToJobClasses(
        { jobStats: baseJobStats, jobBasepoints: baseJobBasepoints, jobExp: baseJobExp, jobAspd: baseJobAspd, skillTree: baseSkillTree },
        jobs,
        skills,
      ).classes;
    }

    const batchIds = new Set(classes.map((c) => c.id));
    const overrideIds = new Set(overrideAll.map((c) => c.id));
    const allKnown = [
      ...baselineAll.filter((c) => !overrideIds.has(c.id) && !batchIds.has(c.id)),
      ...overrideAll.filter((c) => !batchIds.has(c.id)),
      ...classes,
    ];

    const crossIssues = validateJobClassBatch(classes, allKnown, jobs, skills);
    if (crossIssues.length > 0) {
      throw Object.assign(
        new Error(`Classes (validação cruzada): ${crossIssues.map((i) => `${i.job}: ${i.message}`).join("; ")}`),
        { statusCode: 400 },
      );
    }

    // 4) aplica o lote por cima do mapa existente (override esparso por Job).
    //    UM mapa só pro domínio JOB_STATS — as 4 categorias se combinam no
    //    mesmo RawJobBodyEntry, porque é isso que o arquivo físico é.
    const jobStatsMap = groupByJob(jobStatsDoc.Body);
    const treeMap = new Map(skillTreeDoc.Body.map((e) => [e.Job, e]));

    const diff: JobDatabaseDiffEntry[] = [];
    const warnings: string[] = [];

    for (const jc of classes) {
      const jobName = jc.name;
      const before = jobStatsMap.get(jobName);

      const statsOut = jobClassToJobStatsEntry(jc, jobName, before);
      const basepointsOut = jobClassToJobBasepointsEntry(jc, jobName, before);
      const expOut = jobClassToJobExpEntry(jc, jobName, before);
      const aspdWarnings: string[] = [];
      const aspdOut = jobClassToJobAspdEntry(jc, jobName, before, aspdWarnings);
      for (const w of aspdWarnings) warnings.push(`${jobName}: ${w}`);
      const treeWarnings: string[] = [];
      const treeOut = jobClassToSkillTreeEntry(jc, jobName, jobs, skills, treeWarnings);
      for (const w of treeWarnings) warnings.push(`${jobName}: ${w}`);

      diff.push(...diffEntry("jobStats", jobName, before, statsOut));
      diff.push(...diffEntry("jobBasepoints", jobName, before, basepointsOut));
      diff.push(...diffEntry("jobExp", jobName, before, expOut));
      diff.push(...diffEntry("jobAspd", jobName, before, aspdOut));
      diff.push(...diffTreeEntry(jobName, treeMap.get(jobName), treeOut));

      // as 4 saídas parciais se combinam num RawJobBodyEntry só — cada
      // Mapper só escreve os campos da SUA categoria (jobClassToJobStatsEntry
      // nunca toca BaseHp, por exemplo), então spread em qualquer ordem é
      // seguro; `Jobs` é idêntico nos quatro.
      jobStatsMap.set(jobName, { ...statsOut, ...basepointsOut, ...expOut, ...aspdOut });
      treeMap.set(jobName, treeOut);
    }

    // 5) re-renderiza os 2 documentos INTEIROS e prova round-trip — ainda
    //    sem tocar em nenhum arquivo real.
    const renderedJobStats = renderJobStatsYaml([...jobStatsMap.values()]);
    const renderedSkillTree = renderSkillTreeYaml([...treeMap.values()]);

    const reparsedStats = JobStatsDocSchema.safeParse(parseYamlText(renderedJobStats));
    if (!reparsedStats.success) {
      throw Object.assign(
        new Error(`round-trip falhou em job_stats.yml: ${JSON.stringify(reparsedStats.error.issues.slice(0, 3))}`),
        { statusCode: 500 },
      );
    }
    const reparsedTree = SkillTreeDocSchema.safeParse(parseYamlText(renderedSkillTree));
    if (!reparsedTree.success) {
      throw Object.assign(
        new Error(`round-trip falhou em skill_tree.yml: ${JSON.stringify(reparsedTree.error.issues.slice(0, 3))}`),
        { statusCode: 500 },
      );
    }

    // 6) só agora: backup + escrita atômica (tmp + rename) dos 2 — todos ou
    //    nenhum. `rename` é atômico por arquivo (mesmo volume); a garantia
    //    real de "tudo ou nada" é que NENHUM passo acima toca em arquivo de
    //    verdade — só a partir daqui, e qualquer falha aqui deixa os
    //    originais intocados (Node não tem transação entre arquivos —
    //    documentado, não escondido).
    const targets: { path: string; text: string }[] = [
      { path: this.paths.jobStats, text: renderedJobStats },
      { path: this.paths.skillTree, text: renderedSkillTree },
    ];
    const tmpPaths: string[] = [];
    try {
      for (const { path, text } of targets) {
        await mkdir(dirname(path), { recursive: true });
        await backupIfExists(path);
        const tmp = `${path}.tmp`;
        await writeFile(tmp, text, "utf8");
        tmpPaths.push(tmp);
      }
      for (const { path } of targets) {
        await rename(`${path}.tmp`, path);
      }
    } catch (err) {
      await Promise.allSettled(tmpPaths.map((p) => rm(p, { force: true })));
      throw err;
    }

    await queueReload("pcdb");

    return { warnings, diff };
  }
}
