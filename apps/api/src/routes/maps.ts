import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GameMapSchema } from "@ragnarok/map-format";
import type { MapRepository } from "../store/map-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";

/**
 * Editor de mapas (soul.txt §5.9). GET público (o game client carrega mapas);
 * mutações exigem admin + auditam. list() devolve resumos; get(id) o mapa
 * inteiro.
 */

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
});

const IdParamSchema = z.object({ id: z.string().trim().min(1).max(64) });

export function mapRoutes(repo: MapRepository, security: SecurityContext | null = null) {
  return async function registerMapRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    app.get("/:id", async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const map = await repo.get(p.data.id);
      if (!map) return reply.code(404).send({ error: "not found" });
      return map;
    });

    app.post("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = GameMapSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const created = await repo.create(body.data);
        if (admin && security) {
          await security.audit({ actor: admin, action: "create", targetType: "map", targetId: created.id });
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
      const body = GameMapSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        if (admin && security) {
          // payload omitido: mapa pode ter centenas de milhares de células
          await security.audit({ actor: admin, action: "update", targetType: "map", targetId: p.data.id });
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
        await security.audit({ actor: admin, action: "delete", targetType: "map", targetId: p.data.id });
      }
      return { ok: true };
    });
  };
}
