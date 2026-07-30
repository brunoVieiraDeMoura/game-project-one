import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { JsonServerConfigRepository } from "../store/json-server-config-repository";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("server-config API (singleton, Gerenciador Global)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({
      serverConfigRepository: new JsonServerConfigRepository(
        join(tmpdir(), `serverconfig-test-${Date.now()}-${Math.random()}.json`),
      ),
      security: null,
    });
  });

  it("GET devolve o default (taxas 1×)", async () => {
    const res = await app.inject({ method: "GET", url: "/server-config" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.expRateBase).toBe(1);
    expect(body.dropRate).toBe(1);
  });

  it("PUT altera taxas, bump de version no servidor, persiste", async () => {
    const current = (await app.inject({ method: "GET", url: "/server-config" })).json();
    const put = await app.inject({
      method: "PUT",
      url: "/server-config",
      payload: {
        ...current,
        expRateBase: 5,
        dropRate: 3,
        dropRateOverrides: [{ scope: { kind: "itemType", itemType: "card" }, multiplier: 2 }],
        version: 999,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().version).toBe(2);
    expect(put.json().expRateBase).toBe(5);

    const after = (await app.inject({ method: "GET", url: "/server-config" })).json();
    expect(after.dropRate).toBe(3);
    expect(after.dropRateOverrides).toHaveLength(1);
  });

  it("PUT rejeita multiplicador não-positivo", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/server-config",
      payload: { expRateBase: 0, expRateJob: 1, dropRate: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
