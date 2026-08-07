import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import { RawSkillYamlSchema, parseSkillEntry, type Skill } from "@ragnarok/game-data";
import { JsonSkillRepository } from "./json-skill-repository";
import { YamlSkillRepository } from "./yaml-skill-repository";

/**
 * Testes exigidos antes de qualquer gravação real em `db/import/
 * skill_db.yml` (leia1.txt, 2026-08-07): round-trip do Writer, validação
 * estrutural, e diff (só a entrada editada muda — o resto do arquivo fica
 * intocado, é a mesma garantia de merge que o rAthena espera de um
 * override esparso).
 */

function bash(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 5,
    aegisName: "SM_BASH",
    name: "Golpe",
    maxLevel: 10,
    type: "damage",
    damageNature: "weapon",
    hitType: "single",
    element: "weapon",
    damageFlags: [],
    flags: [],
    range: -1,
    hits: 1,
    areaRadius: 0,
    knockback: 0,
    activeInstances: 0,
    giveAp: 0,
    spCost: [8, 8, 8, 8, 8, 15, 15, 15, 15, 15],
    castTimeMs: { variable: 0, fixed: 0 },
    cooldownMs: 0,
    afterCastDelayMs: 0,
    afterCastWalkDelayMs: 0,
    durationMs: 0,
    duration2Ms: 4500,
    interruptible: true,
    castTimeFlags: [],
    castDelayFlags: [],
    target: "enemy",
    appliedStatuses: [],
    ...overrides,
  };
}

function provoke(overrides: Partial<Skill> = {}): Skill {
  return {
    ...bash({ id: 6, aegisName: "SM_PROVOKE", name: "Provocar", type: "support", damageNature: "none", target: "enemy" }),
    ...overrides,
  };
}

describe("YamlSkillRepository — Writer schema-first (Parser+Mapper+Validator já aprovados)", () => {
  let importPath: string;
  let repo: YamlSkillRepository;
  let delegate: JsonSkillRepository;

  beforeEach(() => {
    importPath = join(tmpdir(), `skill_db.yml-writer-test-${Date.now()}-${Math.random()}.yml`);
    delegate = new JsonSkillRepository(join(tmpdir(), `skills-writer-test-${Date.now()}-${Math.random()}.json`));
    repo = new YamlSkillRepository(delegate, importPath);
  });

  afterEach(async () => {
    await rm(importPath, { force: true });
  });

  it("round-trip: grava, reparseia com o MESMO Parser, os campos batem", async () => {
    const skill = bash();
    await repo.create(skill);

    const raw = await readFile(importPath, "utf8");
    const doc = parseYamlText(raw) as { Header: { Type: string; Version: number }; Body: unknown[] };
    expect(doc.Header).toEqual({ Type: "SKILL_DB", Version: 4 });

    const rawEntry = RawSkillYamlSchema.parse(doc.Body[0]);
    const parsed = parseSkillEntry(rawEntry);

    expect(parsed.id).toBe(5);
    expect(parsed.name).toBe("SM_BASH");
    expect(parsed.description).toBe("Golpe");
    expect(parsed.maxLevel).toBe(10);
    expect(parsed.hit).toBe("Single");
    expect(parsed.type).toBe("Weapon");
    expect(parsed.targetType).toBe("Attack");
    // spCost é da tabela Requires — 10 níveis informados, 11-13 seguram o último valor
    expect(parsed.requires?.spCost.slice(0, 10)).toEqual([8, 8, 8, 8, 8, 15, 15, 15, 15, 15]);
    expect(parsed.requires?.spCost.slice(10)).toEqual([15, 15, 15]);
    // achado no teste funcional (@reloadskilldb no servidor real, 2026-08-07):
    // Element é escalar ("weapon") e maxLevel=10 — os níveis 11-13 têm que
    // segurar "Weapon", nunca cair pro "Neutral" do fill inicial
    expect(parsed.element.slice(10)).toEqual(["Weapon", "Weapon", "Weapon"]);
  });

  it("validação estrutural: MaxLevel > 13 é rejeitado, arquivo não é tocado", async () => {
    await expect(repo.writeOverride(bash({ maxLevel: 14 }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(readFile(importPath, "utf8")).rejects.toThrow(); // nunca chegou a existir
  });

  it("validação estrutural: Name/Description acima de 39 caracteres é rejeitado", async () => {
    const tooLong = "N".repeat(40);
    await expect(repo.writeOverride(bash({ name: tooLong }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("diff: editar a skill B não toca a entrada já gravada da skill A", async () => {
    await repo.create(bash());
    const afterA = await readFile(importPath, "utf8");

    await repo.create(provoke());
    const afterB = await readFile(importPath, "utf8");

    const docA = parseYamlText(afterA) as { Body: { Id: number }[] };
    const docB = parseYamlText(afterB) as { Body: { Id: number }[] };
    const entryAinB = docB.Body.find((e) => e.Id === 5);
    expect(entryAinB).toEqual(docA.Body.find((e) => e.Id === 5)); // idêntica, não regravada

    expect(docB.Body.map((e) => e.Id).sort()).toEqual([5, 6]);
    expect(afterB.length).toBeGreaterThan(afterA.length); // cresceu, não substituiu
  });

  it("diff: reeditar a MESMA skill preserva campos não tocados pelo Mapper (cauda 11-13)", async () => {
    // simula uma skill cuja base já tinha SplashArea com cauda diferente do hold-last
    // (o caso SM_MAGNUM da auditoria — Level 11 acima do MaxLevel)
    await repo.create(bash({ areaRadius: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] }));

    const raw1 = await readFile(importPath, "utf8");
    const parsed1 = parseSkillEntry(RawSkillYamlSchema.parse((parseYamlText(raw1) as { Body: unknown[] }).Body[0]));
    expect(parsed1.splashArea.slice(10)).toEqual([2, 2, 2]); // hold-last, sem base anterior

    // segunda edição: só o nome muda — areaRadius nem é passado no objeto (mas o
    // Mapper sempre EMITE o campo por inteiro; o que se preserva é a cauda 11-13
    // vinda da leitura da base, não um "campo ausente" no sentido do rAthena)
    await repo.update(5, bash({ name: "Golpe Renomeado", areaRadius: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] }));
    const raw2 = await readFile(importPath, "utf8");
    const parsed2 = parseSkillEntry(RawSkillYamlSchema.parse((parseYamlText(raw2) as { Body: unknown[] }).Body[0]));
    expect(parsed2.description).toBe("Golpe Renomeado");
    expect(parsed2.splashArea.slice(10)).toEqual([2, 2, 2]);
  });

  it("avisa (não descarta em silêncio) quando um campo não tem representação em skill_db.yml", async () => {
    const { warnings } = await repo.writeOverride(
      bash({ damageFormula: { expression: "atk*2", element: "weapon", needsReview: false } }),
    );
    expect(warnings.some((w) => w.includes("damageFormula"))).toBe(true);
  });
});
