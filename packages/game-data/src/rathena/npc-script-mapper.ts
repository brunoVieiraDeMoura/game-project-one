import type { NpcScriptAst, Statement, Expr, EntryPoint } from "./npc-script-ast";
import { printExpr, printStatement } from "./npc-script-print";
import type { DialogueNode, NpcEventHandler } from "../npc";

/**
 * Mapper — AST (sintaxe, `npc-script-ast.ts`) → `DialogueNode[]`/
 * `NpcEventHandler[]` (modelo estruturado da dashboard, `npc.ts`). Leia1.txt
 * (aprovação da arquitetura de NPCs, 2026-08-07): "mantenha a separação
 * rigorosa entre sintaxe e semântica: o Parser continua produzindo
 * `CallStatement` genérico e o Mapper decide quando uma chamada conhecida
 * vira `DialogueNode`/`action` tipado. Não introduza regras semânticas no
 * Parser." — este arquivo é o único lugar onde `"mes"`, `"warp"`,
 * `"select"` etc. viram significado; o Lexer/Parser nunca souberam disso.
 *
 * **Nada é destruído**: todo `Statement`/construção que este Mapper não
 * sabe tipar vira um nó `action` com `kind: "legacyScript"` — o texto
 * preservado é o do PRÓPRIO STATEMENT (via `printStatement`, não o script
 * inteiro), reaproveitando o escape-hatch que `NpcActionSchema` já tinha
 * (soul §5.5 — nunca descartado, nunca adivinhado). Diferença pro migrador
 * antigo: hoje o fallback é no MENOR nó possível — um `if` que contém um
 * comando não reconhecido continua sendo um `if` de verdade, só aquele
 * comando fica opaco.
 *
 * **Reconhecidos por enquanto** (ampliar é seguro, é só adicionar mais
 * `case` — nunca precisa mudar o Parser): `mes`/`next`/`close`/`close2`/
 * `end` (diálogo linear, igual o migrador antigo já fazia), `switch
 * (select("A:B:C")) { case N: ... }` → nó `choice` com os rótulos vindos
 * do PRÓPRIO argumento de `select` (padrão citado como exemplo em
 * leia1.txt), `if`/`else` → nó `conditional` (a condição em si fica
 * `custom`+texto — tipar expressão arbitrária como
 * `DialogueConditionSchema` é trabalho de uma iteração futura, não desta),
 * `warp("mapa",x,y)` → `action: warp`.
 */

export interface NpcMapResult {
  dialogueEntry: string | null;
  dialogue: DialogueNode[];
  eventHandlers: NpcEventHandler[];
}

interface OpenEnd {
  nodeId: string;
  field: "next" | "elseNext";
}

interface MapContext {
  nextId: () => string;
}

function makeContext(prefix: string): MapContext {
  let n = 0;
  return { nextId: () => `${prefix}${n++}` };
}

function patch(nodes: DialogueNode[], ends: OpenEnd[], target: string | undefined): void {
  if (target === undefined) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const end of ends) {
    const node = byId.get(end.nodeId);
    if (!node) continue;
    if (end.field === "next") node.next = target;
    else node.elseNext = target;
  }
}

// ---------------------------------------------------------------------------
// Agrupamento: runs de `mes` consecutivos viram UM nó `say` (mesma regra do
// migrador linear antigo); `next` força a quebra sem produzir nó próprio.
// ---------------------------------------------------------------------------

type Group = { type: "say"; lines: string[]; end?: number } | { type: "other"; stmt: Statement };

function isMesCall(st: Statement): st is Extract<Statement, { kind: "CallStatement" }> {
  return st.kind === "CallStatement" && st.callee.toLowerCase() === "mes" && st.args.length === 1 && st.args[0]!.kind === "StringLit";
}
function isNextCall(st: Statement): boolean {
  return st.kind === "CallStatement" && st.callee.toLowerCase() === "next" && st.args.length === 0;
}
function isEndCall(st: Statement): boolean {
  return st.kind === "CallStatement" && ["close", "close2", "end"].includes(st.callee.toLowerCase()) && st.args.length === 0;
}
function selectArgOf(expr: Expr): string | undefined {
  if (expr.kind === "Call" && expr.callee.toLowerCase() === "select" && expr.args.length === 1 && expr.args[0]!.kind === "StringLit") {
    return expr.args[0]!.value;
  }
  return undefined;
}
function warpArgsOf(st: Statement): { mapId: string; x: number; y: number } | undefined {
  if (st.kind !== "CallStatement" || st.callee.toLowerCase() !== "warp") return undefined;
  const [a, b, c] = st.args;
  if (a?.kind === "StringLit" && b?.kind === "IntLit" && c?.kind === "IntLit") {
    return { mapId: a.value, x: b.value, y: c.value };
  }
  return undefined;
}

