import type { NpcScriptAst, Statement, Expr, EntryPoint } from "./npc-script-ast";
import type { NpcMapResult } from "./npc-script-mapper";
import { DialogueNodeSchema, NpcEventHandlerSchema } from "../npc";

/**
 * Validator do módulo NPCs (leia1.txt, 2026-08-07/08 — "Validator antes do
 * Writer"). Duas camadas, como pedido:
 *
 * 1. ESTRUTURAL — o que dá pra provar sem depender do servidor: entry
 *    points (rótulo duplicado/vazio, `dialogueEntry`×`eventHandlers` sem
 *    colidir), e uma varredura EXAUSTIVA da AST (todo `Statement`/`Expr`
 *    visitado — `assertNever` faz o TypeScript recusar compilar se um nó
 *    novo for adicionado ao AST sem o walker aprender a visitá-lo, que é a
 *    garantia concreta pedida em "nenhum nó pode desaparecer
 *    silenciosamente").
 * 2. REFERÊNCIAS SEMÂNTICAS — só onde a referência é ESTATICAMENTE
 *    identificável (literal). Dinâmica (`warp(.@map$,...)`) nunca vira
 *    `invalid` — vira `unknown`, porque o rAthena aceita perfeitamente e
 *    inventar uma regra aqui seria o Validator proibindo o que o servidor
 *    permite (leia1.txt §3: "NÃO transforme heurísticas em validações
 *    obrigatórias").
 *
 * `goto`/`donpcevent` são tratados SEPARADOS (leia1.txt §4): `goto` resolve
 * dentro do MESMO NPC (confirmado em `rathena/src/map/script.cpp`,
 * `buildin_goto` — o alvo é uma posição de bytecode dentro do MESMO
 * `script_code` compilado, e um NPC inteiro — corpo principal + TODOS os
 * `On*:` — compila como uma unidade só; por isso o universo de rótulos
 * pra `goto` é `entryPoints[].label` ∪ rótulos ANINHADOS, nunca só o
 * entry point onde o `goto` está); `donpcevent("Npc::Label")` mira OUTRO
 * NPC e só é resolvível com um índice do CORPUS inteiro (`npcEventExists`
 * é opcional na interface de catálogos por isso — sem ele, todo
 * `donpcevent` vira `unknown`, nunca `invalid` por omissão).
 *
 * **Achado da auditoria, com consequência direta na regra de "safe to
 * write" (leia1.txt §7.8)**: `legacyScript.legacySource` vem do
 * `printStatement` (Printer) — reformatado (sem espaço em torno de
 * operador, comando clássico sem parênteses reemitido COM parênteses,
 * comentários removidos), não uma FATIA literal do arquivo original. Isso
 * significa que hoje NENHUM NPC com `legacyScript` pode ser certificado
 * como reconstruível byte-a-byte a partir só do `NpcSchema` — só
 * SEMANTICAMENTE equivalente (round-trip ESTRUTURAL, já provado pelo gate
 * do Parser). `safeToWrite` trata isso como bloqueio, de propósito e sem
 * exceção, até essa questão ser resolvida e aprovada em separado (não é
 * "corrigido em silêncio" — é a regra mais conservadora que a instrução
 * pede: "não considere legacyScript como perda aceitável").
 */

// ---------------------------------------------------------------------------
// Catálogos — resolução de referência estática, injetada (Node-side lê
// items.json/skills.json/monsters.json/map_index.txt; este arquivo é puro).
// ---------------------------------------------------------------------------

export type RefStatus = "valid" | "invalid" | "unknown";

export interface NpcCatalogs {
  mapExists(mapId: string): boolean;
  itemExists(itemId: number): boolean;
  skillExists(skillId: number): boolean;
  monsterExists(monsterId: number): boolean;
  /** cross-NPC — precisa do CORPUS inteiro mapeado antes de existir.
   * Ausente = toda referência de `donpcevent` fica `unknown` (nunca
   * `invalid` por falta de catálogo). */
  npcEventExists?(npcName: string, label: string | null): boolean;
}

export interface RefTally {
  valid: number;
  invalid: number;
  unknown: number;
}

