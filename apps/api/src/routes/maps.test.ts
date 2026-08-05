import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { JsonMapRepository } from "../store/json-map-repository";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GameMap } from "@ragnarok/map-format";

function sampleMap(id: string, w = 3, h = 2): GameMap {
  const n = w * h;
  return {
    id,
    name: id,
    size: { width: w, height: h },
    cellSize: 5,
    terrainMode: "smooth",
    heightmap: new Array(n).fill(0),
    collision: ["walkable", "wall", "walkable", "water", "walkable", "cliff"].slice(0, n) as GameMap["collision"],
    surface: [],
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [
      { id: "w1", kind: "warp", position: [1, 0, 1], target: { mapId: "other", position: [5, 0, 5] } },
    ],
    triggers: [],
    ramps: [],
  authoredHexScale: 1,
    lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
    metadata: { sourceLegacyMap: id, version: 1, generatedAt: "2026-07-19T00:00:00.000Z" },
  };
}

describe("maps API (Editor de mapas)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({
      mapRepository: new JsonMapRepository(join(tmpdir(), `maps-test-${Date.now()}-${Math.random()}`)),
      security: null,
    });
  });

  it("list devolve resumos (sem heightmap/collision); get devolve o mapa inteiro", async () => {
    await app.inject({ method: "POST", url: "/maps", payload: sampleMap("prontera") });
    await app.inject({ method: "POST", url: "/maps", payload: sampleMap("geffen") });

    const list = await app.inject({ method: "GET", url: "/maps" });
    const body = list.json();
    expect(body.total).toBe(2);
    expect(body.maps[0]).toMatchObject({ id: "geffen", width: 3, height: 2, spawnCount: 1 });
    expect(body.maps[0].collision).toBeUndefined();
    expect(body.maps[0].heightmap).toBeUndefined();

    const full = await app.inject({ method: "GET", url: "/maps/prontera" });
    expect(full.json().collision).toHaveLength(6);
    expect(full.json().spawns).toHaveLength(1);
  });

  it("busca por id/nome", async () => {
    await app.inject({ method: "POST", url: "/maps", payload: sampleMap("prt_fild00") });
    await app.inject({ method: "POST", url: "/maps", payload: sampleMap("gef_fild00") });
    const res = await app.inject({ method: "GET", url: "/maps?search=prt" });
    expect(res.json().maps).toEqual([expect.objectContaining({ id: "prt_fild00" })]);
  });

  it("valida length de collision/heightmap contra width*height", async () => {
    const bad = { ...sampleMap("x"), collision: ["walkable"] as GameMap["collision"] };
    const res = await app.inject({ method: "POST", url: "/maps", payload: bad });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita duplicado, atualiza e deleta", async () => {
    await app.inject({ method: "POST", url: "/maps", payload: sampleMap("prontera") });
    const dup = await app.inject({ method: "POST", url: "/maps", payload: sampleMap("prontera") });
    expect(dup.statusCode).toBe(409);

    const upd = await app.inject({
      method: "PUT",
      url: "/maps/prontera",
      payload: { ...sampleMap("prontera"), name: "Prontera City" },
    });
    expect(upd.json().name).toBe("Prontera City");

    const del = await app.inject({ method: "DELETE", url: "/maps/prontera" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/maps/prontera" });
    expect(gone.statusCode).toBe(404);
  });
});
