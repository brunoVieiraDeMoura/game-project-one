import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Npc } from "@ragnarok/game-data";
import { applyNpcScriptCreate, rollbackNpcScriptCreate, ADMIN_CREATED_NPC_FILE } from "./npc-script-create";

function baseNpc(overrides: Partial<Npc> = {}): Npc {
  return {
    id: "GPQA_TEST",
    name: "QA Test",
    sprite: "1_M_01",
    mapId: "gpqa01",
    position: [65, 60, 0],
    direction: 0,
    dialogueEntry: "n0",
    dialogue: [
      { id: "n0", kind: "say", text: "Ola!", next: "n1" },
      { id: "n1", kind: "end" },
    ],
    eventHandlers: [],
    questTriggers: [],
    questBoard: [],
    ...overrides,
  };
}

describe("applyNpcScriptCreate", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "npc-create-"));
  });

  it("refuses when destination file doesn't exist yet (setup missing)", () => {
    const result = applyNpcScriptCreate(root, baseNpc());
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.httpStatus).toBe(500);
      expect(result.message).toMatch(/não existe/);
    }
  });

  it("appends a well-formed block and computes a resolvable legacyRef", () => {
    writeFileSync(join(root, ADMIN_CREATED_NPC_FILE), "// header\n", "utf8");
    const result = applyNpcScriptCreate(root, baseNpc());
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;

    expect(result.legacyRef).toMatch(new RegExp(`^${ADMIN_CREATED_NPC_FILE}:\\d+$`));
    const [, lineStr] = result.legacyRef.split(":");
    const lineNum = Number(lineStr);

    const finalText = readFileSync(result.absPath, "utf8");
    const lines = finalText.split("\n");
    // a linha apontada por legacyRef tem que ser exatamente o cabeçalho do script.
    expect(lines[lineNum - 1]).toContain("gpqa01,65,60,0\tscript\tQA Test#GPQA_TEST\t1_M_01,{");
    expect(finalText).toContain('mes "Ola!";');
    expect(finalText).toContain("close;");
    // o header original nunca foi tocado.
    expect(finalText.startsWith("// header\n")).toBe(true);
  });

  it("does not touch the file at all when generation is refused (invalid graph)", () => {
    writeFileSync(join(root, ADMIN_CREATED_NPC_FILE), "// header\n", "utf8");
    const before = readFileSync(join(root, ADMIN_CREATED_NPC_FILE), "utf8");

    const result = applyNpcScriptCreate(root, baseNpc({ dialogueEntry: "n0", dialogue: [{ id: "n0", kind: "choice", choices: [{ label: "A", next: "n1" }] }] }));
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.code).toBe("unsupported-node-kind");

    const after = readFileSync(join(root, ADMIN_CREATED_NPC_FILE), "utf8");
    expect(after).toBe(before);
  });

  it("refuses an id unsafe for a script #suffix, without touching the file", () => {
    writeFileSync(join(root, ADMIN_CREATED_NPC_FILE), "// header\n", "utf8");
    const before = readFileSync(join(root, ADMIN_CREATED_NPC_FILE), "utf8");

    const result = applyNpcScriptCreate(root, baseNpc({ id: "not safe, has spaces" }));
    expect(result.kind).toBe("refused");

    const after = readFileSync(join(root, ADMIN_CREATED_NPC_FILE), "utf8");
    expect(after).toBe(before);
  });

  it("appends multiple NPCs sequentially without disturbing earlier ones", () => {
    writeFileSync(join(root, ADMIN_CREATED_NPC_FILE), "// header\n", "utf8");
    const r1 = applyNpcScriptCreate(root, baseNpc({ id: "GPQA_ONE", name: "One" }));
    const r2 = applyNpcScriptCreate(root, baseNpc({ id: "GPQA_TWO", name: "Two" }));
    expect(r1.kind).toBe("applied");
    expect(r2.kind).toBe("applied");

    const finalText = readFileSync(join(root, ADMIN_CREATED_NPC_FILE), "utf8");
    expect(finalText).toContain("One#GPQA_ONE");
    expect(finalText).toContain("Two#GPQA_TWO");
    expect(finalText.indexOf("One#GPQA_ONE")).toBeLessThan(finalText.indexOf("Two#GPQA_TWO"));
  });

  it("rollback restores the file to its exact previous content", () => {
    writeFileSync(join(root, ADMIN_CREATED_NPC_FILE), "// header\n", "utf8");
    const result = applyNpcScriptCreate(root, baseNpc());
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") return;

    rollbackNpcScriptCreate(result.absPath, result.previousText);
    const restored = readFileSync(result.absPath, "utf8");
    expect(restored).toBe("// header\n");
  });
});