function emptyTally(): RefTally {
  return { valid: 0, invalid: 0, unknown: 0 };
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface NpcValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** rótulo do entry point onde ocorreu; `null` = corpo principal. */
  entryPoint?: string | null;
  line?: number;
}

export interface NpcValidationReport {
  issues: NpcValidationIssue[];
  labels: { total: number; duplicates: string[]; empty: number };
  gotos: { total: number; resolved: number; missing: number; dynamic: number };
  donpcevents: { total: number; resolved: number; missing: number; dynamic: number };
  references: { maps: RefTally; items: RefTally; skills: RefTally; monsters: RefTally };
  legacyStatements: { total: number; byCallee: Record<string, number> };
  eventHandlers: { total: number; labels: string[] };
  /** achados de perda de informação ESPECÍFICOS deste NPC (não a lista
   * sistêmica do módulo — essa vive só na documentação, pra não repetir
   * a mesma string em milhares de relatórios). Vazio ≠ "sem perda
   * nenhuma" — ver doc do módulo pros achados sistêmicos. */
  informationLoss: string[];
  safeToWrite: boolean;
  blockers: string[];
  /** classificação de 3 vias pedida em leia1.txt §10 ("valid/invalid/
   * unknown"), no vocabulário do próprio §6: `invalid` = tem issue de
   * severidade `error` (rótulo duplicado/vazio, goto órfão, referência
   * inválida, colisão de id, schema); `unknown` = sintaxe válida e ZERO
   * erro, mas contém `legacyScript` ("valid syntax + unsupported semantic
   * mapping", a frase exata do §6); `valid` = zero erro e zero
   * legacyScript. NÃO é o mesmo eixo que `safeToWrite` — um NPC pode ser
   * `unknown` (sem erro nenhum) e ainda assim `safeToWrite: false` por
   * causa do bloqueio de fidelidade do §7.8. */
  classification: "valid" | "invalid" | "unknown";
}

// ---------------------------------------------------------------------------
// Passo 1 — assertNever: se um `kind` novo entrar em `Statement`/`Expr` sem
// este arquivo aprender a visitá-lo, isto para de compilar. É a garantia
// "nenhum nó desaparece silenciosamente" em forma de erro de build, não de
// disciplina.
// ---------------------------------------------------------------------------

function assertNever(x: never, where: string): never {
  throw new Error(`nó não tratado em ${where}: ${JSON.stringify(x)}`);
}

/** Strings mágicas do rAthena aceitas no lugar de um nome de mapa de
 * verdade — achado ao investigar os 3 primeiros "invalid" do corpus real
 * (`npc/cities/rachel.txt:320` e `npc/quests/quests_13_1.txt` usavam
 * `warp "Random",...`/`warp "SavePoint",...`, script.cpp:5642-5645).
 * `"this"` (mapa do próprio NPC) vale pra QUALQUER comando que recebe mapa
 * — é um padrão universal do rAthena (`strcmp(mapname,"this")`, dezenas de
 * ocorrências em `buildin_*`, ex. script.cpp:8208/14390/20093). As demais
 * (`Random`/`Save`/`SavePoint`/`SavePointAll`/`Leader`/`RandomAll`) só
 * existem na família `warp*` (script.cpp:5642-5645 `warp`, 5804-5809
 * `warpparty`, 5954-5957 `warpguild`, 13274-13275 `warpwaitingpc`) —
 * `monster`/`killmonster`/etc. não as reconhecem, então não entram na
 * allowlist universal. */
const MAP_MAGIC_UNIVERSAL = new Set(["this"]);
const MAP_MAGIC_WARP = new Set(["Random", "Save", "SavePoint", "SavePointAll", "Leader", "RandomAll"]);

/** callee (lowercase) → posições de argumento que são referência estática
 * conhecida. Lista PEQUENA e deliberada (leia1.txt §3): cada entrada aqui
 * é um comando cuja assinatura eu conferi em `rathena/src/map/script.cpp`
 * (`buildin_*`). Ampliar é seguro — é só adicionar mais uma linha —, mas
 * cada uma precisa da mesma conferência; não adivinhar posição de argumento
 * por nome de comando parecido. */
