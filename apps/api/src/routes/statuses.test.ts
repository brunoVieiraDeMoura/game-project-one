import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../server";
import { JsonStatusRepository } from "../store/json-status-repository";
import type { EfstTable } from "../store/efst-table";

function tempRepo() {
  return new JsonStatusRepository(join(tmpdir(), `statuses-test-${Date.now()}-${Math.random()}.json`));
}

function sampleStatus(id: string, name: string, icon?: string, category: "buff" | "debuff" | "neutral" = "neutral") {
  return { id, name, category, icon, description: `desc de ${name}` };
}

/** só as entradas relevantes pro teste — o resto do id space real (1471
 * entradas) não importa aqui, `by-efst` faz um lookup pontual. */
function tempEfstTable(): EfstTable {
  return new Map([
    [0, "EFST_PROVOKE"],
    [1, "EFST_ENDURE"],
    [5, "EFST_POISON"],
  ]);
}

describe("/statuses/by-efst", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const repo = tempRepo();
    await repo.create(sampleStatus("provoke", "Provoke", "EFST_PROVOKE", "debuff"));
    await repo.create(sampleStatus("endure", "Endure", "EFST_ENDURE", "neutral"));
    await repo.create(sampleStatus("noicon", "Sem Ícone"));
    app = await buildServer({ statusRepository: repo, efstTable: tempEfstTable(), security: null });
  });

  it("resolves numeric EFST ids to their catalog entry, tagged with efstId", async () => {
    const res = await app.inject({ method: "GET", url: "/statuses/by-efst?ids=0,1" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { statuses: Array<{ id: string; efstId: number; icon?: string }> };
    expect(body.statuses).toHaveLength(2);
    const byId = Object.fromEntries(body.statuses.map((s) => [s.id, s]));
    expect(byId.provoke?.efstId).toBe(0);
    expect(byId.endure?.efstId).toBe(1);
  });

  it("omits ids with no entry in the efst table (unknown numeric id)", async () => {
    const res = await app.inject({ method: "GET", url: "/statuses/by-efst?ids=999999" });
    expect(res.json()).toEqual({ statuses: [] });
  });

  it("omits ids whose EFST name has no matching catalog entry (id 5 -> EFST_POISON, not seeded)", async () => {
    const res = await app.inject({ method: "GET", url: "/statuses/by-efst?ids=5" });
    expect(res.json()).toEqual({ statuses: [] });
  });

  it("rejects a missing ids query", async () => {
    const res = await app.inject({ method: "GET", url: "/statuses/by-efst" });
    expect(res.statusCode).toBe(400);
  });

  it("still resolves /statuses/:id normally (by-efst doesn't shadow the :id route)", async () => {
    const res = await app.inject({ method: "GET", url: "/statuses/provoke" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "provoke" });
  });
});
