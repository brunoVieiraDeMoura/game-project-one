import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import { RawSkillYamlSchema, parseSkillEntry, type Item, type Skill } from "@ragnarok/game-data";
import { JsonSkillRepository } from "./json-skill-repository";
import { YamlSkillRepository } from "./yaml-skill-repository";
import type { ItemListResult, ItemRepository } from "./item-repository";

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

function fakeItem(id: number, aegisName: string): Item {
  return {
    id,
    aegisName,
    name: aegisName,
    type: "etc",
    buyPrice: 10,
    sellPrice: 5,
    weight: 10,
    attack: 0,
    magicAttack: 0,
    defense: 0,
    range: 0,
    slots: 0,
    jobs: ["all"],
    classes: [],
    gender: "both",
    locations: [],
    equipLevelMin: 0,
    equipLevelMax: 0,
    refineable: false,
    gradable: false,
    viewSprite: 0,
  };
}

/** Fake mínimo de `ItemRepository` (achado A21): só `get(id)` é exercitado pelo resolver do Writer — os demais métodos não são chamados por este caminho. */
class FakeItemRepository implements ItemRepository {
  constructor(private readonly items: Map<number, Item>) {}
  async list(): Promise<ItemListResult> {
    throw new Error("FakeItemRepository.list não implementado — não usado pelo write-path de Skill");
  }
  async get(id: number): Promise<Item | undefined> {
    return this.items.get(id);
  }
  async create(item: Item): Promise<Item> {
    throw new Error("FakeItemRepository.create não implementado — não usado pelo write-path de Skill");
  }
  async update(): Promise<Item | undefined> {
    throw new Error("FakeItemRepository.update não implementado — não usado pelo write-path de Skill");
  }
  async remove(): Promise<boolean> {
    throw new Error("FakeItemRepository.remove não implementado — não usado pelo write-path de Skill");
  }
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

  it("A13: hitType \"normal\" agora avisa (antes só \"critical\" avisava) — Hit some do YAML nos dois casos", async () => {
    const { warnings } = await repo.writeOverride(bash({ hitType: "normal" }));
    expect(warnings.some((w) => w.includes('hitType "normal"'))).toBe(true);

    const raw = await readFile(importPath, "utf8");
    const entry = RawSkillYamlSchema.parse((parseYamlText(raw) as { Body: unknown[] }).Body[0]);
    expect(entry.Hit).toBeUndefined();
  });

  it("A13: hitType \"critical\" continua avisando (comportamento preexistente, não regrediu)", async () => {
    const { warnings } = await repo.writeOverride(bash({ hitType: "critical" }));
    expect(warnings.some((w) => w.includes('hitType "critical"'))).toBe(true);
  });
});

