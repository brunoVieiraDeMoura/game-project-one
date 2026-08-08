import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RawStatusSchema,
  statusToRawEntry,
  validateStatusEntry,
  validateStatusBatch,
  type StatusEffectDef,
  type SkillIdResolver,
} from "@ragnarok/game-data";

/**
 * Gate do Mapper/Validator de Status (leia1.txt, 2026-08-07): prova que
 * `StatusEffectDef` → `RawStatus` produz saída válida contra o MESMO
 * schema oficial (nenhuma regra de serialização duplicada), que campos
 * aditivos saem como conjunto FECHADO autoritativo, que `Script` nunca é
 * reescrito, e que a validação cruzada pega duplicata/referência órfã/
 * DurationLookup inválido.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

function loadRealCatalog(): StatusEffectDef[] {
  return JSON.parse(readFileSync(join(REPO_ROOT, "tools", "legacy-migration", "output", "statuses.json"), "utf8"));
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
    flags: ["send_option", "boss_resist", "stop_attacking", "stop_casting", "remove_on_damaged"],
    durationLookupSkill: "NPC_PETRIFYATTACK",
    failOn: ["refresh", "inspiration", "freeze", "stun", "sleep"],
    endOnStart: ["aeterna"],
    endReturn: ["stonewait", "stone"],
    endOnEnd: [],
    group: "controle",
    params: [],
    ...overrides,
  };
}

function fakeSkillResolver(known: string[]): SkillIdResolver {
  const set = new Set(known.map((s) => s.toLowerCase()));
  return {
    idOf: (name) => (set.has(name.toLowerCase()) ? 1 : undefined),
    nameOf: () => undefined,
  };
}

describe("Mapper de Status — StatusEffectDef → RawStatus", () => {
  it("saída de statusToRawEntry valida contra o MESMO schema oficial (RawStatusSchema)", () => {
    const { entry } = statusToRawEntry(stone());
    expect(RawStatusSchema.safeParse(entry).success).toBe(true);
  });

  it("campos aditivos pequenos saem como conjunto FECHADO — flag não marcada vira false explícito, não ausente", () => {
    const { entry } = statusToRawEntry(stone());
    expect(entry.States?.NOMOVE).toBe(true);
    expect(entry.States?.NOCAST).toBe(true);
    expect(entry.States?.NOATTACK).toBe(true);
    // não pedido — tem que estar false, não ausente (autoritativo)
    expect(entry.States?.NOWARP).toBe(false);
    expect(entry.States?.NODEATHPENALTY).toBe(false);
    expect(Object.keys(entry.States ?? {}).length).toBeGreaterThan(3); // todas as 18 mapeadas presentes
  });

  it("Opt1 canoniza pra grafia do enum (stone → STONE)", () => {
    const { entry } = statusToRawEntry(stone());
    expect(entry.Opt1).toBe("STONE");
  });

  it("Status/Fail/EndOnStart/EndReturn saem em TitleCase mecânico (sempre válido, nunca reivindicado como grafia original)", () => {
    const { entry } = statusToRawEntry(stone());
    expect(entry.Status).toBe("Stone");
    expect(entry.Fail?.Refresh).toBe(true);
    expect(entry.Fail?.Freeze).toBe(true);
    expect(entry.EndOnStart?.Aeterna).toBe(true);
    expect(entry.EndReturn?.Stonewait).toBe(true);
  });

  it("Fail/EndOnStart/etc.: remover uma referência que estava na base vira false explícito, não some", () => {
    const base = RawStatusSchema.parse({
      Status: "Stone",
      Fail: { Freeze: true, Stun: true, Sleep: true },
    });
    const { entry } = statusToRawEntry(stone({ failOn: ["freeze"] }), base); // removeu stun/sleep
    expect(entry.Fail?.Freeze).toBe(true);
    expect(entry.Fail?.Stun).toBe(false);
    expect(entry.Fail?.Sleep).toBe(false);
  });

  it("Script nunca é reescrito a partir de effects — preservado verbatim do base", () => {
    const base = RawStatusSchema.parse({ Status: "Berserk", Script: "sc_start SC_ASPDPOTION0,0,0;" });
    const { entry, warnings } = statusToRawEntry(
      stone({ id: "berserk", effects: { effects: [], unmappedEffects: ["sc_start SC_ASPDPOTION0,0,0;"] } }),
      base,
    );
    expect(entry.Script).toBe("sc_start SC_ASPDPOTION0,0,0;");
    expect(warnings.some((w) => w.includes("Script"))).toBe(true);
  });

  it("valor de flag não reconhecido é ignorado com aviso, nunca gravado como lixo", () => {
    const { entry, warnings } = statusToRawEntry(stone({ states: ["no_move", "campo_inventado"] }));
    expect(warnings.some((w) => w.includes("campo_inventado"))).toBe(true);
    expect(Object.values(entry.States ?? {}).every((v) => typeof v === "boolean")).toBe(true);
  });

  it("round-trip sobre 200 status reais do catálogo migrado: toda saída valida contra RawStatusSchema", () => {
    const real = loadRealCatalog().slice(0, 200);
    for (const s of real) {
      const { entry } = statusToRawEntry(s);
      const parsed = RawStatusSchema.safeParse(entry);
      expect(parsed.success).toBe(true);
    }
  });
});

describe("Validator de Status", () => {
  it("estrutural: minRate fora de 0..65535 é rejeitado", () => {
    expect(validateStatusEntry(stone({ minRate: 70000 }))).not.toEqual([]);
  });

  it("estrutural: minDurationMs negativo é rejeitado", () => {
    expect(validateStatusEntry(stone({ minDurationMs: -1 }))).not.toEqual([]);
  });

  it("cruzada: referência órfã em Fail é detectada", () => {
    const known = new Set(["stone", "freeze"]);
    const issues = validateStatusBatch([stone({ failOn: ["freeze", "status_inexistente"] })], known, fakeSkillResolver(["NPC_PETRIFYATTACK"]));
    expect(issues.some((i) => i.message.includes("status_inexistente"))).toBe(true);
  });

  it("cruzada: DurationLookup referenciando skill inexistente é detectado", () => {
    const known = new Set(["stone"]);
    const issues = validateStatusBatch([stone({ durationLookupSkill: "SKILL_QUE_NAO_EXISTE" })], known, fakeSkillResolver(["NPC_PETRIFYATTACK"]));
    expect(issues.some((i) => i.message.includes("SKILL_QUE_NAO_EXISTE"))).toBe(true);
  });

  it("cruzada: id duplicado no lote é detectado", () => {
    const known = new Set(["stone"]);
    const issues = validateStatusBatch([stone(), stone()], known, fakeSkillResolver([]));
    expect(issues.some((i) => i.message.includes("duplicado"))).toBe(true);
  });

  it("cruzada: referência a outro status do MESMO lote (ainda não no catálogo) é aceita, não órfã", () => {
    const known = new Set<string>();
    const a = stone({
      id: "a",
      failOn: ["b"],
      endOnStart: [],
      endReturn: [],
      durationLookupSkill: undefined,
    });
    const b = stone({ id: "b", failOn: [], endOnStart: [], endReturn: [], durationLookupSkill: undefined });
    const issues = validateStatusBatch([a, b], known, fakeSkillResolver([]));
    expect(issues.filter((i) => i.status === "a")).toEqual([]);
  });
});
