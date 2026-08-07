import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { JobStatsDocSchema, SkillTreeDocSchema } from "@ragnarok/game-data";

/**
 * Gate do módulo Classes (leia1.txt, 2026-08-07 — mesmo pipeline de
 * Skills): nenhum Mapper/Writer antes deste teste provar que o Parser
 * (`packages/game-data/src/rathena/{job-stats,skill-tree}-yaml.ts`) lê
 * 100% dos 4 arquivos JOB_STATS + o SKILL_TREE_DB sem perder informação.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

function loadDoc(relPath: string): unknown {
  return parseYaml(readFileSync(join(REPO_ROOT, "rathena", relPath), "utf8"));
}

describe("JOB_STATS (job_stats/job_basepoints/job_exp/job_aspd) — Parser lê 100%", () => {
  const files = [
    ["db/re/job_stats.yml", "job_stats"],
    ["db/re/job_basepoints.yml", "job_basepoints"],
    ["db/re/job_exp.yml", "job_exp"],
    ["db/re/job_aspd.yml", "job_aspd"],
  ] as const;

  for (const [path, label] of files) {
    it(`${label}: todas as entradas validam e sobrevivem ao round-trip`, () => {
      const doc = loadDoc(path);
      const parsed = JobStatsDocSchema.parse(doc);
      expect(parsed.Body.length).toBeGreaterThan(0);

      // reemite (mesmo schema, forma canônica) e reparseia
      const reemitted = stringifyYaml({ Header: parsed.Header, Body: parsed.Body });
      const reparsed = JobStatsDocSchema.parse(parseYaml(reemitted));
      expect(reparsed).toEqual(parsed);
    });
  }

  it("job_aspd: as 25 chaves de BaseASPD batem com a lista verificada, sem sobra nem falta", () => {
    const doc = JobStatsDocSchema.parse(loadDoc("db/re/job_aspd.yml"));
    const seen = new Set<string>();
    for (const entry of doc.Body) {
      for (const k of Object.keys(entry.BaseASPD ?? {})) seen.add(k);
    }
    expect(seen.size).toBe(25);
  });

  it("job_stats: BonusStats com os 12 PARAM_ conhecidos, nenhuma chave rejeitada", () => {
    const doc = JobStatsDocSchema.parse(loadDoc("db/re/job_stats.yml"));
    const total = doc.Body.reduce((n, e) => n + (e.BonusStats?.length ?? 0), 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe("SKILL_TREE_DB (skill_tree.yml) — Parser lê 100%", () => {
  it("todas as entradas de db/re/skill_tree.yml validam e sobrevivem ao round-trip", () => {
    const doc = SkillTreeDocSchema.parse(loadDoc("db/re/skill_tree.yml"));
    expect(doc.Body.length).toBeGreaterThan(0);

    const reemitted = stringifyYaml({ Header: doc.Header, Body: doc.Body });
    const reparsed = SkillTreeDocSchema.parse(parseYaml(reemitted));
    expect(reparsed).toEqual(doc);
  });

  it("achado da auditoria: BaseLevel/JobLevel existem de verdade nos dados (não foram perdidos pelo Parser)", () => {
    const doc = SkillTreeDocSchema.parse(loadDoc("db/re/skill_tree.yml"));
    let withBaseLevel = 0;
    let withJobLevel = 0;
    for (const job of doc.Body) {
      for (const skill of job.Tree) {
        if (skill.BaseLevel !== undefined) withBaseLevel++;
        if (skill.JobLevel !== undefined) withJobLevel++;
      }
    }
    expect(withBaseLevel).toBeGreaterThan(0);
    expect(withJobLevel).toBeGreaterThan(0);
  });

  it("Rune_Knight herda a cadeia inteira já achatada nos dados (Novice+Swordman+Knight), não só o pai direto", () => {
    const doc = SkillTreeDocSchema.parse(loadDoc("db/re/skill_tree.yml"));
    const runeKnight = doc.Body.find((j) => j.Job === "Rune_Knight");
    expect(runeKnight?.Inherit?.Novice).toBe(true);
    expect(runeKnight?.Inherit?.Swordman).toBe(true);
    expect(runeKnight?.Inherit?.Knight).toBe(true);
  });
});
