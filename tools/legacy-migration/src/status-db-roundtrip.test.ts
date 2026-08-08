import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { StatusDocSchema, RawStatusSchema } from "@ragnarok/game-data";

/**
 * Gate do módulo Status (leia1.txt, aprovação 2026-08-07 — mesmo pipeline
 * de Skills/Classes): nenhum Mapper/Validator/Writer antes deste teste
 * provar que o Parser (`packages/game-data/src/rathena/status-db-yaml.ts`)
 * lê 100% das 1.019 entradas de `db/re/status.yml` sem perder informação.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const STATUS_PATH = join(REPO_ROOT, "rathena", "db", "re", "status.yml");

function loadDoc(): unknown {
  return parseYaml(readFileSync(STATUS_PATH, "utf8"));
}

describe("status.yml — Parser lê 100% do formato (gate antes do Mapper)", () => {
  it("todas as 1.019 entradas validam contra StatusDocSchema", () => {
    const doc = StatusDocSchema.parse(loadDoc());
    expect(doc.Header).toEqual({ Type: "STATUS_DB", Version: 4 });
    expect(doc.Body.length).toBe(1019);
  });

  it("ida-e-volta (parse → reemite → reparse) é estruturalmente idêntica pra cada entrada", () => {
    const doc = StatusDocSchema.parse(loadDoc());
    const mismatches: { status: string; diff: string }[] = [];

    for (const entry of doc.Body) {
      const reemitted = stringifyYaml(entry);
      const reparsed = RawStatusSchema.parse(parseYaml(reemitted));
      if (JSON.stringify(reparsed) !== JSON.stringify(entry)) {
        mismatches.push({ status: entry.Status, diff: `${JSON.stringify(entry)} !== ${JSON.stringify(reparsed)}` });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });

  it("CalcFlags.All sobrevive e vira chave canônica 'All' (47 entradas reais — grep inicial da auditoria só viu os 5 primeiros, head -5)", () => {
    const doc = StatusDocSchema.parse(loadDoc());
    const withAll = doc.Body.filter((e) => e.CalcFlags?.All === true);
    expect(withAll.length).toBe(47);
  });

  it("Script é preservado literalmente como string crua (168 entradas reais — grep inicial contava a linha do comentário-cabeçalho)", () => {
    const doc = StatusDocSchema.parse(loadDoc());
    const withScript = doc.Body.filter((e) => e.Script !== undefined);
    expect(withScript.length).toBe(168);
    for (const e of withScript) expect(typeof e.Script).toBe("string");
  });

  it("caso isolado Stone: Opt1 canonizado, States/CalcFlags/Flags/Fail/EndOnStart/EndReturn todos presentes", () => {
    const doc = StatusDocSchema.parse(loadDoc());
    const stone = doc.Body.find((e) => e.Status === "Stone")!;
    expect(stone.Opt1).toBe("STONE"); // canonizado (era "Stone" no YAML)
    expect(stone.States?.NOMOVE).toBe(true); // canonizado (era "NoMove")
    expect(stone.States?.NOCAST).toBe(true);
    expect(stone.States?.NOATTACK).toBe(true);
    expect(stone.CalcFlags?.DEF_ELE).toBe(true); // canonizado (era "Def_Ele")
    expect(stone.CalcFlags?.DEF).toBe(true);
    expect(stone.CalcFlags?.MDEF).toBe(true);
    expect(stone.Flags?.SENDOPTION).toBe(true); // canonizado (era "SendOption")
    expect(stone.Flags?.BOSSRESIST).toBe(true);
    expect(stone.Flags?.REMOVEONDAMAGED).toBe(true);
    expect(stone.Fail?.Freeze).toBe(true); // Fail/EndOnStart/EndReturn ficam string livre — grafia CRUA preservada
    expect(stone.Fail?.Stun).toBe(true);
    expect(stone.EndOnStart?.Aeterna).toBe(true);
    expect(stone.EndReturn?.Stone).toBe(true);
    expect(stone.EndReturn?.StoneWait).toBe(true);
    expect(stone.DurationLookup).toBe("NPC_PETRIFYATTACK");
  });

  it("chave desconhecida em campo aditivo pequeno é rejeitada (Validator estrutural do Parser)", () => {
    const bad = {
      Status: "Fake",
      States: { NaoExiste: true },
    };
    expect(RawStatusSchema.safeParse(bad).success).toBe(false);
  });

  it("false sobrevive nos campos aditivos (achado: flagArray() do migrador atual descarta — Parser não pode)", () => {
    const withFalse = {
      Status: "Fake",
      States: { NoMove: true, NoCast: false },
    };
    const parsed = RawStatusSchema.parse(withFalse);
    expect(parsed.States).toEqual({ NOMOVE: true, NOCAST: false });
  });
});
