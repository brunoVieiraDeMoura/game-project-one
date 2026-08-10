import type { DialogueNode } from "../npc";
import type { NpcMapResult, NpcMapResultWithUnits, EntrySourceMap, WriterUnit } from "./npc-script-mapper";
import { parseExpression } from "./npc-script-parser";

/**
 * Writer de NPCs (leia1.txt, 2026-08-08 e 2026-08-09 — "ampliar a
 * capacidade de edição do Writer, sem reabrir a decisão de arquitetura já
 * aprovada": reconstrução por offset/fatia do texto original continua
 * sendo a base; o que mudou nesta rodada é a PROFUNDIDADE da reconciliação
 * — de "só nós de topo de entry point" pra "recursiva dentro de
 * `conditional`/`choice`", provada nó a nó, nunca reimprimindo mais do que
 * o estritamente necessário.
 *
 * **A garantia central não mudou**: pra cada UNIDADE (agora podendo estar
 * aninhada dentro de um ramo de `if`/`else` ou de um `case`), se o CONTEÚDO
 * é igual entre `before`/`after`, o texto sai por FATIA DE BYTE do
 * original — nunca reimpresso, então comentário/espaço/sintaxe antiga
 * sobrevivem de graça. Só quando o conteúdo realmente muda é que entra
 * reimpressão, e só do MENOR trecho possível.
 *
 * **Novidades desta rodada** (leia1.txt §"Prioridade"):
 * 1. editar o TEXTO DA CONDIÇÃO de um `conditional` — usa `IfStatement.
 *    testStart/testEnd` (novo campo do AST/Parser); o texto novo é
 *    validado com `parseExpression` de verdade antes de aceitar (nunca
 *    escreve algo que não se prova sintaticamente válido) e inserido
 *    VERBATIM (é texto do admin, não sintaxe "antiga" pra preservar);
 * 2. editar os RÓTULOS de um `choice` — reconstrói só o `select("A:B:C")`
 *    a partir de `choices[].label`, via `SwitchStatement.discriminantStart/
 *    discriminantEnd`;
 * 3. editar uma FOLHA aninhada dentro de um ramo de `if`/`else` ou de um
 *    `case` de `switch(select(...))` — a mesma reconciliação de sempre,
 *    só que recursiva (`WriterUnit.nested`);
 * 4. ações já tipadas (`action:warp`) aninhadas se beneficiam de graça do
 *    item 3, sem código extra.
 *
 * **Continua bloqueado, de propósito** (leia1.txt: "não remova bloqueios
 * sem prova"):
 * - `legacyScript` editado diretamente — não existe reimpressão pra ele;
 * - adicionar/remover/reordenar nó (de topo OU aninhado) — a checagem de
 *   FIAÇÃO (`wiringOf`) continua recusando qualquer coisa assim, em
 *   qualquer profundidade, porque agora ela roda em CADA nível da recursão;
 * - adicionar/remover um RAMO inteiro (`else` que não existia virar
 *   existir, ou o contrário) — mesma checagem de fiação: `elseNext`
 *   ausente↔presente já é uma diferença de fiação no nível do
 *   `conditional`;
 * - adicionar/remover uma OPÇÃO de `choice` — `choices.length` diferente
 *   já é pego antes mesmo de olhar rótulo;
 * - adicionar/remover um event handler inteiro;
 * - trecho substituído cujo span original contém comentário.
 *
 * ---------------------------------------------------------------------
 * leia1.txt, 2026-08-10 — "ampliar capacidades do Writer com foco em
 * edição segura", três auditorias pedidas ANTES de qualquer implementação
 * nova. As três concluem BLOQUEIO — nenhuma foi implementada nesta rodada.
 * A capacidade nova de verdade desta rodada foi só PROVAR (com mais testes,
 * inclusive um exemplo real do corpus com 14 níveis de aninhamento —
 * `npc/re/quests/quests_16_1.txt:14024`, "Court Musician#orint", uma cadeia
 * de 13 `else if`) que a recursão de `conditional`/`choice` já cobre
 * profundidade e MISTURA arbitrárias (`if` contendo `switch`, `switch`
 * contendo `if`, em qualquer combinação) — não precisou de código novo,
 * só prova.
 *
 * **Auditoria 1 — "conteúdo de conditional/choice ALÉM da condição/
 * rótulos"**: não existe mais nada pra liberar. Os únicos campos de
 * CONTEÚDO (não-fiação) de um `conditional` são `branches[0].condition`
 * (já editável) e de um `choice` são `choices[].label` (já editável);
 * tudo mais nesses dois nós (`next`/`elseNext`/`choices[].next`/
 * `branches[].next`) é posição no grafo, nunca dado do admin. Registrar
 * isso aqui é deliberado — "não transforme uma recusa em permissão
 * apenas para aumentar a cobertura" vale nos dois sentidos: também não
 * finjo que existe uma capacidade nova quando não existe.
 *
 * **Auditoria 2 — categorias de `legacyScript` editáveis SEM interpretar
 * semanticamente o comando**: nenhuma encontrada. Tabela de callees reais
 * do corpus (do relatório do Validator, os mais frequentes em
 * `legacyScript`) e o veredito de cada um:
 *
 * | callee         | tem "texto" visível? | por que editar exige semântica |
 * |----------------|-----------------------|----------------------------------|
 * | `cutin`        | não (nome de imagem)  | —                                 |
 * | `set`          | não (atribuição)      | —                                 |
 * | `mes` dinâmico | SIM (`mes "a"+.@v+"b"`)| saber que é `mes` E que `args[0]` é o texto — a MESMA semântica que já uso pro `mes` estático, só que precisaria ACEITAR expressão em vez de só `StringLit`, que é mudança de escopo do Mapper (fora desta auditoria, ver nota abaixo) |
 * | `npctalk`      | SIM (arg 0)           | saber que `npctalk` tem texto no arg 0 é conhecimento POR COMANDO |
 * | `donpcevent`   | não (controle)        | —                                 |
 * | `monster`      | não (spawn)           | —                                 |
 * | `disablenpc`/`enablenpc` | não (controle) | —                            |
 * | `emotion`      | não (id de emote)     | —                                 |
 * | `mapannounce`  | SIM (arg 1)           | mesma razão de `npctalk`, posição DIFERENTE (arg 1, não 0) — prova que não dá pra generalizar "primeiro arg string" |
 * | `specialeffect`| não (id de efeito)    | —                                 |
 * | `setquest`     | não (id de quest)     | —                                 |
 *
 * Conclusão: TODA categoria com texto visível ao jogador (`mes` dinâmico,
 * `npctalk`, `mapannounce`) exige saber a POSIÇÃO do argumento editável, e
 * essa posição é DIFERENTE por comando (arg 0 pra uns, arg 1 pra outros) —
 * ou seja, é semântica por definição, não sintaxe. A única alternativa
 * sem semântica seria editar o `legacySource` como texto livre inteiro,
 * que leia1.txt já proíbe explicitamente ("não transforme legacyScript em
 * texto livre editável"). **Resultado: mantido bloqueado, sem exceção.**
 * (Nota à parte, fora desta auditoria: reconhecer `mes` com argumento
 * dinâmico como um `say` de verdade — em vez de cair em `legacyScript` —
 * é uma mudança de ESCOPO DO MAPPER, não do Writer, e alteraria o que
 * `isMesCall` aceita; não avaliado aqui porque a instrução desta rodada é
 * sobre o Writer, e mudar o Mapper "sem necessidade" está nas restrições.)
 *
 * **Auditoria 3 — adicionar/remover/reordenar nó**: bloqueado, lista do
 * que falta pra liberar com segurança:
 * - *offsets*: hoje `WriterUnit` só guarda `end`; o `start` de cada
 *   unidade é DERIVADO do `end` da anterior (`unit[i].start =
 *   unit[i-1].end`). Isso é suficiente pra EDITAR um nó existente (a
 *   fatia dele já está bem definida), mas não diz pra ONDE vai um
 *   comentário/espaço "órfão" se o nó VIZINHO for removido, nem de onde
 *   viria a indentação de um nó NOVO (ele não tem fatia nenhuma no
 *   original).
 * - *comentários*: a convenção atual ("todo espaço pertence à unidade que
 *   vem DEPOIS dele") funciona pra edição in-place porque a unidade
 *   continua existindo pra "carregar" esse espaço. Remover a unidade
 *   deixa esse espaço sem dono — perder ele em silêncio violaria a regra
 *   de comentário; preservar exige uma decisão de design ainda não
 *   tomada (anexar ao vizinho? virar um nó "comentário solto"?).
 * - *labels*: rótulos ANINHADOS (dentro de bloco, profundidade > 0)
 *   continuam sendo só texto opaco (`RawStatement`, achado da auditoria
 *   original do Validator) — inserir/remover um nó ao lado de um desses
 *   não tem verificação nenhuma de que o rótulo aninhado continua
 *   coerente.
 * - *gotos*: `goto` resolve no NPC INTEIRO (script.cpp:`buildin_goto`,
 *   mesmo `script_code` compilado — achado do Validator), não só no
 *   entry point local. Remover um nó que é ALVO de `goto` em OUTRO lugar
 *   do script deixaria esse `goto` órfão, e o Writer hoje não confere
 *   isso — o Validator confere o ESTADO ANTES da edição, não o
 *   RESULTADO depois dela.
 * - *branches*: adicionar um ramo que não existia (ex.: um `else` novo)
 *   exige sintetizar `else { ... }` do zero e decidir ONDE inserir — a
 *   checagem de fiação já recusa isso corretamente hoje, só não tenho a
 *   parte de "gerar com segurança".
 * - *event handlers*: adicionar um novo exige sintetizar `Rótulo:\n` —
 *   não tenho hoje o "espaço ENTRE dois handlads consecutivos" como algo
 *   em que eu possa inserir um terceiro no meio (só sei o `bodyStart`/
 *   `bodyEnd` de cada um individualmente).
 * - *referências entre entry points*: `donpcevent("Npc::Label")` mira
 *   rótulos por nome — renomear/remover um rótulo sem checar isso
 *   quebraria a referência em silêncio.
 * Nenhuma aproximação foi implementada pra nenhum desses pontos — a
 * checagem de fiação (`wiringOf`) continua sendo o único mecanismo, e ela
 * RECUSA (nunca tenta adivinhar) qualquer coisa que mexa em quantidade ou
 * ordem de nó.
 *
 * **Auditoria 4 — event handlers inteiros**: bloqueado, mesma lógica:
 * - onde começa/termina cada label: hoje só capturo o CORPO (`bodyStart`
 *   depois do `:`, `bodyEnd` no fim do último statement) — não capturo o
 *   span do PRÓPRIO texto do rótulo (`OnTouch_`, com esse `_` específico
 *   e essas maiúsculas exatas) como algo reusável pra sintetizar um novo;
 * - comentário logo antes/depois de um rótulo: hoje esse espaço é
 *   copiado junto com o handler ANTERIOR (mesma convenção de "espaço
 *   pertence a quem vem depois dele" aplicada ao NÍVEL de entry point) —
 *   ambíguo se removido: o comentário pode estar explicando o handler
 *   SEGUINTE, não o anterior;
 * - múltiplos handlers: sei onde cada um começa/termina INDIVIDUALMENTE,
 *   não tenho "a lista ordenada com os vãos entre eles" como uma
 *   estrutura editável;
 * - preservar handler não modificado: **já funciona**, provado em teste
 *   (`editar uma folha aninhada DENTRO de um handler não afeta o corpo
 *   principal nem outros handlers`);
 * - adicionar/remover sem afetar os demais: não implementado — precisa
 *   da estrutura do item anterior primeiro.
 */

