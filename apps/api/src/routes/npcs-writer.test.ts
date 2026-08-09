import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../server";
import { JsonNpcRepository } from "../store/json-npc-repository";
import { parseNpcScript, mapNpcScriptWithUnits, type Npc, type DialogueNode } from "@ragnarok/game-data";

/**
 * Testes de integração do PUT /npcs/:id com o Writer real (leia1.txt,
 * integração Writer↔Admin, 2026-08-08). Usa arquivos `.txt` TEMPORÁRIOS —
 * nunca `rathena/` — como o próprio leia1.txt exige pros testes
 * automatizados. `npcScriptRoot` aponta pra um `mkdtempSync` novo por teste.
 */

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

const WITH_LEGACY_NEIGHBOR = `prontera,150,150,4\tscript\tComLegacyVizinho\t1_M_01,{
\tmes "editavel";
\tcutin "some_cutin",0;
\tclose;
}
`;

const WITH_COMMENT = `prontera,150,150,4\tscript\tComComentario\t1_M_01,{
\t// comentario que nao pode sumir
\tmes "ola";
\tclose;
}
`;

function parseFile(dir: string, fileName: string, code: string, ref: string) {
  writeFileSync(join(dir, fileName), code, "utf8");
  const mapped = mapNpcScriptWithUnits(parseNpcScript(extractBody(code)));
  return { mapped, ref: `${fileName}:1` === ref ? ref : ref };
}

// extrai só o corpo `{...}` do fixture (mesma forma que `locateNpcScript`
// devolveria) — os fixtures acima têm cabeçalho numa linha só, corpo
// começando logo depois do primeiro `{`.
function extractBody(code: string): string {
  const start = code.indexOf("{") + 1;
  const end = code.lastIndexOf("}");
  return code.slice(start, end);
}

function npcFrom(mapped: ReturnType<typeof mapNpcScriptWithUnits>, id: string, legacyRef: string, extra: Partial<Npc> = {}): Npc {
  return {
    id,
    name: id,
    sprite: "1_M_01",
    mapId: "prontera",
    position: [150, 150, 0],
    direction: 4,
    dialogueEntry: mapped.dialogueEntry,
    dialogue: mapped.dialogue,
    eventHandlers: mapped.eventHandlers,
    questTriggers: [],
    questBoard: [],
    legacyRef,
    ...extra,
  } as Npc;
}

function editSay(dialogue: DialogueNode[], oldText: string, newText: string): DialogueNode[] {
  return dialogue.map((n) => (n.kind === "say" && n.text === oldText ? { ...n, text: newText } : n));
}

