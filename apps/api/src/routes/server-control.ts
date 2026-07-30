import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { queueReload, type ReloadKind } from "../store/mysql-item-repository.js";
import { roDatabase } from "../store/mysql.js";

/**
 * Controle do servidor de jogo rodando.
 *
 * O rAthena não tem porta de administração: a única forma de falar com o
 * map-server vivo é de dentro dele. Então "recarregar" é enfileirar um pedido
 * numa tabela que o NPC `npc-idle/panel.txt` consulta a cada 2 s e executa como
 * `@reloaditemdb`/`@reloadmobdb`/…
 *
 * Admin-only: recarregar base é operação de servidor, não leitura de catálogo.
 */

const RELOAD_KINDS = ["itemdb", "mobdb", "skilldb", "script", "battleconf"] as const;

const ReloadBodySchema = z.object({
  kind: z.enum(RELOAD_KINDS),
});

export function serverControlRoutes(security: SecurityContext | null = null) {
  return async function registerServerControlRoutes(app: FastifyInstance) {
    app.post("/reload", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;

      const body = ReloadBodySchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });

      await queueReload(body.data.kind as ReloadKind);
      if (admin && security) {
        await security.audit({
          actor: admin,
          action: "reload",
          targetType: "server",
          targetId: body.data.kind,
        });
      }
      // 202: o pedido está na fila; quem aplica é o NPC, em até ~2 s
      return reply.code(202).send({ queued: body.data.kind });
    });

    /** Estado da fila — serve para a UI dizer "aplicado" em vez de "mandado". */
    app.get("/reload", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;

      const [rows] = await roDatabase().query<RowDataPacket[]>(
        "SELECT id, kind, requested_at, done_at FROM `panel_reload_queue` ORDER BY id DESC LIMIT 10",
      );
      return {
        pending: rows.filter((r) => r.done_at === null).length,
        recent: rows,
      };
    });
  };
}