type RefKind = "map" | "item" | "skill" | "monster";
const KNOWN_REF_ARGS: Record<string, { index: number; kind: RefKind; mapMagic?: ReadonlySet<string> }[]> = {
  warp: [{ index: 0, kind: "map", mapMagic: MAP_MAGIC_WARP }],
  warpparty: [{ index: 0, kind: "map", mapMagic: MAP_MAGIC_WARP }],
  warpguild: [{ index: 0, kind: "map", mapMagic: MAP_MAGIC_WARP }],
  getitem: [{ index: 0, kind: "item" }],
  getitem2: [{ index: 0, kind: "item" }],
  getitembound: [{ index: 0, kind: "item" }],
  delitem: [{ index: 0, kind: "item" }],
  delitem2: [{ index: 0, kind: "item" }],
  countitem: [{ index: 0, kind: "item" }],
  countitem2: [{ index: 0, kind: "item" }],
  checkweight: [{ index: 0, kind: "item" }],
  checkweight2: [{ index: 0, kind: "item" }],
  skill: [{ index: 0, kind: "skill" }],
  addtoskill: [{ index: 0, kind: "skill" }],
  getskilllv: [{ index: 0, kind: "skill" }],
  monster: [
    { index: 0, kind: "map" },
    { index: 4, kind: "monster" },
  ],
  areamonster: [
    { index: 0, kind: "map" },
    { index: 6, kind: "monster" },
  ],
  killmonster: [{ index: 0, kind: "map" }],
  killmonsterall: [{ index: 0, kind: "map" }],
  mobcount: [{ index: 0, kind: "map" }],
  mapwarp: [{ index: 0, kind: "map" }],
};

// ---------------------------------------------------------------------------
// Rastreio interno durante a varredura — uma passada só faz tudo (statement
// + expressão), pra nenhum `Call` aninhado dentro de condição/expressão
// escapar da varredura de referência.
// ---------------------------------------------------------------------------

interface Trace {
  labels: Set<string>;
  gotos: { target: Expr; line: number }[];
  donpcevents: { arg: Expr; line: number }[];
  refs: { kind: RefKind; arg: Expr; mapMagic?: ReadonlySet<string> }[];
  legacyCandidateCounts: { statements: number };
}

function walkExpr(e: Expr, trace: Trace): void {
  switch (e.kind) {
    case "IntLit":
    case "StringLit":
    case "Ident":
      return;
    case "Call": {
      const lower = e.callee.toLowerCase();
      if (lower === "donpcevent") {
        trace.donpcevents.push({ arg: e.args[0]!, line: -1 });
      } else if (lower === "goto") {
        trace.gotos.push({ target: e.args[0]!, line: -1 });
      } else {
        const known = KNOWN_REF_ARGS[lower];
        if (known) {
          for (const { index, kind, mapMagic } of known) {
            const arg = e.args[index];
            if (arg) trace.refs.push({ kind, arg, mapMagic });
          }
        }
      }
      for (const a of e.args) walkExpr(a, trace);
      return;
    }
    case "Index":
      walkExpr(e.target, trace);
      walkExpr(e.index, trace);
      return;
    case "Unary":
      walkExpr(e.operand, trace);
      return;
    case "Binary":
      walkExpr(e.left, trace);
      walkExpr(e.right, trace);
      return;
    case "Assign":
      walkExpr(e.target, trace);
      walkExpr(e.value, trace);
      return;
    case "Ternary":
      walkExpr(e.test, trace);
      walkExpr(e.consequent, trace);
      walkExpr(e.alternate, trace);
      return;
    default:
      return assertNever(e, "walkExpr");
  }
}

/** `identificador:` isolado — o rótulo ANINHADO (profundidade > 0) que o
 * Parser não promove a EntryPoint (achado da auditoria original, 22/249
 * fallbacks do gate eram exatamente isso). Continua opaco pro Mapper, mas o
 * Validator sabe reconhecer o PADRÃO — não é o nó estruturado, é
 * casamento de texto sobre o fallback, documentado como tal. */
const NESTED_LABEL_RE = /^(\S+):$/;

