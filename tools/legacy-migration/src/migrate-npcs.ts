import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NpcSchema, type Npc } from "@ragnarok/game-data";
import { parseNpcDialogue } from "./parse-npc-dialogue";

/**
 * Migração de NPCs: warps, shops e scripts dos arquivos alcançáveis a partir
 * de rathena/npc/re/scripts_main.conf (cadeia de import:) → npcs.json
 * matching @ragnarok/game-data NpcSchema.
 *
 * Usage: pnpm migrate:npcs [--out <path>]
 *
 * Formatos exatos de rathena/src/map/npc.cpp (npc_parse_warp/shop/script/
 * duplicate). Diálogo: prefixo linear mes/next/close reconhecido; resto do
 * script vira nó legacyScript needsReview (nunca descartado, nunca
 * adivinhado — soul §5.5). Funções (`function script`) não são NPCs e ficam
 * fora (contadas no relatório).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const NPC_ROOT = join(REPO_ROOT, "rathena");

// monsters já migrados; mapflags não têm NPC; custom vazio por padrão
const SKIP_CONFS = new Set(["scripts_monsters.conf", "scripts_mapflags.conf", "scripts_custom.conf"]);

function resolveConfChain(entry: string, warnings: string[]): string[] {
  const files: string[] = [];
  const visit = (confRel: string) => {
    const base = confRel.split("/").pop()!;
    if (SKIP_CONFS.has(base)) return;
    const confPath = join(NPC_ROOT, confRel);
    if (!existsSync(confPath)) {
      warnings.push(`conf não encontrado: ${confRel}`);
      return;
    }
    for (const rawLine of readFileSync(confPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("import:")) visit(line.replace(/^import:\s*/, ""));
      else if (line.startsWith("npc:")) files.push(line.replace(/^npc:\s*/, ""));
    }
  };
  visit(entry);
  return files;
}