function groupStatements(stmts: Statement[]): Group[] {
  const groups: Group[] = [];
  let buffer: string[] = [];
  let bufEnd: number | undefined;
  const flush = () => {
    if (buffer.length > 0) {
      groups.push({ type: "say", lines: buffer, end: bufEnd });
      buffer = [];
      bufEnd = undefined;
    }
  };
  for (const st of stmts) {
    if (isMesCall(st)) {
      buffer.push((st.args[0] as Extract<Expr, { kind: "StringLit" }>).value);
      bufEnd = st.end;
      continue;
    }
    if (isNextCall(st)) {
      // "next" fecha a página — o statement em si pertence ao grupo que ele
      // fecha (pro Writer conseguir recortar sem deixar `next;` órfão fora
      // de toda UNIDADE de origem, leia1.txt 2026-08-08 §1/§2).
      if (buffer.length > 0) bufEnd = st.end;
      flush();
      continue;
    }
    flush();
    groups.push({ type: "other", stmt: st });
  }
  flush();
  return groups;
}

// ---------------------------------------------------------------------------
// Mapeamento — cada Group vira {entry, nodes, openEnds}; encadeamento é
// resolvido de fora pra dentro por `patch`, nunca precisando prever ids.
// ---------------------------------------------------------------------------

/** uma ponta editável dentro de um `conditional`/`choice` que NÃO é um nó
 * filho — a condição de um `if` (`branches[0].condition.legacySource`) ou o
 * argumento de `select(...)` de um `switch` (as `choices[].label`). Span de
 * CARACTERE exato, pro Writer trocar SÓ este trecho preservando `if (`/`)`/
 * `switch(select(`/`))` ao redor byte a byte. */
export interface EditableSpan {
  start: number;
  end: number;
}

/** um ramo/caso ANINHADO dentro de um `conditional` (`"then"`/`"else"`) ou
 * `choice` (`"case:0"`, `"case:1"`, ...) — a mesma partição contígua de
 * `WriterUnit[]` de um entry point inteiro, só que com escopo dentro daquele
 * ramo. `headerStart`/`headerEnd` só existem pra `choice` (o texto
 * `case N:`/`default:`), que o Writer reusa VERBATIM quando aquele case
 * específico não muda — `if`/`else` não precisam disso porque `if (`/`) {`/
 * `} else {`/`}` são pontuação fixa, não conteúdo do admin. */
export interface NestedBranch {
  key: string;
  bodyStart?: number;
  units: WriterUnit[];
  headerStart?: number;
  headerEnd?: number;
}

/** id do nó TOPO-DE-NÍVEL (dentro do entry point OU de um ramo aninhado que
 * o contém) + offset de caractere onde o(s) statement(s)-fonte dele
 * TERMINAM — pro Writer (leia1.txt 2026-08-08) montar um recorte CONTÍGUO
 * do corpo original sem depender do Printer pra nada que não foi editado.
 * `nested`/`editableSpan` só existem quando o nó é `conditional`/`choice` —
 * é o que permite ao Writer editar uma folha ANINHADA (dentro de um ramo de
 * `if`/`else` ou de um `case`) ou o texto da condição/rótulos SEM
 * reimprimir a construção inteira. */
export interface WriterUnit {
  nodeId: string;
  end: number;
  editableSpan?: EditableSpan;
  nested?: NestedBranch[];
}

interface MappedBlock {
  entry: string | null;
  nodes: DialogueNode[];
  openEnds: OpenEnd[];
  /** só preenchido quando o statement mapeado por esta chamada é o
   * `IfStatement`/`SwitchStatement(select)` de um `conditional`/`choice` —
   * o chamador (`mapStatements`) copia pra dentro do `WriterUnit` que ele
   * mesmo empilha, então só existe nesse um nível, nunca se acumula. */
  editableSpan?: EditableSpan;
  nested?: NestedBranch[];
}

