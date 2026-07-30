import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { JsonItemRepository } from "../store/json-item-repository";
import type { SecurityContext } from "../auth/security";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tempRepo() {
  return new JsonItemRepository(join(tmpdir(), `items-test-${Date.now()}-${Math.random()}.json`));
}

function sampleItem(id: number, name = `Item ${id}`) {
  return {
    id,
    aegisName: `Aegis_${id}`,
    name,
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

describe("items API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ itemRepository: tempRepo(), security: null });
  });

  it("creates, reads, pages and searches", async () => {
    for (const id of [1, 2, 3]) {
      const res = await app.inject({ method: "POST", url: "/items", payload: sampleItem(id) });
      expect(res.statusCode).toBe(201);
    }
    await app.inject({ method: "POST", url: "/items", payload: sampleItem(4, "Red Potion") });

    const page = await app.inject({ method: "GET", url: "/items?page=1&pageSize=2" });
    const body = page.json();
    expect(body.total).toBe(4);
    expect(body.items).toHaveLength(2);

    const search = await app.inject({ method: "GET", url: "/items?search=red" });
    expect(search.json().items).toEqual([expect.objectContaining({ name: "Red Potion" })]);
  });

  it("rejects invalid payloads with 400 and duplicates with 409", async () => {
    const bad = await app.inject({ method: "POST", url: "/items", payload: { id: -1 } });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/items", payload: sampleItem(7) });
    const dup = await app.inject({ method: "POST", url: "/items", payload: sampleItem(7) });
    expect(dup.statusCode).toBe(409);
  });

  it("updates and deletes", async () => {
    await app.inject({ method: "POST", url: "/items", payload: sampleItem(9) });
    const upd = await app.inject({
      method: "PUT",
      url: "/items/9",
      payload: { ...sampleItem(9), name: "Renamed" },
    });
    expect(upd.json().name).toBe("Renamed");

    const del = await app.inject({ method: "DELETE", url: "/items/9" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/items/9" });
    expect(gone.statusCode).toBe(404);
  });
});

describe("items API auth", () => {
  const audited: string[] = [];
  const stubSecurity: SecurityContext = {
    async verify(token) {
      if (token === "admin-token") return { accountId: 1, username: "gm", groupLevel: 99 };
      if (token === "player-token") return { accountId: 2, username: "player", groupLevel: 0 };
      return null;
    },
    async audit(entry) {
      audited.push(`${entry.action}:${entry.targetType}:${entry.targetId}`);
    },
  };

  let app: FastifyInstance;

  beforeEach(async () => {
    audited.length = 0;
    app = await buildServer({ itemRepository: tempRepo(), security: stubSecurity });
  });

  it("blocks mutations without valid admin token; GET stays open", async () => {
    const noToken = await app.inject({ method: "POST", url: "/items", payload: sampleItem(1) });
    expect(noToken.statusCode).toBe(401);

    const badToken = await app.inject({
      method: "POST", url: "/items", payload: sampleItem(1),
      headers: { authorization: "Bearer nope" },
    });
    expect(badToken.statusCode).toBe(401);

    const lowLevel = await app.inject({
      method: "POST", url: "/items", payload: sampleItem(1),
      headers: { authorization: "Bearer player-token" },
    });
    expect(lowLevel.statusCode).toBe(403);

    const list = await app.inject({ method: "GET", url: "/items" });
    expect(list.statusCode).toBe(200);
  });

  it("allows admin mutations and records audit entries", async () => {
    const created = await app.inject({
      method: "POST", url: "/items", payload: sampleItem(5),
      headers: { authorization: "Bearer admin-token" },
    });
    expect(created.statusCode).toBe(201);

    const del = await app.inject({
      method: "DELETE", url: "/items/5",
      headers: { authorization: "Bearer admin-token" },
    });
    expect(del.statusCode).toBe(200);

    expect(audited).toEqual(["create:item:5", "delete:item:5"]);
  });
});
