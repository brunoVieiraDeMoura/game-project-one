import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { JsonNpcRepository } from "../store/json-npc-repository";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Npc } from "@ragnarok/game-data";

function warpNpc(id: string, mapId = "prontera"): Npc {
  return {
    id,
    name: id,
    sprite: "WARP",
    mapId,
    position: [54, 139, 0],
    direction: 0,
    dialogueEntry: null,
    dialogue: [],
    questTriggers: [],
    questBoard: [],
    warp: { mapId: "geffen", position: [120, 100, 0], triggerSpan: { xs: 1, ys: 1 } },
  };
}

function dialogueNpc(id: string, name: string): Npc {
  return {
    id,
    name,
    sprite: "852",
    mapId: "airplane",
    position: [100, 69, 0],
    direction: 3,
    dialogueEntry: "n0",
    dialogue: [
      { id: "n0", kind: "say", text: "Olá!", next: "n1" },
      { id: "n1", kind: "end" },
    ],
    questTriggers: [],
    questBoard: [],
  };
}

describe("npcs API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({
      npcRepository: new JsonNpcRepository(join(tmpdir(), `npcs-test-${Date.now()}-${Math.random()}.json`)),
      security: null,
    });
  });

  it("creates, filters by kind and mapId, searches", async () => {
    for (const npc of [warpNpc("warp_a"), warpNpc("warp_b", "geffen"), dialogueNpc("crew1", "Airship Crew")]) {
      const res = await app.inject({ method: "POST", url: "/npcs", payload: npc });
      expect(res.statusCode).toBe(201);
    }

    const all = await app.inject({ method: "GET", url: "/npcs" });
    expect(all.json().total).toBe(3);

    const warps = await app.inject({ method: "GET", url: "/npcs?kind=warp" });
    expect(warps.json().total).toBe(2);

    const byMap = await app.inject({ method: "GET", url: "/npcs?mapId=geffen" });
    expect(byMap.json().npcs).toEqual([expect.objectContaining({ id: "warp_b" })]);

    const search = await app.inject({ method: "GET", url: "/npcs?search=airship" });
    expect(search.json().npcs).toEqual([expect.objectContaining({ id: "crew1" })]);

    const one = await app.inject({ method: "GET", url: "/npcs/crew1" });
    expect(one.json().dialogue).toHaveLength(2);
  });

  it("validates payloads, rejects duplicates, updates and deletes", async () => {
    const bad = await app.inject({ method: "POST", url: "/npcs", payload: { id: "x" } });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/npcs", payload: warpNpc("w1") });
    const dup = await app.inject({ method: "POST", url: "/npcs", payload: warpNpc("w1") });
    expect(dup.statusCode).toBe(409);

    const upd = await app.inject({
      method: "PUT",
      url: "/npcs/w1",
      payload: { ...warpNpc("w1"), name: "Portal" },
    });
    expect(upd.json().name).toBe("Portal");

    const del = await app.inject({ method: "DELETE", url: "/npcs/w1" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/npcs/w1" });
    expect(gone.statusCode).toBe(404);
  });
});
