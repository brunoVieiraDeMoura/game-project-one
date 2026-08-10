import type { DialogueNode, Npc } from "../npc";
import { escapeString, printLeaf } from "./npc-script-writer";

/**
 * Gerador de script de NPC NOVO (Fase 3.4,
 * docs/audit/fase3-testes/FASE3.4-NPC-CREATE.md) — diferente do Writer
 * (`npc-script-writer.ts`), que só sabe EDITAR um nó dentro de um `.txt` já
 * existente (precisa de `before`/`after` pra diffar por fatia de byte). Não
 * existe "before" pra um NPC que ainda não existe — então este módulo
 * IMPRIME o grafo inteiro do zero, andando de `dialogueEntry` em diante via
 * `.next`, reaproveitando `escapeString`/`printLeaf` do Writer (mesmas
 * strings, mesmo escapamento — nunca reimplementado em paralelo).
 *
 * Escopo deliberadamente MENOR que o Writer de edição: só o grafo LINEAR
 * (`say` → `say`/`action:warp`/`end`, em cadeia, sem ramificação) — isso
 * cobre o MVP pedido (nome/mapa/x/y/sprite/diálogo/`next`/`close`/`warp`).
 * `choice`/`conditional`/`legacyScript`/demais `NpcAction` kinds/event
 * handlers são RECUSADOS com motivo explícito, não uma tentativa de gerar
 * sintaxe nova pra eles — walking de múltiplos ramos com reconvergência
 * seria uma extensão real do escopo, não a base mínima pedida.
 */

export type GenerateRefusalCode =
  | "empty-dialogue"
  | "missing-node"
  | "cycle-detected"
  | "dangling-say"
  | "unsupported-node-kind";

export interface GenerateResult {
  ok: boolean;
  /** corpo `{...}` SEM as chaves — só o texto de dentro, já indentado. */
  body?: string;
  reason?: string;
  code?: GenerateRefusalCode;
}

function refuse(code: GenerateRefusalCode, reason: string): GenerateResult {
  return { ok: false, code, reason };
}

/** anda a cadeia `dialogueEntry -> .next -> .next -> ...` e imprime cada nó.
 * Só aceita `say`/`end`/`action:warp` encadeados linearmente — o mesmo
 * conjunto que `isLeafNode` do Writer já sabe imprimir (`printLeaf`), só que
 * aqui em SEQUÊNCIA, gerando `next;` entre páginas de texto e `close;`
 * quando um `say` cai direto num `end`. */