describe("YamlSkillRepository — ItemCost/Equipment resolvem itemId → aegisName (achado A21)", () => {
  let importPath: string;
  let repo: YamlSkillRepository;
  let delegate: JsonSkillRepository;
  let itemRepository: FakeItemRepository;

  beforeEach(() => {
    importPath = join(tmpdir(), `skill_db.yml-a21-test-${Date.now()}-${Math.random()}.yml`);
    delegate = new JsonSkillRepository(join(tmpdir(), `skills-a21-test-${Date.now()}-${Math.random()}.json`));
    itemRepository = new FakeItemRepository(
      new Map([
        [501, fakeItem(501, "Red_Potion")],
        [1201, fakeItem(1201, "Knife")],
      ]),
    );
    repo = new YamlSkillRepository(delegate, importPath, itemRepository);
  });

  afterEach(async () => {
    await rm(importPath, { force: true });
  });

  async function readEntry() {
    const raw = await readFile(importPath, "utf8");
    const doc = parseYamlText(raw) as { Body: unknown[] };
    return RawSkillYamlSchema.parse(doc.Body[0]);
  }

  it("1) itemId válido resolve pro aegisName correto (via ItemCost)", async () => {
    await repo.create(bash({ requirements: { itemsConsumed: [{ itemId: 501, amount: 1 }], requiredEquipment: [], requiredWeapons: [], requiredAmmo: [], requiredStatuses: [] } }));
    const entry = await readEntry();
    expect(entry.Requires?.ItemCost).toEqual([{ Item: "Red_Potion", Amount: 1 }]);
  });

  it("2) ItemCost com itemId válido → YAML contém aegisName, não o número", async () => {
    const { warnings } = await repo.writeOverride(
      bash({ requirements: { itemsConsumed: [{ itemId: 501, amount: 3, level: 2 }], requiredEquipment: [], requiredWeapons: [], requiredAmmo: [], requiredStatuses: [] } }),
    );
    const entry = await readEntry();
    expect(entry.Requires?.ItemCost).toEqual([{ Item: "Red_Potion", Amount: 3, Level: 2 }]);
    expect(warnings.some((w) => w.includes("ItemCost"))).toBe(false);
  });

  it("3) Equipment com itemId válido → YAML contém aegisName, não o número", async () => {
    const { warnings } = await repo.writeOverride(
      bash({ requirements: { itemsConsumed: [], requiredEquipment: [1201], requiredWeapons: [], requiredAmmo: [], requiredStatuses: [] } }),
    );
    const entry = await readEntry();
    expect(entry.Requires?.Equipment).toEqual({ Knife: true });
    expect(warnings.some((w) => w.includes("Equipment"))).toBe(false);
  });

  it("4) itemId inexistente: omitido do YAML + warning (nunca String(itemId) como fallback)", async () => {
    const { warnings } = await repo.writeOverride(
      bash({
        requirements: {
          itemsConsumed: [{ itemId: 999999, amount: 1 }],
          requiredEquipment: [888888],
          requiredWeapons: [],
          requiredAmmo: [],
          requiredStatuses: [],
        },
      }),
    );
    const entry = await readEntry();
    expect(entry.Requires?.ItemCost ?? []).toEqual([]);
    expect(entry.Requires?.Equipment ?? {}).toEqual({});
    expect(warnings.some((w) => w.includes("ItemCost") && w.includes("999999"))).toBe(true);
    expect(warnings.some((w) => w.includes("Equipment") && w.includes("888888"))).toBe(true);
    // nunca grava o id cru como texto
    const raw = await readFile(importPath, "utf8");
    expect(raw).not.toContain("999999");
    expect(raw).not.toContain("888888");
  });

  it("5) skill sem ItemCost/Equipment preserva o comportamento anterior (sem warning de item, sem chaves no YAML)", async () => {
    const { warnings } = await repo.writeOverride(bash());
    const entry = await readEntry();
    expect(entry.Requires?.ItemCost ?? []).toEqual([]);
    expect(entry.Requires?.Equipment ?? {}).toEqual({});
    expect(warnings.some((w) => w.includes("ItemCost") || w.includes("Equipment"))).toBe(false);
  });

  it("6) múltiplos itens: todos resolvidos individualmente (ItemCost + Equipment juntos)", async () => {
    const { warnings } = await repo.writeOverride(
      bash({
        requirements: {
          itemsConsumed: [
            { itemId: 501, amount: 2 },
            { itemId: 999999, amount: 1 },
          ],
          requiredEquipment: [1201, 888888],
          requiredWeapons: [],
          requiredAmmo: [],
          requiredStatuses: [],
        },
      }),
    );
    const entry = await readEntry();
    expect(entry.Requires?.ItemCost).toEqual([{ Item: "Red_Potion", Amount: 2 }]);
    expect(entry.Requires?.Equipment).toEqual({ Knife: true });
    expect(warnings.some((w) => w.includes("999999"))).toBe(true);
    expect(warnings.some((w) => w.includes("888888"))).toBe(true);
  });

  it("7) nenhum outro campo de Skill mudou (comparação com a skill sem itens)", async () => {
    // mesma forma de `requirements` nos dois lados (armas/munição vazias em ambos)
    // pra isolar a diferença EXCLUSIVAMENTE em itemsConsumed/requiredEquipment
    await repo.create(bash({ requirements: { itemsConsumed: [], requiredEquipment: [], requiredWeapons: [], requiredAmmo: [], requiredStatuses: [] } }));
    const withoutItems = await readEntry();
    await rm(importPath, { force: true });

    await repo.update(5, bash({ requirements: { itemsConsumed: [{ itemId: 501, amount: 1 }], requiredEquipment: [1201], requiredWeapons: [], requiredAmmo: [], requiredStatuses: [] } }));
    const withItems = await readEntry();

    const { Requires: _r1, ...restWithout } = withoutItems;
    const { Requires: _r2, ...restWithItems } = withItems;
    expect(restWithItems).toEqual(restWithout);
    // dentro de Requires, só ItemCost/Equipment mudam — o resto (SpCost etc.) é idêntico
    const { ItemCost: _ic1, Equipment: _eq1, ...requiresRestWithout } = withoutItems.Requires ?? {};
    const { ItemCost: _ic2, Equipment: _eq2, ...requiresRestWithItems } = withItems.Requires ?? {};
    expect(requiresRestWithItems).toEqual(requiresRestWithout);
  });
});