export type WriterRefusalCode =
  | "no-source-position"
  | "structure-changed"
  | "unsupported-node-kind"
  | "comment-in-replaced-span"
  | "whole-handler-add-remove"
  | "invalid-condition-text";

export interface EntryWriteResult {
  /** rótulo do entry point; `null` = corpo principal. */
  entryLabel: string | null;
  ok: boolean;
  reason?: string;
  code?: WriterRefusalCode;
  /** true só quando `ok` E o conteúdo realmente mudou (nó a nó, em qualquer profundidade). */
  changed: boolean;
  /** corpo `{...}` NOVO desta entrada — só presente quando `ok && changed`. */
  patchedBody?: string;
}

export interface NpcWriteResult {
  /** true só se TODAS as entradas que tinham diferença de conteúdo deram `ok`. */
  ok: boolean;
  entries: EntryWriteResult[];
  changedCount: number;
}

function isLeafNode(node: DialogueNode): boolean {
  if (node.kind === "say" || node.kind === "end") return true;
  if (node.kind === "action") return node.action?.kind === "warp";
  return false; // conditional, choice, action:legacyScript, e o resto de NpcActionSchema
}

/** compara só o CONTEÚDO de um nó — nunca a "fiação" (`next`/`elseNext`/
 * `choices[].next`/`branches[].next`), que é posição no grafo, não dado do
 * admin. */
