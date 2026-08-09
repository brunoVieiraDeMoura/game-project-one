import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Relocaliza o corpo `{...}` de um NPC `script` a partir de `legacyRef`
 * ("caminho/relativo.txt:linhaInicial1Based" — o MESMO formato gravado por
 * `migrate-npcs.ts`, fórmula `${rel}:${li + 1}` ANTES de `li` avançar pro
 * fim do bloco).
 *
 * Não reimplementa o parsing de cabeçalho da migração (regex de
 * mapa/x/y/sprite) — em vez disso acha o PRIMEIRO `{`/`}` balanceado depois
 * da linha de início, pela mesma varredura caractere-a-caractere de
 * `blockClosed` (copiada de `migrate-npcs.ts`/`extract-corpus.ts` — os dois
 * já têm cópias idênticas entre si, essa é a terceira, deliberadamente, em
 * vez de importar de um arquivo cujo único propósito documentado é evitar
 * esse acoplamento). `code` (o texto devolvido) é conferido, em teste, byte
 * a byte contra `extractScriptBodies` do legacy-migration.
 *
 * Recusa (não lança) se o arquivo tiver QUALQUER `\r` — 3 dos 1138 arquivos
 * do corpus usam CRLF; reescrever a partir de um texto normalizado por
 * `\n` apagaria essa diferença em silêncio. Achado, não corrigido aqui.
 */

export interface LocatedNpcScript {
  absPath: string;
  rawText: string;
  /** offsets em `rawText`: logo depois do `{` até o `}` correspondente. */
  bodyStart: number;
  bodyEnd: number;
  /** `rawText.slice(bodyStart, bodyEnd)` — o mesmo texto que a migração passou pro Parser. */
  code: string;
}

export type LocateFailureCode =
  | "invalid-ref"
  | "file-not-found"
  | "crlf-unsupported"
  | "line-out-of-range"
  | "not-a-script-header"
  | "block-not-closed"
  | "body-not-found";

export type LocateResult = ({ ok: true } & LocatedNpcScript) | { ok: false; code: LocateFailureCode; reason: string };

function blockClosed(text: string): boolean {
  let depth = 0;
  let opened = false;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    const next2 = text.slice(i, i + 2);
    if (next2 === "//") {
      const nl = text.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (next2 === "/*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      depth++;
      opened = true;
    } else if (ch === "}") depth--;
  }
  return opened && depth <= 0;
}

/** acha o primeiro `{`/`}` balanceado (fora de string/comentário) e devolve
 * a POSIÇÃO (não um booleano, como `blockClosed`) — independente do
 * cabeçalho na frente (mapa/x/y/sprite), então espaço em branco ou vírgulas
 * ali não afetam onde o corpo começa. */
function findBodySpan(text: string): { start: number; end: number } | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    const next2 = text.slice(i, i + 2);
    if (next2 === "//") {
      const nl = text.indexOf("\n", i);
      if (nl === -1) return null;
      i = nl;
      continue;
    }
    if (next2 === "/*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
      if (depth === 1) start = i + 1;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) return { start, end: i };
    }
  }
  return null;
}

export function locateNpcScript(npcRoot: string, legacyRef: string): LocateResult {
  const sep = legacyRef.lastIndexOf(":");
  if (sep < 0) return { ok: false, code: "invalid-ref", reason: `legacyRef sem ":" — "${legacyRef}"` };
  const relPath = legacyRef.slice(0, sep);
  const lineNum = Number(legacyRef.slice(sep + 1));
  if (!Number.isInteger(lineNum) || lineNum < 1) {
    return { ok: false, code: "invalid-ref", reason: `número de linha inválido em legacyRef — "${legacyRef}"` };
  }

  const absPath = join(npcRoot, relPath);
  if (!existsSync(absPath)) return { ok: false, code: "file-not-found", reason: `arquivo não existe: ${absPath}` };

  const rawText = readFileSync(absPath, "utf8");
  if (rawText.includes("\r")) {
    return { ok: false, code: "crlf-unsupported", reason: `${relPath} usa CRLF — reescrita não suportada nesta versão` };
  }

  const lines = rawText.split("\n");
  const li = lineNum - 1;
  if (li < 0 || li >= lines.length) {
    return {
      ok: false,
      code: "line-out-of-range",
      reason: `linha ${lineNum} fora do arquivo (${lines.length} linhas) — ${relPath} pode ter mudado desde a migração`,
    };
  }

  const cols = lines[li]!.split("\t");
  const w2 = cols[1] ?? "";
  const isScriptHeader = w2 === "script" || /^script\([A-Z]+\)$/.test(w2);
  if (!isScriptHeader) {
    return {
      ok: false,
      code: "not-a-script-header",
      reason: `linha ${lineNum} de ${relPath} não é cabeçalho de "script" (coluna 2="${w2}") — arquivo pode ter mudado desde a migração`,
    };
  }

  const lineStart: number[] = new Array(lines.length);
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = acc;
    acc += lines[i]!.length + 1;
  }

  let endLi = li;
  let joined = lines[li]!;
  while (!blockClosed(joined) && endLi + 1 < lines.length) {
    endLi++;
    joined += "\n" + lines[endLi];
  }
  if (!blockClosed(joined)) {
    return {
      ok: false,
      code: "block-not-closed",
      reason: `bloco a partir de ${relPath}:${lineNum} nunca fecha "{" — arquivo pode ter mudado desde a migração`,
    };
  }

  const blockRawStart = lineStart[li]!;
  const blockRawEndExclusive = lineStart[endLi]! + lines[endLi]!.length;
  const blockRawText = rawText.slice(blockRawStart, blockRawEndExclusive);

  const span = findBodySpan(blockRawText);
  if (!span) {
    return { ok: false, code: "body-not-found", reason: `não encontrei "{...}" balanceado a partir de ${relPath}:${lineNum}` };
  }

  const bodyStart = blockRawStart + span.start;
  const bodyEnd = blockRawStart + span.end;
  return { ok: true, absPath, rawText, bodyStart, bodyEnd, code: rawText.slice(bodyStart, bodyEnd) };
}
