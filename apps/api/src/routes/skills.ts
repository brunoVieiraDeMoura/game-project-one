import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { SkillSchema } from "@ragnarok/game-data";
import type { SkillRepository } from "../store/skill-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { logCreate, logUpdate, logDelete } from "../audit/log.js";

/** Mesma whitelist/limite de `routes/items.ts` — ícone de skill é o mesmo
 * tipo de asset raster de UI (barra, janela de skills, badge de cast). */
const ICON_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ICON_MAX_SIDE = 128;

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
  /** filtro por classe: prefixos crus separados por vírgula (ex. "SM,KN,LK") */
  classPrefix: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^[A-Z0-9]{1,8}$/)).min(1))
    .optional(),
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

export function skillRoutes(
  repo: SkillRepository,
  security: SecurityContext | null = null,
  /** pastas onde o PNG processado é gravado (`server.ts: skillIconRoots`) —
   * `null`/vazio desliga o upload (responde 501), mesmo contrato de
   * `itemRoutes`. */
  iconRoots: string[] | null = null,
) {
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
        await logCreate(
          { security, admin, targetType: "skill", targetId: String(created.id), source: "admin/skills" },
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
      const body = SkillSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const before = await repo.get(p.data.id);
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        await logUpdate(
          { security, admin, targetType: "skill", targetId: String(p.data.id), source: "admin/skills" },
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
        { security, admin, targetType: "skill", targetId: String(p.data.id), source: "admin/skills" },
        before?.name ?? String(p.data.id),
        before,
      );
      return { ok: true };
    });

    // Upload de ícone: `POST /skills/:id/icon`, multipart (campo "file").
    // Mesmo contrato de `POST /items/:id/icon` — fora do `update()` de
    // propósito, ver `SkillRepository.setIcon`.
    app.post("/:id/icon", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      if (!repo.setIcon || !iconRoots || iconRoots.length === 0) {
        return reply.code(501).send({ error: "upload de ícone não suportado neste backend" });
      }

      const before = await repo.get(p.data.id);
      if (!before) return reply.code(404).send({ error: "not found" });

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "faltou o arquivo (campo \"file\")" });
      if (!ICON_MIME_TYPES.has(file.mimetype)) {
        return reply.code(400).send({ error: `formato não suportado: ${file.mimetype}` });
      }
      const buffer = await file.toBuffer();

      let png: Buffer;
      try {
        png = await sharp(buffer)
          .resize({ width: ICON_MAX_SIDE, height: ICON_MAX_SIDE, fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();
      } catch (err) {
        return reply.code(400).send({ error: `imagem inválida: ${(err as Error).message}` });
      }

      const filename = `${p.data.id}.png`;
      for (const root of iconRoots) {
        await mkdir(root, { recursive: true });
        await writeFile(join(root, filename), png);
      }

      const updated = await repo.setIcon(p.data.id, filename);
      if (!updated) return reply.code(404).send({ error: "not found" });
      await logUpdate(
        { security, admin, targetType: "skill", targetId: String(p.data.id), source: "admin/skills/icon" },
        updated.name,
        before as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      );
      return updated;
    });

    app.delete("/:id/icon", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      if (!repo.setIcon) {
        return reply.code(501).send({ error: "upload de ícone não suportado neste backend" });
      }

      const before = await repo.get(p.data.id);
      if (!before) return reply.code(404).send({ error: "not found" });

      if (before.icon && iconRoots) {
        for (const root of iconRoots) {
          await unlink(join(root, before.icon)).catch(() => undefined);
        }
      }

      const updated = await repo.setIcon(p.data.id, null);
      if (!updated) return reply.code(404).send({ error: "not found" });
      await logUpdate(
        { security, admin, targetType: "skill", targetId: String(p.data.id), source: "admin/skills/icon" },
        updated.name,
        before as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      );
      return updated;
    });
  };
}