function stripWiring(node: DialogueNode): unknown {
  const { next: _next, elseNext: _elseNext, choices, branches, ...rest } = node;
  return {
    ...rest,
    choices: choices?.map((c) => ({ label: c.label })),
    branches: branches?.map((b) => ({ condition: b.condition })),
  };
}
function contentEqual(a: DialogueNode, b: DialogueNode): boolean {
  return JSON.stringify(stripWiring(a)) === JSON.stringify(stripWiring(b));
}

/** só os campos de FIAÇÃO (posição no grafo) de um nó — o que decide se a
 * TOPOLOGIA mudou. Um `conditional`/`choice` NÃO tem `.next` próprio (a
 * continuação mora em `branches[].next`/`elseNext`/`choices[].next` — os
 * ramos convergem só na PONTA de cada um, nunca no nó em si). Comparar isto
 * (em vez de "andar" pelo grafo) é o que permite recusar corretamente
 * qualquer adição/remoção/reordenação em QUALQUER profundidade, sem
 * precisar de um walker que sabe seguir `branches`/`choices`. */
function wiringOf(node: DialogueNode): unknown {
  return {
    next: node.next,
    elseNext: node.elseNext,
    choices: node.choices?.map((c) => c.next),
    branches: node.branches?.map((b) => b.next),
  };
}

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** inverso PARCIAL do Mapper — só pros kinds que `isLeafNode` aceita. */
function printLeaf(node: DialogueNode): string | null {
  if (node.kind === "say") {
    const lines = (node.text ?? "").split("\n");
    return lines.map((l) => `mes "${escapeString(l)}";`).join("\n");
  }
  if (node.kind === "end") return "end;";
  if (node.kind === "action" && node.action?.kind === "warp") {
    const [x, y] = node.action.position;
    return `warp "${escapeString(node.action.mapId)}",${x},${y};`;
  }
  return null;
}

