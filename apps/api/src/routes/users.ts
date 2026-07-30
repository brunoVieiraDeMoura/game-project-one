import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { UserRepository } from "../store/user-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";

/**
 * Módulo Usuários (soul.txt §5.8). TODAS as rotas são admin-only — dados de
 * conta são sensíveis, não há GET público (diferente dos módulos de
 * conteúdo). Quando security é null (dev/testes) o guard libera.
 */

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
  bannedOnly: z.coerce.boolean().optional(),
});

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const BanBodySchema = z.object({
  reason: z.string().trim().min(1),
  /** ISO; null/ausente = permanente */
  expiresAt: z.string().datetime().nullable().default(null),
});

const AuditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  targetType: z.string().trim().min(1).optional(),
  actorAccountId: z.coerce.number().int().positive().optional(),
});

export function userRoutes(repo: UserRepository, security: SecurityContext | null = null) {
  return async function registerUserRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.listAccounts(q.data);
    });

    // auditoria — precisa vir antes de /:id pra não colidir com o param
    app.get("/audit", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const q = AuditQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.listAudit(q.data);
    });

    app.get("/:id", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const account = await repo.getAccount(p.data.id);
      if (!account) return reply.code(404).send({ error: "not found" });
      return account;
    });

    app.post("/:id/ban", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const body = BanBodySchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      const banned = await repo.ban(p.data.id, {
        reason: body.data.reason,
        expiresAt: body.data.expiresAt,
        byAccountId: admin?.accountId ?? 0,
      });
      if (!banned) return reply.code(404).send({ error: "not found" });
      if (admin && security) {
        await security.audit({
          actor: admin,
          action: "ban",
          targetType: "account",
          targetId: String(p.data.id),
          reason: body.data.reason,
          payload: { expiresAt: body.data.expiresAt },
        });
      }
      return banned;
    });

    app.post("/:id/unban", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const account = await repo.unban(p.data.id);
      if (!account) return reply.code(404).send({ error: "not found" });
      if (admin && security) {
        await security.audit({
          actor: admin,
          action: "unban",
          targetType: "account",
          targetId: String(p.data.id),
        });
      }
      return account;
    });
  };
}
