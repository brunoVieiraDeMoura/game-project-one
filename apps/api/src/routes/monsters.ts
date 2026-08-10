import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ElementSchema, MonsterSchema } from "@ragnarok/game-data";
import type { MonsterRepository } from "../store/monster-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
  /** consulta reversa "quem dropa X" (id do item) */
  dropsItem: z.coerce.number().int().positive().optional(),
  levelMin: z.coerce.number().int().min(0).max(999).optional(),
  levelMax: z.coerce.number().int().min(0).max(999).optional(),
  element: ElementSchema.optional(),
});

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function monsterRoutes(
  repo: MonsterRepository,
  security: SecurityContext | null = null,
  /** achado A23: `spawns[]` só é persistido pelo repositório JSON/Supabase —
   * `mysql-monster-row.ts`/`mysql-monster-repository.ts` não têm coluna pra
   * isso (spawn real do rAthena é script NPC, não linha de `mob_db_re`). Sob
   * MySQL, editar spawn no admin salva "com sucesso" e descarta em silêncio.
   * `spawnsWritable` deixa o admin avisar/travar a seção em vez de mentir. */
  spawnsWritable = true,
) {
  return async function registerMonsterRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    /** Registrada ANTES de `/:id` de propósito — rota estática não pode
     * competir com o parâmetro, mesmo o Fastify já priorizando estático. */
    app.get("/capabilities", async () => ({ spawnsWritable }));

    app.get("/:id", async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const monster = await repo.get(p.data.id);
      if (!monster) return reply.code(404).send({ error: "not found" });
      return monster;
    });

    app.post("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = MonsterSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const created = await repo.create(body.data);
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "create",
            targetType: "monster",
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
      const body = MonsterSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        if (admin && security) {
          await security.audit({
            actor: admin,
            action: "update",
            targetType: "monster",
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
          targetType: "monster",
          targetId: String(p.data.id),
        });
      }
      return { ok: true };
    });
  };
}