function walkStatement(st: Statement, trace: Trace): void {
  switch (st.kind) {
    case "CallStatement": {
      const lower = st.callee.toLowerCase();
      if (lower === "donpcevent") {
        trace.donpcevents.push({ arg: st.args[0] ?? { kind: "Ident", name: "" }, line: st.line });
      } else if (lower === "goto") {
        trace.gotos.push({ target: st.args[0] ?? { kind: "Ident", name: "" }, line: st.line });
      } else {
        const known = KNOWN_REF_ARGS[lower];
        if (known) {
          for (const { index, kind, mapMagic } of known) {
            const arg = st.args[index];
            if (arg) trace.refs.push({ kind, arg, mapMagic });
          }
        }
      }
      for (const a of st.args) walkExpr(a, trace);
      return;
    }
    case "ExprStatement":
      walkExpr(st.expr, trace);
      return;
    case "SetStatement":
      walkExpr(st.target, trace);
      walkExpr(st.value, trace);
      return;
    case "IfStatement":
      walkExpr(st.test, trace);
      for (const c of st.consequent) walkStatement(c, trace);
      if (st.alternate) for (const c of st.alternate) walkStatement(c, trace);
      return;
    case "SwitchStatement":
      walkExpr(st.discriminant, trace);
      for (const c of st.cases) {
        if (c.test) walkExpr(c.test, trace);
        for (const b of c.body) walkStatement(b, trace);
      }
      return;
    case "WhileStatement":
      walkExpr(st.test, trace);
      for (const b of st.body) walkStatement(b, trace);
      return;
    case "DoWhileStatement":
      for (const b of st.body) walkStatement(b, trace);
      walkExpr(st.test, trace);
      return;
    case "ForStatement":
      if (st.init) walkStatement(st.init, trace);
      if (st.test) walkExpr(st.test, trace);
      if (st.update) walkStatement(st.update, trace);
      for (const b of st.body) walkStatement(b, trace);
      return;
    case "BlockStatement":
      for (const b of st.body) walkStatement(b, trace);
      return;
    case "BreakStatement":
      return;
    case "RawStatement": {
      const m = NESTED_LABEL_RE.exec(st.text.trim());
      if (m) trace.labels.add(m[1]!);
      return;
    }
    default:
      return assertNever(st, "walkStatement");
  }
}

function resolveRef(kind: RefKind, arg: Expr, catalogs: NpcCatalogs, mapMagic?: ReadonlySet<string>): RefStatus {
  if (kind === "map") {
    if (arg.kind !== "StringLit") return "unknown";
    if (MAP_MAGIC_UNIVERSAL.has(arg.value) || mapMagic?.has(arg.value)) return "valid";
    return catalogs.mapExists(arg.value) ? "valid" : "invalid";
  }
  if (arg.kind !== "IntLit") return "unknown";
  if (kind === "item") return catalogs.itemExists(arg.value) ? "valid" : "invalid";
  if (kind === "skill") return catalogs.skillExists(arg.value) ? "valid" : "invalid";
  return catalogs.monsterExists(arg.value) ? "valid" : "invalid";
}

function tally(t: RefTally, status: RefStatus): void {
  if (status === "valid") t.valid++;
  else if (status === "invalid") t.invalid++;
  else t.unknown++;
}

// ---------------------------------------------------------------------------
// Entry points — rótulo duplicado/vazio, conflito principal×handlers.
// ---------------------------------------------------------------------------

