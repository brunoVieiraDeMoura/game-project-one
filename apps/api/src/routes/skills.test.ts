import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { JsonSkillRepository } from "../store/json-skill-repository";
import { JsonStatusRepository } from "../store/json-status-repository";
import { join } from "node:path";
import { tmpdir } from "node:os";

function sampleSkill(id: number, name = `Skill ${id}`, aegisName = `SK_${id}`) {
  return {
    id,
    aegisName,
    name,
    maxLevel: 10,
    type: "damage",
    damageNature: "weapon",
    hitType: "single",
    element: "weapon",
    range: -1,
    hits: 1,
    spCost: [8, 8, 8, 8, 8, 15, 15, 15, 15, 15],
    castTimeMs: { variable: 0, fixed: 0 },
    target: "enemy",
    damageFormula: { expression: "", needsReview: true, legacySource: "battle.cpp" },
    appliedStatuses: [{ statusId: "stun", durationMs: 4500, needsReview: true }],
  };
}

function sampleStatus(id: string, name = id) {
  return {
    id,
    name,
    category: "debuff",
    states: ["no_move"],
    flags: ["debuff"],
    minDurationMs: 1000,
  };
}

describe("skills API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({
      skillRepository: new JsonSkillRepository(join(tmpdir(), `skills-test-${Date.now()}-${Math.random()}.json`)),
      statusRepository: new JsonStatusRepository(join(tmpdir(), `statuses-test-${Date.now()}-${Math.random()}.json`)),
      security: null,
    });
  });

  it("creates, reads, pages and searches by name/aegisName", async () => {
    for (const [id, name, aegis] of [
      [5, "Bash", "SM_BASH"],
      [6, "Provoke", "SM_PROVOKE"],
      [7, "Magnum Break", "SM_MAGNUM"],
    ] as const) {
      const res = await app.inject({ method: "POST", url: "/skills", payload: sampleSkill(id, name, aegis) });
      expect(res.statusCode).toBe(201);
    }

    const page = await app.inject({ method: "GET", url: "/skills?page=1&pageSize=2" });
    const body = page.json();
    expect(body.total).toBe(3);
    expect(body.skills).toHaveLength(2);
    expect(body.skills[0].id).toBe(5);

    const byName = await app.inject({ method: "GET", url: "/skills?search=magnum" });
    expect(byName.json().skills).toEqual([expect.objectContaining({ aegisName: "SM_MAGNUM" })]);

    const byAegis = await app.inject({ method: "GET", url: "/skills?search=sm_bash" });
    expect(byAegis.json().skills).toEqual([expect.objectContaining({ name: "Bash" })]);

    const one = await app.inject({ method: "GET", url: "/skills/5" });
    expect(one.statusCode).toBe(200);
    expect(one.json().damageFormula.needsReview).toBe(true);
  });

  it("validates payloads, rejects duplicates, updates and deletes", async () => {
    const bad = await app.inject({ method: "POST", url: "/skills", payload: { id: 1 } });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/skills", payload: sampleSkill(5) });
    const dup = await app.inject({ method: "POST", url: "/skills", payload: sampleSkill(5) });
    expect(dup.statusCode).toBe(409);

    const upd = await app.inject({
      method: "PUT",
      url: "/skills/5",
      payload: { ...sampleSkill(5), name: "Bash" },
    });
    expect(upd.json().name).toBe("Bash");

    const del = await app.inject({ method: "DELETE", url: "/skills/5" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/skills/5" });
    expect(gone.statusCode).toBe(404);
  });
});

describe("statuses API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({
      skillRepository: new JsonSkillRepository(join(tmpdir(), `skills-test-${Date.now()}-${Math.random()}.json`)),
      statusRepository: new JsonStatusRepository(join(tmpdir(), `statuses-test-${Date.now()}-${Math.random()}.json`)),
      security: null,
    });
  });

  it("CRUD com id string + busca + pageSize grande pro dropdown", async () => {
    for (const id of ["stun", "stone", "freeze"]) {
      const res = await app.inject({ method: "POST", url: "/statuses", payload: sampleStatus(id) });
      expect(res.statusCode).toBe(201);
    }

    const all = await app.inject({ method: "GET", url: "/statuses?pageSize=2000" });
    expect(all.json().total).toBe(3);

    const search = await app.inject({ method: "GET", url: "/statuses?search=sto" });
    expect(search.json().statuses).toEqual([expect.objectContaining({ id: "stone" })]);

    const one = await app.inject({ method: "GET", url: "/statuses/stun" });
    expect(one.json().states).toEqual(["no_move"]);

    const dup = await app.inject({ method: "POST", url: "/statuses", payload: sampleStatus("stun") });
    expect(dup.statusCode).toBe(409);

    const upd = await app.inject({
      method: "PUT",
      url: "/statuses/stun",
      payload: { ...sampleStatus("stun"), category: "neutral" },
    });
    expect(upd.json().category).toBe("neutral");

    const del = await app.inject({ method: "DELETE", url: "/statuses/freeze" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/statuses/freeze" });
    expect(gone.statusCode).toBe(404);
  });
});