/** heurística CONSERVADORA de propósito: `//`/`/*` em qualquer lugar do
 * trecho (mesmo dentro de string) já recusa. Falso positivo custa "não
 * escrevo" — seguro. Falso negativo custaria apagar um comentário —
 * inaceitável. */
function containsCommentMarker(text: string): boolean {
  return /\/\/|\/\*/.test(text);
}

function nodesById(dialogue: DialogueNode[]): Map<string, DialogueNode> {
  return new Map(dialogue.map((n) => [n.id, n]));
}

interface Refusal {
  ok: false;
  reason: string;
  code: WriterRefusalCode;
}
function refuse(code: WriterRefusalCode, reason: string): Refusal {
  return { ok: false, code, reason };
}

interface Resolved {
  ok: true;
  text: string;
  changed: boolean;
}

function contiguousRanges(
  bodyStart: number | undefined,
  units: WriterUnit[],
): { unit: WriterUnit; start: number; end: number }[] | null {
  if (bodyStart === undefined) return null;
  const out: { unit: WriterUnit; start: number; end: number }[] = [];
  let cursor = bodyStart;
  for (const u of units) {
    out.push({ unit: u, start: cursor, end: u.end });
    cursor = u.end;
  }
  return out;
}

/** resolve uma LISTA de unidades contíguas (o corpo de um entry point OU o
 * corpo de um ramo/case aninhado — mesma função pros dois, é por isso que a
 * recursão fica simples). Lista vazia é sempre "sem mudança, texto vazio"
 * — não depende de `bodyStart` (não há o que recortar mesmo). */
function resolveUnitList(
  bodyStart: number | undefined,
  units: WriterUnit[],
  beforeById: Map<string, DialogueNode>,
  afterById: Map<string, DialogueNode>,
  source: string,
): Resolved | Refusal {
  if (units.length === 0) return { ok: true, text: "", changed: false };
  const ranges = contiguousRanges(bodyStart, units);
  if (!ranges) return refuse("no-source-position", "sem posição de origem pra este trecho");

  let changed = false;
  const pieces: string[] = [];
  for (const r of ranges) {
    const resolved = resolveNode(r.unit, r.start, r.end, beforeById, afterById, source);
    if (!resolved.ok) return resolved;
    pieces.push(resolved.text);
    if (resolved.changed) changed = true;
  }
  return { ok: true, text: pieces.join("\n"), changed };
}

