import type { Expr, Statement, EntryPoint, NpcScriptAst } from "@ragnarok/game-data";
import { tokenize, type Token } from "./lexer";

/**
 * Parser do script de NPC — gramática de statement + Pratt parser de
 * expressão (leia1.txt, aprovação da arquitetura, 2026-08-07).
 *
 * **Recuperação por statement, não por arquivo**: cada `parseStatement()`
 * roda dentro de um checkpoint; qualquer erro de parse resincroniza até o
 * próximo `;`/`}` de nível zero e devolve `RawStatement` com o texto
 * pulado — a estrutura AO REDOR (o `if`/`switch`/`while` que estava sendo
 * parseado) nunca é perdida, só aquele statement específico fica opaco.
 * É a implementação concreta do requisito "fallback no menor nó sintático
 * necessário".
 */

class ParseError extends Error {}

const ASSIGN_OPS = new Set(["=", "+=", "-=", "&=", "|=", "^="]);
/** precedência C-padrão com bitwise inserido entre lógico e igualdade
 * (`|` < `^` < `&` < `==`) — achado do gate: `dmdswrd_Q2 | 1`,
 * `PCBLOCK_NPC ^ PCBLOCK_MOVE`, `jitterbug_options &= ~1` aparecem de
 * verdade e não tinham NENHUM operador bitwise reconhecido. */
const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "|": 3,
  "^": 4,
  "&": 5,
  "==": 6,
  "!=": 6,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  "+": 8,
  "-": 8,
  "*": 9,
  "/": 9,
  "%": 9,
};

class TokenStream {
  constructor(
    public tokens: Token[],
    public pos = 0,
  ) {}
  peek(off = 0): Token {
    return this.tokens[Math.min(this.pos + off, this.tokens.length - 1)]!;
  }
  advance(): Token {
    const t = this.peek();
    if (t.type !== "EOF") this.pos++;
    return t;
  }
  isPunct(v: string): boolean {
    const t = this.peek();
    return t.type === "Punct" && t.value === v;
  }
  isIdent(v: string): boolean {
    const t = this.peek();
    return t.type === "Ident" && t.value.toLowerCase() === v;
  }
  expectPunct(v: string): void {
    if (!this.isPunct(v)) throw new ParseError(`esperava "${v}", achou "${this.peek().value}" (linha ${this.peek().line})`);
    this.advance();
  }
}

// ---------------------------------------------------------------------------
// Expressões — Pratt / precedence climbing
// ---------------------------------------------------------------------------

function parsePrimary(s: TokenStream): Expr {
  const t = s.peek();
  if (t.type === "Int") {
    s.advance();
    return { kind: "IntLit", value: t.intValue! };
  }
  if (t.type === "String") {
    s.advance();
    return { kind: "StringLit", value: t.value };
  }
  if (s.isPunct("(")) {
    s.advance();
    const e = parseAssign(s);
    s.expectPunct(")");
    return e;
  }
  if (s.isPunct("-") || s.isPunct("!") || s.isPunct("~")) {
    const op = s.advance().value as "-" | "!" | "~";
    return { kind: "Unary", op, operand: parseUnary(s) };
  }
  // `++x`/`--x` (pré-incremento) — dessuçarado direto pra `x+=1`/`x-=1`:
  // mesmo efeito como STATEMENT (o único contexto onde aparece no corpus,
  // tipicamente `for(...;...;++.@i)`), e assim o round-trip fecha sem
  // precisar de um nó de AST novo só pra isso.
  if (s.isPunct("++") || s.isPunct("--")) {
    const op = s.advance().value === "++" ? "+=" : "-=";
    const target = parsePrimary(s);
    return { kind: "Assign", op, target, value: { kind: "IntLit", value: 1 } };
  }
  if (t.type === "Ident") {
    s.advance();
    let expr: Expr = { kind: "Ident", name: t.value };
    if (s.isPunct("(")) {
      s.advance();
      const args: Expr[] = [];
      if (!s.isPunct(")")) {
        args.push(parseAssign(s));
        while (s.isPunct(",")) {
          s.advance();
          args.push(parseAssign(s));
        }
      }
      s.expectPunct(")");
      expr = { kind: "Call", callee: t.value, args };
    }
    while (s.isPunct("[")) {
      s.advance();
      const index = parseAssign(s);
      s.expectPunct("]");
      expr = { kind: "Index", target: expr, index };
    }
    // `x++`/`x--` (pós-incremento) — mesma dessuçarização de `++x`/`--x`.
    if (s.isPunct("++") || s.isPunct("--")) {
      const op = s.advance().value === "++" ? "+=" : "-=";
      expr = { kind: "Assign", op, target: expr, value: { kind: "IntLit", value: 1 } };
    }
    return expr;
  }
  throw new ParseError(`token inesperado "${t.value || t.type}" (linha ${t.line})`);
}

