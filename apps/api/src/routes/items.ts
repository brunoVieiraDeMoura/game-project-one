import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { ItemSchema, ItemSubTypeSchema, ItemTypeSchema } from "@ragnarok/game-data";
import type { ItemRepository } from "../store/item-repository";
import type { SecurityContext } from "../auth/security";
import { requireAdmin } from "../auth/guard";
import { logCreate, logUpdate, logDelete } from "../audit/log.js";

/**
 * Formatos aceitos no upload de ícone de item — os mesmos que `sharp` lê sem
 * plugin extra. SVG fica de fora de propósito: ícone de item é raster em
 * TODO lugar que ele aparece (chão em 3D como textura, bolsa, aviso de
 * loot), e SVG exigiria rasterizar em cada um desses três em vez de uma vez
 * só aqui na entrada.
 */
const ICON_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** lado máximo do ícone processado — cobre folgado qualquer slot que hoje
 * mostra ícone de item (bolsa, chão, aviso de loot, janela de detalhe); mais
 * que isso é peso de arquivo sem ganho visual num quadrado de UI. */
const ICON_MAX_SIDE = 128;

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().trim().min(1).optional(),
  type: ItemTypeSchema.optional(),
  subType: ItemSubTypeSchema.optional(),
});

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * `/items/by-id?ids=1,2,3` — o CLIENTE pergunta o nome legível de vários itens.
 *
 * Mesma forma da rota de skills, e pelo mesmo motivo: o rAthena manda só o ID
 * em inventário e drop, e uma requisição por item encheria a rede de chamadas
 * com uma bolsa aberta. O teto de 200 existe para o parâmetro não virar uma
 * varredura da tabela inteira.
 */
const IdsQuerySchema = z.object({
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(",").map(Number).filter(Number.isInteger).slice(0, 200)),
});

export function itemRoutes(
  repo: ItemRepository,
  security: SecurityContext | null = null,
  /** pastas onde o PNG processado é gravado (`server.ts: itemIconRoots`) —
   * `null`/vazio desliga o upload (responde 501), usado nos testes que não
   * têm disco pra escrever. */
  iconRoots: string[] | null = null,
) {
  return async function registerItemRoutes(app: FastifyInstance) {
    app.get("/", async (req, reply) => {
      const q = ListQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      return repo.list(q.data);
    });

    // ANTES do `/:id`: o Fastify casa rota por ordem de registro, e "by-id"
    // seria engolido como um `:id` que não é número
    app.get("/by-id", async (req, reply) => {
      const q = IdsQuerySchema.safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: q.error.issues });
      const found = await Promise.all(q.data.ids.map((id) => repo.get(id)));
      // `repo.get` devolve `undefined` (Mysql) OU `null` (outros backends) pra
      // id inexistente — `!==` só pegava um dos dois, e o outro sobrevivia no
      // array. JSON.stringify converte `undefined` de array em `null`, então
      // um id desconhecido no meio do lote virava `{items:[null,...]}`: o
      // parser do cliente (`itemCatalog.ensure`) lê `cru.id` sem checar null e
      // quebra o `.then()` inteiro — o LOTE INTEIRO cai no `.catch()` silencioso,
      // inclusive os itens que TINHAM sido encontrados. Um item de drop ainda
      // não seedado no catálogo derrubava o nome de todo mundo na mesma leva.
      return { items: found.filter((i) => i != null) };
    });

    app.get("/:id", async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return reply.code(400).send({ error: p.error.issues });
      const item = await repo.get(p.data.id);
      if (!item) return reply.code(404).send({ error: "not found" });
      return item;
    });

    app.post("/", async (req, reply) => {
      const admin = await requireAdmin(security, req, reply);
      if (admin === undefined) return;
      const body = ItemSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const created = await repo.create(body.data);
        await logCreate(
          { security, admin, targetType: "item", targetId: String(created.id), source: "admin/items" },
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
      const body = ItemSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues });
      try {
        const before = await repo.get(p.data.id);
        const updated = await repo.update(p.data.id, body.data);
        if (!updated) return reply.code(404).send({ error: "not found" });
        await logUpdate(
          { security, admin, targetType: "item", targetId: String(p.data.id), source: "admin/items" },
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

    // Upload de ícone: `POST /items/:id/icon`, multipart (campo "file"). Fora
    // de `update()` de propósito — ver comentário de `MysqlItemRepository.
    // setIcon` — e por isso não usa `ItemSchema.safeParse`, só valida o
    // arquivo em si.
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
        { security, admin, targetType: "item", targetId: String(p.data.id), source: "admin/items/icon" },
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
        { security, admin, targetType: "item", targetId: String(p.data.id), source: "admin/items/icon" },
        updated.name,
        before as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
      );
      return updated;
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
        { security, admin, targetType: "item", targetId: String(p.data.id), source: "admin/items" },
        before?.name ?? String(p.data.id),
        before,
      );
      return { ok: true };
    });
  };
}
