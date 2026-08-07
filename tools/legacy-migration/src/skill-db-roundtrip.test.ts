import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { RawSkillYamlSchema, parseSkillEntry, reemitRawSkillYaml } from "@ragnarok/game-data";

/**
 * Gate do projeto (leia.txt, 2026-08-07 — ver memory
 * workflow-parser-before-writer): nenhum Writer de skill_db.yml é escrito
 * antes deste teste provar que o Parser (`packages/game-data/src/rathena/
 * skill-db-yaml.ts`) lê 100% do catálogo real sem perder informação.
 *
 * Prova: para cada uma das 1.635 entradas de `db/re/skill_db.yml`,
 *   bruto → RawSkillYamlSchema (tem que validar)
 *        → parseSkillEntry (resolve pra forma canônica)
 *        → reemitRawSkillYaml (reemite bruto, sempre lista de 13 níveis)
 *        → parseSkillEntry de novo
 *   e as duas formas resolvidas têm que ser estruturalmente idênticas —
 *   se não forem, o Parser está perdendo ou distorcendo campo.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SOURCE = join(REPO_ROOT, "rathena", "db", "re", "skill_db.yml");

interface RawBody {
  Id: number;
  Name: string;
  [key: string]: unknown;
}

function loadBody(): RawBody[] {
  const doc = parseYaml(readFileSync(SOURCE, "utf8")) as { Body: RawBody[] };
  return doc.Body;
}

describe("skill_db.yml — Parser lê 100% do formato (gate antes do Writer)", () => {
  it("todas as 1.635 entradas validam contra RawSkillYamlSchema", () => {
    const body = loadBody();
    expect(body.length).toBeGreaterThan(1600);

    const failures: { id: number; name: string; error: string }[] = [];
    for (const raw of body) {
      const parsed = RawSkillYamlSchema.safeParse(raw);
      if (!parsed.success) {
        failures.push({ id: raw.Id, name: raw.Name, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      }
    }
    if (failures.length > 0) {
      console.error(JSON.stringify(failures.slice(0, 20), null, 2));
    }
    expect(failures).toEqual([]);
  });

  it("ida-e-volta (parse → reemite → reparse) é idêntica pra cada entrada", () => {
    const body = loadBody();
    const mismatches: { id: number; name: string; diff: string }[] = [];

    for (const raw of body) {
      const validated = RawSkillYamlSchema.parse(raw);
      const first = parseSkillEntry(validated);
      const reemitted = reemitRawSkillYaml(first);
      const second = parseSkillEntry(reemitted);

      const a = JSON.stringify(first);
      const b = JSON.stringify(second);
      if (a !== b) {
        mismatches.push({ id: raw.Id, name: raw.Name, diff: `${a.slice(0, 300)} !== ${b.slice(0, 300)}` });
      }
    }
    if (mismatches.length > 0) {
      console.error(JSON.stringify(mismatches.slice(0, 10), null, 2));
    }
    expect(mismatches).toEqual([]);
  });

  it("casos isolados na auditoria batem campo a campo", () => {
    const body = loadBody();
    const byName = new Map(body.map((r) => [r.Name, r]));

    // SM_BASH: Requires + Weapon mask + CopyFlags + perLevel
    const bash = parseSkillEntry(RawSkillYamlSchema.parse(byName.get("SM_BASH")));
    expect(bash.copyFlags?.skill.Plagiarism).toBe(true);
    expect(bash.requires?.weapon.Fist).toBe(true);

    // WZ_STORMGUST: Unit completo
    const storm = parseSkillEntry(RawSkillYamlSchema.parse(byName.get("WZ_STORMGUST")));
    expect(storm.unit?.id).toBe("Dummyskill");
    expect(storm.unit?.flag.NoOverlap).toBe(true);
    expect(storm.unit?.flag.PathCheck).toBe(true);

    // AL_WARP: AlternateId + Interval negativo
    const warp = parseSkillEntry(RawSkillYamlSchema.parse(byName.get("AL_WARP")));
    expect(warp.unit?.alternateId).toBe("Warp_Waiting");
    expect(warp.unit?.interval).toBe(-1);
  });
});
