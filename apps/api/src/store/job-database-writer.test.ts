import { readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { parse as parseYamlText, stringify as stringifyYaml } from "yaml";
import {
  JobStatsDocSchema,
  SkillTreeDocSchema,
  jobStatsToJobClassPart,
  jobBasepointsToJobClassPart,
  jobAspdToJobClassPart,
  type JobClass,
  type JobIdResolver,
  type SkillIdResolver,
} from "@ragnarok/game-data";
import { JobDatabaseWriter, type JobDatabasePaths, type JobDatabaseBaselinePaths } from "./job-database-writer";

/**
 * Testes exigidos antes de qualquer gravação real nos 5 arquivos (leia1.txt,
 * aprovação Classes 2026-08-07): round-trip do Writer, validação estrutural,
 * validação cruzada, diff, backup e atomicidade ("todos os arquivos são
 * gerados, validados, passam por round-trip, diff e backup antes que
 * qualquer substituição ocorra. Não quero gravações parciais.").
 */

function jobFixture(overrides: Partial<JobClass> = {}): JobClass {
  return {
    id: 1,
    name: "Novice",
    parentClassId: null,
    maxBaseLevel: 10,
    maxJobLevel: 10,
    baseStats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
    bonusStatsPerLevel: [],
    baseHpByLevel: [],
    baseSpByLevel: [],
    maxWeight: 20000,
    baseExpByLevel: [],
    jobExpByLevel: [],
    allowedWeapons: [],
    allowedArmorTags: [],
    skills: [],
    skillTreeInherit: [],
    aspdModifiers: [],
    ...overrides,
  };
}

function swordman(overrides: Partial<JobClass> = {}): JobClass {
  return jobFixture({
    id: 7,
    name: "Swordman",
    parentClassId: 1,
    skillTreeInherit: [1],
    baseHpByLevel: [40, 48, 56],
    aspdModifiers: [{ weaponType: "1h_sword", baseAspd: 156 }],
    skills: [{ skillId: 100, maxLevel: 5, requires: [] }],
    ...overrides,
  });
}

function knight(overrides: Partial<JobClass> = {}): JobClass {
  return jobFixture({
    id: 8,
    name: "Knight",
    parentClassId: 7,
    skillTreeInherit: [1, 7],
    skills: [{ skillId: 101, maxLevel: 10, requires: [{ skillId: 100, level: 3 }] }],
    ...overrides,
  });
}

function resolvers(): { jobs: JobIdResolver; skills: SkillIdResolver } {
  const jobNames = new Map([
    [1, "Novice"],
    [7, "Swordman"],
    [8, "Knight"],
  ]);
  const jobIds = new Map([...jobNames].map(([id, name]) => [name.toLowerCase(), id]));
  const skillNames = new Map([
    [100, "SM_SWORD"],
    [101, "KN_SPEARBOOMERANG"],
    [102, "SM_BASH"],
  ]);
  const skillIds = new Map([...skillNames].map(([id, name]) => [name, id]));
  return {
    jobs: { idOf: (n) => jobIds.get(n.toLowerCase()), nameOf: (id) => jobNames.get(id) },
    skills: { idOf: (n) => skillIds.get(n), nameOf: (id) => skillNames.get(id) },
  };
}

describe("JobDatabaseWriter — Writer atômico dos 5 arquivos (Mapper+Validator já aprovados)", () => {
  let paths: JobDatabasePaths;
  let writer: JobDatabaseWriter;

  beforeEach(() => {
    const stamp = `${Date.now()}-${Math.random()}`;
    paths = {
      jobStats: join(tmpdir(), `job_stats-${stamp}.yml`),
      skillTree: join(tmpdir(), `skill_tree-${stamp}.yml`),
    };
    writer = new JobDatabaseWriter(paths);
  });

  afterEach(async () => {
    for (const p of Object.values(paths)) {
      await rm(p, { force: true });
      await rm(`${p}.bak`, { force: true });
      await rm(`${p}.tmp`, { force: true });
    }
  });

  it("round-trip: grava Swordman — job_stats.yml e skill_tree.yml batem com o Mapper (Header correto)", async () => {
    const { jobs, skills } = resolvers();
    // Swordman referencia Novice em parentClassId/skillTreeInherit — "Classes
    // existentes" (requisito 3) exige que Novice esteja no universo conhecido.
    await writer.writeClasses([jobFixture(), swordman()], jobs, skills);

    const jobStatsDoc = JobStatsDocSchema.parse(parseYamlText(await readFile(paths.jobStats, "utf8")));
    const treeDoc = SkillTreeDocSchema.parse(parseYamlText(await readFile(paths.skillTree, "utf8")));

    expect(jobStatsDoc.Header).toEqual({ Type: "JOB_STATS", Version: 4 });
    expect(treeDoc.Header).toEqual({ Type: "SKILL_TREE_DB", Version: 1 });

    // as 4 categorias (peso/HP-SP/exp/ASPD) vêm TODAS da mesma entrada —
    // um único arquivo físico, achado do dispatcher (job-database-writer.ts)
    const statsEntry = jobStatsDoc.Body.find((e) => e.Jobs.Swordman);
    const treeEntry = treeDoc.Body.find((e) => e.Job === "Swordman");

    expect(jobBasepointsToJobClassPart(statsEntry, [], "Swordman").baseHpByLevel).toEqual([40, 48, 56]);
    expect(jobAspdToJobClassPart(statsEntry, [], "Swordman").aspdModifiers).toEqual([{ weaponType: "1h_sword", baseAspd: 156 }]);
    expect(statsEntry?.MaxBaseLevel).toBe(10);
    expect(statsEntry?.MaxWeight).toBe(20000);
    expect(treeEntry?.Inherit).toEqual({ Novice: true });
    expect(treeEntry?.Tree).toEqual([{ Name: "SM_SWORD", MaxLevel: 5 }]);
    void jobStatsToJobClassPart(statsEntry); // schema já provou o round-trip; só confere que não lança
  });

  it("A17: weaponType de ASPD fora dos 25 reais avisa (antes descartava em silêncio, sem warning nenhum)", async () => {
    const { jobs, skills } = resolvers();
    const { warnings } = await writer.writeClasses(
      [jobFixture(), swordman({ aspdModifiers: [{ weaponType: "arrow", baseAspd: 156 }] })],
      jobs,
      skills,
    );
    expect(warnings.some((w) => w.includes('weaponType "arrow"'))).toBe(true);

    const jobStatsDoc = JobStatsDocSchema.parse(parseYamlText(await readFile(paths.jobStats, "utf8")));
    const statsEntry = jobStatsDoc.Body.find((e) => e.Jobs.Swordman);
    expect(statsEntry?.BaseASPD).toEqual({}); // continua descartado — a correção só torna visível
  });

  it("validação estrutural: MaxBaseLevel fora de 1..275 é rejeitado, NENHUM dos arquivos é tocado", async () => {
    const { jobs, skills } = resolvers();
    await expect(writer.writeClasses([jobFixture(), swordman({ maxBaseLevel: 0 })], jobs, skills)).rejects.toMatchObject({
      statusCode: 400,
    });
    for (const p of Object.values(paths)) await expect(readFile(p, "utf8")).rejects.toThrow();
  });

  it("validação cruzada: skillTreeInherit referenciando job desconhecido é rejeitado, nenhum arquivo tocado", async () => {
    const { jobs, skills } = resolvers();
    const err = await writer.writeClasses([jobFixture(), swordman({ skillTreeInherit: [999] })], jobs, skills).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 400 });
    expect((err as Error).message).toContain("999");
    for (const p of Object.values(paths)) await expect(readFile(p, "utf8")).rejects.toThrow();
  });

  it("validação cruzada: pré-requisito fora da árvore própria+herdada é rejeitado (requisito inatingível)", async () => {
    const { jobs, skills } = resolvers();
    // Knight exige SM_SWORD só que NÃO está nem na própria árvore nem herdada dele
    const badKnight = knight({
      skillTreeInherit: [], // remove a herança que traria SM_SWORD via Swordman/Novice
      parentClassId: null,
      skills: [{ skillId: 101, maxLevel: 10, requires: [{ skillId: 100, level: 3 }] }],
    });
    const err = await writer.writeClasses([badKnight], jobs, skills).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 400 });
    expect((err as Error).message).toContain("inatingível");
    for (const p of Object.values(paths)) await expect(readFile(p, "utf8")).rejects.toThrow();
  });

  it("validação cruzada: skillId inexistente no catálogo é rejeitado", async () => {
    const { jobs, skills } = resolvers();
    const err = await writer
      .writeClasses([jobFixture(), swordman({ skills: [{ skillId: 999999, maxLevel: 1, requires: [] }] })], jobs, skills)
      .catch((e) => e);
    expect(err).toMatchObject({ statusCode: 400 });
    expect((err as Error).message).toContain("999999");
  });

  it("diff: escrever Knight depois de Swordman não toca a entrada já gravada de Swordman", async () => {
    const { jobs, skills } = resolvers();
    await writer.writeClasses([jobFixture(), swordman()], jobs, skills);
    const afterSwordman = await readFile(paths.jobStats, "utf8");

    const { diff } = await writer.writeClasses([knight()], jobs, skills);
    const afterKnight = await readFile(paths.jobStats, "utf8");

    const docBefore = JobStatsDocSchema.parse(parseYamlText(afterSwordman));
    const docAfter = JobStatsDocSchema.parse(parseYamlText(afterKnight));
    expect(docBefore.Body.find((e) => e.Jobs.Swordman)).toEqual(docAfter.Body.find((e) => e.Jobs.Swordman));
    expect(docAfter.Body.some((e) => e.Jobs.Knight)).toBe(true);

    // diff só relata o job tocado nesta chamada (Knight), nunca Swordman
    expect(diff.every((d) => d.job === "Knight")).toBe(true);
    expect(diff.some((d) => d.file === "skillTree" && d.changedFields.includes("Tree"))).toBe(true);
  });

  it("backup: reescrever o MESMO job gera .bak com o conteúdo anterior", async () => {
    const { jobs, skills } = resolvers();
    await writer.writeClasses([jobFixture(), swordman()], jobs, skills);
    const before = await readFile(paths.jobStats, "utf8");

    await writer.writeClasses([swordman({ baseHpByLevel: [50, 60, 70] })], jobs, skills);
    const bak = await readFile(`${paths.jobStats}.bak`, "utf8");
    expect(bak).toBe(before);
  });

  it("atomicidade: uma segunda chamada que falha na validação cruzada não corrompe o estado já gravado pela primeira", async () => {
    const { jobs, skills } = resolvers();
    await writer.writeClasses([jobFixture(), swordman()], jobs, skills);
    const okState = await Promise.all(Object.values(paths).map((p) => readFile(p, "utf8")));

    await expect(
      writer.writeClasses([swordman({ skillTreeInherit: [999] })], jobs, skills),
    ).rejects.toMatchObject({ statusCode: 400 });

    const stateAfterFailure = await Promise.all(Object.values(paths).map((p) => readFile(p, "utf8")));
    expect(stateAfterFailure).toEqual(okState);
  });

  it("lote: escreve Swordman + Knight numa chamada só", async () => {
    const { jobs, skills } = resolvers();
    await writer.writeClasses([jobFixture(), swordman(), knight()], jobs, skills);
    const treeDoc = SkillTreeDocSchema.parse(parseYamlText(await readFile(paths.skillTree, "utf8")));
    expect(treeDoc.Body.map((e) => e.Job).sort()).toEqual(["Knight", "Novice", "Swordman"]);
  });
});