export function generateNpcDialogueBody(dialogueEntry: string | null, dialogue: DialogueNode[]): GenerateResult {
  if (dialogueEntry === null || dialogue.length === 0) {
    return refuse("empty-dialogue", "diálogo vazio — NPC precisa de pelo menos 1 nó (say ou end)");
  }
  const byId = new Map(dialogue.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const lines: string[] = [];
  let cursor: string | null = dialogueEntry;

  while (cursor !== null) {
    if (visited.has(cursor)) {
      return refuse("cycle-detected", `ciclo detectado envolvendo o nó "${cursor}" — geração linear não suporta laço`);
    }
    visited.add(cursor);
    const node = byId.get(cursor);
    if (!node) return refuse("missing-node", `nó "${cursor}" referenciado (via .next) mas não existe no grafo`);

    if (node.kind === "say") {
      for (const line of (node.text ?? "").split("\n")) lines.push(`\tmes "${escapeString(line)}";`);
      if (!node.next) {
        return refuse("dangling-say", `nó "say" (${cursor}) não encadeia pra nada (sem .next) — todo diálogo precisa terminar em "end"`);
      }
      const nextNode = byId.get(node.next);
      if (nextNode?.kind === "end") {
        lines.push("\tclose;");
        cursor = null;
        break;
      }
      lines.push("\tnext;");
      cursor = node.next;
      continue;
    }

    if (node.kind === "end") {
      lines.push("\tend;");
      cursor = null;
      break;
    }

    if (node.kind === "action" && node.action?.kind === "warp") {
      const printed = printLeaf(node);
      lines.push(`\t${printed}`);
      cursor = node.next ?? null;
      continue;
    }

    return refuse(
      "unsupported-node-kind",
      `nó "${cursor}" (kind "${node.kind}"${node.kind === "action" ? `/"${node.action?.kind}"` : ""}) não tem geração suportada pra NPC novo — só say/end/action:warp encadeados linearmente`,
    );
  }

  return { ok: true, body: lines.join("\n") };
}

/** nome de script seguro — sempre com sufixo `#<id>` (convenção real do
 * corpus, ex. "Mestre do Teste#idlenarok", "#ep15_1elb": o rAthena NUNCA
 * mostra o que vem depois de "#" ao jogador, só usa como desambiguador
 * interno) — garante que dois NPCs com o mesmo nome de exibição nunca
 * colidem no rAthena, mesmo que o catálogo já garanta `id` único por conta
 * própria. `id` é validado em outro lugar (`isSafeNpcId`) antes de chegar
 * aqui — nunca aceito sem checar primeiro. */
export function npcScriptName(npc: Pick<Npc, "id" | "name">): string {
  return `${npc.name}#${npc.id}`;
}

/** `id` vira sufixo literal `#id` num nome de script rAthena — só
 * alfanumérico/underscore é seguro ali (vírgula/tab/aspas quebrariam o
 * cabeçalho `mapa,x,y,dir\tscript\tNome#id\tSPRITE,{`). */
export function isSafeNpcScriptId(id: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(id);
}

export interface NpcHeaderResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

/** cabeçalho `mapa,x,y,dir\tscript\tNome#id\tSPRITE,{` — mesma forma
 * exata de todo NPC do tipo `script` já migrado (`devmenu.txt:17`,
 * `quests_15_1.txt:4448`, conferido byte a byte antes de escrever qualquer
 * linha nova). */
export function generateNpcHeader(npc: Npc): NpcHeaderResult {
  if (!isSafeNpcScriptId(npc.id)) {
    return { ok: false, reason: `id "${npc.id}" tem caractere fora de [A-Za-z0-9_] — não é seguro como sufixo #id de script` };
  }
  const [x, y] = npc.position;
  const name = npcScriptName(npc);
  return { ok: true, text: `${npc.mapId},${x},${y},${npc.direction}\tscript\t${name}\t${npc.sprite},{` };
}

export interface FullScriptResult {
  ok: boolean;
  text?: string;
  reason?: string;
  code?: GenerateRefusalCode | "unsafe-id";
}

/** script COMPLETO (cabeçalho + corpo + fecho) pronto pra `append` num
 * arquivo `.txt` real — só NPC tipo diálogo simples (sem `shop`/`warp`
 * NPC/`duplicateOf`/`eventHandlers`, cada um com sua própria convenção de
 * cabeçalho que este gerador não cobre — ver FASE3.4-NPC-CREATE.md §MVP). */
export function generateNpcScript(npc: Npc): FullScriptResult {
  if (npc.shop) return { ok: false, code: "unsupported-node-kind", reason: "NPC com shop não é gerável nesta versão (cabeçalho de shop é outra convenção, fora do MVP)" };
  if (npc.warp) return { ok: false, code: "unsupported-node-kind", reason: "NPC do tipo warp (área de gatilho) não é gerável nesta versão — só NPC de diálogo clicável" };
  if (npc.duplicateOf) return { ok: false, code: "unsupported-node-kind", reason: "NPC duplicate() não é gerável nesta versão" };
  if (npc.eventHandlers.length > 0) return { ok: false, code: "unsupported-node-kind", reason: "event handlers (OnTouch/OnInit/...) não são geráveis nesta versão — crie sem eles" };

  const header = generateNpcHeader(npc);
  if (!header.ok) return { ok: false, code: "unsafe-id", reason: header.reason };

  const body = generateNpcDialogueBody(npc.dialogueEntry, npc.dialogue);
  if (!body.ok) return { ok: false, code: body.code, reason: body.reason };

  return { ok: true, text: `${header.text}\n${body.body}\n}` };
}
