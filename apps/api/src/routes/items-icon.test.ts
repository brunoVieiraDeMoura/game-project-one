import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildServer } from "../server";
import { JsonItemRepository } from "../store/json-item-repository";

/**
 * `POST/DELETE /items/:id/icon` — upload de verdade, processado (sharp) e
 * gravado em disco (`items.ts`). Cobre o caminho feliz e as recusas; a
 * escrita em MySQL (`panel_item_icon`, `mysql-item-repository.ts`) não tem
 * teste próprio aqui pelo mesmo motivo do resto do módulo (nenhum outro
 * teste deste arquivo sobe um MariaDB real) — o JSON repository implementa o
 * mesmo `setIcon`, e é ele que a rota exercita.
 */

function tempRepo() {
  return new JsonItemRepository(join(tmpdir(), `items-icon-test-${Date.now()}-${Math.random()}.json`));
}

function sampleItem(id: number, name = `Item ${id}`) {
  return {
    id, aegisName: `Aegis_${id}`, name, type: "etc",
    buyPrice: 10, sellPrice: 5, weight: 10, attack: 0, magicAttack: 0, defense: 0, range: 0, slots: 0,
    jobs: ["all"], classes: [], gender: "both", locations: [],
    equipLevelMin: 0, equipLevelMax: 0, refineable: false, gradable: false, viewSprite: 0,
  };
}

async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } })
    .png()
    .toBuffer();
}

function multipartBody(fieldName: string, filename: string, mimetype: string, data: Buffer): { body: Buffer; contentType: string } {
  const boundary = "----vitestBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("POST/DELETE /items/:id/icon", () => {
  let app: FastifyInstance;
  let iconDir: string;

  beforeEach(async () => {
    iconDir = mkdtempSync(join(tmpdir(), "item-icons-"));
    app = await buildServer({ itemRepository: tempRepo(), security: null, itemIconRoots: [iconDir] });
    await app.inject({ method: "POST", url: "/items", payload: sampleItem(909, "Pedrinha") });
  });

  afterEach(() => {
    rmSync(iconDir, { recursive: true, force: true });
  });

  it("recusa upload sem arquivo", async () => {
    const { body, contentType } = multipartBody("nope", "x.png", "image/png", Buffer.from("x"));
    const res = await app.inject({ method: "POST", url: "/items/909/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(400);
  });

  it("recusa formato não suportado", async () => {
    const { body, contentType } = multipartBody("file", "x.txt", "text/plain", Buffer.from("nao e imagem"));
    const res = await app.inject({ method: "POST", url: "/items/909/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(400);
  });

  it("404 pra item inexistente", async () => {
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    const res = await app.inject({ method: "POST", url: "/items/9999/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(404);
  });

  it("processa, grava em disco e o item passa a ter `icon`", async () => {
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    const res = await app.inject({ method: "POST", url: "/items/909/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().icon).toBe("909.png");

    const written = join(iconDir, "909.png");
    expect(existsSync(written)).toBe(true);
    // veio processado por `sharp` (é um PNG de verdade, não o arquivo cru) —
    // a assinatura basta pra provar isso sem reabrir com sharp de novo
    expect(readFileSync(written).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    const get = await app.inject({ method: "GET", url: "/items/909" });
    expect(get.json().icon).toBe("909.png");
  });

  it("DELETE remove o arquivo e limpa `icon` do item", async () => {
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    await app.inject({ method: "POST", url: "/items/909/icon", headers: { "content-type": contentType }, payload: body });
    expect(existsSync(join(iconDir, "909.png"))).toBe(true);

    const del = await app.inject({ method: "DELETE", url: "/items/909/icon" });
    expect(del.statusCode).toBe(200);
    expect(del.json().icon).toBeUndefined();
    expect(existsSync(join(iconDir, "909.png"))).toBe(false);
  });

  it("501 quando o backend não tem onde escrever (`itemIconRoots: null`)", async () => {
    const noDisk = await buildServer({ itemRepository: tempRepo(), security: null, itemIconRoots: null });
    await noDisk.inject({ method: "POST", url: "/items", payload: sampleItem(1) });
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    const res = await noDisk.inject({ method: "POST", url: "/items/1/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(501);
  });
});

describe("POST /items/:id/icon auth", () => {
  it("exige admin, como as outras mutações do módulo", async () => {
    const iconDir = mkdtempSync(join(tmpdir(), "item-icons-auth-"));
    try {
      const app = await buildServer({
        itemRepository: tempRepo(),
        itemIconRoots: [iconDir],
        security: {
          async verify(token) {
            if (token === "admin-token") return { accountId: 1, username: "gm", groupLevel: 99 };
            return null;
          },
          async audit() {},
        },
      });
      await app.inject({
        method: "POST", url: "/items", payload: sampleItem(909, "Pedrinha"),
        headers: { authorization: "Bearer admin-token" },
      });

      const png = await tinyPng();
      const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
      const noToken = await app.inject({ method: "POST", url: "/items/909/icon", headers: { "content-type": contentType }, payload: body });
      expect(noToken.statusCode).toBe(401);
    } finally {
      rmSync(iconDir, { recursive: true, force: true });
    }
  });
});
