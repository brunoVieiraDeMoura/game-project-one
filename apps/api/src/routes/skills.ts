import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SkillSchema } from "@ragnarok/game-data";
import type { SkillRepository } from "../store/skill-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
});

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * `/skills/by-id?ids=1,2,3` — o CLIENTE pergunta o nome legível das skills que
 * o personagem tem (o ZC.SKILLINFO_LIST só manda a constante, "SM_BASH") e o
 * `target`, que diz se a skill é usada no chão. São ~40 ids: paginar o catálogo
 * inteiro (1.200) para achá-los é desperdício, e um GET por id é uma rajada.
 */
const IdsQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(",").map(Number).filter(Number.isInteger).slice(0, 200)),
});

export function skillRoutes(repo: SkillRepository, security: SecurityContext | null = null) {
  return async function registerSkillRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    app.get("/by-id", async (req, reply) => {
      const q = IdsQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      const found = await Promise.all(q.data.ids.map((id) => repo.get(id)));
      return { skills: found.filter((s) => s !== null) };
    });

    app.get("/:id", async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const skill = await repo.get(p.data.id);
      if (!skill) return reply.code(404).send({ error: "not found" });
      return skill;
    });

    app.post("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = SkillSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const created = await repo.create(body.data);
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "create",
            targetType: "skill",
            targetId: String(created.id),
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
      const body = SkillSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "update",
            targetType: "skill",
            targetId: String(p.data.id),
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
          targetType: "skill",
          targetId: String(p.data.id),
        });
      }
      return { ok: true };
    });
  };
}
