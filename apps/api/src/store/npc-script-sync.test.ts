import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NpcSchema, type Npc } from "@ragnarok/game-data";
import { applyNpcScriptEdit, rollbackAppliedWrite } from "./npc-script-sync";

const SIMPLE = `prontera,150,150,4\tscript\tSimples\t1_M_01,{
\tmes "ola";
\tclose;
}
`;

const IF_ELSE = `prontera,150,150,4\tscript\tCondicional\t1_M_01,{
\tif (variavel == 1) {
\t\tmes "sim";
\t} else {
\t\tmes "nao";
\t}
\tclose;
}
`;

const SWITCH = `prontera,150,150,4\tscript\tMenu\t1_M_01,{
\tswitch(select("A:B:C")) {
\tcase 1:
\t\tmes "opcao a";
\t\tbreak;
\tcase 2:
\t\tmes "opcao b";
\t\tbreak;
\tcase 3:
\t\tmes "opcao c";
\t\tbreak;
\t}
\tclose;
}
`;

const WITH_HANDLER = `prontera,150,150,4\tscript\tComHandler\t1_M_01,{
\tmes "principal";
\tclose;
OnTouch_:
\tmes "toque";
\tend;
}
`;

const TWO_NPCS = `prontera,150,150,4\tscript\tPrimeiro\t1_M_01,{
\tmes "um";
\tclose;
}

prontera,160,160,4\tscript\tSegundo\t1_M_02,{
\tmes "dois";
\tclose;
}
`;

const WITH_COMMENT = `prontera,150,150,4\tscript\tComComentario\t1_M_01,{
\t// isto e um comentario que nao pode sumir
\tmes "ola";
\tclose;
}
`;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "npc-sync-test-"));
}

function baseNpc(overrides: Partial<Npc>): Npc {
  return NpcSchema.parse({
    id: "n1",
    name: "N",
    sprite: "1_M_01",
    mapId: "prontera",
    position: [150, 150, 0],
    direction: 4,
    dialogueEntry: "n0",
    dialogue: [
      { id: "n0", kind: "say", text: "ola", next: "n1" },
      { id: "n1", kind: "end" },
    ],
    ...overrides,
  });
}

