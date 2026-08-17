import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JobClassSchema } from "@ragnarok/game-data";
import type { JobClassRepository } from "../store/job-class-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { logCreate, logUpdate, logDelete } from "../audit/log.js";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
});

const IdParamSchema = z.object({ id: z.coerce.number().int().nonnegative() });

export function jobClassRoutes(repo: JobClassRepository, security: SecurityContext | null = null) {
  return async function registerJobClassRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    app.get("/:id", async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const jobClass = await repo.get(p.data.id);
      if (!jobClass) return reply.code(404).send({ error: "not found" });
      return jobClass;
    });

    app.post("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = JobClassSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const created = await repo.create(body.data);
        await logCreate(
          { security, admin, targetType: "job_class", targetId: String(created.id), source: "admin/classes" },
          created.name,
          created,
        );
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
      const body = JobClassSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const before = await repo.get(p.data.id);
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        await logUpdate(
          { security, admin, targetType: "job_class", targetId: String(p.data.id), source: "admin/classes" },
          updated.name,
          before as unknown as Record<string, unknown> | undefined,
          updated as unknown as Record<string, unknown>,
        );
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
      const before = await repo.get(p.data.id);
      const removed = await repo.remove(p.data.id);
      if (!removed) return reply.code(404).send({ error: "not found" });
      await logDelete(
        { security, admin, targetType: "job_class", targetId: String(p.data.id), source: "admin/classes" },
        before?.name ?? String(p.data.id),
        before,
      );
      return { ok: true };
    });
  };
}
