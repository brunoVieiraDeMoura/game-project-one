import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../server";
import { JsonMonsterRepository } from "../store/json-monster-repository";

/**
 * Testes de integração real do write-path de spawn (Fase 4, POST/PUT/DELETE
 * `/monsters` ↔ `MonsterSpawnWriter` ↔ arquivo `.txt` real de teste). Usa
 * `mkdtempSync` — nunca `npc-idle/mobs`.
 */

function sampleMonster(id: number, spawns: unknown[] = []) {
  return {
    id,
    aegisName: `MOB_${id}`,
    name: `Mob ${id}`,
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
    drops: [],
    spawns,
  };
}

describe("POST/PUT /monsters — write-path real de spawn", () => {
  let app: FastifyInstance;
  let dir: string;
  let mapConfPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "monsters-spawn-route-test-"));
    mapConfPath = join(dir, "map_conf.txt");
    writeFileSync(mapConfPath, "npc: npc/game-project/mobs/prt_fild00.txt\n", "utf8");

    app = await buildServer({
      monsterRepository: new JsonMonsterRepository(join(tmpdir(), `monsters-spawn-route-${Date.now()}-${Math.random()}.json`)),
      security: null,
      monsterSpawnRoot: dir,
      mapConfPath,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("POST cria monstro com spawn → arquivo real recebe a linha, spawnId volta no corpo salvo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(2001, [{ mapId: "prt_fild00", amount: 5, respawnTimeMs: 3000 }]),
    });
    expect(res.statusCode).toBe(201);
    const saved = res.json();
    expect(saved.spawns[0].spawnId).toBeTruthy();

    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toContain("prt_fild00,0,0\tmonster\tMob 2001\t2001,5,3000");
  });

  it("GET depois do POST devolve o mesmo spawnId — identidade persistiu no catálogo", async () => {
    const created = await app.inject({ method: "POST", url: "/monsters", payload: sampleMonster(2002, [{ mapId: "prt_fild00", amount: 1, respawnTimeMs: 1000 }]) });
    const spawnId = created.json().spawns[0].spawnId;

    const got = await app.inject({ method: "GET", url: "/monsters/2002" });
    expect(got.json().spawns[0].spawnId).toBe(spawnId);
  });

  it("PUT editando quantidade do spawn → arquivo atualizado, spawn vizinho intacto", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(2003, [
        { mapId: "prt_fild00", amount: 1, respawnTimeMs: 1000 },
        { mapId: "prt_fild00", amount: 2, respawnTimeMs: 2000 },
      ]),
    });
    const [spawnA, spawnB] = created.json().spawns;

    const put = await app.inject({
      method: "PUT",
      url: "/monsters/2003",
      payload: sampleMonster(2003, [spawnA, { ...spawnB, amount: 999 }]),
    });
    expect(put.statusCode).toBe(200);

    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).toContain(`spawnId:${spawnA.spawnId}\nprt_fild00,0,0\tmonster\tMob 2003\t2003,1,1000`);
    expect(text).toContain(`spawnId:${spawnB.spawnId}\nprt_fild00,0,0\tmonster\tMob 2003\t2003,999,2000`);
  });

  it("PUT removendo um spawn (array menor) → linha some do arquivo, o outro permanece", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(2004, [
        { mapId: "prt_fild00", amount: 1, respawnTimeMs: 1000 },
        { mapId: "prt_fild00", amount: 2, respawnTimeMs: 2000 },
      ]),
    });
    const [spawnA, spawnB] = created.json().spawns;

    const put = await app.inject({ method: "PUT", url: "/monsters/2004", payload: sampleMonster(2004, [spawnA]) });
    expect(put.statusCode).toBe(200);
    expect(put.json().spawns).toHaveLength(1);

    const text = readFileSync(join(dir, "prt_fild00.txt"), "utf8");
    expect(text).not.toContain(`spawnId:${spawnB.spawnId}`);
    expect(text).toContain(`spawnId:${spawnA.spawnId}`);
  });

  it("mapa não registrado → 422 map-not-registered, banco NÃO grava o monstro (PUT/POST atômico)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(2005, [{ mapId: "mapa_inexistente", amount: 1, respawnTimeMs: 1000 }]),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("map-not-registered");

    const get = await app.inject({ method: "GET", url: "/monsters/2005" });
    expect(get.statusCode).toBe(404); // nada foi persistido
  });

  it("quantidade inválida (<=0) → 400 do zod, nada gravado", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(2006, [{ mapId: "prt_fild00", amount: 0, respawnTimeMs: 1000 }]),
    });
    expect(res.statusCode).toBe(400);
    expect(await app.inject({ method: "GET", url: "/monsters/2006" }).then((r) => r.statusCode)).toBe(404);
  });

  it("respawn inválido (negativo) → 400 do zod", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(2007, [{ mapId: "prt_fild00", amount: 1, respawnTimeMs: -1 }]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("área inválida (x negativo) → 400 do zod", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(2008, [{ mapId: "prt_fild00", amount: 1, respawnTimeMs: 1000, area: { x: -5, y: 10, xs: 5, ys: 5 } }]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT em monstro inexistente → 404, nenhum arquivo tocado", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/monsters/999999",
      payload: sampleMonster(999999, [{ mapId: "prt_fild00", amount: 1, respawnTimeMs: 1000 }]),
    });
    expect(res.statusCode).toBe(404);
  });

  it("/monsters/capabilities reporta spawnsWritable=true com writer configurado", async () => {
    const res = await app.inject({ method: "GET", url: "/monsters/capabilities" });
    expect(res.json()).toEqual({ spawnsWritable: true });
  });
});

describe("POST /monsters — spawnsWritable=false (sem monsterSpawnRoot configurado)", () => {
  it("spawns passam direto pro catálogo sem tentar escrever arquivo nenhum (comportamento preservado)", async () => {
    const app = await buildServer({
      monsterRepository: new JsonMonsterRepository(join(tmpdir(), `monsters-spawn-disabled-${Date.now()}-${Math.random()}.json`)),
      security: null,
      monsterSpawnRoot: null,
    });
    const res = await app.inject({
      method: "POST",
      url: "/monsters",
      payload: sampleMonster(3001, [{ mapId: "mapa_qualquer_nao_registrado", amount: 1, respawnTimeMs: 1000 }]),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().spawns[0].spawnId).toBeUndefined();

    const caps = await app.inject({ method: "GET", url: "/monsters/capabilities" });
    expect(caps.json()).toEqual({ spawnsWritable: false });
  });
});