// A migração usa: fileRef = `${rel}:${li + 1}` — a linha do CABEÇALHO
// ("script\tNome...,{"), ANTES de avançar pro fim do bloco.
describe("applyNpcScriptEdit — skip (sem mudança de diálogo)", () => {
  let dir: string;
  beforeEach(() => (dir = tempDir()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("dialogue/eventHandlers idênticos → skip, arquivo intocado", () => {
    writeFileSync(join(dir, "a.txt"), SIMPLE, "utf8");
    const before = readFileSync(join(dir, "a.txt"), "utf8");
    const current = baseNpc({ legacyRef: "a.txt:1" });
    const requested = { ...current, name: "Outro Nome", position: [999, 999, 0] as [number, number, number] };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("skip");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(before);
  });
});

describe("applyNpcScriptEdit — edições aceitas", () => {
  let dir: string;
  beforeEach(() => (dir = tempDir()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("fala simples (topo do corpo)", () => {
    writeFileSync(join(dir, "a.txt"), SIMPLE, "utf8");
    const current = baseNpc({ legacyRef: "a.txt:1" });
    const requested = {
      ...current,
      dialogue: current.dialogue.map((n) => (n.id === "n0" ? { ...n, text: "ola EDITADO" } : n)),
    };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("applied");
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("ola EDITADO");
    expect(fileNow).not.toContain('"ola";');
    expect(fileNow).toContain("script\tSimples\t1_M_01"); // cabeçalho intocado
  });

  it("fala dentro de if/else", () => {
    writeFileSync(join(dir, "a.txt"), IF_ELSE, "utf8");
    const parsed = parseCurrent(dir, "a.txt:1");
    const target = parsed.dialogue.find((n) => n.kind === "say" && n.text === "sim")!;
    const requested = {
      ...parsed,
      dialogue: parsed.dialogue.map((n) => (n.id === target.id ? { ...n, text: "sim EDITADO" } : n)),
    };
    const current = toNpc(parsed, "a.txt:1");
    const result = applyNpcScriptEdit(dir, current, toNpc(requested, "a.txt:1"));
    expect(result.kind).toBe("applied");
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("sim EDITADO");
    expect(fileNow).toContain('mes "nao";'); // ramo else intocado
  });

  it("fala dentro de switch(select(...))", () => {
    writeFileSync(join(dir, "a.txt"), SWITCH, "utf8");
    const parsed = parseCurrent(dir, "a.txt:1");
    const target = parsed.dialogue.find((n) => n.kind === "say" && n.text === "opcao b")!;
    const requested = {
      ...parsed,
      dialogue: parsed.dialogue.map((n) => (n.id === target.id ? { ...n, text: "opcao b EDITADA" } : n)),
    };
    const current = toNpc(parsed, "a.txt:1");
    const result = applyNpcScriptEdit(dir, current, toNpc(requested, "a.txt:1"));
    expect(result.kind).toBe("applied");
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("opcao b EDITADA");
    expect(fileNow).toContain('mes "opcao a";');
    expect(fileNow).toContain('mes "opcao c";');
  });

  it("conteúdo de event handler", () => {
    writeFileSync(join(dir, "a.txt"), WITH_HANDLER, "utf8");
    const parsed = parseCurrent(dir, "a.txt:1");
    const handler = parsed.eventHandlers.find((h) => h.label === "OnTouch_")!;
    const target = handler.dialogue.find((n) => n.kind === "say")!;
    const requested = {
      ...parsed,
      eventHandlers: parsed.eventHandlers.map((h) =>
        h.label === "OnTouch_" ? { ...h, dialogue: h.dialogue.map((n) => (n.id === target.id ? { ...n, text: "toque EDITADO" } : n)) } : h,
      ),
    };
    const current = toNpc(parsed, "a.txt:1");
    const result = applyNpcScriptEdit(dir, current, toNpc(requested, "a.txt:1"));
    expect(result.kind).toBe("applied");
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("toque EDITADO");
    expect(fileNow).toContain('mes "principal";'); // corpo principal intocado
  });

  it("múltiplos NPCs no mesmo diretório não interferem entre si", () => {
    writeFileSync(join(dir, "a.txt"), TWO_NPCS, "utf8");
    const original = readFileSync(join(dir, "a.txt"), "utf8");
    const parsedFirst = parseCurrent(dir, "a.txt:1");
    const targetFirst = parsedFirst.dialogue.find((n) => n.kind === "say")!;
    const requestedFirst = {
      ...parsedFirst,
      dialogue: parsedFirst.dialogue.map((n) => (n.id === targetFirst.id ? { ...n, text: "um EDITADO" } : n)),
    };
    const result = applyNpcScriptEdit(dir, toNpc(parsedFirst, "a.txt:1"), toNpc(requestedFirst, "a.txt:1"));
    expect(result.kind).toBe("applied");
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("um EDITADO");
    expect(fileNow).toContain('mes "dois";'); // segundo NPC do MESMO arquivo, intocado
    expect(fileNow.length).toBeGreaterThan(0);
    expect(fileNow).not.toBe(original);
  });
});

describe("applyNpcScriptEdit — recusas (zero escrita)", () => {
  let dir: string;
  beforeEach(() => (dir = tempDir()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("comentário no trecho editado → recusa, arquivo intocado", () => {
    writeFileSync(join(dir, "a.txt"), WITH_COMMENT, "utf8");
    const before = readFileSync(join(dir, "a.txt"), "utf8");
    const parsed = parseCurrent(dir, "a.txt:1");
    const target = parsed.dialogue.find((n) => n.kind === "say")!;
    const requested = { ...parsed, dialogue: parsed.dialogue.map((n) => (n.id === target.id ? { ...n, text: "editado" } : n)) };
    const result = applyNpcScriptEdit(dir, toNpc(parsed, "a.txt:1"), toNpc(requested, "a.txt:1"));
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.error).toBe("writer-refused");
      expect(result.code).toBe("comment-in-replaced-span");
    }
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(before);
  });

  it("legacyRef aponta pra linha que já não é cabeçalho de script (arquivo mudou) → recusa operacional, zero escrita", () => {
    writeFileSync(join(dir, "a.txt"), SIMPLE, "utf8");
    const before = readFileSync(join(dir, "a.txt"), "utf8");
    const current = baseNpc({ legacyRef: "a.txt:1" });
    // sobrescreve o arquivo com algo cuja linha 1 não é mais cabeçalho de script
    writeFileSync(join(dir, "a.txt"), "// mudou\n" + SIMPLE, "utf8");
    const requested = { ...current, dialogue: current.dialogue.map((n) => (n.id === "n0" ? { ...n, text: "x" } : n)) };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.error).toBe("operational");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).not.toBe(before); // mudou por FORA do sync — o teste confirma que o sync não mexeu MAIS ainda
  });

  it("arquivo mudou externamente entre a leitura do banco e o PUT (stale-source) → recusa 409, zero escrita", () => {
    writeFileSync(join(dir, "a.txt"), SIMPLE, "utf8");
    const current = baseNpc({ legacyRef: "a.txt:1" }); // "o que o banco diz que é"
    // arquivo muda por fora depois que o banco foi lido
    writeFileSync(join(dir, "a.txt"), SIMPLE.replace('mes "ola";', 'mes "ola mudou no arquivo";'), "utf8");
    const beforeWrite = readFileSync(join(dir, "a.txt"), "utf8");
    const requested = { ...current, dialogue: current.dialogue.map((n) => (n.id === "n0" ? { ...n, text: "tentativa do admin" } : n)) };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.error).toBe("stale-source");
      expect(result.httpStatus).toBe(409);
    }
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(beforeWrite);
  });

  it("NPC sem legacyRef → recusa not-editable, zero escrita possível", () => {
    const current = baseNpc({});
    const requested = { ...current, dialogue: current.dialogue.map((n) => (n.id === "n0" ? { ...n, text: "x" } : n)) };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.error).toBe("not-editable");
  });

  it("NPC de warp (sem corpo próprio) tentando mudar diálogo → recusa not-editable", () => {
    const current = baseNpc({ warp: { mapId: "geffen", position: [1, 1, 0], triggerSpan: { xs: 1, ys: 1 } }, legacyRef: "a.txt:1" });
    const requested = { ...current, dialogue: current.dialogue.map((n) => (n.id === "n0" ? { ...n, text: "x" } : n)) };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.error).toBe("not-editable");
  });

  it("falha ao ESCREVER o arquivo (alvo do write já existe como DIRETÓRIO) → recusa operacional", () => {
    // `chmodSync` não bloqueia escrita em diretório no Windows, e
    // `vi.spyOn` não consegue substituir export de `node:fs` (namespace ESM
    // não configurável). Falha de fs real e PORTÁVEL: pré-cria o caminho do
    // `.tmp` (mesma convenção de `npc-script-sync.ts`: `${absPath}.tmp`)
    // como DIRETÓRIO — `writeFileSync` nesse caminho falha com EISDIR em
    // qualquer SO, sem precisar mockar nada.
    writeFileSync(join(dir, "a.txt"), SIMPLE, "utf8");
    mkdirSync(join(dir, "a.txt.tmp"));
    const current = baseNpc({ legacyRef: "a.txt:1" });
    const requested = { ...current, dialogue: current.dialogue.map((n) => (n.id === "n0" ? { ...n, text: "x" } : n)) };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.error).toBe("operational");
  });
});

