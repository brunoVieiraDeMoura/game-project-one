import type { DialogueNode } from "@ragnarok/game-data";

/**
 * Converte o corpo de um script NPC do rAthena numa árvore de diálogo
 * estruturada (soul.txt §5.5). Estratégia conservadora e honesta:
 * reconhece o prefixo linear de `mes`/`next`/`close`/`close2`/`end`;
 * no primeiro statement fora disso, o RESTANTE INTEIRO do script vira um
 * nó `action` com `legacyScript` + needsReview — nada é descartado, nada
 * é adivinhado.
 */

/** divide o corpo em statements de nível zero, respeitando strings e comentários */
export function splitStatements(code: string): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let i = 0;
  while (i < code.length) {
    const ch = code[i]!;
    const next2 = code.slice(i, i + 2);
    if (inString) {
      current += ch;
      if (ch === "\\" && i + 1 < code.length) {
        current += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (next2 === "//") {
      const nl = code.indexOf("\n", i);
      i = nl === -1 ? code.length : nl + 1;
      continue;
    }
    if (next2 === "/*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (ch === '"') {
      inString = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed !== "") statements.push(trimmed);
      current = "";
      i++;
      continue;
    }
    // labels de script ("L_Start:") terminam com ':' — mantidos no statement
    current += ch;
    i++;
  }
  const rest = current.trim();
  if (rest !== "") statements.push(rest);
  return statements;
}

const MES_RE = /^mes\s+"((?:[^"\\]|\\.)*)"$/;

export interface DialogueResult {
  entry: string | null;
  nodes: DialogueNode[];
  /** true quando o script inteiro foi convertido sem sobras */
  fullyParsed: boolean;
}

export function parseNpcDialogue(code: string, legacyRef: string): DialogueResult {
  const statements = splitStatements(code);
  if (statements.length === 0) return { entry: null, nodes: [], fullyParsed: true };

  const nodes: DialogueNode[] = [];
  let sayLines: string[] = [];
  let nodeCount = 0;
  const nextId = () => `n${nodeCount++}`;

  const flushSay = (nextRef: string | undefined): string | undefined => {
    if (sayLines.length === 0) return undefined;
    const id = nextId();
    nodes.push({ id, kind: "say", text: sayLines.join("\n"), next: nextRef });
    sayLines = [];
    return id;
  };

  // monta linearmente; resolve encadeamento no fim (nós criados em ordem)
  for (let s = 0; s < statements.length; s++) {
    const stmt = statements[s]!;
    const mes = stmt.match(MES_RE);
    if (mes) {
      sayLines.push(mes[1]!.replace(/\\"/g, '"'));
      continue;
    }
    if (stmt === "next") {
      flushSay(undefined);
      continue;
    }
    if (stmt === "close" || stmt === "close2" || stmt === "end") {
      flushSay(undefined);
      nodes.push({ id: nextId(), kind: "end" });
      // statements após close/end (labels OnInit etc.) → flagged se existirem
      const remaining = statements.slice(s + 1);
      if (remaining.length > 0) {
        nodes.push({
          id: nextId(),
          kind: "action",
          action: {
            kind: "legacyScript",
            needsReview: true,
            legacySource: `${legacyRef} :: ${remaining.join(";\n")}`,
          },
        });
        return { entry: chain(nodes), nodes, fullyParsed: false };
      }
      return { entry: chain(nodes), nodes, fullyParsed: true };
    }
    // primeiro statement não reconhecido → resto inteiro vira legacyScript
    flushSay(undefined);
    const remaining = statements.slice(s);
    nodes.push({
      id: nextId(),
      kind: "action",
      action: {
        kind: "legacyScript",
        needsReview: true,
        legacySource: `${legacyRef} :: ${remaining.join(";\n")}`,
      },
    });
    return { entry: chain(nodes), nodes, fullyParsed: false };
  }

  flushSay(undefined);
  if (nodes.length === 0) return { entry: null, nodes: [], fullyParsed: true };
  return { entry: chain(nodes), nodes, fullyParsed: true };
}

/** liga cada nó ao seguinte (ordem de criação) e devolve o id de entrada */
function chain(nodes: DialogueNode[]): string {
  for (let i = 0; i < nodes.length - 1; i++) {
    const node = nodes[i]!;
    if ((node.kind === "say" || node.kind === "action") && node.next === undefined) {
      node.next = nodes[i + 1]!.id;
    }
  }
  return nodes[0]!.id;
}