function resolveNode(
  unit: WriterUnit,
  start: number,
  end: number,
  beforeById: Map<string, DialogueNode>,
  afterById: Map<string, DialogueNode>,
  source: string,
): Resolved | Refusal {
  const before = beforeById.get(unit.nodeId);
  const after = afterById.get(unit.nodeId);
  if (!before || !after) return refuse("structure-changed", `nó "${unit.nodeId}" ausente em um dos grafos — estado inconsistente`);
  if (before.kind !== after.kind) return refuse("structure-changed", `nó "${unit.nodeId}" mudou de tipo (kind) — não suportado`);
  if (JSON.stringify(wiringOf(before)) !== JSON.stringify(wiringOf(after))) {
    return refuse(
      "structure-changed",
      `o encadeamento do nó "${unit.nodeId}" mudou (nó/ramo/opção adicionado, removido ou reordenado) — não suportado nesta versão do Writer`,
    );
  }
  // `conditional`/`choice` NUNCA podem confiar no atalho `contentEqual`
  // sozinho: os campos PRÓPRIOS desses nós (id/kind/branches[].condition/
  // choices[].label — tudo que `stripWiring` preserva) ficam IDÊNTICOS
  // mesmo quando o que mudou foi conteúdo ANINHADO (um `say` dentro do
  // ramo `then`, por exemplo) — nenhum desses campos sabe nada sobre os
  // nós filhos, que são objetos SEPARADOS. Um atalho aqui faria o Writer
  // reusar o trecho verbatim e nunca descer pra checar o que há dentro —
  // exatamente o achado por trás de 5 dos 8 testes falhando na primeira
  // versão desta recursão. `resolveConditional`/`resolveChoice` fazem o
  // PRÓPRIO "nada mudou em lugar nenhum" e devolvem o verbatim quando é o
  // caso; até lá, sempre descem.
  if (before.kind === "conditional" && unit.nested) {
    return resolveConditional(unit, start, end, before, after, beforeById, afterById, source);
  }
  if (before.kind === "choice" && unit.nested) {
    return resolveChoice(unit, start, end, before, after, beforeById, afterById, source);
  }

  if (contentEqual(before, after)) {
    return { ok: true, text: source.slice(start, end), changed: false };
  }

  if (!isLeafNode(before) || !isLeafNode(after)) {
    return refuse("unsupported-node-kind", `nó "${unit.nodeId}" (kind "${before.kind}") não tem escrita suportada ainda`);
  }
  const originalSpan = source.slice(start, end);
  if (containsCommentMarker(originalSpan)) {
    return refuse("comment-in-replaced-span", `nó "${unit.nodeId}" foi editado, mas o trecho original tem comentário — reimprimir apagaria o comentário`);
  }
  const printed = printLeaf(after);
  if (printed === null) return refuse("unsupported-node-kind", `nó "${unit.nodeId}" não sabe se reimprimir`);
  return { ok: true, text: printed, changed: true };
}

