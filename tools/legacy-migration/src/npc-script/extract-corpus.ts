import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Extração dos corpos de script `{...}` de NPC reais, a partir da cadeia de
 * conf `npc/re/scripts_main.conf` — compartilhada entre o gate do Parser
 * (`npc-script-roundtrip.test.ts`) e os testes do Mapper
 * (`npc-script-mapper.test.ts`), pra não duplicar a mesma lógica de
 * cabeçalho tab-separado + casamento de chaves uma terceira vez.
 *
 * Mesma extração de `tools/legacy-migration/src/migrate-npcs.ts` (não
 * importada de lá de propósito — aquele arquivo roda `main()`
 * incondicionalmente ao ser importado, efeito colateral indesejado num
 * teste).
 */

const SKIP_CONFS = new Set(["scripts_monsters.conf", "scripts_mapflags.conf", "scripts_custom.conf"]);

function resolveConfChain(npcRoot: string, entry: string): string[] {
  const files: string[] = [];
  const visit = (confRel: string) => {
    const base = confRel.split("/").pop()!;
    if (SKIP_CONFS.has(base)) return;
    const confPath = join(npcRoot, confRel);
    if (!existsSync(confPath)) return;
    for (const rawLine of readFileSync(confPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("import:")) visit(line.replace(/^import:\s*/, ""));
      else if (line.startsWith("npc:")) files.push(line.replace(/^npc:\s*/, ""));
    }
  };
  visit(entry);
  return files;
}

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

function skipBlock(lines: string[], startLi: number): number {
  let li = startLi;
  let joined = lines[li]!;
  while (!blockClosed(joined) && li + 1 < lines.length) {
    li++;
    joined += "\n" + lines[li];
  }
  return li;
}

export interface ScriptBody {
  ref: string;
  /** nome completo do NPC (coluna 3 do cabeçalho, "Nome#ex" ou "Nome::EX" incluído) — pra
   * índice de cross-referência (`donpcevent("Npc::Label")`) no Validator. */
  name: string;
  code: string;
}

/** conta os blocos `function script Nome {...}` da mesma cadeia de conf —
 * eles NUNCA viram `ScriptBody` (pulados de propósito, `w1==="function"`),
 * então o pipeline inteiro (Parser/Mapper/Validator/Writer) não os enxerga.
 * Existe só pro relatório do Writer (leia1.txt §13/§16) poder dizer QUANTOS
 * existem, sem fingir que são zero. */
export function countFunctionScripts(npcRoot: string): number {
  const files = resolveConfChain(npcRoot, "npc/re/scripts_main.conf");
  let count = 0;
  for (const rel of files) {
    const filePath = join(npcRoot, rel);
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    let inBlockComment = false;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      if (line.trim().startsWith("/*") && !line.includes("*/")) {
        inBlockComment = true;
        continue;
      }
      if (line.trim().startsWith("//") || !line.includes("\t")) continue;
      const cols = line.split("\t");
      const [w1, w2] = [cols[0] ?? "", cols[1] ?? ""];
      if (w1 === "function" && w2 === "script") {
        count++;
        li = skipBlock(lines, li);
      }
    }
  }
  return count;
}

export function extractScriptBodies(npcRoot: string): ScriptBody[] {
  const files = resolveConfChain(npcRoot, "npc/re/scripts_main.conf");
  const out: ScriptBody[] = [];

  for (const rel of files) {
    const filePath = join(npcRoot, rel);
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    let inBlockComment = false;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        continue;
      }
      if (line.trim().startsWith("/*") && !line.includes("*/")) {
        inBlockComment = true;
        continue;
      }
      if (line.trim().startsWith("//") || !line.includes("\t")) continue;
      const cols = line.split("\t");
      const [w1, w2, w3] = [cols[0] ?? "", cols[1] ?? "", cols[2] ?? ""];
      const w4Raw = cols.slice(3).join("\t").replace(/^\s+/, "");

      if (w1 === "function" && w2 === "script") {
        li = skipBlock(lines, li);
        continue;
      }
      if (w2 === "monster" || w2 === "boss_monster" || w2 === "mapflag") continue;
      if (w2 === "script" || /^script\([A-Z]+\)$/.test(w2)) {
        let joined = w4Raw;
        let endLi = li;
        while (!blockClosed(joined) && endLi + 1 < lines.length) {
          endLi++;
          joined += "\n" + lines[endLi];
        }
        li = endLi;
        const headMatch = joined
          .replace(/,\s*,\s*\{/, ",{")
          .match(/^\s*([^,]+?)(?:,(\d+))?(?:,(\d+))?,\s*\{([\s\S]*)\}\s*(?:\/\/[^\n]*)?$/);
        if (headMatch) out.push({ ref: `${rel}:${li + 1}`, name: w3, code: headMatch[4]! });
      }
    }
  }
  return out;
}
