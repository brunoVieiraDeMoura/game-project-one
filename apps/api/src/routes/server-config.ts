import type { FastifyInstance } from "fastify";
import { ServerConfigSchema } from "@ragnarok/game-data";
import type { ServerConfigRepository } from "../store/server-config-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";

/**
 * Gerenciador Global (soul.txt §5.7). Singleton: GET (público, servido do
 * cache curto pra hot-reload) e PUT (admin) que substitui inteiro, bump de
 * version + updatedAt no servidor, audita.
 */
export function serverConfigRoutes(repo: ServerConfigRepository, security: SecurityContext | null = null) {
  return async function registerServerConfigRoutes(app: FastifyInstance) {
    app.get("/", async () => repo.get());

    app.put("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = ServerConfigSchema.omit({ version: true, updatedAt: true }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      const current = await repo.get();
      const next = { ...body.data, version: current.version + 1, updatedAt: new Date().toISOString() };
      const saved = await repo.save(next);
      if (admin && security) {
        await security.audit({
          actor: admin,
          action: "update",
          targetType: "server_config",
          targetId: String(saved.version),
          payload: saved,
        });
      }
      return saved;
    });
  };
}