function resolveConditional(
  unit: WriterUnit,
  start: number,
  end: number,
  before: DialogueNode,
  after: DialogueNode,
  beforeById: Map<string, DialogueNode>,
  afterById: Map<string, DialogueNode>,
  source: string,
): Resolved | Refusal {
  const thenBranch = unit.nested!.find((n) => n.key === "then");
  const elseBranch = unit.nested!.find((n) => n.key === "else");
  if (!thenBranch) return refuse("no-source-position", `conditional "${unit.nodeId}" sem mapa de origem do ramo "then"`);

  const beforeCond = before.branches?.[0]?.condition;
  const afterCond = after.branches?.[0]?.condition;
  const conditionChanged = JSON.stringify(beforeCond) !== JSON.stringify(afterCond);

  let conditionText = "";
  if (conditionChanged) {
    if (afterCond?.kind !== "custom") {
      return refuse("unsupported-node-kind", `condição de "${unit.nodeId}" só pode ser editada como texto cru ("custom") nesta versão`);
    }
    if (!unit.editableSpan) return refuse("no-source-position", `sem posição de origem pra condição de "${unit.nodeId}"`);
    const newText = (afterCond.legacySource ?? "").trim();
    try {
      parseExpression(newText);
    } catch (err) {
      return refuse("invalid-condition-text", `condição nova de "${unit.nodeId}" não é uma expressão válida: ${(err as Error).message}`);
    }
    conditionText = newText; // texto do ADMIN, verbatim — não é "sintaxe antiga", não há o que preservar aqui.
  } else if (unit.editableSpan) {
    conditionText = source.slice(unit.editableSpan.start, unit.editableSpan.end);
  }

  const thenResolved = resolveUnitList(thenBranch.bodyStart, thenBranch.units, beforeById, afterById, source);
  if (!thenResolved.ok) return thenResolved;
  let elseResolved: Resolved | null = null;
  if (elseBranch) {
    const r = resolveUnitList(elseBranch.bodyStart, elseBranch.units, beforeById, afterById, source);
    if (!r.ok) return r;
    elseResolved = r;
  }

  const anyChanged = conditionChanged || thenResolved.changed || (elseResolved?.changed ?? false);
  if (!anyChanged) return { ok: true, text: source.slice(start, end), changed: false };
  if (!conditionChanged && !unit.editableSpan) {
    return refuse("no-source-position", `sem posição de origem pra condição de "${unit.nodeId}" — não dá pra reconstruir o if`);
  }

  let text = `if (${conditionText}) {\n${thenResolved.text}\n}`;
  if (elseBranch) text += ` else {\n${elseResolved!.text}\n}`;
  return { ok: true, text, changed: true };
}

function resolveChoice(
  unit: WriterUnit,
  start: number,
  end: number,
  before: DialogueNode,
  after: DialogueNode,
  beforeById: Map<string, DialogueNode>,
  afterById: Map<string, DialogueNode>,
  source: string,
): Resolved | Refusal {
  const beforeChoices = before.choices ?? [];
  const afterChoices = after.choices ?? [];
  // já sabemos (checagem de fiação em `resolveNode`) que `choices[].next` bate
  // 1-a-1 — então mesmo tamanho aqui é garantido, mas confere de novo por
  // segurança (defesa em profundidade, custa nada).
  if (beforeChoices.length !== afterChoices.length) {
    return refuse("structure-changed", `número de opções de "${unit.nodeId}" mudou — não suportado nesta versão`);
  }
  const labelsChanged = beforeChoices.some((c, i) => c.label !== afterChoices[i]!.label);

  let discriminantText = "";
  if (labelsChanged) {
    const joined = afterChoices.map((c) => c.label).join(":");
    discriminantText = `select("${escapeString(joined)}")`;
  } else if (unit.editableSpan) {
    discriminantText = source.slice(unit.editableSpan.start, unit.editableSpan.end);
  }

  const caseTexts: string[] = [];
  let anyCaseChanged = false;
  for (const branch of unit.nested ?? []) {
    const resolved = resolveUnitList(branch.bodyStart, branch.units, beforeById, afterById, source);
    if (!resolved.ok) return resolved;
    if (resolved.changed) anyCaseChanged = true;
    const header = branch.headerStart !== undefined && branch.headerEnd !== undefined ? source.slice(branch.headerStart, branch.headerEnd) : null;
    if (header === null && (resolved.changed || labelsChanged)) {
      return refuse("no-source-position", `sem posição de origem pro cabeçalho de um case de "${unit.nodeId}"`);
    }
    caseTexts.push(`${header ?? ""}\n${resolved.text}`);
  }

  const anyChanged = labelsChanged || anyCaseChanged;
  if (!anyChanged) return { ok: true, text: source.slice(start, end), changed: false };
  if (!labelsChanged && !unit.editableSpan) {
    return refuse("no-source-position", `sem posição de origem pro select() de "${unit.nodeId}"`);
  }

  const text = `switch (${discriminantText}) {\n${caseTexts.join("\n")}\n}`;
  return { ok: true, text, changed: true };
}

