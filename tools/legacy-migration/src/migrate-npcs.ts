import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NpcSchema,
  parseNpcScript,
  mapNpcScriptWithUnits,
  validateNpcScript,
  type Npc,
  type NpcScriptAst,
  type NpcMapResultWithUnits,
} from "@ragnarok/game-data";
import { loadMapCatalog, loadIdCatalog, buildNpcEventIndex, makeCatalogs } from "./npc-script/catalogs";

/**
 * Migração de NPCs: warps, shops e scripts dos arquivos alcançáveis a partir
 * de rathena/npc/re/scripts_main.conf (cadeia de import:) → npcs.json
 * matching @ragnarok/game-data NpcSchema.
 *
 * Usage: pnpm migrate:npcs [--out <path>]
 *
 * Formatos exatos de rathena/src/map/npc.cpp (npc_parse_warp/shop/script/
 * duplicate). Diálogo: pipeline novo (leia1.txt, 2026-08-11 — "alinhar a
 * migração dos NPCs ao novo pipeline Lexer → Parser → AST → Mapper") —
 * `parseNpcScript` (Lexer+Parser+AST) → `mapNpcScriptWithUnits` (Mapper) →
 * `validateNpcScript` (Validator, com catálogos reais de mapa/item/skill/
 * monstro + índice cross-NPC de `donpcevent`). Cada `On*:` vira um
 * `eventHandler` de PRIMEIRA CLASSE (não mais achatado/perdido dentro de um
 * `legacyScript` só, como o migrador linear antigo fazia — achado
 * documentado no relatório desta migração). Construção não reconhecida
 * semanticamente vira `legacyScript` do PRÓPRIO statement (nunca descartado,
 * nunca adivinhado — soul §5.5). Funções (`function script`) não são NPCs e
 * ficam fora (contadas no relatório, nunca vistas pelo pipeline).
 *
 * NÃO persiste `mainSourceMap`/`handlerSourceMaps` (offsets de byte) — eles
 * só fazem sentido no INSTANTE desta migração, contra o `.txt` de então;
 * ficariam inválidos assim que o arquivo original mudasse. O `before` que um
 * futuro Writer real vai precisar tem que ser recomputado NA HORA a partir
 * do `.txt`, não lido do banco — ver leia1.txt anterior (bloqueio de
 * integração Admin/API, ainda não resolvido, fora do escopo desta etapa).
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
    const stripped = fullName
      .toLowerCase()
      .replace(/[^a-z0-9#_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/#/g, "-");
    // nome só com pontuação (ex.: "?") esvazia o slug — sem fallback, o id
    // fica "" e o admin não consegue montar link de edição pra esse NPC
    const base = stripped || "npc";
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

  // catálogos reais pro Validator — mesmos usados nos testes do módulo NPC
  // (mapas do map_index.txt do rAthena, itens/skills/monstros já migrados).
  const mapCatalog = loadMapCatalog(NPC_ROOT);
  const itemCatalog = loadIdCatalog(outDir, "items.json");
  const skillCatalog = loadIdCatalog(outDir, "skills.json");
  const monsterCatalog = loadIdCatalog(outDir, "monsters.json");

  const warnings: string[] = [];
  const files = resolveConfChain("npc/re/scripts_main.conf", warnings);
  console.log(`${files.length} arquivos de NPC na cadeia de conf`);

  const slug = makeSlugger();
  const npcs: Npc[] = [];
  const invalid: { npc: string; error: string }[] = [];
  const idByFullName = new Map<string, string>();
  const pendingDuplicates: { fullName: string; sourceName: string }[] = [];
  let functionsSkipped = 0;

  // PRÉ-PASSADA: parseia/mapeia todo script ANTES do loop principal —
  // só pra montar o índice cross-NPC de `donpcevent` (precisa dos rótulos
  // de TODOS os NPCs de uma vez). A ORDEM DE PUSH em si continua sendo a
  // do loop principal, abaixo, na ordem NATURAL do arquivo — achado
  // (leia1.txt, 2026-08-11): uma primeira versão desta migração fazia o
  // push do script NA pré-passada (fora de ordem), e isso quebrava a
  // resolução de alias de `duplicate()` sempre que um NPC tinha nome com
  // "#Ex" E "::Ex" ao mesmo tempo (ex. real do corpus: `Horn#LF_ar03_01::
  // LF_ar03_01`, arug_cas03.txt:45) — o PRIMEIRO `duplicate()` subsequente
  // (que também termina em "#LF_ar03_01") "roubava" o alias "LF_ar03_01"
  // ANTES do NPC fonte real registrar o dele, porque só o fonte tinha sido
  // adiado pra depois. `duplicateOf` saía apontando pro `duplicate()`
  // vizinho, não pro NPC fonte — silencioso, só visível comparando
  // byte a byte com a migração antiga. Corrigido preservando a ORDEM DE
  // PUSH original; a pré-passada só EXTRAI dado, nunca EMPILHA NPC.
  const scriptAstByRef = new Map<string, { fullName: string; ast: NpcScriptAst; mapped: NpcMapResultWithUnits }>();
  for (const rel of files) {
    const filePath = join(NPC_ROOT, rel);
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
      if (w2 !== "script" && !/^script\([A-Z]+\)$/.test(w2)) continue;
      const fileRef = `${rel}:${li + 1}`; // mesma fórmula da passada real — ANTES de `li` avançar pro fim do bloco
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
      if (!headMatch) continue; // reportado como warning na passada real, abaixo
      try {
        const ast = parseNpcScript(headMatch[4]!);
        const mapped = mapNpcScriptWithUnits(ast);
        scriptAstByRef.set(fileRef, { fullName: w3, ast, mapped });
      } catch {
        // falha de parse/map — a passada real (abaixo) reporta como inválido.
      }
    }
  }

  // índice cross-NPC pra `donpcevent("Npc::Label")` — já dá pra montar aqui,
  // a pré-passada acima já tem TODOS os scripts.
  const npcEventIndex = buildNpcEventIndex(
    [...scriptAstByRef.values()].map((s) => ({
      name: s.fullName,
      labels: s.ast.entryPoints.filter((ep) => ep.label !== null).map((ep) => ep.label),
    })),
  );
  const catalogs = makeCatalogs(mapCatalog, itemCatalog, skillCatalog, monsterCatalog, npcEventIndex);
  const nodeKindTally = (nodes: { kind: string; action?: { kind: string } }[]) => {
    for (const n of nodes) {
      metrics.nodes++;
      metrics.byNodeKind[n.kind] = (metrics.byNodeKind[n.kind] ?? 0) + 1;
      if (n.kind === "action" && n.action?.kind === "legacyScript") metrics.legacyScriptNodes++;
    }
  };

  // métricas do pipeline novo — leia1.txt §4: números reais do corpus inteiro.
  const metrics = {
    scriptsProcessed: 0,
    entryPoints: 0,
    labeledEntryPoints: 0,
    nodes: 0,
    byNodeKind: {} as Record<string, number>,
    eventHandlers: 0,
    npcsWithEventHandlers: 0,
    legacyScriptNodes: 0,
    validatorInvalid: 0, // classification "invalid" (erro estrutural/referência)
    validatorUnknown: 0, // classification "unknown" (válido, tem legacyScript)
    validatorValid: 0,
    unknownReferences: { maps: 0, items: 0, skills: 0, monsters: 0 },
    invalidReferences: { maps: 0, items: 0, skills: 0, monsters: 0 },
    gotoMissing: 0,
    donpcMissing: 0,
  };

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
        const [, sprite, tx, ty] = headMatch;
        // já parseado/mapeado na PRÉ-PASSADA (mesma detecção de bloco,
        // mesmo fileRef) — reusa em vez de reparsear, e faz o PUSH aqui,
        // na ordem NATURAL do arquivo (ver nota grande acima da pré-passada).
        const pre = scriptAstByRef.get(fileRef);
        if (!pre) {
          invalid.push({ npc: w3, error: "script não encontrado na pré-passada (parse/map falhou) — ver warnings" });
          continue;
        }
        const { ast, mapped } = pre;

        metrics.scriptsProcessed++;
        metrics.entryPoints += ast.entryPoints.length;
        metrics.labeledEntryPoints += ast.entryPoints.filter((ep) => ep.label !== null).length;
        nodeKindTally(mapped.dialogue);
        for (const h of mapped.eventHandlers) nodeKindTally(h.dialogue);
        metrics.eventHandlers += mapped.eventHandlers.length;
        if (mapped.eventHandlers.length > 0) metrics.npcsWithEventHandlers++;

        const report = validateNpcScript(ast, mapped, catalogs);
        if (report.classification === "invalid") metrics.validatorInvalid++;
        else if (report.classification === "unknown") metrics.validatorUnknown++;
        else metrics.validatorValid++;
        for (const key of ["maps", "items", "skills", "monsters"] as const) {
          metrics.unknownReferences[key] += report.references[key].unknown;
          metrics.invalidReferences[key] += report.references[key].invalid;
        }
        metrics.gotoMissing += report.gotos.missing;
        metrics.donpcMissing += report.donpcevents.missing;

        pushNpc(
          {
            id: slug(w3),
            name: w3.split("#")[0] || w3,
            sprite: sprite!,
            mapId: head.mapId,
            position: [head.x, head.y, 0],
            direction: head.facing,
            dialogueEntry: mapped.dialogueEntry,
            dialogue: mapped.dialogue,
            eventHandlers: mapped.eventHandlers,
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
          eventHandlers: npcs.filter((n) => n.eventHandlers.length > 0).length,
        },
        pipeline: metrics,
        functionsSkipped,
        invalid,
        warnings,
        note:
          "pipeline novo (leia1.txt 2026-08-11): Lexer→Parser→AST→mapNpcScriptWithUnits→Validator. " +
          "eventHandlers são entry points de PRIMEIRA CLASSE (On*:), não mais achatados dentro de legacyScript. " +
          "Construção não reconhecida semanticamente vira legacyScript do PRÓPRIO statement — nunca descartado, nunca adivinhado.",
      },
      null,
      2,
    ),
  );

  console.log(`npcs: ${npcs.length} migrados, ${invalid.length} inválidos`);
  console.log(
    `warps ${npcs.filter((n) => n.warp).length}; shops ${npcs.filter((n) => n.shop).length}; ` +
      `scripts ${metrics.scriptsProcessed} (entryPoints ${metrics.entryPoints}, eventHandlers ${metrics.eventHandlers} em ${metrics.npcsWithEventHandlers} NPCs); ` +
      `duplicates ${npcs.filter((n) => n.duplicateOf).length}; funções puladas ${functionsSkipped}`,
  );
  console.log(
    `Validator: valid ${metrics.validatorValid} / unknown ${metrics.validatorUnknown} / invalid ${metrics.validatorInvalid}; ` +
      `goto órfão ${metrics.gotoMissing}; donpcevent não resolvido ${metrics.donpcMissing}`,
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