function mapStatements(stmts: Statement[], ctx: MapContext, units?: WriterUnit[]): MappedBlock {
  const groups = groupStatements(stmts);
  const allNodes: DialogueNode[] = [];
  let entry: string | null = null;
  let prevOpenEnds: OpenEnd[] = [];

  for (const group of groups) {
    const mapped = mapGroup(group, ctx);
    allNodes.push(...mapped.nodes);
    if (entry === null) entry = mapped.entry;
    if (mapped.entry !== null) patch(allNodes, prevOpenEnds, mapped.entry);
    prevOpenEnds = mapped.entry === null ? prevOpenEnds : mapped.openEnds;

    if (units && mapped.entry !== null) {
      const end = group.type === "say" ? group.end : group.stmt.end;
      if (typeof end === "number") {
        units.push({ nodeId: mapped.entry, end, editableSpan: mapped.editableSpan, nested: mapped.nested });
      }
    }
  }

  return { entry, nodes: allNodes, openEnds: prevOpenEnds };
}

function mapGroup(group: Group, ctx: MapContext): MappedBlock {
  if (group.type === "say") {
    const id = ctx.nextId();
    const node: DialogueNode = { id, kind: "say", text: group.lines.join("\n") };
    return { entry: id, nodes: [node], openEnds: [{ nodeId: id, field: "next" }] };
  }
  return mapStatement(group.stmt, ctx);
}

function legacyNode(id: string, st: Statement): DialogueNode {
  return {
    id,
    kind: "action",
    action: { kind: "legacyScript", needsReview: true, legacySource: printStatement(st, "").trim() },
  };
}

function mapStatement(st: Statement, ctx: MapContext): MappedBlock {
  if (isEndCall(st)) {
    const id = ctx.nextId();
    return { entry: id, nodes: [{ id, kind: "end" }], openEnds: [] };
  }

  const warp = warpArgsOf(st);
  if (warp) {
    const id = ctx.nextId();
    const node: DialogueNode = {
      id,
      kind: "action",
      action: { kind: "warp", mapId: warp.mapId, position: [warp.x, warp.y, 0] },
    };
    return { entry: id, nodes: [node], openEnds: [{ nodeId: id, field: "next" }] };
  }

  if (st.kind === "IfStatement") {
    const id = ctx.nextId();
    const consequentUnits: WriterUnit[] = [];
    const consequent = mapStatements(st.consequent, ctx, consequentUnits);
    let alternateUnits: WriterUnit[] | undefined;
    const alternate = st.alternate ? mapStatements(st.alternate, ctx, (alternateUnits = [])) : null;
    const node: DialogueNode = {
      id,
      kind: "conditional",
      branches: [
        {
          condition: { kind: "custom", legacySource: printExpr(st.test, true) },
          next: consequent.entry ?? id, // corpo vazio (raro) — sem alvo melhor, aponta pra si (sem-op)
        },
      ],
      elseNext: alternate?.entry ?? undefined,
    };
    const openEnds: OpenEnd[] = [...consequent.openEnds];
    if (alternate) openEnds.push(...alternate.openEnds);
    else openEnds.push({ nodeId: id, field: "elseNext" }); // sem else = cai direto pro que vem depois quando falso

    const nested: NestedBranch[] = [{ key: "then", bodyStart: st.consequentBodyStart, units: consequentUnits }];
    if (st.alternate) nested.push({ key: "else", bodyStart: st.alternateBodyStart, units: alternateUnits! });
    const editableSpan = st.testStart !== undefined && st.testEnd !== undefined ? { start: st.testStart, end: st.testEnd } : undefined;

    return { entry: id, nodes: [node, ...consequent.nodes, ...(alternate?.nodes ?? [])], openEnds, nested, editableSpan };
  }

  if (st.kind === "SwitchStatement") {
    const selectArg = selectArgOf(st.discriminant);
    if (selectArg !== undefined) {
      const id = ctx.nextId();
      const labels = selectArg.split(":");
      const choices: { label: string; next: string }[] = [];
      const allNodes: DialogueNode[] = [];
      const openEnds: OpenEnd[] = [];
      const nested: NestedBranch[] = [];
      st.cases.forEach((c, i) => {
        const caseUnits: WriterUnit[] = [];
        const mapped = mapStatements(c.body, ctx, caseUnits);
        allNodes.push(...mapped.nodes);
        openEnds.push(...mapped.openEnds);
        const label = c.test?.kind === "IntLit" ? (labels[c.test.value - 1] ?? `opção ${c.test.value}`) : (labels[i] ?? "…");
        if (mapped.entry !== null) choices.push({ label, next: mapped.entry });
        // `headerEnd` (logo depois do ":" de "case N:"/"default:") é o
        // ANCORADOURO certo — não `c.body[0]?.start`, que perderia um
        // comentário entre o ":" e o primeiro statement do case.
        nested.push({ key: `case:${i}`, bodyStart: c.headerEnd, units: caseUnits, headerStart: c.headerStart, headerEnd: c.headerEnd });
      });
      const node: DialogueNode = { id, kind: "choice", choices };
      const editableSpan =
        st.discriminantStart !== undefined && st.discriminantEnd !== undefined
          ? { start: st.discriminantStart, end: st.discriminantEnd }
          : undefined;
      return { entry: id, nodes: [node, ...allNodes], openEnds, nested, editableSpan };
    }
  }

  // fallback — o comando/construção não é reconhecido SEMANTICAMENTE (pode
  // ser sintaticamente perfeito) — vira `legacyScript` do PRÓPRIO statement,
  // nunca do script inteiro.
  const id = ctx.nextId();
  return { entry: id, nodes: [legacyNode(id, st)], openEnds: [{ nodeId: id, field: "next" }] };
}