function validateEntryPoints(ast: NpcScriptAst, issues: NpcValidationIssue[]): { total: number; duplicates: string[]; empty: number } {
  const seen = new Map<string, number>();
  let empty = 0;
  for (const ep of ast.entryPoints) {
    if (ep.label === null) continue; // corpo principal — não é rótulo
    if (ep.label.trim() === "") {
      empty++;
      issues.push({ severity: "error", code: "empty-label", message: "entry point com rótulo vazio", entryPoint: ep.label, line: ep.line });
      continue;
    }
    seen.set(ep.label, (seen.get(ep.label) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([label]) => label);
  for (const label of duplicates) {
    issues.push({ severity: "error", code: "duplicate-label", message: `rótulo "${label}" aparece mais de uma vez neste NPC`, entryPoint: label });
  }
  const labeled = ast.entryPoints.filter((ep) => ep.label !== null);
  return { total: labeled.length, duplicates, empty };
}

function validateMapperInvariants(mapped: NpcMapResult, issues: NpcValidationIssue[]): void {
  // Todo id de nó tem que ser ÚNICO entre corpo principal e handlers, e
  // entre handlers — é a forma concreta de "conflito entre diálogo
  // principal e eventHandlers" (leia1.txt §2.1): o Mapper prefixa por
  // contexto ("n"/"h0_"/"h1_"/...) precisamente pra isto nunca acontecer;
  // esta checagem prova que a garantia se sustenta, em vez de assumir.
  const seenIds = new Map<string, string>(); // id -> onde
  const check = (nodes: { id: string }[], where: string) => {
    for (const n of nodes) {
      const prev = seenIds.get(n.id);
      if (prev) {
        issues.push({ severity: "error", code: "node-id-collision", message: `id de nó "${n.id}" usado em "${prev}" e em "${where}"`, entryPoint: where === "principal" ? null : where });
      }
      seenIds.set(n.id, where);
    }
  };
  check(mapped.dialogue, "principal");
  for (const h of mapped.eventHandlers) check(h.dialogue, h.label);

  // schema — dupla checagem: o Mapper já foi provado (teste do corpus,
  // 0 falhas) mas o Validator não deve ASSUMIR isso pra sempre.
  for (const node of mapped.dialogue) {
    const parsed = DialogueNodeSchema.safeParse(node);
    if (!parsed.success) issues.push({ severity: "error", code: "schema-invalid", message: `nó "${node.id}": ${parsed.error.message}`, entryPoint: null });
  }
  for (const h of mapped.eventHandlers) {
    const parsed = NpcEventHandlerSchema.safeParse(h);
    if (!parsed.success) issues.push({ severity: "error", code: "schema-invalid", message: `eventHandler "${h.label}": ${parsed.error.message}`, entryPoint: h.label });
  }
}

// ---------------------------------------------------------------------------
// legacyScript — métricas (leia1.txt §6: nunca invalida sozinho, mas produz
// número por callee/arquivo/percentual).
// ---------------------------------------------------------------------------

function categorizeLegacy(text: string): string {
  const first = text.trim().split(/[\s(]/)[0] ?? "(vazio)";
  return first;
}

function collectLegacyStatements(mapped: NpcMapResult): { total: number; byCallee: Record<string, number> } {
  const byCallee: Record<string, number> = {};
  let total = 0;
  const all = [...mapped.dialogue, ...mapped.eventHandlers.flatMap((h) => h.dialogue)];
  for (const node of all) {
    if (node.kind === "action" && node.action?.kind === "legacyScript") {
      total++;
      const cat = categorizeLegacy(node.action.legacySource);
      byCallee[cat] = (byCallee[cat] ?? 0) + 1;
    }
  }
  return { total, byCallee };
}

// ---------------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------------

export function validateNpcScript(ast: NpcScriptAst, mapped: NpcMapResult, catalogs: NpcCatalogs): NpcValidationReport {
  const issues: NpcValidationIssue[] = [];

  const labels = validateEntryPoints(ast, issues);
  validateMapperInvariants(mapped, issues);

  // varredura única — statements + expressões de TODOS os entry points.
  const trace: Trace = { labels: new Set(), gotos: [], donpcevents: [], refs: [], legacyCandidateCounts: { statements: 0 } };
  for (const ep of ast.entryPoints) {
    if (ep.label) trace.labels.add(ep.label);
    for (const st of ep.body) walkStatement(st, trace);
  }

  // goto — universo = rótulos de entry point ∪ rótulos aninhados (mesmo
  // script_code compilado, script.cpp:buildin_goto — ver doc do módulo).
  let gotoResolved = 0;
  let gotoMissing = 0;
  let gotoDynamic = 0;
  for (const g of trace.gotos) {
    if (g.target.kind !== "Ident") {
      gotoDynamic++;
      continue;
    }
    if (trace.labels.has(g.target.name)) {
      gotoResolved++;
    } else {
      gotoMissing++;
      issues.push({ severity: "error", code: "goto-missing", message: `goto "${g.target.name}" não resolve pra nenhum rótulo deste NPC`, line: g.line >= 0 ? g.line : undefined });
    }
  }

  // donpcevent — separado de goto por definição (mira OUTRO NPC).
  let donpcResolved = 0;
  let donpcMissing = 0;
  let donpcDynamic = 0;
  for (const d of trace.donpcevents) {
    if (d.arg.kind !== "StringLit") {
      donpcDynamic++;
      continue;
    }
    if (!catalogs.npcEventExists) {
      donpcDynamic++; // sem catálogo cross-NPC — não INVENTAR resposta.
      continue;
    }
    const raw = d.arg.value;
    const sep = raw.indexOf("::");
    const npcName = sep === -1 ? raw : raw.slice(0, sep);
    const label = sep === -1 ? null : raw.slice(sep + 2);
    if (sep === -1) {
      donpcDynamic++;
      issues.push({ severity: "warning", code: "donpcevent-format", message: `donpcevent("${raw}") sem separador "::" — formato não reconhecido, tratado como unknown` });
      continue;
    }
    if (catalogs.npcEventExists(npcName, label)) {
      donpcResolved++;
    } else {
      donpcMissing++;
      issues.push({ severity: "warning", code: "donpcevent-missing", message: `donpcevent("${raw}") não resolve pra nenhum NPC/rótulo conhecido` });
    }
  }

  // referências estáticas (map/item/skill/monster).
  const references = { maps: emptyTally(), items: emptyTally(), skills: emptyTally(), monsters: emptyTally() };
  const tallyKey: Record<RefKind, keyof typeof references> = { map: "maps", item: "items", skill: "skills", monster: "monsters" };
  for (const r of trace.refs) {
    const status = resolveRef(r.kind, r.arg, catalogs, r.mapMagic);
    tally(references[tallyKey[r.kind]], status);
    if (status === "invalid") {
      const shown = r.arg.kind === "StringLit" ? r.arg.value : r.arg.kind === "IntLit" ? r.arg.value : "?";
      issues.push({ severity: "error", code: `${r.kind}-invalid`, message: `referência de ${r.kind} "${shown}" não existe no catálogo` });
    }
  }

  const legacyStatements = collectLegacyStatements(mapped);

  const blockers: string[] = [];
  if (labels.duplicates.length > 0) blockers.push(`${labels.duplicates.length} rótulo(s) duplicado(s)`);
  if (labels.empty > 0) blockers.push(`${labels.empty} rótulo(s) vazio(s)`);
  if (gotoMissing > 0) blockers.push(`${gotoMissing} goto(s) órfão(s)`);
  if (references.maps.invalid > 0) blockers.push(`${references.maps.invalid} referência(s) de mapa inválida(s)`);
  if (references.items.invalid > 0) blockers.push(`${references.items.invalid} referência(s) de item inválida(s)`);
  if (references.skills.invalid > 0) blockers.push(`${references.skills.invalid} referência(s) de skill inválida(s)`);
  if (references.monsters.invalid > 0) blockers.push(`${references.monsters.invalid} referência(s) de monstro inválida(s)`);
  if (issues.some((i) => i.code === "node-id-collision")) blockers.push("colisão de id de nó entre principal/eventHandlers");
  if (issues.some((i) => i.code === "schema-invalid")) blockers.push("saída do Mapper não valida contra o schema");
  if (legacyStatements.total > 0) {
    blockers.push(
      `${legacyStatements.total} statement(s) em legacyScript — texto vem do Printer (reformatado), não é fatia literal do arquivo original; leia1.txt §7.8 não permite considerar isso perda aceitável`,
    );
  }

  const hasError = issues.some((i) => i.severity === "error");
  const classification: NpcValidationReport["classification"] = hasError ? "invalid" : legacyStatements.total > 0 ? "unknown" : "valid";

  return {
    issues,
    labels,
    gotos: { total: trace.gotos.length, resolved: gotoResolved, missing: gotoMissing, dynamic: gotoDynamic },
    donpcevents: { total: trace.donpcevents.length, resolved: donpcResolved, missing: donpcMissing, dynamic: donpcDynamic },
    references,
    legacyStatements,
    eventHandlers: { total: mapped.eventHandlers.length, labels: mapped.eventHandlers.map((h) => h.label) },
    informationLoss: [],
    safeToWrite: blockers.length === 0,
    blockers,
    classification,
  };
}
