import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseNpcScript, mapNpcScriptWithUnits, type Npc } from "@ragnarok/game-data";
import { locateNpcScript } from "./npc-script-locate";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const REAL_NPC_ROOT = join(REPO_ROOT, "rathena");
const COMPARE_PATH = join(REPO_ROOT, "tools", "legacy-migration", "output", "npcs-v2-compare.json");

/** ordem de chave difere entre objeto fresco do Mapper e objeto vindo do
 * JSON do banco — comparar precisa ser por CONTEÚDO, não por string bruta. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = canonical((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}
function canon(v: unknown): string {
  return JSON.stringify(canonical(v));
}

/**
 * Prova que `locateNpcScript` (que NÃO reimplementa o parsing de cabeçalho
 * de `migrate-npcs.ts`, só a varredura de chaves) devolve, pro MESMO
 * `legacyRef`, exatamente o `dialogue`/`eventHandlers` que a migração real
 * já provou correto (via `npcs-v2-compare.json`, o artefato do reseed
 * aprovado). Isto é mais forte que comparar texto bruto contra
 * `extractScriptBodies`: aquele helper usa uma convenção de linha DIFERENTE
 * pra `ref` (linha do FIM do bloco, não do início — achado nesta própria
 * investigação), então comparar contra ele testaria a convenção errada.
 * `npcs-v2-compare.json` usa a convenção real (linha do cabeçalho), a mesma
 * gravada em `legacyRef` no banco.
 */
describe("locateNpcScript — round-trip locate→parse→map bate com o dado já provado no banco", () => {
  it("amostra de 200 NPCs reais (1 em cada ~46): locate+parse+map == npcs-v2-compare.json", () => {
    const npcs: Npc[] = JSON.parse(readFileSync(COMPARE_PATH, "utf8"));
    const scriptNpcs = npcs.filter((n) => !n.warp && !n.shop && !n.duplicateOf && n.legacyRef);
    const sample = scriptNpcs.filter((_, i) => i % 46 === 0);
    expect(sample.length).toBeGreaterThan(150);

    let diffs = 0;
    let crlfRefusals = 0;
    const diffSamples: unknown[] = [];
    for (const npc of sample) {
      const located = locateNpcScript(REAL_NPC_ROOT, npc.legacyRef!);
      if (!located.ok) {
        // achado desta investigação: 3 dos 1138 arquivos do corpus usam
        // CRLF, e `locateNpcScript` recusa DE PROPÓSITO em vez de
        // normalizar em silêncio (ver `crlf-unsupported`) — não é
        // divergência, é a recusa esperada e documentada.
        if (located.code === "crlf-unsupported") {
          crlfRefusals++;
          continue;
        }
        diffs++;
        if (diffSamples.length < 5) diffSamples.push({ id: npc.id, legacyRef: npc.legacyRef, locateFailed: located.reason });
        continue;
      }
      const mapped = mapNpcScriptWithUnits(parseNpcScript(located.code));
      const a = canon({ dialogueEntry: mapped.dialogueEntry, dialogue: mapped.dialogue, eventHandlers: mapped.eventHandlers });
      const b = canon({ dialogueEntry: npc.dialogueEntry, dialogue: npc.dialogue, eventHandlers: npc.eventHandlers });
      if (a !== b) {
        diffs++;
        if (diffSamples.length < 5) diffSamples.push({ id: npc.id, legacyRef: npc.legacyRef });
      }
    }
    if (diffs > 0) console.error("divergências:", JSON.stringify(diffSamples, null, 1));
    expect(diffs).toBe(0);
    expect(crlfRefusals).toBeGreaterThanOrEqual(0); // documenta que a amostra pode conter arquivo CRLF sem falhar o teste
  });

  it("#AirshipWarp-1: locate acha o bloco certo (4 handlers) direto do .txt real", () => {
    const npcs: Npc[] = JSON.parse(readFileSync(COMPARE_PATH, "utf8"));
    const npc = npcs.find((n) => n.name === "#AirshipWarp-1")!;
    expect(npc.legacyRef).toBe("npc/airports/airships.txt:21");
    const located = locateNpcScript(REAL_NPC_ROOT, npc.legacyRef!);
    expect(located.ok).toBe(true);
    if (located.ok) {
      const mapped = mapNpcScriptWithUnits(parseNpcScript(located.code));
      expect(mapped.eventHandlers.map((h) => h.label)).toEqual(["OnInit", "OnHide", "OnUnhide", "OnTouch_"]);
    }
  });
});

describe("locateNpcScript — recusas", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "npc-locate-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("arquivo inexistente", () => {
    const r = locateNpcScript(dir, "nao-existe.txt:1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("file-not-found");
  });

  it("legacyRef sem número de linha válido", () => {
    const r = locateNpcScript(dir, "a.txt:abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-ref");
  });

  it("linha fora do arquivo (arquivo encolheu)", () => {
    writeFileSync(join(dir, "a.txt"), "prontera,1,1,1\tscript\tX\t1,{\n\tend;\n}\n", "utf8");
    const r = locateNpcScript(dir, "a.txt:999");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("line-out-of-range");
  });

  it("linha não é cabeçalho de script (arquivo mudou de forma)", () => {
    writeFileSync(join(dir, "a.txt"), "// comentário\nprontera,1,1,1\tscript\tX\t1,{\n\tend;\n}\n", "utf8");
    const r = locateNpcScript(dir, "a.txt:1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not-a-script-header");
  });

  it("CRLF — recusa em vez de normalizar em silêncio", () => {
    writeFileSync(join(dir, "a.txt"), "prontera,1,1,1\tscript\tX\t1,{\r\n\tend;\r\n}\r\n", "utf8");
    const r = locateNpcScript(dir, "a.txt:1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("crlf-unsupported");
  });

  it("bloco nunca fecha (arquivo truncado)", () => {
    writeFileSync(join(dir, "a.txt"), "prontera,1,1,1\tscript\tX\t1,{\n\tmes \"a\";\n", "utf8");
    const r = locateNpcScript(dir, "a.txt:1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("block-not-closed");
  });

  it("caso feliz: acha o corpo certo, ignora cabeçalho e o que vem depois no arquivo", () => {
    writeFileSync(
      join(dir, "a.txt"),
      [
        "prontera,1,1,1\tscript\tOutro\t1,{",
        "\tmes \"não é este\";",
        "\tend;",
        "}",
        "",
        "prontera,2,2,2\tscript\tAlvo\t2,{",
        "\tmes \"a\";",
        "\tclose;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const r = locateNpcScript(dir, "a.txt:6");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.code.trim()).toBe('mes "a";\n\tclose;');
      expect(r.rawText.slice(r.bodyStart, r.bodyEnd)).toBe(r.code);
    }
  });
});