function mapEntryPoint(ep: EntryPoint, prefix: string): { entry: string | null; dialogue: DialogueNode[]; units: WriterUnit[] } {
  const ctx = makeContext(prefix);
  const units: WriterUnit[] = [];
  const { entry, nodes } = mapStatements(ep.body, ctx, units);
  return { entry, dialogue: nodes, units };
}

export function mapNpcScript(ast: NpcScriptAst): NpcMapResult {
  return mapNpcScriptWithUnits(ast);
}

/** o `EntrySourceMap` de um entry point — `bodyStart` vem direto do
 * `EntryPoint.bodyStart` do AST (não recalculado aqui), `units` é a
 * partição de topo-de-nível na ORDEM em que aparecem no corpo original. Os
 * dois juntos bastam pro Writer reconstruir o corpo inteiro por
 * concatenação contígua (`unit[i].start = unit[i-1].end`, começando em
 * `bodyStart`) sem depender do Printer pra nada que não mudou. */
export interface EntrySourceMap {
  bodyStart?: number;
  bodyEnd?: number;
  units: WriterUnit[];
}

export interface NpcMapResultWithUnits extends NpcMapResult {
  mainSourceMap: EntrySourceMap;
  /** por rótulo (mesma chave de `eventHandlers[].label`) */
  handlerSourceMaps: Record<string, EntrySourceMap>;
}

export function mapNpcScriptWithUnits(ast: NpcScriptAst): NpcMapResultWithUnits {
  const [main, ...rest] = ast.entryPoints;
  const mainMapped = main ? mapEntryPoint(main, "n") : { entry: null, dialogue: [], units: [] };

  const handlerSourceMaps: Record<string, EntrySourceMap> = {};
  const eventHandlers: NpcEventHandler[] = rest.map((ep, i) => {
    const mapped = mapEntryPoint(ep, `h${i}_`);
    handlerSourceMaps[ep.label!] = { bodyStart: ep.bodyStart, bodyEnd: ep.bodyEnd, units: mapped.units };
    return { label: ep.label!, entry: mapped.entry, dialogue: mapped.dialogue };
  });

  return {
    dialogueEntry: mainMapped.entry,
    dialogue: mainMapped.dialogue,
    eventHandlers,
    mainSourceMap: { bodyStart: main?.bodyStart, bodyEnd: main?.bodyEnd, units: mainMapped.units },
    handlerSourceMaps,
  };
}
