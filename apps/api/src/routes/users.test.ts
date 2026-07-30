import { describe, expect, it, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { MemoryUserRepository } from "../store/memory-user-repository";
import type { SecurityContext } from "../auth/security";

const ADMIN = "Bearer admin-token";

function seededRepo(): MemoryUserRepository {
  const repo = new MemoryUserRepository();
  repo.seedAccount(
    { id: 1, username: "gm", email: "gm@x.com", groupLevel: 99, createdAt: "2026-01-01T00:00:00Z", lastLoginAt: null, characterIds: [] },
    [{ at: "2026-07-01T10:00:00Z", ip: "10.0.0.1" }],
  );
  repo.seedAccount(
    { id: 2, username: "player", email: "p@x.com", groupLevel: 0, createdAt: "2026-02-01T00:00:00Z", lastLoginAt: "2026-07-10T09:00:00Z", characterIds: [100, 101] },
  );
  repo.seedAudit({ actorAccountId: 1, action: "update", targetType: "item", targetId: "501", at: "2026-07-05T00:00:00Z" });
  return repo;
}

const audited: { action: string; reason?: string }[] = [];
const stubSecurity: SecurityContext = {
  async verify(token) {
    if (token === "admin-token") return { accountId: 1, username: "gm", groupLevel: 99 };
    if (token === "player-token") return { accountId: 2, username: "player", groupLevel: 0 };
    return null;
  },
  async audit(entry) {
    audited.push({ action: `${entry.action}:${entry.targetType}:${entry.targetId}`, reason: entry.reason });
  },
};

describe("users API (admin-only, soul §5.8)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    audited.length = 0;
    app = await buildServer({ userRepository: seededRepo(), security: stubSecurity });
  });

  it("bloqueia tudo sem admin — não há GET público", async () => {
    expect((await app.inject({ method: "GET", url: "/users" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/users", headers: { authorization: "Bearer player-token" } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/users/1", headers: { authorization: "Bearer nope" } })).statusCode,
    ).toBe(401);
  });

  it("lista, busca e detalha conta com histórico", async () => {
    const list = await app.inject({ method: "GET", url: "/users", headers: { authorization: ADMIN } });
    expect(list.json().total).toBe(2);

    const search = await app.inject({ method: "GET", url: "/users?search=player", headers: { authorization: ADMIN } });
    expect(search.json().accounts).toEqual([expect.objectContaining({ id: 2 })]);

    const detail = await app.inject({ method: "GET", url: "/users/1", headers: { authorization: ADMIN } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().loginHistory).toHaveLength(1);
    expect(detail.json().ban).toBeNull();

    const missing = await app.inject({ method: "GET", url: "/users/999", headers: { authorization: ADMIN } });
    expect(missing.statusCode).toBe(404);
  });

  it("ban → conta fica com ban ativo + auditoria com motivo; unban limpa", async () => {
    const ban = await app.inject({
      method: "POST",
      url: "/users/2/ban",
      headers: { authorization: ADMIN },
      payload: { reason: "uso de bot", expiresAt: null },
    });
    expect(ban.statusCode).toBe(200);
    expect(ban.json().ban).toMatchObject({ reason: "uso de bot", expiresAt: null, bannedByAccountId: 1 });
    expect(audited).toContainEqual({ action: "ban:account:2", reason: "uso de bot" });

    const after = await app.inject({ method: "GET", url: "/users?bannedOnly=true", headers: { authorization: ADMIN } });
    expect(after.json().accounts.map((a: { id: number }) => a.id)).toEqual([2]);

    const unban = await app.inject({ method: "POST", url: "/users/2/unban", headers: { authorization: ADMIN } });
    expect(unban.json().ban).toBeNull();
    expect(audited).toContainEqual({ action: "unban:account:2", reason: undefined });

    // ban anterior aparece no histórico
    const detail = await app.inject({ method: "GET", url: "/users/2", headers: { authorization: ADMIN } });
    expect(detail.json().banHistory.length).toBeGreaterThanOrEqual(1);
  });

  it("ban exige motivo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users/2/ban",
      headers: { authorization: ADMIN },
      payload: { reason: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lê o admin_audit_log com filtro por targetType", async () => {
    const all = await app.inject({ method: "GET", url: "/users/audit", headers: { authorization: ADMIN } });
    expect(all.json().total).toBe(1);
    const filtered = await app.inject({ method: "GET", url: "/users/audit?targetType=monster", headers: { authorization: ADMIN } });
    expect(filtered.json().total).toBe(0);
  });
});
