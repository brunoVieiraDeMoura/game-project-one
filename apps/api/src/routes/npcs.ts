import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NpcSchema } from "@ragnarok/game-data";
import type { NpcRepository } from "../store/npc-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
  kind: z.enum(["warp", "shop", "dialogue", "duplicate", "other"]).optional(),
  mapId: z.string().trim().min(1).optional(),
});

const IdParamSchema = z.object({ id: z.string().trim().min(1).max(128) });

export function npcRoutes(repo: NpcRepository, security: SecurityContext | null = null) {
  return async function registerNpcRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    app.get("/:id", async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const npc = await repo.get(p.data.id);
      if (!npc) return reply.code(404).send({ error: "not found" });
      return npc;
    });

    app.post("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = NpcSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const created = await repo.create(body.data);
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "create",
            targetType: "npc",
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
      const body = NpcSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "update",
            targetType: "npc",
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
          targetType: "npc",
          targetId: p.data.id,
        });
      }
      return { ok: true };
    });
  };
}
