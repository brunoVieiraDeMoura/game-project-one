import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ElementSchema, MonsterSchema, type Monster } from "@ragnarok/game-data";
import type { MonsterRepository } from "../store/monster-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { applyMonsterSpawnSync, type MonsterSpawnWriterPaths } from "../store/monster-spawn-writer.js";
import { queueReload } from "../store/mysql-item-repository.js";
import { logCreate, logUpdate, logDelete } from "../audit/log.js";

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
   * `spawnsWritable` deixa o admin avisar/travar a seção em vez de mentir.
   * Fase 4: virou `true` de verdade (não mais um "confia em mim") quando
   * `spawnWriterPaths` está configurado E o backend não é MySQL — as duas
   * condições precisam valer pro estado do catálogo continuar sendo a
   * verdade (MySQL não tem onde guardar `spawns[]`, ver `mysql-monster-row.ts`). */
  spawnsWritable = true,
  spawnWriterPaths: MonsterSpawnWriterPaths | null = null,
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

      let toCreate: Monster = body.data;
      let spawnSync: { touchedFiles: string[]; rollback: () => void } | null = null;
      if (spawnsWritable && spawnWriterPaths && body.data.spawns.length > 0) {
        const sync = applyMonsterSpawnSync(spawnWriterPaths, { id: body.data.id, name: body.data.name }, [], body.data.spawns);
        if (sync.kind === "refused") {
          return reply.code(sync.httpStatus).send({ error: sync.error, message: sync.message, ...(sync.mapId ? { mapId: sync.mapId } : {}) });
        }
        if (sync.kind === "applied") {
          toCreate = { ...body.data, spawns: sync.spawns };
          spawnSync = { touchedFiles: sync.touchedFiles, rollback: sync.rollback };
        }
      }

      try {
        const created = await repo.create(toCreate);
        await logCreate(
          { security, admin, targetType: "monster", targetId: String(created.id), source: "admin/monsters" },
          created.name,
          created,
        );
        if (spawnSync && spawnSync.touchedFiles.length > 0) {
          await queueReload("script");
        }
        return reply.code(201).send(created);
      } catch (err) {
        if (spawnSync) {
          try {
            spawnSync.rollback();
          } catch (rollbackErr) {
            return reply.code(500).send({
              error: "operational",
              message: `banco falhou e o rollback do(s) arquivo(s) de spawn TAMBÉM falhou — estado pode ter ficado divergente: ${(rollbackErr as Error).message}`,
            });
          }
        }
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

      const current = await repo.get(p.data.id);
      if (!current) return reply.code(404).send({ error: "not found" });

      let toUpdate: Monster = body.data;
      let spawnSync: { touchedFiles: string[]; rollback: () => void } | null = null;
      if (spawnsWritable && spawnWriterPaths) {
        const sync = applyMonsterSpawnSync(spawnWriterPaths, { id: p.data.id, name: body.data.name }, current.spawns, body.data.spawns);
        if (sync.kind === "refused") {
          return reply.code(sync.httpStatus).send({ error: sync.error, message: sync.message, ...(sync.mapId ? { mapId: sync.mapId } : {}) });
        }
        if (sync.kind === "applied") {
          toUpdate = { ...body.data, spawns: sync.spawns };
          spawnSync = { touchedFiles: sync.touchedFiles, rollback: sync.rollback };
        }
      }

      try {
        const updated = await repo.update(p.data.id, toUpdate);
        if (!updated) return reply.code(404).send({ error: "not found" });
        await logUpdate(
          { security, admin, targetType: "monster", targetId: String(p.data.id), source: "admin/monsters" },
          updated.name,
          current as unknown as Record<string, unknown>,
          updated as unknown as Record<string, unknown>,
        );
        if (spawnSync && spawnSync.touchedFiles.length > 0) {
          await queueReload("script");
        }
        return updated;
      } catch (err) {
        if (spawnSync) {
          try {
            spawnSync.rollback();
          } catch (rollbackErr) {
            return reply.code(500).send({
              error: "operational",
              message: `banco falhou e o rollback do(s) arquivo(s) de spawn TAMBÉM falhou — estado pode ter ficado divergente: ${(rollbackErr as Error).message}`,
            });
          }
        }
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
        { security, admin, targetType: "monster", targetId: String(p.data.id), source: "admin/monsters" },
        before?.name ?? String(p.data.id),
        before,
      );
      return { ok: true };
    });
  };
}
