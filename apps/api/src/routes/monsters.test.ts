import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { JsonMonsterRepository } from "../store/json-monster-repository";
import { join } from "node:path";
import { tmpdir } from "node:os";

function sampleMonster(id: number, name = `Mob ${id}`, aegisName = `MOB_${id}`) {
  return {
    id,
    aegisName,
    name,
    level: 16,
    hp: 136,
    baseExp: 169,
    jobExp: 115,
    stats: { str: 12, agi: 15, vit: 10, int: 5, dex: 19, luk: 5 },
    attack: 7,
    magicAttack: 7,
    race: "insect",
    element: { type: "fire", level: 1 },
    size: "small",
    ai: "01",
    aiMode: "passive",
    drops: [
      { itemId: 990, rate: 0.35 },
      { itemId: 904, rate: 27.5 },
    ],
    spawns: [{ mapId: "prt_fild00", amount: 10, respawnTimeMs: 5000 }],
  };
}

describe("monsters API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({
      monsterRepository: new JsonMonsterRepository(
        join(tmpdir(), `monsters-test-${Date.now()}-${Math.random()}.json`),
      ),
      security: null,
    });
  });

  it("A23: /capabilities reporta spawnsWritable=true quando o repositório injetado NÃO é o MySQL (checa a instância, não o env cru — hasRoDatabase() pode ser true no ambiente e o repo em uso ser outro)", async () => {
    const res = await app.inject({ method: "GET", url: "/monsters/capabilities" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ spawnsWritable: true });
  });

  it("creates, reads, pages and searches", async () => {
    for (const [id, name, aegis] of [
      [1001, "Scorpion", "SCORPION"],
      [1002, "Poring", "PORING"],
      [1004, "Hornet", "HORNET"],
    ] as const) {
      const res = await app.inject({ method: "POST", url: "/monsters", payload: sampleMonster(id, name, aegis) });
      expect(res.statusCode).toBe(201);
    }

    const page = await app.inject({ method: "GET", url: "/monsters?page=1&pageSize=2" });
    const body = page.json();
    expect(body.total).toBe(3);
    expect(body.monsters).toHaveLength(2);
    expect(body.monsters[0].id).toBe(1001);

    const search = await app.inject({ method: "GET", url: "/monsters?search=poring" });
    expect(search.json().monsters).toEqual([expect.objectContaining({ aegisName: "PORING" })]);

    const one = await app.inject({ method: "GET", url: "/monsters/1001" });
    expect(one.statusCode).toBe(200);
    expect(one.json().drops).toHaveLength(2);
  });

  it('consulta reversa "quem dropa X" cobre drops e mvpDrops', async () => {
    await app.inject({ method: "POST", url: "/monsters", payload: sampleMonster(1001) });
    await app.inject({
      method: "POST",
      url: "/monsters",
      payload: {
        ...sampleMonster(1038, "Osiris", "OSIRIS"),
        drops: [{ itemId: 714, rate: 1 }],
        mvp: true,
        mvpDrops: [{ itemId: 990, rate: 10 }],
      },
    });

    const byDrop = await app.inject({ method: "GET", url: "/monsters?dropsItem=904" });
    expect(byDrop.json().monsters).toEqual([expect.objectContaining({ id: 1001 })]);

    // item 990 aparece nos drops do 1001 e nos mvpDrops do 1038
    const both = await app.inject({ method: "GET", url: "/monsters?dropsItem=990" });
    expect(both.json().monsters.map((m: { id: number }) => m.id)).toEqual([1001, 1038]);

    const none = await app.inject({ method: "GET", url: "/monsters?dropsItem=999999" });
    expect(none.json().total).toBe(0);
  });

  it("validates payloads, rejects duplicates, updates and deletes", async () => {
    const bad = await app.inject({ method: "POST", url: "/monsters", payload: { id: 1 } });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/monsters", payload: sampleMonster(1001) });
    const dup = await app.inject({ method: "POST", url: "/monsters", payload: sampleMonster(1001) });
    expect(dup.statusCode).toBe(409);

    const upd = await app.inject({
      method: "PUT",
      url: "/monsters/1001",
      payload: { ...sampleMonster(1001), name: "Scorpion" },
    });
    expect(upd.json().name).toBe("Scorpion");

    const del = await app.inject({ method: "DELETE", url: "/monsters/1001" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/monsters/1001" });
    expect(gone.statusCode).toBe(404);
  });
});
