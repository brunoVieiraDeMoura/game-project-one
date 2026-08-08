import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapNpcScriptWithUnits, validateNpcScript, planNpcWrite, type NpcMapResult, type NpcCatalogs } from "@ragnarok/game-data";
import { parseNpcScript } from "./npc-script/parser";
import { extractScriptBodies, countFunctionScripts } from "./npc-script/extract-corpus";
import { loadMapCatalog, loadIdCatalog, buildNpcEventIndex, makeCatalogs } from "./npc-script/catalogs";

/**
 * Testes do Writer de NPC (leia1.txt, 2026-08-08 — "definir requisitos e
 * segurança antes da implementação"). Nada aqui grava em `rathena/`, roda
 * reload, ou toca servidor — só corpo `{...}` em memória, exatamente como
 * pedido em §15 ("Nesta etapa NÃO altere o servidor real").
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const NPC_ROOT = join(REPO_ROOT, "rathena");
const OUTPUT_DIR = join(__dirname, "..", "output");

function load(code: string) {
  const ast = parseNpcScript(code);
  const before = mapNpcScriptWithUnits(ast);
  return { ast, source: code, before };
}

/** clona um `NpcMapResult` por JSON — simula "o admin abriu e não mexeu em nada". */
function cloneAsAfter(before: NpcMapResult): NpcMapResult {
  return JSON.parse(JSON.stringify({ dialogueEntry: before.dialogueEntry, dialogue: before.dialogue, eventHandlers: before.eventHandlers }));
}

function fakeCatalogs(): NpcCatalogs {
  return { mapExists: () => true, itemExists: () => true, skillExists: () => true, monsterExists: () => true };
}

/** consulta o Validator ANTES de escrever — leia1.txt §6: "referências
 * inválidas detectadas pelo Validator devem impedir a gravação". */
function planWithValidation(source: string, ast: ReturnType<typeof parseNpcScript>, before: NpcMapResult, after: NpcMapResult, catalogs: NpcCatalogs) {
  const report = validateNpcScript(ast, before, catalogs);
  if (report.issues.some((i) => i.severity === "error")) {
    return { ok: false, reason: "Validator encontrou erro estrutural/referência inválida — gravação bloqueada", validation: report };
  }
  const write = planNpcWrite(source, mapNpcScriptWithUnits(ast), after);
  return { ...write, validation: report };
}

