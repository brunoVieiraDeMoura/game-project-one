import { writeFileSync, renameSync } from "node:fs";
import { z } from "zod";
import { NpcSchema, parseNpcScript, mapNpcScriptWithUnits, planNpcWrite, type Npc, type NpcMapResult } from "@ragnarok/game-data";
import { locateNpcScript } from "./npc-script-locate.js";

/**
 * Ponte entre `PUT /npcs/:id` e o Writer aprovado (`planNpcWrite`,
 * `@ragnarok/game-data`). Leia1.txt (integração Writer↔Admin, 2026-08-08):
 * "o fluxo deve operar sobre o `before` recompilado do `.txt` real, usando o
 * pipeline novo já aprovado, e não sobre a estrutura antiga que estava no
 * banco" + "o PUT de NPC é uma operação atômica: ou todas as alterações são
 * aplicadas, ou nenhuma é aplicada".
 *
 * Só entra em ação quando `dialogue`/`eventHandlers`/`dialogueEntry`
 * mudaram em relação ao registro ATUAL do banco — nome, posição, warp e shop
 * continuam sendo escrita só-banco, exatamente como antes desta integração
 * (não amplia o que o Writer edita, só decide QUANDO chamá-lo).
 *
 * **Proteção de concorrência, sem coluna de versão nova** (schema não muda
 * nesta etapa): o "before" nunca vem do banco nem do que o Admin carregou no
 * GET — vem de uma releitura FRESCA do `.txt`. Comparando esse fresh contra
 * o banco ATUAL (não o que o Admin carregou), uma divergência prova que o
 * arquivo mudou desde a última sincronização banco↔arquivo, e a edição é
 * recusada (409) sem tocar em nada. **Isto NÃO cobre dois admins editando o
 * MESMO npc ao mesmo tempo** — sem coluna de versão, essa é uma corrida de
 * banco pura, igual a qualquer outro CRUD do projeto; não finjo ter
 * resolvido isso aqui.
 */

const DialogueShapeSchema = z.object({
  dialogueEntry: NpcSchema.shape.dialogueEntry,
  dialogue: NpcSchema.shape.dialogue,
  eventHandlers: NpcSchema.shape.eventHandlers,
});
type DialogueShape = z.infer<typeof DialogueShapeSchema>;

function dialogueShape(npc: {
  dialogueEntry: Npc["dialogueEntry"];
  dialogue: Npc["dialogue"];
  eventHandlers: Npc["eventHandlers"];
}): DialogueShape {
  return DialogueShapeSchema.parse({
    dialogueEntry: npc.dialogueEntry,
    dialogue: npc.dialogue,
    eventHandlers: npc.eventHandlers,
  });
}

/** `JSON.stringify` sozinho é sensível à ORDEM das chaves — e a ordem
 * difere entre um objeto vindo fresco do Mapper e um vindo de
 * `NpcSchema.parse` sobre uma linha do banco (mesmo conteúdo, mesma
 * chamada de `.parse`, ordem de campo diferente por causa de onde cada um
 * foi CONSTRUÍDO). Sem isto, a checagem de stale-source dava falso
 * positivo — achado ao testar contra dado real (`kvm01.txt:29`: os dois
 * lados tinham EXATAMENTE os mesmos campos, só em ordem diferente, e a
 * comparação recusava a edição como se o arquivo tivesse mudado). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function sameShape(a: DialogueShape, b: DialogueShape): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export type NpcScriptSyncResult =
  | { kind: "skip" }
  | {
      kind: "applied";
      absPath: string;
      previousRawText: string;
      /** relativo ao `npcRoot` — mesmo valor gravado antes do ":" no `legacyRef`. */
      relPath: string;
      /** última linha (1-based) do bloco do NPC editado, ANTES da escrita — fronteira:
       * `legacyRef` de outro NPC no mesmo arquivo só precisa de ajuste se sua linha for maior que esta. */
      editedBlockEndLine: number;
      /** quantas linhas o arquivo ganhou (positivo) ou perdeu (negativo) com esta escrita. */
      lineDelta: number;
    }
  | {
      kind: "refused";
      httpStatus: number;
      error: "not-editable" | "stale-source" | "writer-refused" | "operational";
      message: string;
      code?: string;
      entryLabel?: string | null;
    };

