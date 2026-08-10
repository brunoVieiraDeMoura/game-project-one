import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NpcKindSchema, NpcOriginSchema, NpcSchema } from "@ragnarok/game-data";
import type { NpcRepository } from "../store/npc-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { applyNpcScriptEdit, rollbackAppliedWrite } from "../store/npc-script-sync";
import { queueReload } from "../store/mysql-item-repository.js";

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
  kind: NpcKindSchema.optional(),
  mapId: z.string().trim().min(1).optional(),
  origin: NpcOriginSchema.optional(),
});

const IdParamSchema = z.object({ id: z.string().trim().min(1).max(128) });

export function npcRoutes(repo: NpcRepository, security: SecurityContext | null = null, npcScriptRoot: string | null = null) {
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
        const current = await repo.get(p.data.id);
        if (!current) return reply.code(404).send({ error: "not found" });

        // Ponte pro Writer (leia1.txt, integração Writer↔Admin): só age
        // quando dialogue/eventHandlers mudaram; PUT é atômico — recusa do
        // Writer significa NADA muda, nem banco nem .txt, mesmo que outros
        // campos do mesmo request (nome/posição/warp/shop) fossem válidos.
        let rollbackFile: (() => void) | null = null;
        let scriptFileChanged = false;
        if (npcScriptRoot) {
          const sync = applyNpcScriptEdit(npcScriptRoot, current, body.data);
          if (sync.kind === "refused") {
            return reply.code(sync.httpStatus).send({
              error: sync.error,
              message: sync.message,
              ...(sync.code ? { code: sync.code } : {}),
              ...(sync.entryLabel !== undefined ? { entryLabel: sync.entryLabel } : {}),
            });
          }
          if (sync.kind === "applied") {
            rollbackFile = () => rollbackAppliedWrite(sync.absPath, sync.previousRawText);
            scriptFileChanged = true;
          }
        }

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
          // achado da auditoria independente da Fase 3: diferente de todo
          // outro módulo (item/mob/skill/status), a edição de diálogo de NPC
          // gravava o .txt real e o banco com sucesso mas NUNCA enfileirava
          // `@reloadscript` — o rAthena rodando continuava servindo o texto
          // ANTIGO até um restart manual. Só depois que os dois lados (arquivo
          // + banco) confirmaram, nunca antes (rollback do arquivo em caso de
          // falha do banco não deixaria um reload órfão pra um texto revertido).
          if (scriptFileChanged) {
            await queueReload("script");
          }
          return updated;
        } catch (dbErr) {
          // .txt já foi escrito com sucesso mas o banco falhou — a única
          // janela em que os dois lados podem divergir (Node não tem
          // transação entre arquivo e banco). Melhor esforço: restaura os
          // bytes originais do arquivo antes de propagar o erro.
          if (rollbackFile) {
            try {
              rollbackFile();
            } catch (rollbackErr) {
              return reply.code(500).send({
                error: "operational",
                message: `banco falhou e o rollback do arquivo TAMBÉM falhou — estado pode ter ficado divergente: ${(rollbackErr as Error).message}`,
              });
            }
          }
          throw dbErr;
        }
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
