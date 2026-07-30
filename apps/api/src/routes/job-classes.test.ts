import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { JsonJobClassRepository } from "../store/json-job-class-repository";
import { join } from "node:path";
import { tmpdir } from "node:os";

function sampleJobClass(id: number, name = `Job ${id}`) {
  return {
    id,
    name,
    parentClassId: null,
    maxBaseLevel: 99,
    maxJobLevel: 50,
    baseStats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
    bonusStatsPerLevel: [{ level: 2, stats: { str: 1 } }],
    baseHpByLevel: [40, 45],
    baseSpByLevel: [11, 12],
    maxWeight: 20000,
    baseExpByLevel: [9, 16],
    jobExpByLevel: [10, 18],
    allowedWeapons: [],
    allowedArmorTags: [],
    skills: [{ skillId: 1, maxLevel: 9, requires: [] }],
    aspdModifiers: [{ weaponType: "dagger", baseAspd: 55 }],
  };
}

describe("job classes API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const repo = new JsonJobClassRepository(
      join(tmpdir(), `jobs-test-${Date.now()}-${Math.random()}.json`),
    );
    app = await buildServer({ jobClassRepository: repo, security: null });
  });

  it("creates, reads, pages and searches (id 0 allowed — Novice)", async () => {
    for (const [id, name] of [[0, "Novice"], [1, "Swordman"], [7, "Knight"]] as const) {
      const res = await app.inject({ method: "POST", url: "/job-classes", payload: sampleJobClass(id, name) });
      expect(res.statusCode).toBe(201);
    }

    const page = await app.inject({ method: "GET", url: "/job-classes?page=1&pageSize=2" });
    const body = page.json();
    expect(body.total).toBe(3);
    expect(body.jobClasses).toHaveLength(2);
    expect(body.jobClasses[0].id).toBe(0);

    const search = await app.inject({ method: "GET", url: "/job-classes?search=knight" });
    expect(search.json().jobClasses).toEqual([expect.objectContaining({ name: "Knight" })]);

    const novice = await app.inject({ method: "GET", url: "/job-classes/0" });
    expect(novice.statusCode).toBe(200);
    expect(novice.json().name).toBe("Novice");
  });

  it("validates payloads, rejects duplicates, updates and deletes", async () => {
    const bad = await app.inject({ method: "POST", url: "/job-classes", payload: { id: 1 } });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/job-classes", payload: sampleJobClass(7) });
    const dup = await app.inject({ method: "POST", url: "/job-classes", payload: sampleJobClass(7) });
    expect(dup.statusCode).toBe(409);

    const upd = await app.inject({
      method: "PUT",
      url: "/job-classes/7",
      payload: { ...sampleJobClass(7), name: "Knight" },
    });
    expect(upd.json().name).toBe("Knight");

    const del = await app.inject({ method: "DELETE", url: "/job-classes/7" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/job-classes/7" });
    expect(gone.statusCode).toBe(404);
  });
});