/**
 * Regressão Napalm Beat/Mage (auditoria 2026-08-13): rAthena
 * (`SkillTreeDatabase::parseBodyNode`, pc.cpp:13422) mescla `db/re` +
 * `db/import` por upsert — omitir uma skill do `Tree[]` do override NUNCA
 * remove o registro da baseline, ele continua valendo pra sempre. A única
 * remoção suportada pelo motor é um tombstone `MaxLevel: 0` explícito
 * (apagado por `loadingFinished`, pc.cpp:13690). Este bloco prova que o
 * Writer emite esse tombstone — pra qualquer skill/job, sem hardcode —
 * quando compara o lote contra a baseline real (`rathena/db/re/skill_tree.yml`).
 */
describe("JobDatabaseWriter — remoção de skill da árvore vira tombstone MaxLevel:0 (baseline db/re)", () => {
  let paths: JobDatabasePaths;
  let baseline: JobDatabaseBaselinePaths;
  let writer: JobDatabaseWriter;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    paths = {
      jobStats: join(tmpdir(), `job_stats-${stamp}.yml`),
      skillTree: join(tmpdir(), `skill_tree-${stamp}.yml`),
    };
    baseline = {
      jobStats: join(tmpdir(), `base-job_stats-${stamp}.yml`),
      jobBasepoints: join(tmpdir(), `base-job_basepoints-${stamp}.yml`),
      jobExp: join(tmpdir(), `base-job_exp-${stamp}.yml`),
      jobAspd: join(tmpdir(), `base-job_aspd-${stamp}.yml`),
      skillTree: join(tmpdir(), `base-skill_tree-${stamp}.yml`),
    };
    // baseline "db/re": Swordman tem SM_SWORD + SM_BASH; Knight exige SM_BASH
    // pra existir — exatamente o cenário de Napalm Beat sendo pré-requisito
    // de outra skill do Mago.
    const baseTreeDoc = {
      Header: { Type: "SKILL_TREE_DB", Version: 1 },
      Body: [
        {
          Job: "Swordman",
          Tree: [
            { Name: "SM_SWORD", MaxLevel: 5 },
            { Name: "SM_BASH", MaxLevel: 10, Requires: [{ Name: "SM_SWORD", Level: 3 }] },
          ],
        },
        {
          Job: "Knight",
          Tree: [{ Name: "KN_SPEARBOOMERANG", MaxLevel: 10, Requires: [{ Name: "SM_BASH", Level: 5 }] }],
        },
      ],
    };
    await writeFile(baseline.skillTree, stringifyYaml(baseTreeDoc), "utf8");
    writer = new JobDatabaseWriter(paths, baseline);
  });

  afterEach(async () => {
    for (const p of [...Object.values(paths), ...Object.values(baseline)]) {
      await rm(p, { force: true });
      await rm(`${p}.bak`, { force: true });
      await rm(`${p}.tmp`, { force: true });
    }
  });

  it("remover SM_BASH da árvore do Swordman grava tombstone MaxLevel:0 (não some em silêncio)", async () => {
    const { jobs, skills } = resolvers();
    await writer.writeClasses(
      [jobFixture(), swordman({ skills: [{ skillId: 100, maxLevel: 5, requires: [] }] })],
      jobs,
      skills,
    );

    const treeDoc = SkillTreeDocSchema.parse(parseYamlText(await readFile(paths.skillTree, "utf8")));
    const swordmanTree = treeDoc.Body.find((e) => e.Job === "Swordman")?.Tree ?? [];
    expect(swordmanTree).toContainEqual({ Name: "SM_SWORD", MaxLevel: 5 });
    expect(swordmanTree).toContainEqual({ Name: "SM_BASH", MaxLevel: 0 });
  });

  it("remover SM_BASH como pré-requisito de outra skill grava tombstone Level:0 (não fica preso pra sempre)", async () => {
    const { jobs, skills } = resolvers();
    // Knight não exige mais SM_BASH (só o que já existia — SM_SWORD via herança)
    await writer.writeClasses([jobFixture(), swordman(), knight()], jobs, skills);

    const treeDoc = SkillTreeDocSchema.parse(parseYamlText(await readFile(paths.skillTree, "utf8")));
    const knightTree = treeDoc.Body.find((e) => e.Job === "Knight")?.Tree ?? [];
    const spearBoomerang = knightTree.find((s) => s.Name === "KN_SPEARBOOMERANG");
    expect(spearBoomerang?.Requires).toContainEqual({ Name: "SM_SWORD", Level: 3 });
    expect(spearBoomerang?.Requires).toContainEqual({ Name: "SM_BASH", Level: 0 });
  });

  it("reescrever o mesmo lote de novo continua emitindo o tombstone (idempotente através de @reloadpcdb/restart)", async () => {
    const { jobs, skills } = resolvers();
    const trimmedSwordman = swordman({ skills: [{ skillId: 100, maxLevel: 5, requires: [] }] });
    await writer.writeClasses([jobFixture(), trimmedSwordman], jobs, skills);
    await writer.writeClasses([jobFixture(), trimmedSwordman], jobs, skills);

    const treeDoc = SkillTreeDocSchema.parse(parseYamlText(await readFile(paths.skillTree, "utf8")));
    const swordmanTree = treeDoc.Body.find((e) => e.Job === "Swordman")?.Tree ?? [];
    expect(swordmanTree).toContainEqual({ Name: "SM_BASH", MaxLevel: 0 });
  });

  it("skill que nunca existiu na baseline não gera tombstone nenhum (não é genérico demais)", async () => {
    const { jobs, skills } = resolvers();
    await writer.writeClasses([jobFixture()], jobs, skills);
    const treeDoc = SkillTreeDocSchema.parse(parseYamlText(await readFile(paths.skillTree, "utf8")));
    const novice = treeDoc.Body.find((e) => e.Job === "Novice");
    expect(novice?.Tree ?? []).toEqual([]);
  });
});