function parseUnary(s: TokenStream): Expr {
  return parsePrimary(s);
}

function parseBinary(s: TokenStream, minPrec: number): Expr {
  let left = parseUnary(s);
  for (;;) {
    const t = s.peek();
    if (t.type !== "Punct") break;
    const prec = BINARY_PRECEDENCE[t.value];
    if (prec === undefined || prec < minPrec) break;
    s.advance();
    const right = parseBinary(s, prec + 1);
    left = { kind: "Binary", op: t.value, left, right };
  }
  return left;
}

function parseTernary(s: TokenStream): Expr {
  const test = parseBinary(s, 1);
  if (s.isPunct("?")) {
    s.advance();
    const consequent = parseAssign(s);
    s.expectPunct(":");
    const alternate = parseAssign(s);
    return { kind: "Ternary", test, consequent, alternate };
  }
  return test;
}

function parseAssign(s: TokenStream): Expr {
  const left = parseTernary(s);
  const t = s.peek();
  if (t.type === "Punct" && ASSIGN_OPS.has(t.value)) {
    s.advance();
    const value = parseAssign(s);
    return { kind: "Assign", op: t.value as "=" | "+=" | "-=" | "&=" | "|=" | "^=", target: left, value };
  }
  return left;
}

/** exportado pro round-trip test conseguir parsear expressões isoladas. */
export function parseExpression(source: string): Expr {
  const s = new TokenStream(tokenize(source));
  const e = parseAssign(s);
  if (s.peek().type !== "EOF") throw new ParseError(`sobrou "${s.peek().value}" depois da expressão`);
  return e;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function parseCommaExprList(s: TokenStream): Expr[] {
  const args: Expr[] = [];
  if (s.isPunct(";")) return args;
  args.push(parseAssign(s));
  while (s.isPunct(",")) {
    s.advance();
    args.push(parseAssign(s));
  }
  return args;
}

function parseBlockOrSingle(s: TokenStream): Statement[] {
  if (s.isPunct("{")) {
    s.advance();
    const body: Statement[] = [];
    while (!s.isPunct("}") && s.peek().type !== "EOF") body.push(parseStatement(s));
    s.expectPunct("}");
    return body;
  }
  return [parseStatement(s)];
}

function parseStatementInner(s: TokenStream): Statement {
  const line = s.peek().line;

  if (s.isPunct("{")) return { kind: "BlockStatement", body: parseBlockOrSingle(s), line };

  if (s.isIdent("if")) {
    s.advance();
    s.expectPunct("(");
    const test = parseAssign(s);
    s.expectPunct(")");
    const consequent = parseBlockOrSingle(s);
    let alternate: Statement[] | null = null;
    if (s.isIdent("else")) {
      s.advance();
      alternate = parseBlockOrSingle(s);
    }
    return { kind: "IfStatement", test, consequent, alternate, line };
  }

  if (s.isIdent("while")) {
    s.advance();
    s.expectPunct("(");
    const test = parseAssign(s);
    s.expectPunct(")");
    const body = parseBlockOrSingle(s);
    return { kind: "WhileStatement", test, body, line };
  }

  if (s.isIdent("do")) {
    s.advance();
    const body = parseBlockOrSingle(s);
    if (!s.isIdent("while")) throw new ParseError(`esperava "while" depois de "do" (linha ${s.peek().line})`);
    s.advance();
    s.expectPunct("(");
    const test = parseAssign(s);
    s.expectPunct(")");
    s.expectPunct(";");
    return { kind: "DoWhileStatement", body, test, line };
  }

  if (s.isIdent("for")) {
    s.advance();
    s.expectPunct("(");
    const init = s.isPunct(";") ? null : parseStatement(s, { noSemi: true });
    s.expectPunct(";");
    const test = s.isPunct(";") ? null : parseAssign(s);
    s.expectPunct(";");
    const update = s.isPunct(")") ? null : parseStatement(s, { noSemi: true });
    s.expectPunct(")");
    const body = parseBlockOrSingle(s);
    return { kind: "ForStatement", init, test, update, body, line };
  }

  if (s.isIdent("switch")) {
    s.advance();
    s.expectPunct("(");
    const discriminant = parseAssign(s);
    s.expectPunct(")");
    s.expectPunct("{");
    const cases: { test: Expr | null; body: Statement[] }[] = [];
    while (!s.isPunct("}") && s.peek().type !== "EOF") {
      let test: Expr | null = null;
      if (s.isIdent("case")) {
        s.advance();
        test = parseAssign(s);
      } else if (s.isIdent("default")) {
        s.advance();
      } else {
        throw new ParseError(`esperava "case"/"default" (linha ${s.peek().line})`);
      }
      s.expectPunct(":");
      const body: Statement[] = [];
      while (!s.isIdent("case") && !s.isIdent("default") && !s.isPunct("}") && s.peek().type !== "EOF") {
        body.push(parseStatement(s));
      }
      cases.push({ test, body });
    }
    s.expectPunct("}");
    return { kind: "SwitchStatement", discriminant, cases, line };
  }

  if (s.isIdent("break")) {
    s.advance();
    s.expectPunct(";");
    return { kind: "BreakStatement", line };
  }

  if (s.isIdent("set")) {
    s.advance();
    const target = parseBinary(s, 1);
    s.expectPunct(",");
    const value = parseAssign(s);
    s.expectPunct(";");
    return { kind: "SetStatement", target, value, line };
  }

  // Ident em posição de statement: pode ser comando clássico sem parênteses
  // (`mes "x"; warp "prontera",150,150; close;`), chamada nova (`callfunc(
  // "F",1);`), atribuição bare (`.@x = 1;`) ou rótulo aninhado (`L1:`) —
  // desambiguado por LOOKAHEAD, não por lista fechada de nomes de comando.
  if (s.peek().type === "Ident") {
    const identTok = s.advance();
    if (s.isPunct(":")) {
      s.advance();
      // rótulo fora do nível de EntryPoint (ex.: goto local dentro de bloco)
      // — não modelado como ponto de entrada aqui; RawStatement preserva a
      // forma sem perder o resto do bloco ao redor.
      return { kind: "RawStatement", text: `${identTok.value}:`, line };
    }
    if (s.isPunct("(")) {
      s.advance();
      const args: Expr[] = [];
      if (!s.isPunct(")")) {
        args.push(parseAssign(s));
        while (s.isPunct(",")) {
          s.advance();
          args.push(parseAssign(s));
        }
      }
      s.expectPunct(")");
      // chamada pode ser statement puro OU início de expressão maior
      // (`foo() + 1;`, `foo(x) ? a : b;` — achado do gate:
      // `specialeffect2(hg_ubu01==6)?EF_CONE:EF_MVP;` usa exatamente essa
      // forma como comando "clássico" sem vírgula pro resultado).
      let expr: Expr = { kind: "Call", callee: identTok.value, args };
      const t = s.peek();
      if (t.type === "Punct" && BINARY_PRECEDENCE[t.value] !== undefined) {
        expr = continueBinary(s, expr, 1);
      }
      if (s.isPunct("?")) {
        s.advance();
        const consequent = parseAssign(s);
        s.expectPunct(":");
        const alternate = parseAssign(s);
        expr = { kind: "Ternary", test: expr, consequent, alternate };
      } else if (t.type === "Punct" && ASSIGN_OPS.has(t.value)) {
        s.advance();
        const value = parseAssign(s);
        expr = { kind: "Assign", op: t.value as "=" | "+=" | "-=" | "&=" | "|=" | "^=", target: expr, value };
      }
      s.expectPunct(";");
      if (expr.kind === "Call") return { kind: "CallStatement", callee: expr.callee, args: expr.args, line };
      return { kind: "ExprStatement", expr, line };
    }
    if (s.peek().type === "Punct" && ASSIGN_OPS.has(s.peek().value)) {
      const op = s.advance().value as "=" | "+=" | "-=" | "&=" | "|=" | "^=";
      const value = parseAssign(s);
      s.expectPunct(";");
      return { kind: "ExprStatement", expr: { kind: "Assign", op, target: { kind: "Ident", name: identTok.value }, value }, line };
    }
    if (s.isPunct(";")) {
      s.advance();
      return { kind: "CallStatement", callee: identTok.value, args: [], line };
    }
    // daqui em diante, `identTok` é ou (a) o operando esquerdo de uma
    // expressão solta (`.@x == 1;`, `.@arr[0];`, `.@x ? a : b;` — raro,
    // mas sintaticamente válido), ou (b) o CALLEE de um comando clássico
    // sem parênteses (`mes "x"; warp "a",1,2; close;` — o caso comum).
    // A distinção é: o token seguinte CONTINUA uma expressão a partir de
    // `identTok` (operador binário, `[`, `?`) ou COMEÇA um argumento novo
    // (string/número/outro identificador/`(`/unário) — achado do gate:
    // tratar `identTok` como o primeiro ARGUMENTO (em vez do CALLEE) fazia
    // `mes "oi";` inteiro cair em RawStatement, porque o argumento real
    // (a string) nunca era consumido.
    //
    // `-` fica de FORA desse gatilho de propósito: `percentheal -100,0;` é
    // command com PRIMEIRO ARGUMENTO negativo (142 ocorrências reais no
    // gate), não `percentheal MENOS 100` — subtração solta como statement
    // (resultado descartado) não ocorre de verdade no corpus.
    if (
      (s.peek().type === "Punct" && s.peek().value !== "-" && BINARY_PRECEDENCE[s.peek().value] !== undefined) ||
      s.isPunct("[") ||
      s.isPunct("?") ||
      s.isPunct("++") ||
      s.isPunct("--")
    ) {
      let left: Expr = { kind: "Ident", name: identTok.value };
      left = continuePostfix(s, left);
      let expr = continueBinary(s, left, 1);
      if (s.isPunct("?")) {
        s.advance();
        const consequent = parseAssign(s);
        s.expectPunct(":");
        const alternate = parseAssign(s);
        expr = { kind: "Ternary", test: expr, consequent, alternate };
      } else if (s.peek().type === "Punct" && ASSIGN_OPS.has(s.peek().value)) {
        // achado do gate: `.@card[.@slot-1] = .@bonus[.@i];` — atribuição
        // depois de um `[...]`/binário de continuação, nunca checada antes.
        const op = s.advance().value as "=" | "+=" | "-=" | "&=" | "|=" | "^=";
        const value = parseAssign(s);
        expr = { kind: "Assign", op, target: expr, value };
      }
      s.expectPunct(";");
      return { kind: "ExprStatement", expr, line };
    }
    // comando clássico: `identTok` é o CALLEE, os argumentos começam AQUI.
    const args = [parseAssign(s), ...restOfCommaList(s)];
    s.expectPunct(";");
    return { kind: "CallStatement", callee: identTok.value, args, line };
  }

  // statement que começa com uma expressão NÃO liderada por identificador —
  // achado do gate: `((donpcevent(...)+"...")+.@str$)+"::OnEnable";` é um
  // statement de expressão válido (efeito colateral descartado) que começa
  // com `(`, e nenhum ramo acima cobria isso (só o ramo de Ident tinha
  // lógica de "vira expressão solta"). Cobre `(`/unário/literal solto.
  if (s.isPunct("(") || s.isPunct("-") || s.isPunct("!") || s.isPunct("++") || s.isPunct("--") || s.peek().type === "Int" || s.peek().type === "String") {
    const expr = parseAssign(s);
    s.expectPunct(";");
    return { kind: "ExprStatement", expr, line };
  }

  throw new ParseError(`statement não reconhecido (linha ${line}): token "${s.peek().value || s.peek().type}"`);
}

function continuePostfix(s: TokenStream, expr: Expr): Expr {
  while (s.isPunct("[")) {
    s.advance();
    const index = parseAssign(s);
    s.expectPunct("]");
    expr = { kind: "Index", target: expr, index };
  }
  if (s.isPunct("++") || s.isPunct("--")) {
    const op = s.advance().value === "++" ? "+=" : "-=";
    expr = { kind: "Assign", op, target: expr, value: { kind: "IntLit", value: 1 } };
  }
  return expr;
}

function continueBinary(s: TokenStream, left: Expr, minPrec: number): Expr {
  for (;;) {
    const t = s.peek();
    if (t.type !== "Punct") break;
    const prec = BINARY_PRECEDENCE[t.value];
    if (prec === undefined || prec < minPrec) break;
    s.advance();
    const right = parseBinary(s, prec + 1);
    left = { kind: "Binary", op: t.value, left, right };
  }
  return left;
}

function restOfCommaList(s: TokenStream): Expr[] {
  const out: Expr[] = [];
  while (s.isPunct(",")) {
    s.advance();
    out.push(parseAssign(s));
  }
  return out;
}

/** resincroniza até o próximo `;`/`}` de nível zero, preservando o texto
 * cru do trecho pulado — é o fallback no MENOR nó sintático possível. */
function recover(s: TokenStream, startPos: number, line: number): Statement {
  s.pos = startPos;
  let depth = 0;
  const start = s.pos;
  while (s.peek().type !== "EOF") {
    if (s.isPunct("{")) depth++;
    else if (s.isPunct("}")) {
      if (depth === 0) break;
      depth--;
    } else if (s.isPunct(";") && depth === 0) {
      s.advance();
      break;
    }
    s.advance();
  }
  const text = s.tokens
    .slice(start, s.pos)
    .map((t) => (t.type === "String" ? `"${t.value}"` : t.value))
    .join(" ");
  return { kind: "RawStatement", text, line };
}

function parseStatement(s: TokenStream, opts?: { noSemi?: boolean }): Statement {
  const checkpoint = s.pos;
  const line = s.peek().line;
  const start = s.peek().start;
  let st: Statement;
  try {
    if (opts?.noSemi) {
      // usado só dentro de for(init; test; update) — sem ';' final próprio
      if (s.isIdent("set")) {
        s.advance();
        const target = parseBinary(s, 1);
        s.expectPunct(",");
        const value = parseAssign(s);
        st = { kind: "SetStatement", target, value, line };
      } else {
        const expr = parseAssign(s);
        st = { kind: "ExprStatement", expr, line };
      }
    } else {
      st = parseStatementInner(s);
    }
  } catch {
    st = recover(s, checkpoint, line);
  }
  // span de CARACTERE no texto-fonte (pro Writer, leia1.txt 2026-08-08) —
  // um ponto só de verdade, em vez de estampar em cada `return` de
  // `parseStatementInner`/`recover`. `s.pos - 1` é sempre o ÚLTIMO token
  // consumido por este statement (parou de avançar assim que terminou).
  const end = s.tokens[Math.max(s.pos - 1, checkpoint)]!.end;
  return { ...st, start, end };
}

// ---------------------------------------------------------------------------
// Programa — rótulos de nível zero viram EntryPoint separado
// ---------------------------------------------------------------------------

function splitEntryPointTokens(tokens: Token[]): { label: string | null; line: number; slice: Token[] }[] {
  const segments: { label: string | null; line: number; slice: Token[] }[] = [];
  let depth = 0;
  /** conta `?` pendentes sem `:` correspondente — achado do gate:
   * `(.@i%2)?.@treasurebox:1324` em nível zero (sem chaves ao redor) fazia
   * o `:` do ternário ser lido como fechamento de RÓTULO
   * (`.@treasurebox:`), cortando o statement ao meio. Um `:` só fecha
   * rótulo quando não há `?` pendente. */
  let ternaryDepth = 0;
  let currentLabel: string | null = null;
  let currentLine = tokens[0]?.line ?? 1;
  let start = 0;

  const flush = (endIdx: number) => {
    const eofPos = tokens[endIdx]?.start ?? tokens[tokens.length - 1]!.end;
    segments.push({
      label: currentLabel,
      line: currentLine,
      slice: [...tokens.slice(start, endIdx), { type: "EOF", value: "", line: currentLine, start: eofPos, end: eofPos }],
    });
  };

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.type === "EOF") break;
    if (t.type === "Punct" && t.value === "{") depth++;
    else if (t.type === "Punct" && t.value === "}") depth--;
    else if (t.type === "Punct" && t.value === "?") ternaryDepth++;
    else if (t.type === "Punct" && t.value === ":" && ternaryDepth > 0) ternaryDepth--;
    else if (
      depth === 0 &&
      ternaryDepth === 0 &&
      t.type === "Ident" &&
      tokens[i + 1]?.type === "Punct" &&
      tokens[i + 1]?.value === ":" &&
      t.value.toLowerCase() !== "case" &&
      t.value.toLowerCase() !== "default"
    ) {
      flush(i);
      currentLabel = t.value;
      currentLine = t.line;
      i += 2; // pula "Nome" ":"
      start = i;
      continue;
    }
    i++;
  }
  flush(tokens.findIndex((t) => t.type === "EOF") === -1 ? tokens.length : tokens.findIndex((t) => t.type === "EOF"));
  return segments;
}

export function parseNpcScript(source: string): NpcScriptAst {
  const tokens = tokenize(source);
  const segments = splitEntryPointTokens(tokens);
  const entryPoints: EntryPoint[] = segments.map((seg) => {
    const s = new TokenStream(seg.slice);
    const body: Statement[] = [];
    while (s.peek().type !== "EOF") body.push(parseStatement(s));
    // span de CARACTERE do CORPO deste entry point (sem o rótulo em si) —
    // `seg.slice` sempre termina num EOF sintético (`splitEntryPointTokens`),
    // então o último token DE VERDADE é o penúltimo. Corpo vazio (`OnInit:`
    // seguido de outro rótulo) não tem token real — span fica indefinido de
    // propósito, o Writer trata como "não sei onde fica, não mexo aí".
    const real = seg.slice.slice(0, -1);
    const bodyStart = real[0]?.start;
    const bodyEnd = real[real.length - 1]?.end;
    return { label: seg.label, body, line: seg.line, bodyStart, bodyEnd };
  });
  return { entryPoints };
}