describe("rollbackAppliedWrite", () => {
  let dir: string;
  beforeEach(() => (dir = tempDir()));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("restaura os bytes originais depois de um applied", () => {
    writeFileSync(join(dir, "a.txt"), SIMPLE, "utf8");
    const original = readFileSync(join(dir, "a.txt"), "utf8");
    const current = baseNpc({ legacyRef: "a.txt:1" });
    const requested = { ...current, dialogue: current.dialogue.map((n) => (n.id === "n0" ? { ...n, text: "x" } : n)) };
    const result = applyNpcScriptEdit(dir, current, requested);
    expect(result.kind).toBe("applied");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).not.toBe(original);
    if (result.kind === "applied") rollbackAppliedWrite(result.absPath, result.previousRawText);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(original);
  });
});

// ---- helpers: parseia o .txt de verdade pra pegar o `dialogue`/`eventHandlers`
// REAIS (com os ids que o Mapper de fato atribui), em vez de inventar um
// grafo à mão que poderia divergir do que `applyNpcScriptEdit` relê internamente.
import { parseNpcScript, mapNpcScriptWithUnits } from "@ragnarok/game-data";
import { locateNpcScript } from "./npc-script-locate";

function parseCurrent(dir: string, ref: string) {
  const located = locateNpcScript(dir, ref);
  if (!located.ok) throw new Error(`locate falhou: ${located.reason}`);
  const mapped = mapNpcScriptWithUnits(parseNpcScript(located.code));
  return mapped;
}

function toNpc(mapped: ReturnType<typeof mapNpcScriptWithUnits>, legacyRef: string): Npc {
  return NpcSchema.parse({
    id: "n1",
    name: "N",
    sprite: "1_M_01",
    mapId: "prontera",
    position: [150, 150, 0],
    direction: 4,
    dialogueEntry: mapped.dialogueEntry,
    dialogue: mapped.dialogue,
    eventHandlers: mapped.eventHandlers,
    legacyRef,
  });
}
