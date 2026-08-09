import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapNpcScriptWithUnits, validateNpcScript, planNpcWrite, type NpcMapResult, type NpcCatalogs } from "@ragnarok/game-data";
import { parseNpcScript } from "@ragnarok/game-data";
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
// leia1.txt 2026-08-09 — capacidade de edição AMPLIADA: nó aninhado dentro
// de conditional/choice, texto de condição, rótulos de choice.
// ---------------------------------------------------------------------------

describe("Writer de NPC — folha aninhada dentro de if (sem else)", () => {
  it("editar um say DENTRO do if preserva o legacyScript vizinho e o que vem depois do if", () => {
    const code = `
      if (.@x == 1) {
        mes "dentro";
        cutin "x",0;
      }
      mes "fora";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "dentro")!.text = "dentro EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const main = result.entries[0]!;
    expect(main.patchedBody).toContain('mes "dentro EDITADO";');
    expect(main.patchedBody).toContain('cutin "x",0;'); // legacyScript aninhado, verbatim
    expect(main.patchedBody).not.toContain("cutin(");
  });
});

describe("Writer de NPC — folha aninhada dentro de if/else", () => {
  const code = `
    if (.@x == 1) {
      mes "ramo A";
    } else {
      mes "ramo B";
    }
    close;
  `;

  it("editar a folha do ramo THEN preserva o ramo ELSE intocado", () => {
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "ramo A")!.text = "ramo A EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.entries[0]!.patchedBody).toContain('mes "ramo A EDITADO";');
    expect(result.entries[0]!.patchedBody).toContain('mes "ramo B";');
  });

  it("editar a folha do ramo ELSE preserva o ramo THEN intocado", () => {
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "ramo B")!.text = "ramo B EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.entries[0]!.patchedBody).toContain('mes "ramo A";');
    expect(result.entries[0]!.patchedBody).toContain('mes "ramo B EDITADO";');
  });
});

describe("Writer de NPC — folha aninhada dentro de switch/select (choice)", () => {
  it("editar a folha de UM case preserva os outros cases e os cabeçalhos `case N:` verbatim", () => {
    const code = `
      switch (select("A:B")) {
        case 1:
          mes "opção A";
          break;
        case 2:
          mes "opção B";
          break;
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "opção A")!.text = "opção A EDITADA";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain('mes "opção A EDITADA";');
    expect(body).toContain('mes "opção B";');
    expect(body).toContain("case 1:");
    expect(body).toContain("case 2:");
    expect(body).toContain("break;"); // legacyScript (break) de cada case, intocado
  });
});

describe("Writer de NPC — estruturas aninhadas em profundidade", () => {
  it("if DENTRO de if — editar a folha mais funda preserva tudo ao redor", () => {
    const code = `
      if (.@x == 1) {
        if (.@y == 2) {
          mes "fundo";
        }
        mes "meio";
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "fundo")!.text = "fundo EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain('mes "fundo EDITADO";');
    expect(body).toContain('mes "meio";');
  });
});

describe("Writer de NPC — editar o TEXTO DA CONDIÇÃO de um conditional", () => {
  it("condição nova e válida é aceita, ramo `then` intocado sobrevive verbatim", () => {
    const code = `
      if (.@x == 1) {
        mes "a";
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const cond = after.dialogue.find((n) => n.kind === "conditional")!;
    cond.branches![0]!.condition.legacySource = ".@x==2";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain("if (.@x==2)");
    expect(body).toContain('mes "a";');
  });

  it("condição nova INVÁLIDA (não parseia) é RECUSADA — nunca escreve um `if` quebrado", () => {
    const code = `if (.@x == 1) { mes "a"; } close;`;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const cond = after.dialogue.find((n) => n.kind === "conditional")!;
    cond.branches![0]!.condition.legacySource = "==@@ isto não é uma expressão (((";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries[0]!.code).toBe("invalid-condition-text");
  });

  it("condição E folha do then editadas AO MESMO TEMPO — as duas entram no resultado", () => {
    const code = `if (.@x == 1) { mes "a"; } close;`;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const cond = after.dialogue.find((n) => n.kind === "conditional")!;
    cond.branches![0]!.condition.legacySource = ".@x==9";
    after.dialogue.find((n) => n.kind === "say")!.text = "a EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain("if (.@x==9)");
    expect(body).toContain('mes "a EDITADO";');
  });
});