function writeEntry(
  entryLabel: string | null,
  originalSource: string,
  sourceMap: EntrySourceMap,
  beforeDialogue: DialogueNode[],
  beforeEntry: string | null,
  afterDialogue: DialogueNode[],
  afterEntry: string | null,
): EntryWriteResult {
  if (afterEntry !== beforeEntry) {
    return {
      entryLabel,
      ok: false,
      reason: "o nó de entrada deste corpo mudou — não suportado nesta versão do Writer",
      code: "structure-changed",
      changed: false,
    };
  }
  const beforeById = nodesById(beforeDialogue);
  const afterById = nodesById(afterDialogue);
  const resolved = resolveUnitList(sourceMap.bodyStart, sourceMap.units, beforeById, afterById, originalSource);
  if (!resolved.ok) return { entryLabel, ok: false, reason: resolved.reason, code: resolved.code, changed: false };
  return { entryLabel, ok: true, changed: resolved.changed, patchedBody: resolved.changed ? resolved.text : undefined };
}

/**
 * `originalSource` é o MESMO texto passado a `parseNpcScript` (o corpo
 * `{...}` inteiro deste NPC) — os offsets em `before.mainSourceMap`/
 * `handlerSourceMaps` são absolutos NELE, não por entry point separado.
 * `before` precisa vir de `mapNpcScriptWithUnits(astDoTextoOriginal)`;
 * `after` é o grafo como o admin deixou (plain `NpcMapResult` — não tem
 * mapa de origem, é dado novo).
 */
export function planNpcWrite(originalSource: string, before: NpcMapResultWithUnits, after: NpcMapResult): NpcWriteResult {
  const entries: EntryWriteResult[] = [];

  entries.push(writeEntry(null, originalSource, before.mainSourceMap, before.dialogue, before.dialogueEntry, after.dialogue, after.dialogueEntry));

  const beforeLabels = new Set(before.eventHandlers.map((h) => h.label));
  const afterLabels = new Set(after.eventHandlers.map((h) => h.label));
  const allLabels = new Set([...beforeLabels, ...afterLabels]);

  for (const label of allLabels) {
    if (!beforeLabels.has(label) || !afterLabels.has(label)) {
      entries.push({
        entryLabel: label,
        ok: false,
        reason: "adicionar ou remover um event handler INTEIRO não é suportado nesta versão do Writer",
        code: "whole-handler-add-remove",
        changed: false,
      });
      continue;
    }
    const beforeHandler = before.eventHandlers.find((h) => h.label === label)!;
    const afterHandler = after.eventHandlers.find((h) => h.label === label)!;
    const sourceMap = before.handlerSourceMaps[label];
    if (!sourceMap) {
      entries.push({ entryLabel: label, ok: false, reason: "sem mapa de origem pra este handler", code: "no-source-position", changed: false });
      continue;
    }
    entries.push(writeEntry(label, originalSource, sourceMap, beforeHandler.dialogue, beforeHandler.entry, afterHandler.dialogue, afterHandler.entry));
  }

  // uma entrada SEM diferença de conteúdo que falhou só por não ter posição
  // de origem (ex.: handler vazio) não bloqueia nada — ninguém pediu pra
  // mexer nela. Só bloqueia quando havia uma edição de verdade ali.
  const blocking = entries.filter((e) => !e.ok && entryHasIntendedChange(e, before, after));
  const ok = blocking.length === 0;

  return { ok, entries, changedCount: entries.filter((e) => e.changed).length };
}

/** uma entrada recusada só bloqueia o NPC se havia de fato uma diferença
 * pretendida ali — comparado por CONTEÚDO da lista de diálogo inteira
 * (não pelos nós individuais, que é justamente o que falhou em resolver). */
function entryHasIntendedChange(e: EntryWriteResult, before: NpcMapResultWithUnits, after: NpcMapResult): boolean {
  if (e.entryLabel === null) {
    return JSON.stringify(before.dialogue.map(stripWiring)) !== JSON.stringify(after.dialogue.map(stripWiring));
  }
  const b = before.eventHandlers.find((h) => h.label === e.entryLabel);
  const a = after.eventHandlers.find((h) => h.label === e.entryLabel);
  if (!b || !a) return true; // handler inteiro adicionado/removido é sempre uma mudança pretendida
  return JSON.stringify(b.dialogue.map(stripWiring)) !== JSON.stringify(a.dialogue.map(stripWiring));
}
