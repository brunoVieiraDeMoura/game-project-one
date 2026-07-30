import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StatusEffectDefSchema } from "@ragnarok/game-data";
import type { StatusRepository } from "../store/status-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";

// pageSize maior que o padrão: o form de skills carrega o catálogo inteiro
// pro dropdown (soul.txt §5.3 — nunca texto livre)
const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(2000).default(20),
  search: z.string().trim().min(1).optional(),
});

const IdParamSchema = z.object({ id: z.string().trim().min(1).max(64) });

export function statusRoutes(repo: StatusRepository, security: SecurityContext | null = null) {
  return async function registerStatusRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    app.get("/:id", async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const status = await repo.get(p.data.id);
      if (!status) return reply.code(404).send({ error: "not found" });
      return status;
    });

    app.post("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = StatusEffectDefSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const created = await repo.create(body.data);
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "create",
            targetType: "status",
            targetId: created.id,
            payload: created,
          });
        }
        return reply.code(201).send(created);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        return reply.code(status).send({ error: (err as Error).message });
      }
    });

    app.put("/:id", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const body = StatusEffectDefSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "update",
            targetType: "status",
            targetId: p.data.id,
            payload: updated,
          });
        }
        return updated;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode ?? 500;
        return reply.code(status).send({ error: (err as Error).message });
      }
    });

    app.delete("/:id", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const removed = await repo.remove(p.data.id);
      if (!removed) return reply.code(404).send({ error: "not found" });
      if (admin && security) {
        await security.audit({
          actor: admin,
          action: "delete",
          targetType: "status",
          targetId: p.data.id,
        });
      }
      return { ok: true };
    });
  };
}