/** slug único e determinístico a partir do nome completo do NPC */
function makeSlugger() {
  const used = new Map<string, number>();
  return (fullName: string): string => {
    const base = fullName
      .toLowerCase()
      .replace(/[^a-z0-9#_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/#/g, "-");
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  };
}

interface Head {
  mapId: string;
  x: number;
  y: number;
  facing: number;
  floating: boolean;
}

function parseHead(w1: string): Head | null {
  if (w1 === "-") return { mapId: "-", x: 0, y: 0, facing: 0, floating: true };
  // campos extras após o facing são ignorados pelo sscanf do rAthena
  const m = w1.match(/^([a-zA-Z0-9_@-]+),(\d+),(\d+)(?:,(\d+))?/);
  if (!m) return null;
  return { mapId: m[1]!, x: Number(m[2]), y: Number(m[3]), facing: Number(m[4] ?? 0), floating: false };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath =
    outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : join(__dirname, "..", "output", "npcs.json");
  const outDir = dirname(outPath);

  const items = JSON.parse(readFileSync(join(outDir, "items.json"), "utf8")) as {
    id: number;
    aegisName: string;
  }[];
  const itemIdByAegis = new Map(items.map((i) => [i.aegisName.toLowerCase(), i.id]));

  const warnings: string[] = [];
  const files = resolveConfChain("npc/re/scripts_main.conf", warnings);
  console.log(`${files.length} arquivos de NPC na cadeia de conf`);

  const slug = makeSlugger();
  const npcs: Npc[] = [];
  const invalid: { npc: string; error: string }[] = [];
  const idByFullName = new Map<string, string>();
  const pendingDuplicates: { fullName: string; sourceName: string }[] = [];
  let functionsSkipped = 0;
  let dialoguesFull = 0;
  let dialoguesFlagged = 0;

  const parseShopItems = (
    spec: string,
    fileRef: string,
    withStock: boolean,
  ): { itemId: number; price: number; stock?: number }[] => {
    const out: { itemId: number; price: number; stock?: number }[] = [];
    for (const part of spec.split(",")) {
      const bits = part.trim().split(":");
      if (bits.length < 2) {
        if (part.trim() !== "") warnings.push(`${fileRef}: item de shop não reconhecido "${part}" — REVISAR`);
        continue;
      }
      const idRaw = bits[0]!;
      const itemId = /^\d+$/.test(idRaw) ? Number(idRaw) : itemIdByAegis.get(idRaw.toLowerCase());
      if (itemId === undefined) {
        warnings.push(`${fileRef}: item de shop "${idRaw}" não resolvido — REVISAR`);
        continue;
      }
      out.push({
        itemId,
        price: Number(bits[1]),
        ...(withStock && bits[2] !== undefined ? { stock: Number(bits[2]) } : {}),
      });
    }
    return out;
  };

  const pushNpc = (candidate: Record<string, unknown>, fullName: string) => {
    const parsed = NpcSchema.safeParse(candidate);
    if (parsed.success) {
      npcs.push(parsed.data);
      // rAthena npc_name2id indexa pelo exname ("Nome#ex" / "Nome::EX") quando presente
      idByFullName.set(fullName, parsed.data.id);
      const ex = fullName.includes("::") ? fullName.split("::").pop()! : fullName.split("#").pop();
      if (ex && ex !== fullName && !idByFullName.has(ex)) idByFullName.set(ex, parsed.data.id);
    } else {
      invalid.push({ npc: fullName, error: parsed.error.message });
    }
  };

  for (const rel of files) {
    const filePath = join(NPC_ROOT, rel);
    if (!existsSync(filePath)) {
      warnings.push(`arquivo não encontrado: ${rel}`);
      continue;
    }
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
      // tab duplo antes do w4 acontece em arquivos legados (sscanf tolera)
      const w4Raw = cols.slice(3).join("\t").replace(/^\s+/, "");
      // linhas estruturadas (não-script) podem ter comentário // no fim
      const w4 = w2.startsWith("script") ? w4Raw : w4Raw.split("//")[0]!.trim();
      const fileRef = `${rel}:${li + 1}`;

      if (w1 === "function" && w2 === "script") {
        // função de biblioteca, não NPC — pular bloco {}
        functionsSkipped++;
        li = skipBlock(lines, li);
        continue;
      }
      if (w2 === "monster" || w2 === "boss_monster" || w2 === "mapflag") continue;

      const head = parseHead(w1);

      if (w2 === "warp" || w2 === "warp2") {
        if (!head) {
          warnings.push(`${fileRef}: cabeçalho de warp não reconhecido — REVISAR`);
          continue;
        }
        const m = w4.match(/^(\d+),(\d+),([a-zA-Z0-9_@-]+),(\d+),(\d+)/);
        if (!m) {
          warnings.push(`${fileRef}: destino de warp não reconhecido "${w4}" — REVISAR`);
          continue;
        }
        pushNpc(
          {
            id: slug(w3),
            name: w3.split("#")[0] || w3,
            sprite: "WARP",
            mapId: head.mapId,
            position: [head.x, head.y, 0],
            direction: head.facing,
            warp: {
              mapId: m[3],
              position: [Number(m[4]), Number(m[5]), 0],
              triggerSpan: { xs: Number(m[1]), ys: Number(m[2]) },
            },
            legacyRef: fileRef,
          },
          w3,
        );
        continue;
      }

      if (w2 === "shop" || w2 === "cashshop" || w2 === "marketshop") {
        if (!head) {
          warnings.push(`${fileRef}: cabeçalho de shop não reconhecido — REVISAR`);
          continue;
        }
        const firstComma = w4.indexOf(",");
        const sprite = firstComma === -1 ? w4 : w4.slice(0, firstComma);
        let itemsSpec = firstComma === -1 ? "" : w4.slice(firstComma + 1);
        // flag opcional de desconto logo após o sprite (yes/no)
        let discount: boolean | undefined;
        const discountMatch = itemsSpec.match(/^(yes|no),/);
        if (discountMatch) {
          discount = discountMatch[1] === "yes";
          itemsSpec = itemsSpec.slice(discountMatch[0].length);
        }
        const id = slug(w3);
        pushNpc(
          {
            id,
            name: w3.split("#")[0] || w3,
            sprite,
            mapId: head.mapId,
            position: [head.x, head.y, 0],
            direction: head.facing,
            shop: {
              id: `${id}_shop`,
              currency: w2 === "cashshop" ? "cash" : "zeny",
              discount,
              items: parseShopItems(itemsSpec, fileRef, w2 === "marketshop"),
            },
            legacyRef: fileRef,
          },
          w3,
        );
        continue;
      }

      if (w2.startsWith("duplicate(")) {
        if (!head) {
          warnings.push(`${fileRef}: cabeçalho de duplicate não reconhecido — REVISAR`);
          continue;
        }
        const sourceName = w2.slice("duplicate(".length, -1);
        const spriteMatch = w4.match(/^([^,]+)/);
        const fullName = w3;
        const candidate = {
          id: slug(w3),
          name: w3.split("#")[0] || w3,
          sprite: spriteMatch?.[1] ?? "-1",
          mapId: head.mapId,
          position: [head.x, head.y, 0],
          direction: head.facing,
          legacyRef: fileRef,
        };
        pendingDuplicates.push({ fullName, sourceName });
        pushNpc(candidate, fullName);
        continue;
      }

      // "script(CLOAKED)" etc.: flag de estado inicial — mesmo formato de bloco
      if (w2 === "script" || /^script\([A-Z]+\)$/.test(w2)) {
        // bloco {} pode atravessar linhas — juntar até fechar
        let joined = w4;
        let endLi = li;
        while (!blockClosed(joined) && endLi + 1 < lines.length) {
          endLi++;
          joined += "\n" + lines[endLi];
        }
        li = endLi;

        // ",,{" (trigger vazio) e trigger com um número só são tolerados pelo
        // sscanf do rAthena (npc.cpp:4436 — touch area só com os DOIS números)
        const headMatch = joined
          .replace(/,\s*,\s*\{/, ",{")
          .match(/^\s*([^,]+?)(?:,(\d+))?(?:,(\d+))?,\s*\{([\s\S]*)\}\s*(?:\/\/[^\n]*)?$/);
        if (!head || !headMatch) {
          warnings.push(`${fileRef}: script NPC não reconhecido — REVISAR`);
          continue;
        }
        const [, sprite, tx, ty, code] = headMatch;
        const dialogue = parseNpcDialogue(code!, fileRef);
        if (dialogue.fullyParsed) dialoguesFull++;
        else dialoguesFlagged++;
        pushNpc(
          {
            id: slug(w3),
            name: w3.split("#")[0] || w3,
            sprite: sprite!,
            mapId: head.mapId,
            position: [head.x, head.y, 0],
            direction: head.facing,
            dialogueEntry: dialogue.entry,
            dialogue: dialogue.nodes,
            ...(tx !== undefined && ty !== undefined ? { touchArea: { xs: Number(tx), ys: Number(ty) } } : {}),
            legacyRef: fileRef,
          },
          w3,
        );
        continue;
      }
    }
  }

  // resolve duplicates → id do NPC fonte
  for (const dup of pendingDuplicates) {
    const targetId = idByFullName.get(dup.fullName);
    const sourceId = idByFullName.get(dup.sourceName);
    if (!targetId) continue; // inválido, já reportado
    if (!sourceId) {
      warnings.push(`duplicate "${dup.fullName}" referencia fonte desconhecida "${dup.sourceName}" — REVISAR`);
      continue;
    }
    const npc = npcs.find((n) => n.id === targetId)!;
    npc.duplicateOf = sourceId;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(npcs, null, 1));
  writeFileSync(
    join(outDir, "npcs-migration-report.json"),
    JSON.stringify(
      {
        files: files.length,
        migrated: npcs.length,
        byKind: {
          warps: npcs.filter((n) => n.warp).length,
          shops: npcs.filter((n) => n.shop).length,
          dialogues: npcs.filter((n) => n.dialogue.length > 0).length,
          duplicates: npcs.filter((n) => n.duplicateOf).length,
        },
        dialoguesFullyParsed: dialoguesFull,
        dialoguesFlagged: dialoguesFlagged,
        functionsSkipped,
        invalid,
        warnings,
        note: "diálogos flagged têm o script restante intacto em legacySource (nó action/legacyScript, needsReview) — revisão manual, nada descartado",
      },
      null,
      2,
    ),
  );

  console.log(`npcs: ${npcs.length} migrados, ${invalid.length} inválidos`);
  console.log(
    `warps ${npcs.filter((n) => n.warp).length}; shops ${npcs.filter((n) => n.shop).length}; ` +
      `diálogos ${dialoguesFull} completos / ${dialoguesFlagged} flagged; ` +
      `duplicates ${npcs.filter((n) => n.duplicateOf).length}; funções puladas ${functionsSkipped}`,
  );
  console.log(`${warnings.length} warnings — ver npcs-migration-report.json`);
  console.log(`saída: ${outPath}`);
}

/** avança até a linha onde o bloco {} iniciado nesta linha fecha */
function skipBlock(lines: string[], startLi: number): number {
  let li = startLi;
  let joined = lines[li]!;
  while (!blockClosed(joined) && li + 1 < lines.length) {
    li++;
    joined += "\n" + lines[li];
  }
  return li;
}

/** true quando todas as { do texto (fora de strings/comentários) fecharam e houve pelo menos uma */
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

main();