export function applyNpcScriptEdit(npcRoot: string, current: Npc, requested: Npc): NpcScriptSyncResult {
  const currentShape = dialogueShape(current);
  const requestedShape = dialogueShape(requested);
  if (sameShape(currentShape, requestedShape)) return { kind: "skip" };

  if (current.warp || current.shop || current.duplicateOf) {
    return {
      kind: "refused",
      httpStatus: 422,
      error: "not-editable",
      message: "este NPC não tem corpo de script próprio (é warp, shop ou duplicate) — diálogo não pode ser editado",
    };
  }
  if (!current.legacyRef) {
    return { kind: "refused", httpStatus: 422, error: "not-editable", message: "NPC sem legacyRef — não há arquivo de origem pra localizar" };
  }

  const located = locateNpcScript(npcRoot, current.legacyRef);
  if (!located.ok) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `${located.code}: ${located.reason}` };
  }

  let ast;
  try {
    ast = parseNpcScript(located.code);
  } catch (err) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `parser falhou ao reler o .txt: ${(err as Error).message}` };
  }
  const before = mapNpcScriptWithUnits(ast);

  const freshShape = dialogueShape({ dialogueEntry: before.dialogueEntry, dialogue: before.dialogue, eventHandlers: before.eventHandlers });
  if (!sameShape(freshShape, currentShape)) {
    return {
      kind: "refused",
      httpStatus: 409,
      error: "stale-source",
      message: "o .txt mudou desde a última sincronização com o banco — recarregue o NPC antes de editar",
    };
  }

  const after: NpcMapResult = { dialogueEntry: requested.dialogueEntry, dialogue: requested.dialogue, eventHandlers: requested.eventHandlers };
  const result = planNpcWrite(located.code, before, after);
  if (!result.ok) {
    const failed = result.entries.find((e) => !e.ok);
    return {
      kind: "refused",
      httpStatus: 422,
      error: "writer-refused",
      code: failed?.code,
      entryLabel: failed?.entryLabel ?? null,
      message: failed?.reason ?? "Writer recusou a edição",
    };
  }
  if (result.changedCount === 0) {
    // dialogueShape divergiu (JSON raso) mas o Writer não viu diferença nó a
    // nó — inconsistência real entre as duas comparações. Não devia
    // acontecer; recusa em vez de aceitar silenciosamente.
    return {
      kind: "refused",
      httpStatus: 500,
      error: "operational",
      message: "diálogo mudou mas o Writer não identificou nenhuma alteração nó a nó — recusando por segurança",
    };
  }

  const ranges = result.entries
    .filter((e) => e.ok && e.changed && e.patchedBody !== undefined)
    .map((e) => {
      const sourceMap = e.entryLabel === null ? before.mainSourceMap : before.handlerSourceMaps[e.entryLabel]!;
      const units = sourceMap.units;
      const lastUnit = units[units.length - 1];
      const start = sourceMap.bodyStart!;
      const end = lastUnit ? lastUnit.end : start;
      return { start, end, text: e.patchedBody! };
    })
    .sort((a, b) => a.start - b.start);

  let newCode = "";
  let cursor = 0;
  for (const r of ranges) {
    newCode += located.code.slice(cursor, r.start) + r.text;
    cursor = r.end;
  }
  newCode += located.code.slice(cursor);

  // prova antes de escrever: o texto novo reparseia pro grafo pedido.
  let reparsed;
  try {
    reparsed = mapNpcScriptWithUnits(parseNpcScript(newCode));
  } catch (err) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `round-trip falhou ao reparsear o corpo novo: ${(err as Error).message}` };
  }
  const reparsedShape = dialogueShape({
    dialogueEntry: reparsed.dialogueEntry,
    dialogue: reparsed.dialogue,
    eventHandlers: reparsed.eventHandlers,
  });
  if (!sameShape(reparsedShape, requestedShape)) {
    return {
      kind: "refused",
      httpStatus: 500,
      error: "operational",
      message: "round-trip falhou: o corpo novo não reparseia pro grafo pedido",
    };
  }

  const newRawText = located.rawText.slice(0, located.bodyStart) + newCode + located.rawText.slice(located.bodyEnd);

  const tmpPath = `${located.absPath}.tmp`;
  try {
    writeFileSync(tmpPath, newRawText, "utf8");
    renameSync(tmpPath, located.absPath);
  } catch (err) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `falha ao escrever o arquivo: ${(err as Error).message}` };
  }

  const lineDelta = newRawText.split("\n").length - located.rawText.split("\n").length;
  return {
    kind: "applied",
    absPath: located.absPath,
    previousRawText: located.rawText,
    relPath: located.relPath,
    editedBlockEndLine: located.blockEndLine,
    lineDelta,
  };
}

/** Acha um sibling `legacyRef` que precisa de ajuste depois que UM write mudou
 * a contagem de linhas de `relPath` — só desloca refs no MESMO arquivo, com
 * linha estritamente depois do bloco editado (`afterLine`). Nunca toca o
 * `legacyRef` do próprio NPC editado (ele fica com a linha do seu cabeçalho,
 * que nunca muda — só o que vem DEPOIS do bloco dele pode ter deslocado).
 * Devolve `undefined` quando não há ajuste a fazer (arquivo diferente, linha
 * antes/dentro do bloco editado, ou ref malformado — nesse caso não é este
 * código que deve reportar o problema). */
export function shiftLegacyRefIfAfter(legacyRef: string, relPath: string, afterLine: number, delta: number): string | undefined {
  if (delta === 0) return undefined;
  const sep = legacyRef.lastIndexOf(":");
  if (sep < 0) return undefined;
  const refRelPath = legacyRef.slice(0, sep);
  const lineNum = Number(legacyRef.slice(sep + 1));
  if (refRelPath !== relPath || !Number.isInteger(lineNum) || lineNum <= afterLine) return undefined;
  return `${refRelPath}:${lineNum + delta}`;
}

/** Restaura os bytes originais depois de `applied` — usado quando a
 * atualização do BANCO falha depois que o arquivo já tinha sido escrito
 * (a única janela em que os dois podem ficar fora de sincronia: o Node não
 * tem transação entre arquivo e banco). Melhor esforço, não garantido —
 * se a própria restauração falhar (ex. disco cheio), o erro é relançado e
 * quem chama tem que tratar como o pior caso: os dois lados podem ter
 * ficado divergentes. Não finjo que isto é atômico de verdade. */
export function rollbackAppliedWrite(absPath: string, previousRawText: string): void {
  writeFileSync(absPath, previousRawText, "utf8");
}
