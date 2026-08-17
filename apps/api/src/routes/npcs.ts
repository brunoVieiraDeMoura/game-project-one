import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NpcKindSchema, NpcOriginSchema, NpcSchema } from "@ragnarok/game-data";
import type { NpcRepository } from "../store/npc-repository";
import type { MapRepository } from "../store/map-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { applyNpcScriptEdit, rollbackAppliedWrite, shiftLegacyRefIfAfter } from "../store/npc-script-sync";
import { applyNpcScriptCreate, rollbackNpcScriptCreate, ADMIN_CREATED_NPC_FILE } from "../store/npc-script-create";
import { queueReload } from "../store/mysql-item-repository.js";
import { logCreate, logUpdate, logDelete } from "../audit/log.js";

/** checagem POSITIVA e exata (não uma heurística de prefixo tipo "começa
 * com npc/") — só um `legacyRef` que bate literalmente com o arquivo que
 * `applyNpcScriptCreate` usa vai pra `npcCreateRoot`; qualquer outra coisa
 * (todo NPC migrado real, E toda fixture de teste com nome de arquivo
 * arbitrário) cai em `npcScriptRoot`, exatamente como sempre foi. Um
 * heurística por prefixo ("npc/") já causou um achado real nesta mesma
 * tarefa: fixture de teste sem esse prefixo ia parar, por engano, no
 * arquivo de verdade do admin — corrigido antes de chegar em produção. */
function scriptRootFor(legacyRef: string, npcScriptRoot: string, npcCreateRoot: string): string {
  return legacyRef.startsWith(`${ADMIN_CREATED_NPC_FILE}:`) ? npcCreateRoot : npcScriptRoot;
}

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
  kind: NpcKindSchema.optional(),
  mapId: z.string().trim().min(1).optional(),
  origin: NpcOriginSchema.optional(),
});

const IdParamSchema = z.object({ id: z.string().trim().min(1).max(128) });