describe("PUT /npcs/:id — integração real com o Writer (arquivo temporário)", () => {
  let dir: string;
  let app: FastifyInstance;
  let jsonPath: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "npc-writer-route-test-"));
    jsonPath = join(tmpdir(), `npcs-writer-route-${Date.now()}-${Math.random()}.json`);
    app = await buildServer({
      npcRepository: new JsonNpcRepository(jsonPath),
      security: null,
      npcScriptRoot: dir,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("1/2. PUT sem alteração de diálogo (só campos DB-only) → 200, arquivo intocado", async () => {
    const { mapped } = parseFile(dir, "a.txt", SIMPLE, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });
    const fileBefore = readFileSync(join(dir, "a.txt"), "utf8");

    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: { ...npc, name: "Outro Nome", position: [1, 2, 0] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Outro Nome");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(fileBefore);
  });

  it("3. PUT alterando fala simples → 200, arquivo E banco atualizados", async () => {
    const { mapped } = parseFile(dir, "a.txt", SIMPLE, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    const edited = { ...npc, dialogue: editSay(npc.dialogue, "ola", "ola EDITADO") };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(200);
    expect(res.json().dialogue.find((n: DialogueNode) => n.kind === "say").text).toBe("ola EDITADO");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toContain("ola EDITADO");

    const get = await app.inject({ method: "GET", url: "/npcs/n1" });
    expect(get.json().dialogue.find((n: DialogueNode) => n.kind === "say").text).toBe("ola EDITADO");
  });

  it("4. PUT alterando fala dentro de if/else → 200", async () => {
    const { mapped } = parseFile(dir, "a.txt", IF_ELSE, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    const edited = { ...npc, dialogue: editSay(npc.dialogue, "sim", "sim EDITADO") };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(200);
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("sim EDITADO");
    expect(fileNow).toContain('mes "nao";');
  });

  it("5. PUT alterando fala dentro de switch/select → 200", async () => {
    const { mapped } = parseFile(dir, "a.txt", SWITCH, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    const edited = { ...npc, dialogue: editSay(npc.dialogue, "opcao b", "opcao b EDITADA") };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(200);
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("opcao b EDITADA");
    expect(fileNow).toContain('mes "opcao a";');
    expect(fileNow).toContain('mes "opcao c";');
  });

  it("6. PUT alterando conteúdo de event handler → 200", async () => {
    const { mapped } = parseFile(dir, "a.txt", WITH_HANDLER, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    const edited = {
      ...npc,
      eventHandlers: npc.eventHandlers.map((h) => (h.label === "OnTouch_" ? { ...h, dialogue: editSay(h.dialogue, "toque", "toque EDITADO") } : h)),
    };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(200);
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("toque EDITADO");
    expect(fileNow).toContain('mes "principal";');
  });

  it("7. Writer recusa (comentário no trecho) → 422, ZERO alteração no banco e no arquivo", async () => {
    const { mapped } = parseFile(dir, "a.txt", WITH_COMMENT, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });
    const fileBefore = readFileSync(join(dir, "a.txt"), "utf8");

    const edited = { ...npc, dialogue: editSay(npc.dialogue, "ola", "ola EDITADO"), name: "Nome Que Não Deveria Salvar" };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("writer-refused");
    expect(res.json().code).toBe("comment-in-replaced-span");

    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(fileBefore);
    const get = await app.inject({ method: "GET", url: "/npcs/n1" });
    expect(get.json().name).toBe("n1"); // não "Nome Que Não Deveria Salvar" — nada foi persistido
  });

  it("8. validação do body (zod) falhando → 400, Writer NUNCA chamado, zero escrita no .txt", async () => {
    const { mapped } = parseFile(dir, "a.txt", SIMPLE, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });
    const fileBefore = readFileSync(join(dir, "a.txt"), "utf8");

    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: { ...npc, direction: "not-a-number" } });
    expect(res.statusCode).toBe(400);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(fileBefore);
  });

  it("9. escrita do .txt falhando (alvo do write já existe como diretório) → 500 operacional, ZERO alteração no banco", async () => {
    // `chmodSync` não bloqueia escrita em diretório no Windows, e `vi.spyOn`
    // não substitui export de `node:fs` (namespace ESM não configurável) —
    // falha de fs real e portável: pré-cria "a.txt.tmp" como diretório.
    const { mapped } = parseFile(dir, "a.txt", SIMPLE, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    mkdirSync(join(dir, "a.txt.tmp"));
    const edited = { ...npc, dialogue: editSay(npc.dialogue, "ola", "ola EDITADO"), name: "Nao Deveria Salvar" };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("operational");

    const get = await app.inject({ method: "GET", url: "/npcs/n1" });
    expect(get.json().name).toBe("n1");
  });

  it("10. .txt alterado externamente depois do carregamento → 409 stale-source, zero escrita", async () => {
    const { mapped } = parseFile(dir, "a.txt", SIMPLE, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    // arquivo muda por FORA depois que o "estado carregado" (o registro
    // criado acima) já reflete a versão antiga.
    writeFileSync(join(dir, "a.txt"), SIMPLE.replace('mes "ola";', 'mes "ola mudou por fora";'), "utf8");
    const fileBefore = readFileSync(join(dir, "a.txt"), "utf8");

    const edited = { ...npc, dialogue: editSay(npc.dialogue, "ola", "tentativa do admin") };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("stale-source");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(fileBefore);
  });

  it("11. múltiplos NPCs (arquivos diferentes) não interferem entre si", async () => {
    const a = parseFile(dir, "a.txt", SIMPLE, "a.txt:1");
    const b = parseFile(dir, "b.txt", IF_ELSE, "b.txt:1");
    const npcA = npcFrom(a.mapped, "na", "a.txt:1");
    const npcB = npcFrom(b.mapped, "nb", "b.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npcA });
    await app.inject({ method: "POST", url: "/npcs", payload: npcB });

    const editedA = { ...npcA, dialogue: editSay(npcA.dialogue, "ola", "A EDITADO") };
    const resA = await app.inject({ method: "PUT", url: "/npcs/na", payload: editedA });
    expect(resA.statusCode).toBe(200);

    expect(readFileSync(join(dir, "a.txt"), "utf8")).toContain("A EDITADO");
    expect(readFileSync(join(dir, "b.txt"), "utf8")).toContain('mes "sim";'); // b.txt intocado

    const editedB = { ...npcB, dialogue: editSay(npcB.dialogue, "sim", "B EDITADO") };
    const resB = await app.inject({ method: "PUT", url: "/npcs/nb", payload: editedB });
    expect(resB.statusCode).toBe(200);

    expect(readFileSync(join(dir, "b.txt"), "utf8")).toContain("B EDITADO");
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toContain("A EDITADO"); // a.txt não voltou atrás
  });

  it("12. no-op (PUT devolvendo o mesmo diálogo) é byte-a-byte idêntico no arquivo", async () => {
    const { mapped } = parseFile(dir, "a.txt", SWITCH, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });
    const fileBefore = readFileSync(join(dir, "a.txt"), "utf8");

    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: npc });
    expect(res.statusCode).toBe(200);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(fileBefore);
  });

  it("13. legacyScript vizinho (cutin) continua preservado depois de editar a fala ao lado", async () => {
    const { mapped } = parseFile(dir, "a.txt", WITH_LEGACY_NEIGHBOR, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    const edited = { ...npc, dialogue: editSay(npc.dialogue, "editavel", "editavel MUDOU") };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(200);
    const fileNow = readFileSync(join(dir, "a.txt"), "utf8");
    expect(fileNow).toContain("editavel MUDOU");
    expect(fileNow).toContain('cutin "some_cutin",0;');
  });

  it("14. comentário no trecho → sempre recusa quando o nó com comentário é editado (código já coberto no teste 7); aqui confirma que EDITAR outro nó no MESMO arquivo, sem comentário no trecho dele, funciona normalmente", async () => {
    // "next;" entre as duas falas é o que impede o Mapper de juntar as duas
    // num só nó "a\nb" (mes consecutivo sem next/close vira UM say só,
    // achado ao rodar este teste da primeira vez) — com "next;" cada mes
    // vira nó PRÓPRIO, e só o de "a" carrega o comentário no span dele.
    const code = `prontera,150,150,4\tscript\tDuasFalas\t1_M_01,{
\t// comentario perto da primeira fala
\tmes "a";
\tnext;
\tmes "b";
\tclose;
}
`;
    writeFileSync(join(dir, "a.txt"), code, "utf8");
    const mapped = mapNpcScriptWithUnits(parseNpcScript(extractBody(code)));
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    // "b" não tem comentário no span dela (o comentário está colado em "a")
    const edited = { ...npc, dialogue: editSay(npc.dialogue, "b", "b EDITADO") };
    const res = await app.inject({ method: "PUT", url: "/npcs/n1", payload: edited });
    expect(res.statusCode).toBe(200);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toContain("b EDITADO");
  });

  it("15. respostas de erro têm discriminante 'error' distinto por motivo (não mascaram falha como sucesso)", async () => {
    const { mapped } = parseFile(dir, "a.txt", WITH_COMMENT, "a.txt:1");
    const npc = npcFrom(mapped, "n1", "a.txt:1");
    await app.inject({ method: "POST", url: "/npcs", payload: npc });

    const refused = await app.inject({
      method: "PUT",
      url: "/npcs/n1",
      payload: { ...npc, dialogue: editSay(npc.dialogue, "ola", "x") },
    });
    expect(refused.json().error).toBe("writer-refused");

    writeFileSync(join(dir, "a.txt"), WITH_COMMENT.replace('mes "ola";', 'mes "ola mudou";'), "utf8");
    const stale = await app.inject({
      method: "PUT",
      url: "/npcs/n1",
      payload: { ...npc, dialogue: editSay(npc.dialogue, "ola", "y") },
    });
    expect(stale.json().error).toBe("stale-source");

    expect(refused.json().error).not.toBe(stale.json().error);
  });
});