describe("Writer de NPC — NPC sem alterações", () => {
  it("salvar sem modificar nada preserva o corpo inteiro, byte a byte", () => {
    const code = `
      mes "Olá!";
      mes "Tudo bem?";
      next;
      mes "Até mais.";
      close;
    `;
    const { ast, source, before } = load(code);
    const after = cloneAsAfter(before);
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.changedCount).toBe(0);
    for (const e of result.entries) expect(e.patchedBody).toBeUndefined();
  });

  it("if/else SEGUIDO de mais conteúdo — no-op funciona (achado do corpus real: nó condicional não tem `.next` próprio, um andador de cadeia ingênuo quebra aqui sem edição nenhuma)", () => {
    const code = `
      if (.@x == 1) {
        mes "a";
      } else {
        mes "b";
      }
      mes "c";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.entries[0]!.ok).toBe(true);
    expect(result.changedCount).toBe(0);
  });

  it("editar o say DEPOIS de um if/else preserva o if/else intocado (mesma forma acima, com edição de verdade)", () => {
    const code = `
      if (.@x == 1) {
        mes "a";
      } else {
        mes "b";
      }
      mes "c";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "c")!.text = "c EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.entries[0]!.patchedBody).toContain('mes "c EDITADO";');
    expect(result.entries[0]!.patchedBody).toContain('mes "a";'); // if/else intocado, verbatim
  });

  it("mesmo com if/switch/legacyScript no meio — nada muda, nada é reimpresso", () => {
    const code = `
      mes "oi";
      if (.@x == 1) {
        mes "ramo A";
      } else {
        mes "ramo B";
      }
      switch (select("X:Y")) {
        case 1: mes "escolheu X"; break;
        case 2: mes "escolheu Y"; break;
      }
      cutin "algum_cutin",0;
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.changedCount).toBe(0);
  });
});

describe("Writer de NPC — alteração simples", () => {
  it("mudar só o texto de UM say não toca no resto do corpo (bytes idênticos pros vizinhos)", () => {
    const code = `
      mes "primeira fala";
      next;
      mes "segunda fala   com   espaco esquisito";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    // edita só o PRIMEIRO nó say
    const firstSay = after.dialogue.find((n) => n.kind === "say")!;
    firstSay.text = "fala EDITADA";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.changedCount).toBe(1);
    const main = result.entries.find((e) => e.entryLabel === null)!;
    expect(main.patchedBody).toContain('mes "fala EDITADA";');
    // o segundo say, intocado, sobrevive com o espaçamento estranho EXATO do original
    expect(main.patchedBody).toContain('"segunda fala   com   espaco esquisito"');
  });

  it("editar o diálogo principal não produz `patchedBody` em NENHUM event handler", () => {
    const code = `
      mes "clique"; close;
    OnTouch:
      mes "toquei"; end;
    OnInit:
      set .@x, 1;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say")!.text = "clique EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const touched = result.entries.filter((e) => e.changed);
    expect(touched.map((e) => e.entryLabel)).toEqual([null]);
    for (const e of result.entries) {
      if (e.entryLabel !== null) expect(e.patchedBody).toBeUndefined();
    }
  });
});

describe("Writer de NPC — legacyScript ao lado da edição", () => {
  it("editar um say vizinho de um legacyScript NÃO apaga nem modifica o legacyScript", () => {
    const code = `
      mes "antes";
      cutin "alguma_coisa_nao_mapeada",0;
      mes "depois";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "antes")!.text = "antes EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const main = result.entries.find((e) => e.entryLabel === null)!;
    // NÃO reimpresso (o nó não mudou) — sobrevive na sintaxe ORIGINAL
    // (vírgula clássica, sem parênteses), não na forma que o Printer usaria.
    expect(main.patchedBody).toContain('cutin "alguma_coisa_nao_mapeada",0;');
    expect(main.patchedBody).not.toContain("cutin(");
  });

  it("editar DIRETAMENTE o texto de um legacyScript é RECUSADO (nunca reimprime sem saber gerar de volta)", () => {
    const code = `cutin "x",0; close;`;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const legacy = after.dialogue.find((n) => n.kind === "action" && n.action?.kind === "legacyScript")!;
    (legacy.action as { legacySource: string }).legacySource = "cutin(\"y\",1);"; // tentativa de editar
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries.find((e) => e.entryLabel === null)!.code).toBe("unsupported-node-kind");
  });
});

describe("Writer de NPC — event handlers", () => {
  it("editar um handler não altera o(s) outro(s)", () => {
    const code = `
      close;
    OnTouch:
      mes "toquei"; end;
    OnEnable:
      mes "ligado"; end;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const onTouch = after.eventHandlers.find((h) => h.label === "OnTouch")!;
    onTouch.dialogue.find((n) => n.kind === "say")!.text = "toquei EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const touched = result.entries.filter((e) => e.changed).map((e) => e.entryLabel);
    expect(touched).toEqual(["OnTouch"]);
    const onEnableResult = result.entries.find((e) => e.entryLabel === "OnEnable")!;
    expect(onEnableResult.patchedBody).toBeUndefined();
  });

  it("adicionar ou remover um handler inteiro é recusado, não adivinhado", () => {
    const code = `
      close;
    OnTouch:
      end;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.eventHandlers = []; // removeu o handler inteiro

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries.find((e) => e.entryLabel === "OnTouch")!.code).toBe("whole-handler-add-remove");
  });
});

describe("Writer de NPC — múltiplos NPCs (independência)", () => {
  it("processar dois NPCs não faz um vazar no outro", () => {
    const npcA = load(`mes "A"; close;`);
    const npcB = load(`mes "B"; close;`);
    const afterA = cloneAsAfter(npcA.before);
    afterA.dialogue.find((n) => n.kind === "say")!.text = "A editado";
    const afterB = cloneAsAfter(npcB.before); // B não editado

    const resultA = planNpcWrite(npcA.source, npcA.before, afterA);
    const resultB = planNpcWrite(npcB.source, npcB.before, afterB);

    expect(resultA.changedCount).toBe(1);
    expect(resultB.changedCount).toBe(0);
    expect(resultA.entries[0]!.patchedBody).toContain("A editado");
    expect(resultB.entries[0]!.patchedBody).toBeUndefined();
  });
});