export function npcRoutes(
  repo: NpcRepository,
  security: SecurityContext | null = null,
  npcScriptRoot: string | null = null,
  npcCreateRoot: string | null = null,
  mapRepository: MapRepository | null = null,
) {
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

      const existing = await repo.get(body.data.id);
      if (existing) return reply.code(409).send({ error: `npc ${body.data.id} already exists` });

      // `legacyRef` JÁ presente no payload = registrar no catálogo um NPC
      // cujo script JÁ existe em algum lugar (o caminho usado pra reimportar/
      // ressemear NPC migrado — uso pré-Fase 3.4, preservado tal qual: nunca
      // tentar gerar script pra algo que o cliente afirma já ter um). Só
      // quando `legacyRef` está AUSENTE é que isto é uma criação de verdade
      // (Fase 3.4) e o writer entra em ação.
      if (body.data.legacyRef) {
        try {
          const savedNpc = await repo.create(body.data);
          await logCreate(
            { security, admin, targetType: "npc", targetId: savedNpc.id, source: "admin/npcs" },
            savedNpc.name,
            savedNpc,
          );
          return reply.code(201).send(savedNpc);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 500;
          return reply.code(status).send({ error: (err as Error).message });
        }
      }

      const requested = body.data;

      if (mapRepository) {
        const map = await mapRepository.get(requested.mapId);
        if (!map) return reply.code(400).send({ error: "invalid-map", message: `mapa "${requested.mapId}" não existe no catálogo` });
        const [x, y] = requested.position;
        if (x < 0 || x >= map.size.width || y < 0 || y >= map.size.height) {
          return reply.code(400).send({
            error: "invalid-position",
            message: `posição (${x},${y}) fora dos limites de "${requested.mapId}" (${map.size.width}x${map.size.height})`,
          });
        }
      }

      if (!npcCreateRoot) {
        return reply.code(501).send({ error: "not-configured", message: "criação de NPC não está configurada neste ambiente (npcCreateRoot ausente)" });
      }
      const created = applyNpcScriptCreate(npcCreateRoot, requested);
      if (created.kind === "refused") {
        return reply.code(created.httpStatus).send({ error: created.error, message: created.message, ...(created.code ? { code: created.code } : {}) });
      }

      const withRef = { ...requested, legacyRef: created.legacyRef };
      try {
        const savedNpc = await repo.create(withRef);
        await logCreate(
          { security, admin, targetType: "npc", targetId: savedNpc.id, source: "admin/npcs" },
          savedNpc.name,
          savedNpc,
        );
        await queueReload("script");
        return reply.code(201).send(savedNpc);
      } catch (dbErr) {
        // arquivo já foi escrito com sucesso mas o banco falhou — mesma
        // janela de divergência do PUT (Node não tem transação entre
        // arquivo e banco). Melhor esforço: restaura o arquivo antes de
        // propagar o erro, pra não deixar um bloco órfão sem registro.
        try {
          rollbackNpcScriptCreate(created.absPath, created.previousText);
        } catch (rollbackErr) {
          return reply.code(500).send({
            error: "operational",
            message: `banco falhou e o rollback do arquivo TAMBÉM falhou — estado pode ter ficado divergente: ${(rollbackErr as Error).message}`,
          });
        }
        const status = (dbErr as { statusCode?: number }).statusCode ?? 500;
        return reply.code(status).send({ error: (dbErr as Error).message });
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
        let legacyRefShift: { relPath: string; editedBlockEndLine: number; lineDelta: number } | null = null;
        const editRoot = current.legacyRef ? scriptRootFor(current.legacyRef, npcScriptRoot ?? "", npcCreateRoot ?? "") : npcScriptRoot;
        if (editRoot) {
          const sync = applyNpcScriptEdit(editRoot, current, body.data);
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
            if (sync.lineDelta !== 0) {
              legacyRefShift = { relPath: sync.relPath, editedBlockEndLine: sync.editedBlockEndLine, lineDelta: sync.lineDelta };
            }
          }
        }

        try {
          const updated = await repo.update(p.data.id, body.data);
          if (!updated) return reply.code(404).send({ error: "not found" });
          await logUpdate(
            { security, admin, targetType: "npc", targetId: p.data.id, source: "admin/npcs" },
            updated.name,
            current as unknown as Record<string, unknown>,
            updated as unknown as Record<string, unknown>,
          );
          // achado da Fase 3.5 (drift de legacyRef): uma edição que muda a
          // contagem de linhas do arquivo desloca o cabeçalho de todo NPC
          // DEPOIS dele no mesmo arquivo — sem isto, o `legacyRef` desses
          // siblings continua apontando pra linha antiga e uma futura edição
          // deles falha ("not-a-script-header") ou, pior, acerta a linha
          // errada por coincidência. Só roda depois que o PRÓPRIO update já
          // confirmou (nunca antes — não quero deslocar sibling nenhum se a
          // edição principal ainda pode ser revertida). Melhor esforço, como
          // o resto do bloco de rollback: se a atualização de um sibling
          // falhar, o pior caso é ele ficar com o legacyRef antigo, que
          // `locateNpcScript` já recusa com segurança (não corrompe nada).
          if (legacyRefShift) {
            const { relPath, editedBlockEndLine, lineDelta } = legacyRefShift;
            const siblings = await repo.listByLegacyRefFile(relPath);
            for (const sibling of siblings) {
              if (sibling.id === p.data.id || !sibling.legacyRef) continue;
              const shifted = shiftLegacyRefIfAfter(sibling.legacyRef, relPath, editedBlockEndLine, lineDelta);
              if (shifted) {
                try {
                  await repo.update(sibling.id, { ...sibling, legacyRef: shifted });
                } catch {
                  // melhor esforço — não falha o PUT principal, que já confirmou.
                }
              }
            }
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
      const before = await repo.get(p.data.id);
      const removed = await repo.remove(p.data.id);
      if (!removed) return reply.code(404).send({ error: "not found" });
      await logDelete(
        { security, admin, targetType: "npc", targetId: p.data.id, source: "admin/npcs" },
        before?.name ?? p.data.id,
        before,
      );
      return { ok: true };
    });
  };
}