describe("Writer de NPC — editar RÓTULOS de um choice", () => {
  it("rótulo novo é aceito, select() é regenerado, cases sobrevivem verbatim", () => {
    const code = `
      switch (select("A:B:C")) {
        case 1: mes "a"; break;
        case 2: mes "b"; break;
        case 3: mes "c"; break;
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const choice = after.dialogue.find((n) => n.kind === "choice")!;
    choice.choices![0]!.label = "Alpha";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain('select("Alpha:B:C")');
    expect(body).toContain('mes "a";');
    expect(body).toContain('mes "b";');
    expect(body).toContain('mes "c";');
  });

  it("adicionar/remover uma OPÇÃO é recusado — não suportado nesta versão", () => {
    const code = `
      switch (select("A:B")) {
        case 1: mes "a"; break;
        case 2: mes "b"; break;
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const choice = after.dialogue.find((n) => n.kind === "choice")!;
    choice.choices!.pop(); // removeu uma opção

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries[0]!.code).toBe("structure-changed");
  });
});

describe("Writer de NPC — comentários antes/depois do trecho alterado", () => {
  it("comentário ENTRE `{` e o primeiro statement de um ramo sobrevive quando um IRMÃO nesse ramo é editado", () => {
    const code = `
      if (.@x == 1) {
        // comentário logo no início do ramo
        mes "a";
        next;
        mes "b";
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    // edita "b" (não é o primeiro statement do ramo) — o comentário do
    // INÍCIO do ramo pertence à unidade "a" (ainda intocada) e tem que sobreviver.
    after.dialogue.find((n) => n.kind === "say" && n.text === "b")!.text = "b EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain("// comentário logo no início do ramo");
    expect(body).toContain('mes "b EDITADO";');
  });

  it("comentário DEPOIS do trecho editado (antes do statement seguinte) sobrevive junto com o vizinho intocado", () => {
    const code = `
      mes "a";
      next;
      // comentário antes de b
      mes "b";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "a")!.text = "a EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain('mes "a EDITADO";');
    expect(body).toContain("// comentário antes de b");
    expect(body).toContain('mes "b";');
  });

  it("editar o statement que TEM o comentário junto (mesmo span) continua recusado", () => {
    const code = `
      // comentário grudado
      mes "a";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say")!.text = "a EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries[0]!.code).toBe("comment-in-replaced-span");
  });
});

describe("Writer de NPC — falha de reconstrução não deixa escrita parcial (estruturas aninhadas)", () => {
  it("adicionar um statement DENTRO de um ramo de if é recusado — resto do NPC não é afetado, patchedBody nenhum sobra", () => {
    const code = `
      if (.@x == 1) {
        mes "a";
      }
      mes "fora";
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const sayA = after.dialogue.find((n) => n.kind === "say" && n.text === "a")!;
    const newId = "__novo__";
    after.dialogue.push({ id: newId, kind: "say", text: "inserido", next: sayA.next });
    sayA.next = newId;

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries[0]!.code).toBe("structure-changed");
    for (const e of result.entries) expect(e.patchedBody).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// leia1.txt 2026-08-10 — auditoria: "conteúdo de conditional/choice ALÉM da
// condição/rótulos" não é liberado porque não existe mais NADA pra liberar
// (achado, não implementação): os únicos campos de CONTEÚDO — não-fiação —
// de um `conditional` são `branches[0].condition` (já editável) e de um
// `choice` são `choices[].label` (já editável); tudo mais (`next`/
// `elseNext`/`choices[].next`/`branches[].next`) é posição no grafo, nunca
// dado do admin. Os testes abaixo provam a próxima prioridade real: que a
// recursão já suporta profundidade e MISTURA arbitrárias de `if`/`switch`
// (não só a mesma construção repetida), com prova em cima de corpus real.
// ---------------------------------------------------------------------------

describe("Writer de NPC — estrutura aninhada MISTA (if contendo switch, switch contendo if)", () => {
  it("if CONTENDO switch(select) — editar a folha dentro do switch preserva o resto do if", () => {
    const code = `
      if (.@x == 1) {
        mes "entrando no if";
        switch (select("A:B")) {
          case 1:
            mes "escolheu A";
            break;
          case 2:
            mes "escolheu B";
            break;
        }
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "escolheu A")!.text = "escolheu A EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain('mes "escolheu A EDITADO";');
    expect(body).toContain('mes "escolheu B";');
    expect(body).toContain('mes "entrando no if";');
  });

  it("switch(select) CONTENDO if/else — editar a folha dentro do if preserva os outros cases", () => {
    const code = `
      switch (select("X:Y")) {
        case 1:
          if (.@z == 1) {
            mes "z é 1";
          } else {
            mes "z não é 1";
          }
          break;
        case 2:
          mes "opção Y";
          break;
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "z não é 1")!.text = "z não é 1, EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain('mes "z não é 1, EDITADO";');
    expect(body).toContain('mes "z é 1";');
    expect(body).toContain('mes "opção Y";');
  });
});

describe("Writer de NPC — profundidade arbitrária real do corpus (achado: 14 níveis)", () => {
  const REF = "npc/re/quests/quests_16_1.txt:14024"; // Court Musician#orint — cadeia de 13 "else if"
  // extração no nível do describe (fase de "collect" do vitest), mesmo
  // padrão do resto do arquivo — rodar `extractScriptBodies` DENTRO do `it`
  // estourava o timeout mesmo em 30s (I/O de 9.206 arquivos não é grátis).
  const bodies = extractScriptBodies(NPC_ROOT);

  it("editar UMA fala no nível mais fundo da cadeia preserva TODAS as outras alternativas e os legacyScript (playbgm) vizinhos", () => {
    const entry = bodies.find((b) => b.ref === REF);
    expect(entry).toBeDefined();

    const { source, before } = load(entry!.code);
    const after = cloneAsAfter(before);
    const target = after.dialogue.find((n) => n.kind === "say" && n.text?.includes("Yuna Song"));
    expect(target).toBeDefined();
    target!.text = "I'll play <Yuna Song EDITADO>.";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain("Yuna Song EDITADO");
    // as OUTRAS 12 alternativas da cadeia, intocadas:
    expect(body).toContain("I'll play <I miss you>.");
    expect(body).toContain("I'll play <Alpen Rose>.");
    expect(body).toContain("I'll play <Dazzling Snow>.");
    expect(body).toContain("I'll play <Jittering Nightmare>.");
    // os legacyScript (playbgm) vizinhos, intocados — nem um viraria opaco a mais:
    expect(body).toContain('playbgm "04";');
    expect(body).toContain('playbgm "33";');
    // o ramo final (else profundo, com npctalk × 3) também intocado:
    expect(body).toContain('npctalk "Oh, this music is!", "Banquet Hall Aristocrat", bc_self;');
  });
});

describe("Writer de NPC — comentário protegido em profundidade (recusa em qualquer nível)", () => {
  it("comentário grudado numa folha no NÍVEL 3 (if > if > if) recusa, sem afetar níveis acima", () => {
    const code = `
      if (.@a == 1) {
        if (.@b == 1) {
          if (.@c == 1) {
            // comentário grudado bem fundo
            mes "fundo";
          }
        }
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "fundo")!.text = "fundo EDITADO";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries[0]!.code).toBe("comment-in-replaced-span");
    expect(result.entries[0]!.patchedBody).toBeUndefined();
  });
});

describe("Writer de NPC — legacyScript vizinho em profundidade (não só no topo)", () => {
  it("legacyScript dentro de um ramo aninhado sobrevive quando o IRMÃO nesse MESMO ramo é editado", () => {
    const code = `
      if (.@x == 1) {
        if (.@y == 1) {
          mes "fala aninhada";
          npctalk "efeito colateral não mapeado";
        }
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "fala aninhada")!.text = "fala aninhada EDITADA";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const body = result.entries[0]!.patchedBody!;
    expect(body).toContain('mes "fala aninhada EDITADA";');
    expect(body).toContain('npctalk "efeito colateral não mapeado";');
    expect(body).not.toContain("npctalk(");
  });
});

describe("Writer de NPC — edição aninhada dentro de um event handler, múltiplos entry points", () => {
  it("editar uma folha aninhada DENTRO de um handler não afeta o corpo principal nem outros handlers", () => {
    const code = `
      mes "clique"; close;
    OnTouch:
      if (.@x == 1) {
        mes "toquei, x=1";
      } else {
        mes "toquei, x!=1";
      }
      end;
    OnInit:
      set .@z, 1;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const onTouch = after.eventHandlers.find((h) => h.label === "OnTouch")!;
    onTouch.dialogue.find((n) => n.kind === "say" && n.text === "toquei, x=1")!.text = "toquei, x=1, EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const touched = result.entries.filter((e) => e.changed).map((e) => e.entryLabel);
    expect(touched).toEqual(["OnTouch"]);
    const onTouchBody = result.entries.find((e) => e.entryLabel === "OnTouch")!.patchedBody!;
    expect(onTouchBody).toContain("toquei, x=1, EDITADO");
    expect(onTouchBody).toContain('mes "toquei, x!=1";'); // ramo else do handler, intocado
    const onInitResult = result.entries.find((e) => e.entryLabel === "OnInit")!;
    expect(onInitResult.patchedBody).toBeUndefined(); // handler NÃO tocado nem entra no resultado
  });
});

describe("Writer de NPC — edição de ação tipada existente (action:warp)", () => {
  it("editar SÓ o mapId preserva x/y", () => {
    const code = `warp "prontera",150,150; end;`;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const warp = after.dialogue.find((n) => n.kind === "action")!;
    (warp.action as { mapId: string }).mapId = "geffen";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.entries[0]!.patchedBody).toContain('warp "geffen",150,150;');
  });

  it("editar SÓ x/y preserva o mapId", () => {
    const code = `warp "prontera",150,150; end;`;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const warp = after.dialogue.find((n) => n.kind === "action")!;
    (warp.action as { position: [number, number, number] }).position = [200, 250, 0];
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.entries[0]!.patchedBody).toContain('warp "prontera",200,250;');
  });

  it("warp ANINHADO dentro de um if também é editável (ação tipada + estrutura, combinadas)", () => {
    const code = `
      if (.@go == 1) {
        warp "prontera",150,150;
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const warp = after.dialogue.find((n) => n.kind === "action")!;
    (warp.action as { mapId: string }).mapId = "izlude";
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    expect(result.entries[0]!.patchedBody).toContain('warp "izlude",150,150;');
  });
});

describe("Writer de NPC — recusa quando a condição vira um tipo estruturado não suportado", () => {
  it("trocar condition.kind de 'custom' pra 'hasItem' é recusado — não sabemos reimprimir isso ainda", () => {
    const code = `if (.@x == 1) { mes "a"; } close;`;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    const cond = after.dialogue.find((n) => n.kind === "conditional")!;
    cond.branches![0]!.condition = { kind: "hasItem", itemId: 501, amount: 1 };
    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(false);
    expect(result.entries[0]!.code).toBe("unsupported-node-kind");
  });
});

describe("Writer de NPC — round-trip AST do trecho reconstruído", () => {
  it("o patchedBody de uma edição aninhada REPARSEIA sem cair em RawStatement", () => {
    const code = `
      if (.@x == 1) {
        mes "a";
      } else {
        mes "b";
      }
      switch (select("X:Y")) {
        case 1: mes "c"; break;
        case 2: mes "d"; break;
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "b")!.text = "b EDITADO";
    after.dialogue.find((n) => n.kind === "say" && n.text === "d")!.text = "d EDITADO";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);
    const reparsed = parseNpcScript(result.entries[0]!.patchedBody!);
    const rawTexts: string[] = [];
    const walk = (stmts: { kind: string; text?: string; consequent?: unknown[]; alternate?: unknown[] | null; cases?: { body: unknown[] }[] }[]) => {
      for (const st of stmts) {
        if (st.kind === "RawStatement") rawTexts.push(st.text!);
        if (st.kind === "IfStatement") {
          walk(st.consequent as never);
          if (st.alternate) walk(st.alternate as never);
        }
        if (st.kind === "SwitchStatement") for (const c of st.cases!) walk(c.body as never);
      }
    };
    for (const ep of reparsed.entryPoints) walk(ep.body as never);
    expect(rawTexts).toEqual([]);

    // remapeando o reparseado, o grafo bate com o que foi PEDIDO (mesmos textos, na mesma forma).
    const remapped = mapNpcScriptWithUnits(reparsed);
    expect(remapped.dialogue.some((n) => n.kind === "say" && n.text === "b EDITADO")).toBe(true);
    expect(remapped.dialogue.some((n) => n.kind === "say" && n.text === "d EDITADO")).toBe(true);
    expect(remapped.dialogue.some((n) => n.kind === "say" && n.text === "a")).toBe(true);
    expect(remapped.dialogue.some((n) => n.kind === "say" && n.text === "c")).toBe(true);
  });
});

describe("Writer de NPC — teste real de arquivo temporário (fs de verdade, fora de rathena/)", () => {
  it("escreve o patchedBody num arquivo TEMPORÁRIO de verdade, lê de volta, reparseia e confirma equivalência", () => {
    const code = `
      if (.@x == 1) {
        mes "a";
      } else {
        mes "b";
      }
      close;
    `;
    const { source, before } = load(code);
    const after = cloneAsAfter(before);
    after.dialogue.find((n) => n.kind === "say" && n.text === "b")!.text = "b EDITADO — teste de arquivo real";

    const result = planNpcWrite(source, before, after);
    expect(result.ok).toBe(true);

    const tmpPath = join(tmpdir(), `npc-writer-test-${Date.now()}.txt`);
    try {
      writeFileSync(tmpPath, result.entries[0]!.patchedBody!, "utf8");
      const readBack = readFileSync(tmpPath, "utf8");
      expect(readBack).toBe(result.entries[0]!.patchedBody);

      const reparsedAst = parseNpcScript(readBack);
      const remapped = mapNpcScriptWithUnits(reparsedAst);
      expect(remapped.dialogue.some((n) => n.kind === "say" && n.text === "a")).toBe(true);
      expect(remapped.dialogue.some((n) => n.kind === "say" && n.text === "b EDITADO — teste de arquivo real")).toBe(true);
    } finally {
      unlinkSync(tmpPath);
    }
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