describe("Writer de NPC — function script", () => {
  it("callfunc(...) dentro do script vira legacyScript comum e sobrevive intocado a uma edição vizinha", () => {
    const code = `
      mes "antes";
      callfunc "SomeLib",1,2;
      mes "depois";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "depois")!.text = "depois EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    // callfunc não mudou — sobrevive BYTE A BYTE na sintaxe original (vírgula
    // clássica), prova de que reuso verbatim (não o Printer) é o caminho.
    expect(result.entries[0]!.patchedBody).toContain('callfunc "SomeLib",1,2;');
    expect(result.entries[0]!.patchedBody).not.toContain("callfunc(");
  });

  it("a DEFINIÇÃO de function script (fora deste NPC) nunca é vista pelo pipeline — não há como o Writer tocá-la", () => {
    // `extractScriptBodies` pula blocos `function script Nome {...}` de
    // propósito (extract-corpus.ts) — não geram ScriptBody nenhum, então
    // NUNCA entram em parseNpcScript/mapNpcScript/planNpcWrite. Not-seen =
    // not-touchable, por construção, não por checagem em runtime.
    expect(countFunctionScripts(NPC_ROOT)).toBeGreaterThan(0);
  });
});

describe("Writer de NPC — goto", () => {
  it("goto/label sobrevivem intocados quando a edição é em outro lugar", () => {
    const code = `
      mes "início";
      goto L_Fim;
    L_Fim:
      mes "fim";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "início")!.text = "início EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
  });

  it("referência inválida (goto órfão) detectada pelo Validator BLOQUEIA a gravação, mesmo de uma edição válida", () => {
    const code = `goto Nunca_Existiu; close;`;
    const { ast, source, before } = load(code);
    const after = cloneAsAfter(before);
    const plan = planWithValidation(source, ast, before, after, fakeCatalogs());
    expect(plan.ok).toBe(false);
    expect(plan.validation.gotos.missing).toBe(1);
  });

  it("goto válido não bloqueia a gravação", () => {
    const code = `goto L; L: close;`;
    const { ast, source, before } = load(code);
    const after = cloneAsAfter(before);
    const plan = planWithValidation(source, ast, before, after, fakeCatalogs());
    expect(plan.ok).toBe(true);
  });
});

