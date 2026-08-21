import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildServer } from "../server";
import { JsonSkillRepository } from "../store/json-skill-repository";
import { JsonStatusRepository } from "../store/json-status-repository";

/**
 * `POST/DELETE /skills/:id/icon` — mesmo contrato de `items-icon.test.ts`,
 * só que `icon` de skill é campo comum do catálogo (não uma tabela auxiliar
 * tipo `panel_item_icon`): o que este teste prova de diferente é que o
 * upload NÃO passa por `YamlSkillRepository.writeOverride`/`skill_db.yml`
 * (não há `iconRoots` apontando pro rAthena, e `icon` nunca aparece no YAML).
 */

function tempSkillRepo() {
  return new JsonSkillRepository(join(tmpdir(), `skills-icon-test-${Date.now()}-${Math.random()}.json`));
}

function tempStatusRepo() {
  return new JsonStatusRepository(join(tmpdir(), `statuses-icon-test-${Date.now()}-${Math.random()}.json`));
}

function sampleSkill(id: number, name = `Skill ${id}`) {
  return {
    id,
    aegisName: `SK_${id}`,
    name,
    maxLevel: 5,
    type: "self_buff",
    damageNature: "none",
    hitType: "single",
    element: "weapon",
    range: 0,
    hits: 1,
    spCost: 0,
    castTimeMs: { variable: 0, fixed: 0 },
    target: "self",
    appliedStatuses: [],
  };
}

async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 30, g: 30, b: 200, alpha: 1 } } })
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

describe("POST/DELETE /skills/:id/icon", () => {
  let app: FastifyInstance;
  let iconDir: string;

  beforeEach(async () => {
    iconDir = mkdtempSync(join(tmpdir(), "skill-icons-"));
    app = await buildServer({
      skillRepository: tempSkillRepo(),
      statusRepository: tempStatusRepo(),
      security: null,
      skillIconRoots: [iconDir],
    });
    await app.inject({ method: "POST", url: "/skills", payload: sampleSkill(9000, "Blink 15") });
  });

  afterEach(() => {
    rmSync(iconDir, { recursive: true, force: true });
  });

  it("recusa upload sem arquivo", async () => {
    const { body, contentType } = multipartBody("nope", "x.png", "image/png", Buffer.from("x"));
    const res = await app.inject({ method: "POST", url: "/skills/9000/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(400);
  });

  it("recusa formato não suportado", async () => {
    const { body, contentType } = multipartBody("file", "x.txt", "text/plain", Buffer.from("nao e imagem"));
    const res = await app.inject({ method: "POST", url: "/skills/9000/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(400);
  });

  it("404 pra skill inexistente", async () => {
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    const res = await app.inject({ method: "POST", url: "/skills/1234/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(404);
  });

  it("processa, grava em disco e a skill passa a ter `icon`", async () => {
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    const res = await app.inject({ method: "POST", url: "/skills/9000/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().icon).toBe("9000.png");

    const written = join(iconDir, "9000.png");
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    const get = await app.inject({ method: "GET", url: "/skills/9000" });
    expect(get.json().icon).toBe("9000.png");
  });

  it("DELETE remove o arquivo e limpa `icon` da skill", async () => {
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    await app.inject({ method: "POST", url: "/skills/9000/icon", headers: { "content-type": contentType }, payload: body });
    expect(existsSync(join(iconDir, "9000.png"))).toBe(true);

    const del = await app.inject({ method: "DELETE", url: "/skills/9000/icon" });
    expect(del.statusCode).toBe(200);
    expect(del.json().icon).toBeUndefined();
    expect(existsSync(join(iconDir, "9000.png"))).toBe(false);
  });

  it("501 quando o backend não tem onde escrever (`skillIconRoots: null`)", async () => {
    const noDisk = await buildServer({
      skillRepository: tempSkillRepo(),
      statusRepository: tempStatusRepo(),
      security: null,
      skillIconRoots: null,
    });
    await noDisk.inject({ method: "POST", url: "/skills", payload: sampleSkill(1) });
    const png = await tinyPng();
    const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
    const res = await noDisk.inject({ method: "POST", url: "/skills/1/icon", headers: { "content-type": contentType }, payload: body });
    expect(res.statusCode).toBe(501);
  });
});

describe("POST /skills/:id/icon auth", () => {
  it("exige admin, como as outras mutações do módulo", async () => {
    const iconDir = mkdtempSync(join(tmpdir(), "skill-icons-auth-"));
    try {
      const app = await buildServer({
        skillRepository: tempSkillRepo(),
        statusRepository: tempStatusRepo(),
        skillIconRoots: [iconDir],
        security: {
          async verify(token) {
            if (token === "admin-token") return { accountId: 1, username: "gm", groupLevel: 99 };
            return null;
          },
          async audit() {},
        },
      });
      await app.inject({
        method: "POST", url: "/skills", payload: sampleSkill(9000, "Blink 15"),
        headers: { authorization: "Bearer admin-token" },
      });

      const png = await tinyPng();
      const { body, contentType } = multipartBody("file", "icon.png", "image/png", png);
      const noToken = await app.inject({ method: "POST", url: "/skills/9000/icon", headers: { "content-type": contentType }, payload: body });
      expect(noToken.statusCode).toBe(401);
    } finally {
      rmSync(iconDir, { recursive: true, force: true });
    }
  });
});
