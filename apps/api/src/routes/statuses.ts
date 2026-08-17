import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { StatusCategorySchema, StatusEffectDefSchema, StatusGroupSchema } from "@ragnarok/game-data";
import type { StatusRepository } from "../store/status-repository";
import type { EfstTable } from "../store/efst-table";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { logCreate, logUpdate, logDelete } from "../audit/log.js";

// pageSize maior que o padrão: o form de skills carrega o catálogo inteiro
// pro dropdown (soul.txt §5.3 — nunca texto livre)
const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(2000).default(20),
  search: z.string().trim().min(1).optional(),
  category: StatusCategorySchema.optional(),
  group: StatusGroupSchema.optional(),
});

const IdParamSchema = z.object({ id: z.string().trim().min(1).max(64) });

/**
 * `/statuses/by-efst?ids=0,5,12` — o cliente recebe do gateway o id NUMÉRICO
 * de status-icon (ZC_MSG_STATE_CHANGE4/5, "auditoria buffs/debuffs"
 * 2026-08-14): o rAthena já traduz SC_* pra EFST_* antes de mandar o pacote,
 * então o fio nunca carrega o `id` (nome SC) que o catálogo usa como chave.
 * `efstTable` (gerado por `migrate:efst` a partir de `status.hpp`) faz
 * id→`EFST_NOME`; o `icon` do catálogo (`statuses.json`) já guarda esse
 * mesmo nome — o join fecha o ciclo sem o cliente adivinhar nada.
 */
const EfstIdsQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 200)),
});

export function statusRoutes(
  repo: StatusRepository,
  security: SecurityContext | null = null,
  efstTable: EfstTable | null = null,
) {
  return async function registerStatusRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    app.get("/by-efst", async (req, reply) => {
      const q = EfstIdsQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      if (!efstTable || q.data.ids.length === 0) return { statuses: [] };

      const wanted = new Map<string, number>(); // EFST_NOME -> efstId
      for (const efstId of q.data.ids) {
        const name = efstTable.get(efstId);
        if (name) wanted.set(name, efstId);
      }
      if (wanted.size === 0) return { statuses: [] };

      // catálogo inteiro cabe numa página (1.019 entradas, teto de 2000) —
      // não existe `get by icon` no repositório, e duplicar esse índice numa
      // cache à parte só pra este endpoint divergiria da regra de nunca
      // guardar estado repetido (fonte única = o próprio repositório).
      const { statuses: all } = await repo.list({ page: 1, pageSize: 2000 });
      const found = all
        .filter((s) => s.icon && wanted.has(s.icon))
        .map((s) => ({ ...s, efstId: wanted.get(s.icon!)! }));
      return { statuses: found };
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
        await logCreate(
          { security, admin, targetType: "status", targetId: created.id, source: "admin/statuses" },
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
      const body = StatusEffectDefSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const before = await repo.get(p.data.id);
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        await logUpdate(
          { security, admin, targetType: "status", targetId: p.data.id, source: "admin/statuses" },
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
        { security, admin, targetType: "status", targetId: p.data.id, source: "admin/statuses" },
        before?.name ?? p.data.id,
        before,
      );
      return { ok: true };
    });
  };
}
