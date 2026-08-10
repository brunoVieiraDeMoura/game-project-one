/**
 * Lexer do script de NPC do rAthena — camada de SINTAXE pura (leia1.txt,
 * aprovação da arquitetura de NPCs, 2026-08-07). Não sabe nada de
 * `mes`/`if`/`switch` como palavra-chave — o Parser é quem decide, por
 * CONTEXTO, se um `Ident` em posição de statement é uma palavra reservada
 * ou um nome de comando (`mes`/`cutin`/`callfunc` não são reservadas no
 * léxico do rAthena, só identificadores comuns usados como nome de função).
 *
 * **`start`/`end` (offset de CARACTERE na string fonte) existem pro
 * Writer** (leia1.txt, 2026-08-08 — "preservar integralmente tudo que não
 * foi alterado"): sem posição de byte, não tem como o Writer recortar um
 * trecho INTOCADO do arquivo original — só teria o texto REIMPRESSO pelo
 * Printer, que já é sabidamente reformatado (achado do Validator). `line`
 * continua existindo só pra mensagem de erro ficar legível.
 */

export type TokenType = "Ident" | "Int" | "String" | "Punct" | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  /** valor numérico já resolvido, só pra token Int */
  intValue?: number;
  line: number;
  /** offset de caractere, início (inclusive) — inclui aspas/sigil/etc. */
  start: number;
  /** offset de caractere, fim (exclusivo) */
  end: number;
}

const PUNCT_3 = ["<<=", ">>="];
const PUNCT_2 = ["==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "::", "++", "--", "&=", "|=", "^="];
const PUNCT_1 = "+-*/%=<>!(){}[],;:&|^~?";

/** sigils de escopo de variável do rAthena, mais longo primeiro (`.@`/`$@`/
 * `##` antes de `@`/`$`/`#`/`.`/`'`) — `.` sozinho é variável de INSTÂNCIA
 * do NPC (persistente, diferente de `.@` escopo temporário/scratch) e `'`
 * é variável de INSTÂNCIA DE MASMORRA (`'nyr_main_step`, achado ao rodar o
 * gate contra `npc/re/instances/Wolves.txt`). A ordem importa — `.@` tem
 * que ser testado ANTES de `.` sozinho pra vencer o match mais longo. */
const SIGILS = [".@", "$@", "##", "@", "$", "#", ".", "'"];

export class LexError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(`linha ${line}: ${message}`);
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const peek = (off = 0) => source[i + off];

  while (i < n) {
    const ch = source[i]!;

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && peek(1) === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && peek(1) === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && peek(1) === "/")) {
        if (source[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"') {
      const start = i;
      const startLine = line;
      i++;
      let value = "";
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < n) {
          const next = source[i + 1]!;
          value += next === "n" ? "\n" : next;
          i += 2;
          continue;
        }
        if (source[i] === "\n") line++;
        value += source[i];
        i++;
      }
      i++; // fecha "
      tokens.push({ type: "String", value, line: startLine, start, end: i });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      if (ch === "0" && (peek(1) === "x" || peek(1) === "X")) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(source[i]!)) i++;
        const raw = source.slice(start, i);
        tokens.push({ type: "Int", value: raw, intValue: Number(raw), line, start, end: i });
        continue;
      }
      while (i < n && /[0-9]/.test(source[i]!)) i++;
      // achado do gate: nomes de label/função que começam com dígito
      // existem de verdade (`171_worker_talk(...)`, script real) — se uma
      // letra/underscore vem GRUDADA logo após os dígitos, não é número
      // seguido de identificador, é UM identificador só que começa com
      // dígito. Número de verdade nunca é seguido de letra em rAthena.
      if (/[A-Za-z_]/.test(source[i] ?? "")) {
        while (i < n && /[A-Za-z0-9_]/.test(source[i]!)) i++;
        if (source[i] === "$") i++;
        tokens.push({ type: "Ident", value: source.slice(start, i), line, start, end: i });
        continue;
      }
      const raw = source.slice(start, i);
      tokens.push({ type: "Int", value: raw, intValue: Number(raw), line, start, end: i });
      continue;
    }

    let sigil = "";
    for (const s of SIGILS) {
      if (source.startsWith(s, i)) {
        sigil = s;
        break;
      }
    }
    if (sigil || /[A-Za-z_]/.test(ch)) {
      const start = i;
      i += sigil.length;
      // achado do gate: variável com sigil pode começar com DÍGITO
      // (`$050320_ein_typing`, `'1hmoon` — scripts reais) — só exige
      // letra/underscore quando NÃO há sigil (identificador cru nunca pode
      // começar com dígito, senão colide com literal numérico).
      const afterSigilPattern = sigil ? /[A-Za-z0-9_]/ : /[A-Za-z_]/;
      if (!afterSigilPattern.test(source[i] ?? "")) {
        // sigil sem nome válido atrás (raro) — trata como identificador vazio-sigil, evita loop infinito
        tokens.push({ type: "Ident", value: source.slice(start, i), line, start, end: i });
        continue;
      }
      while (i < n && /[A-Za-z0-9_]/.test(source[i]!)) i++;
      if (source[i] === "$") i++; // sufixo de variável string
      tokens.push({ type: "Ident", value: source.slice(start, i), line, start, end: i });
      continue;
    }

    const three = source.slice(i, i + 3);
    if (PUNCT_3.includes(three)) {
      tokens.push({ type: "Punct", value: three, line, start: i, end: i + 3 });
      i += 3;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (PUNCT_2.includes(two)) {
      tokens.push({ type: "Punct", value: two, line, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (PUNCT_1.includes(ch)) {
      tokens.push({ type: "Punct", value: ch, line, start: i, end: i + 1 });
      i++;
      continue;
    }

    throw new LexError(`caractere inesperado "${ch}"`, line);
  }

  tokens.push({ type: "EOF", value: "", line, start: n, end: n });
  return tokens;
}
