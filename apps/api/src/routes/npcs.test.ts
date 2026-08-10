import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { buildServer } from "../server";
import { JsonNpcRepository } from "../store/json-npc-repository";
import type { MapRepository } from "../store/map-repository";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Npc } from "@ragnarok/game-data";
import type { GameMap } from "@ragnarok/map-format";

/** stub mínimo — só o suficiente pra validação de mapa/coordenada do POST
 * (Fase 3.4) aceitar os mapas usados nas fixtures deste arquivo. Cobertura
 * de rejeição de mapa/coordenada de verdade fica em npc-script-create.test.ts. */
function stubMapRepository(knownMapIds: string[]): MapRepository {
  const maps = new Map(knownMapIds.map((id) => [id, { id, size: { width: 200, height: 200 } } as GameMap]));
  return {
    list: async () => ({ maps: [], total: 0, page: 1, pageSize: 20 }),
    get: async (id: string) => maps.get(id),
    create: async (m: GameMap) => m,
    update: async (_id: string, m: GameMap) => m,
    remove: async () => true,
  };
}

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
    eventHandlers: [],
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
    eventHandlers: [],
    questTriggers: [],
    questBoard: [],
  };
}

describe("npcs API", () => {
  let app: FastifyInstance;
  let npcRepository: JsonNpcRepository;

  beforeEach(async () => {
    npcRepository = new JsonNpcRepository(join(tmpdir(), `npcs-test-${Date.now()}-${Math.random()}.json`));
    // isolado da árvore real do repo — mesma convenção de `npc-idle/
    // admin-created.txt`, mas descartável, pra não escrever no projeto de
    // verdade rodando os testes (Fase 3.4, apps/api/src/store/npc-script-
    // create.ts espera o arquivo já existir).
    const createRoot = mkdtempSync(join(tmpdir(), "npc-create-test-"));
    writeFileSync(join(createRoot, "admin-created.txt"), "// teste\n", "utf8");
    app = await buildServer({
      npcRepository,
      security: null,
      npcCreateRoot: createRoot,
      mapRepository: stubMapRepository(["airplane", "prontera", "geffen"]),
    });
  });

  it("creates, filters by kind and mapId, searches", async () => {
    // NPCs tipo warp/duplicate/shop não têm geração de script suportada
    // (Fase 3.4 — só diálogo simples é criável via POST); semeados direto
    // no repositório pra testar listagem/filtro sem depender disso.
    await npcRepository.create(warpNpc("warp_a"));
    await npcRepository.create(warpNpc("warp_b", "geffen"));

    const res = await app.inject({ method: "POST", url: "/npcs", payload: dialogueNpc("crew1", "Airship Crew") });
    expect(res.statusCode).toBe(201);

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
    // legacyRef computado pelo writer (Fase 3.4) — nunca vem do cliente.
    expect(one.json().legacyRef).toMatch(/^admin-created\.txt:\d+$/);
  });

  it("validates payloads, rejects duplicates, updates and deletes", async () => {
    const bad = await app.inject({ method: "POST", url: "/npcs", payload: { id: "x" } });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/npcs", payload: dialogueNpc("w1", "W1") });
    const dup = await app.inject({ method: "POST", url: "/npcs", payload: dialogueNpc("w1", "W1 outra vez") });
    expect(dup.statusCode).toBe(409);

    const upd = await app.inject({
      method: "PUT",
      url: "/npcs/w1",
      payload: { ...dialogueNpc("w1", "W1"), name: "Portal" },
    });
    expect(upd.json().name).toBe("Portal");

    const del = await app.inject({ method: "DELETE", url: "/npcs/w1" });
    expect(del.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: "/npcs/w1" });
    expect(gone.statusCode).toBe(404);
  });

  it("rejects NPC types the create-writer doesn't support (warp/shop/duplicate/eventHandlers)", async () => {
    const res = await app.inject({ method: "POST", url: "/npcs", payload: warpNpc("warp_c") });
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toMatch(/warp/i);

    // nada deve ter sido persistido no catálogo quando o writer recusa.
    const gone = await app.inject({ method: "GET", url: "/npcs/warp_c" });
    expect(gone.statusCode).toBe(404);
  });
});