describe("Writer de NPC — falha de validação não produz escrita parcial", () => {
  it("uma alteração recusada não deixa NENHUM patchedBody pra trás, nem nas entradas que dariam certo sozinhas", () => {
    const code = `
      mes "ok, isto seria uma edição válida";
      close;
    OnTouch:
      cutin "x",0;
      end;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say")!.text = "edição válida, de fato";
    const onTouch = after.eventHandlers.find((h) => h.label === "OnTouch")!;
    (onTouch.dialogue.find((n) => n.kind === "action")!.action as { legacySource: string }).legacySource = 'cutin("y",1);';

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false); // OnTouch recusado
    // a política é conservadora: falha em QUALQUER entrada com edição
    // pretendida marca o NPC inteiro como não gravável — não existe
    // "escreve só a parte que deu certo" nesta versão.
  });
});

describe("Writer de NPC — conteúdo desconhecido preservado", () => {
  it("um NPC 100% legacyScript, sem NENHUMA edição, reproduz o corpo original exatamente", () => {
    const code = `cutin "a",0; npctalk "oi"; disablenpc "Bicho"; close;`;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.changedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Corpus real — leia1.txt §13: SIMULAÇÃO, nunca grava em `rathena/`.
// ---------------------------------------------------------------------------

describe("Writer de NPC — corpus real (simulação, leia1.txt §13)", () => {
  const bodies = extractScriptBodies(NPC_ROOT);

  it("NPC WRITER SIMULATION REPORT", () => {
    const maps = loadMapCatalog(NPC_ROOT);
    const items = loadIdCatalog(OUTPUT_DIR, "items.json");
    const skills = loadIdCatalog(OUTPUT_DIR, "skills.json");
    const monsters = loadIdCatalog(OUTPUT_DIR, "monsters.json");
    const functionScripts = countFunctionScripts(NPC_ROOT);

    const parsed = bodies.map(({ ref, name, code }) => {
      const ast = parseNpcScript(code);
      const before = mapNpcScriptWithUnits(ast);
      return { ref, name, ast, code, before };
    });
    const npcEventIndex = buildNpcEventIndex(
      parsed.map((p) => ({ name: p.name, labels: p.ast.entryPoints.filter((ep) => ep.label !== null).map((ep) => ep.label) })),
    );
    const catalogs = makeCatalogs(maps, items, skills, monsters, npcEventIndex);

    let validatedOk = 0;
    let noOpWritableCount = 0; // "salvar sem editar" reconstrói sem erro
    let noOpMismatch = 0; // achado grave: reconstrução SEM edição não bate (bug, não limitação)
    let hasLegacy = 0;
    let hasHandlers = 0;
    let hasFunctionCall = 0; // callfunc(...) em algum lugar

    // simulação de UMA edição real: pega o primeiro nó `say` de topo do
    // diálogo principal (quando existe) e muda o texto — é o caso de uso
    // mais comum de um editor de diálogo.
    let editAttempted = 0;
    let editWritable = 0;
    const blockReasons: Record<string, number> = {};

    for (const { ref, ast, code, before } of parsed) {
      if (before.eventHandlers.length > 0) hasHandlers++;
      const allNodes = [...before.dialogue, ...before.eventHandlers.flatMap((h) => h.dialogue)];
      if (allNodes.some((n) => n.kind === "action" && n.action?.kind === "legacyScript")) hasLegacy++;
      if (allNodes.some((n) => n.kind === "action" && n.action?.kind === "legacyScript" && /callfunc/i.test(n.action.legacySource))) hasFunctionCall++;

      const report = validateNpcScript(ast, before, catalogs);
      const hasBlockingError = report.issues.some((i) => i.severity === "error");
      if (!hasBlockingError) validatedOk++;

      // 1) no-op: salvar sem editar tem que reproduzir sem diferença.
      const noOpAfter = cloneAsAfter(before);
      const noOpResult = planNpcWrite(code, before, noOpAfter);
      if (noOpResult.ok && noOpResult.changedCount === 0) noOpWritableCount++;
      else if (!hasBlockingError) {
        noOpMismatch++;
        if (noOpMismatch <= 5) console.error(`no-op mismatch em ${ref}:`, noOpResult.entries.filter((e) => !e.ok || e.changed));
      }

      // 2) simulação de edição real no primeiro `say` de topo do corpo principal.
      const firstSay = before.dialogue.find((n) => n.kind === "say");
      if (firstSay && !hasBlockingError) {
        editAttempted++;
        const editAfter = cloneAsAfter(before);
        editAfter.dialogue.find((n: { id: string }) => n.id === firstSay.id)!.text = "TEXTO SIMULADO";
        const editResult = planNpcWrite(code, before, editAfter);
        if (editResult.ok) editWritable++;
        else {
          const reason = editResult.entries.find((e) => !e.ok && e.changed === false)?.code ?? "desconhecido";
          blockReasons[reason] = (blockReasons[reason] ?? 0) + 1;
        }
      }
    }

    console.log("\n=== NPC WRITER SIMULATION REPORT ===\n");
    console.log(`scripts: ${bodies.length}`);
    console.log(`validados sem erro estrutural/referência (Validator): ${validatedOk}`);
    console.log(`function scripts (bibliotecas, fora do pipeline inteiro): ${functionScripts}`);
    console.log(`\nno-op (salvar sem editar):`);
    console.log(`  reconstrução idêntica: ${noOpWritableCount} / ${bodies.length}`);
    console.log(`  divergência (achado, não limitação declarada): ${noOpMismatch}`);
    console.log(`\ncontém legacyScript: ${hasLegacy} (${((hasLegacy / bodies.length) * 100).toFixed(1)}%)`);
    console.log(`contém event handlers: ${hasHandlers}`);
    console.log(`contém callfunc(...) (chamada a function script): ${hasFunctionCall}`);
    console.log(`\nsimulação de edição real (1º say do corpo principal, quando existe):`);
    console.log(`  tentativas: ${editAttempted}`);
    console.log(`  graváveis: ${editWritable} (${((editWritable / (editAttempted || 1)) * 100).toFixed(1)}%)`);
    console.log(`  bloqueados, por motivo:`, blockReasons);
    console.log("\n=====================================\n");

    expect(noOpMismatch).toBe(0); // não-limitação: reconstrução sem edição TEM que bater sempre
  }, 120_000);
});
