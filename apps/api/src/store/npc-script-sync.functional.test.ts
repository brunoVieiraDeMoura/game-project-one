import { describe, expect, it, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { NpcSchema, parseNpcScript, mapNpcScriptWithUnits, type Npc } from "@ragnarok/game-data";
import { applyNpcScriptEdit } from "./npc-script-sync";
import { locateNpcScript } from "./npc-script-locate";

/**
 * Teste funcional (leia1.txt, integração Writer↔Admin, §"Teste funcional"):
 * prova o fluxo INTEIRO — Admin/API → before real → after → Writer → arquivo
 * → reparse → validação — contra um NPC REAL do corpus, mas numa CÓPIA
 * temporária, nunca no `.txt` de produção. A prova de que `rathena/` não foi
 * tocado é o HASH do arquivo original antes/depois de toda a operação.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const REAL_NPC_ROOT = join(REPO_ROOT, "rathena");
const REAL_FILE_REL = "npc/airports/airships.txt";
const REAL_LEGACY_REF = "npc/airports/airships.txt:181"; // NPC de diálogo linear simples, já usado nos testes de migração

describe("Fluxo funcional completo — NPC real, arquivo temporário, rathena/ nunca escrito", () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("copia um NPC real pro temp, edita via applyNpcScriptEdit, confirma reparse e confirma rathena/ intocado", () => {
    const realFilePath = join(REAL_NPC_ROOT, REAL_FILE_REL);
    const realFileBefore = readFileSync(realFilePath, "utf8");

    // 1) "before real": locate + parse + map contra o arquivo de PRODUÇÃO
    //    (só leitura — é assim que a integração real obteria o `before`).
    const locatedReal = locateNpcScript(REAL_NPC_ROOT, REAL_LEGACY_REF);
    expect(locatedReal.ok).toBe(true);
    if (!locatedReal.ok) return;
    const beforeMapped = mapNpcScriptWithUnits(parseNpcScript(locatedReal.code));
    expect(beforeMapped.dialogue.some((n) => n.kind === "say")).toBe(true);

    // 2) monta o "current" (o que o banco/Admin teria) a partir do REAL —
    //    e o "requested" com a edição que o Admin faria.
    const current: Npc = NpcSchema.parse({
      id: "airship-crew-func-test",
      name: "Airship Crew",
      sprite: "852",
      mapId: "airplane",
      position: [100, 69, 0],
      direction: 3,
      dialogueEntry: beforeMapped.dialogueEntry,
      dialogue: beforeMapped.dialogue,
      eventHandlers: beforeMapped.eventHandlers,
      legacyRef: REAL_LEGACY_REF,
    });
    const targetSay = current.dialogue.find((n) => n.kind === "say")!;
    const requested: Npc = {
      ...current,
      dialogue: current.dialogue.map((n) => (n.id === targetSay.id ? { ...n, text: "TESTE FUNCIONAL — texto editado" } : n)),
    };

    // 3) copia SÓ o arquivo necessário pro temp, preservando o caminho
    //    relativo (é o que `legacyRef` espera pra resolver).
    tmpRoot = mkdtempSync(join(tmpdir(), "npc-functional-test-"));
    const tmpFilePath = join(tmpRoot, REAL_FILE_REL);
    mkdirSync(dirname(tmpFilePath), { recursive: true });
    writeFileSync(tmpFilePath, realFileBefore, "utf8");

    // 4) roda o fluxo de verdade contra a CÓPIA.
    const result = applyNpcScriptEdit(tmpRoot, current, requested);
    expect(result.kind).toBe("applied");

    // 5) reparse da cópia confirma o grafo pedido.
    const relocated = locateNpcScript(tmpRoot, REAL_LEGACY_REF);
    expect(relocated.ok).toBe(true);
    if (relocated.ok) {
      const after = mapNpcScriptWithUnits(parseNpcScript(relocated.code));
      expect(after.dialogue.some((n) => n.kind === "say" && n.text === "TESTE FUNCIONAL — texto editado")).toBe(true);
    }
    const tmpFileNow = readFileSync(tmpFilePath, "utf8");
    expect(tmpFileNow).toContain("TESTE FUNCIONAL — texto editado");
    expect(tmpFileNow).not.toBe(realFileBefore);

    // 6) a prova central deste teste: rathena/ real, byte a byte, IGUAL ao
    //    que era antes de qualquer coisa acontecer.
    const realFileAfter = readFileSync(realFilePath, "utf8");
    expect(realFileAfter).toBe(realFileBefore);
  });
});
