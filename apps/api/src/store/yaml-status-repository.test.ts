import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import type { Skill, StatusEffectDef } from "@ragnarok/game-data";
import { JsonStatusRepository } from "./json-status-repository";
import { JsonSkillRepository } from "./json-skill-repository";
import { YamlStatusRepository } from "./yaml-status-repository";

/**
 * Testes exigidos antes de qualquer gravação real em `db/import/status.yml`
 * (leia1.txt, aprovação Mapper/Validator/Writer de Status, 2026-08-07):
 * round-trip do Writer, validação estrutural+cruzada, diff, backup,
 * atomicidade — mesmo rigor de Skills/Classes.
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

function stone(overrides: Partial<StatusEffectDef> = {}): StatusEffectDef {
  return {
    id: "stone",
    name: "Stone",
    category: "debuff",
    states: ["no_move", "no_cast", "no_attack"],
    calcFlags: ["def_ele", "def", "mdef"],
    opt1: "stone",
    opt2: [],
    opt3: [],
    options: [],
    flags: ["send_option", "boss_resist", "stop_attacking"],
    durationLookupSkill: undefined,
    failOn: [],
    endOnStart: [],
    endReturn: [],
    endOnEnd: [],
    group: "controle",
    params: [],
    ...overrides,
  };
}

function freeze(overrides: Partial<StatusEffectDef> = {}): StatusEffectDef {
  return { ...stone({ id: "freeze", name: "Freeze", opt1: "freeze", states: ["no_move", "no_cast", "no_attack"] }), ...overrides };
}

describe("YamlStatusRepository — Writer schema-first (Mapper+Validator já aprovados)", () => {
  let importPath: string;
  let repo: YamlStatusRepository;
  let delegate: JsonStatusRepository;
  let skillDelegate: JsonSkillRepository;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random()}`;
    importPath = join(tmpdir(), `status-writer-test-${stamp}.yml`);
    delegate = new JsonStatusRepository(join(tmpdir(), `statuses-writer-test-${stamp}.json`));
    skillDelegate = new JsonSkillRepository(join(tmpdir(), `skills-writer-test-${stamp}.json`));
    await skillDelegate.create(bash());
    repo = new YamlStatusRepository(delegate, skillDelegate, importPath);
  });

  afterEach(async () => {
    await rm(importPath, { force: true });
    await rm(`${importPath}.bak`, { force: true });
    await rm(`${importPath}.tmp`, { force: true });
  });

  it("round-trip: grava, reparseia com o MESMO Parser, os campos batem", async () => {
    await repo.create(stone());

    const raw = await readFile(importPath, "utf8");
    const doc = parseYamlText(raw) as { Header: { Type: string; Version: number }; Body: { Status: string }[] };
    expect(doc.Header).toEqual({ Type: "STATUS_DB", Version: 4 });

    const entry = doc.Body.find((e) => e.Status === "Stone") as never as {
      States: Record<string, boolean>;
      Opt1: string;
    };
    expect(entry.Opt1).toBe("STONE");
    expect(entry.States.NOMOVE).toBe(true);
    expect(entry.States.NOWARP).toBe(false); // conjunto fechado autoritativo
  });

  it("validação estrutural: minRate fora de 0..65535 é rejeitado, arquivo não é tocado", async () => {
    await expect(repo.create(stone({ minRate: 99999 }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(readFile(importPath, "utf8")).rejects.toThrow();
  });

  it("validação cruzada: DurationLookup pra skill inexistente é rejeitado", async () => {
    await expect(repo.create(stone({ durationLookupSkill: "SKILL_INEXISTENTE" }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("validação cruzada: DurationLookup pra skill existente passa", async () => {
    await expect(repo.create(stone({ durationLookupSkill: "SM_BASH" }))).resolves.toBeDefined();
  });

  it("diff: editar freeze depois de stone não toca a entrada já gravada de stone", async () => {
    await repo.create(stone());
    const afterStone = await readFile(importPath, "utf8");

    await repo.create(freeze());
    const afterFreeze = await readFile(importPath, "utf8");

    const docA = parseYamlText(afterStone) as { Body: { Status: string }[] };
    const docB = parseYamlText(afterFreeze) as { Body: { Status: string }[] };
    expect(docB.Body.find((e) => e.Status === "Stone")).toEqual(docA.Body.find((e) => e.Status === "Stone"));
    expect(docB.Body.map((e) => e.Status).sort()).toEqual(["Freeze", "Stone"]);
  });

  it("backup: reescrever o MESMO status gera .bak com o conteúdo anterior", async () => {
    await repo.create(stone());
    const before = await readFile(importPath, "utf8");

    await repo.update("stone", stone({ minRate: 100 }));
    const bak = await readFile(`${importPath}.bak`, "utf8");
    expect(bak).toBe(before);
  });

  it("Fail/EndOnStart preservam referência antiga como false quando removida (catálogo ilimitado)", async () => {
    await delegate.create(freeze());
    await delegate.create(stone({ id: "stun", name: "Stun" }));
    await repo.create(stone({ failOn: ["freeze", "stun"] }));
    await repo.update("stone", stone({ failOn: ["freeze"] })); // removeu "stun"

    const raw = await readFile(importPath, "utf8");
    const doc = parseYamlText(raw) as { Body: { Status: string; Fail?: Record<string, boolean> }[] };
    const entry = doc.Body.find((e) => e.Status === "Stone")!;
    expect(entry.Fail?.Freeze).toBe(true);
    expect(entry.Fail?.Stun).toBe(false);
  });

  it("atomicidade: falha de validação cruzada não corrompe o estado já gravado", async () => {
    await repo.create(stone());
    const okState = await readFile(importPath, "utf8");

    await expect(repo.update("stone", stone({ durationLookupSkill: "SKILL_INEXISTENTE" }))).rejects.toMatchObject({ statusCode: 400 });

    const stateAfterFailure = await readFile(importPath, "utf8");
    expect(stateAfterFailure).toBe(okState);
  });
});
