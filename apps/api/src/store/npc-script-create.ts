import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateNpcScript, type Npc } from "@ragnarok/game-data";

/**
 * Ponte entre `POST /npcs` e o gerador puro (`generateNpcScript`,
 * `@ragnarok/game-data`) — Fase 3.4
 * (docs/audit/fase3-testes/FASE3.4-NPC-CREATE.md). Diferente de
 * `npc-script-sync.ts` (que EDITA um `.txt` já existente via `legacyRef`),
 * este módulo só sabe ANEXAR um bloco novo no FIM de um arquivo próprio do
 * admin (`npc-idle/admin-created.txt`, registrado em
 * `rathena-conf/map_conf.txt` — nunca `rathena/`) — nunca escreve em nenhum
 * outro arquivo, nunca edita o que já está lá.
 *
 * `legacyRef` do NPC criado aponta pra este MESMO arquivo
 * ("admin-created.txt:N") — sem o prefixo "npc/" que todo NPC migrado tem
 * (`ORIGIN_BY_FOLDER`, `npc.ts`) — é essa ausência de prefixo que o `PUT`
 * usa pra saber qual raiz usar (`npcCreateRoot`, não `npcScriptRoot`) na
 * hora de editar um NPC criado pelo admin depois. Ver `routes/npcs.ts`.
 */

export type NpcScriptCreateResult =
  | { kind: "applied"; legacyRef: string; absPath: string; previousText: string }
  | { kind: "refused"; httpStatus: number; error: "invalid" | "operational"; message: string; code?: string };

/** nome de arquivo fixo — um só arquivo pra tudo que o admin cria (mesma
 * convenção de `devmenu.txt`/`panel.txt`: um arquivo por "dono" do
 * conteúdo, não um arquivo por NPC). */
export const ADMIN_CREATED_NPC_FILE = "admin-created.txt";

export function applyNpcScriptCreate(npcCreateRoot: string, npc: Npc): NpcScriptCreateResult {
  const generated = generateNpcScript(npc);
  if (!generated.ok) {
    return { kind: "refused", httpStatus: 422, error: "invalid", message: generated.reason ?? "não foi possível gerar o script deste NPC", code: generated.code };
  }

  const absPath = join(npcCreateRoot, ADMIN_CREATED_NPC_FILE);
  if (!existsSync(absPath)) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `arquivo de destino não existe: ${absPath} — esperado já criado por setup (Fase 3.4)` };
  }

  let currentText: string;
  try {
    currentText = readFileSync(absPath, "utf8");
  } catch (err) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `falha ao ler ${absPath}: ${(err as Error).message}` };
  }
  if (currentText.includes("\r")) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `${ADMIN_CREATED_NPC_FILE} usa CRLF — anexar não suportado nesta versão` };
  }

  const separator = currentText.endsWith("\n") || currentText.length === 0 ? "" : "\n";
  // tudo que vem ANTES da linha de cabeçalho do bloco novo — a contagem de
  // linhas deste prefixo (`split("\n").length`, que já é 1-based por conta
  // da última posição vazia após um "\n" final) é exatamente o número da
  // linha onde o cabeçalho vai cair, mesmo formato de legacyRef que
  // `migrate-npcs.ts` grava pra NPC migrado (relPath:linha 1-based).
  const prefix = `${currentText}${separator}\n`;
  const headerLine = prefix.split("\n").length;
  const newText = `${prefix}${generated.text}\n`;

  const tmpPath = `${absPath}.tmp`;
  try {
    writeFileSync(tmpPath, newText, "utf8");
    renameSync(tmpPath, absPath);
  } catch (err) {
    return { kind: "refused", httpStatus: 500, error: "operational", message: `falha ao escrever ${absPath}: ${(err as Error).message}` };
  }

  return {
    kind: "applied",
    legacyRef: `${ADMIN_CREATED_NPC_FILE}:${headerLine}`,
    absPath,
    previousText: currentText,
  };
}

/** desfaz `applyNpcScriptCreate` — restaura o arquivo pro conteúdo de ANTES
 * do append (mesmo padrão de `rollbackAppliedWrite`, `npc-script-sync.ts`:
 * melhor esforço, não uma transação de verdade — se a própria restauração
 * falhar, quem chama trata como pior caso). */
export function rollbackNpcScriptCreate(absPath: string, previousText: string): void {
  writeFileSync(absPath, previousText, "utf8");
}
