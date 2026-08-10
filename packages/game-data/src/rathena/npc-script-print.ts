import type { Expr, Statement, NpcScriptAst } from "./npc-script-ast";

/**
 * Pretty printer — camada de SINTAXE, não de decisão (leia1.txt: "o Pretty
 * Printer deve apenas formatar o código"). Único trabalho: transformar a
 * AST de volta em texto que, reparseado, produz uma AST estruturalmente
 * IDÊNTICA — não tenta bater byte a byte com o `.txt` original (isso é
 * responsabilidade do Writer, fase futura, que precisa preservar região
 * não editada verbatim). Sub-expressões sempre entre parênteses quando não
 * são o nó raiz — verboso, mas elimina qualquer risco de bug de
 * precedência nesta fase; encurtar a saída é problema de "ficar bonito",
 * não de corretude, e fica pra depois.
 *
 * Mora em `game-data` (não em `tools/legacy-migration`) porque é puro —
 * sem fs — e o Mapper (`npc-script-mapper.ts`) precisa dele pra serializar
 * o texto de um statement/expressão NÃO reconhecido no escape-hatch
 * `legacyScript.legacySource`, e o Mapper também mora aqui.
 */

export function printExpr(e: Expr, topLevel = false): string {
  switch (e.kind) {
    case "IntLit":
      return String(e.value);
    case "StringLit":
      return `"${e.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "Ident":
      return e.name;
    case "Call":
      return `${e.callee}(${e.args.map((a) => printExpr(a, true)).join(",")})`;
    case "Index":
      return `${printExpr(e.target)}[${printExpr(e.index, true)}]`;
    case "Unary":
      return `${e.op}${printExpr(e.operand)}`;
    case "Binary": {
      const s = `${printExpr(e.left)}${e.op}${printExpr(e.right)}`;
      return topLevel ? s : `(${s})`;
    }
    case "Assign": {
      const s = `${printExpr(e.target)}${e.op}${printExpr(e.value, true)}`;
      return topLevel ? s : `(${s})`;
    }
    case "Ternary": {
      const s = `${printExpr(e.test)}?${printExpr(e.consequent, true)}:${printExpr(e.alternate, true)}`;
      return topLevel ? s : `(${s})`;
    }
  }
}

export function printStatement(st: Statement, indent: string): string {
  switch (st.kind) {
    case "CallStatement":
      return `${indent}${st.callee}(${st.args.map((a) => printExpr(a, true)).join(",")});`;
    case "ExprStatement":
      return `${indent}${printExpr(st.expr, true)};`;
    case "SetStatement":
      return `${indent}set ${printExpr(st.target, true)},${printExpr(st.value, true)};`;
    case "IfStatement": {
      let out = `${indent}if (${printExpr(st.test, true)}) {\n`;
      out += st.consequent.map((c) => printStatement(c, indent + "\t")).join("\n");
      out += `\n${indent}}`;
      if (st.alternate) {
        out += ` else {\n${st.alternate.map((c) => printStatement(c, indent + "\t")).join("\n")}\n${indent}}`;
      }
      return out;
    }
    case "SwitchStatement": {
      let out = `${indent}switch (${printExpr(st.discriminant, true)}) {\n`;
      for (const c of st.cases) {
        out += `${indent}\t${c.test ? `case ${printExpr(c.test, true)}` : "default"}:\n`;
        out += c.body.map((b) => printStatement(b, indent + "\t\t")).join("\n") + "\n";
      }
      out += `${indent}}`;
      return out;
    }
    case "WhileStatement": {
      let out = `${indent}while (${printExpr(st.test, true)}) {\n`;
      out += st.body.map((b) => printStatement(b, indent + "\t")).join("\n");
      out += `\n${indent}}`;
      return out;
    }
    case "DoWhileStatement": {
      let out = `${indent}do {\n`;
      out += st.body.map((b) => printStatement(b, indent + "\t")).join("\n");
      out += `\n${indent}} while (${printExpr(st.test, true)});`;
      return out;
    }
    case "ForStatement": {
      const init = st.init ? printStatement(st.init, "").replace(/;$/, "") : "";
      const test = st.test ? printExpr(st.test, true) : "";
      const update = st.update ? printStatement(st.update, "").replace(/;$/, "") : "";
      let out = `${indent}for (${init}; ${test}; ${update}) {\n`;
      out += st.body.map((b) => printStatement(b, indent + "\t")).join("\n");
      out += `\n${indent}}`;
      return out;
    }
    case "BlockStatement":
      return `${indent}{\n${st.body.map((b) => printStatement(b, indent + "\t")).join("\n")}\n${indent}}`;
    case "BreakStatement":
      return `${indent}break;`;
    case "RawStatement":
      return `${indent}${st.text}`;
  }
}

export function printNpcScript(ast: NpcScriptAst): string {
  const parts: string[] = [];
  for (const ep of ast.entryPoints) {
    if (ep.label) parts.push(`${ep.label}:`);
    parts.push(ep.body.map((s) => printStatement(s, "\t")).join("\n"));
  }
  return parts.join("\n");
}
