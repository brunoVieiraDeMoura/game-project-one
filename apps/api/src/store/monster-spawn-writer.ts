import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { generateSpawnLine, generateSpawnBlock, parseSpawnMarker, isSpawnDataLine, type MonsterSpawn } from "@ragnarok/game-data";

/**
 * Write-path real de spawn de monstro (Fase 4, auditoria de spawn de mob no
 * admin — A23). `Monster.spawns[]` no catálogo (Supabase/JSON) é o estado
 * LÓGICO; este módulo é quem sincroniza esse estado com o arquivo `.txt`
 * real que o rAthena carrega (`npc-idle/mobs/<mapId>.txt`, um arquivo por
 * mapa, mesma convenção já usada por `gpqa01.txt`).
 *
 * Identidade: `MonsterSpawn.spawnId` — nunca número de linha (Fase 3.5). O
 * writer re-escaneia o arquivo procurando `// spawnId:<id>` a cada operação;
 * nunca lembra uma posição de uma leitura anterior. Um spawn do catálogo SEM
 * `spawnId` nunca foi tocado por este writer (ex.: leitura de migração) — é
 * deliberadamente IGNORADO no diff (nunca editado/removido às cegas).
 *
 * Registro no `map_conf.txt`: só CONFERE (nunca escreve) — se o arquivo alvo
 * não estiver registrado como `npc:`, a operação inteira é recusada
 * (ponto 8 do escopo aprovado: não automatizar registro; classificar como
 * bloqueado quando o mapa não estiver registrado).
 */

export interface MonsterSpawnWriterPaths {
  /** `npc-idle/mobs` — destino de `<mapId>.txt`. */
  spawnRoot: string;
  /** `rathena-conf/map_conf.txt` — só leitura, pra checagem de registro. */
  mapConfPath: string;
}

export type MonsterSpawnSyncResult =
  | { kind: "skip" }
  | { kind: "applied"; spawns: MonsterSpawn[]; touchedFiles: string[]; rollback: () => void }
  | {
      kind: "refused";
      httpStatus: number;
      error: "map-not-registered" | "invalid" | "operational";
      message: string;
      mapId?: string;
    };

function confRegistrationLine(mapId: string): string {
  return `npc: npc/game-project/mobs/${mapId}.txt`;
}

function isMapRegistered(mapConfPath: string, mapId: string): boolean {
  let conf: string;
  try {
    conf = readFileSync(mapConfPath, "utf8");
  } catch {
    return false;
  }
  const want = confRegistrationLine(mapId);
  return conf.split("\n").some((l) => l.trim() === want);
}

function spawnFilePath(spawnRoot: string, mapId: string): string {
  return join(spawnRoot, `${mapId}.txt`);
}

function sameSpawnContent(a: MonsterSpawn, b: MonsterSpawn): boolean {
  const strip = ({ spawnId: _spawnId, ...rest }: MonsterSpawn) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

interface FileOps {
  mapId: string;
  removeIds: Set<string>;
  edits: Map<string, MonsterSpawn>;
  creates: { spawnId: string; spawn: MonsterSpawn }[];
}

/** aplica as operações de UM arquivo sobre o texto atual — devolve o texto
 * novo, ou uma recusa se algo não bater (marcador sem linha de dados válida
 * logo depois — arquivo mudou por fora do que este writer entende). */
function applyFileOps(
  currentText: string,
  ops: FileOps,
  mobById: Map<string, { id: number; name: string }>,
): { ok: true; text: string } | { ok: false; message: string } {
  const lines = currentText.length > 0 ? currentText.split("\n") : [];
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const markerId = parseSpawnMarker(line);
    if (markerId === undefined || !(ops.removeIds.has(markerId) || ops.edits.has(markerId))) {
      out.push(line);
      continue;
    }
    const dataLine = lines[i + 1];
    if (dataLine === undefined || !isSpawnDataLine(dataLine)) {
      return { ok: false, message: `marcador "spawnId:${markerId}" em ${ops.mapId}.txt não é seguido de uma linha "monster"/"boss_monster" — arquivo pode ter mudado por fora` };
    }
    if (ops.removeIds.has(markerId)) {
      // desfaz exatamente o separador que a criação insere antes de um bloco
      // novo (`out.push("")` na fase de creates, abaixo) — só a linha em
      // branco IMEDIATAMENTE anterior a ESTE marcador, nunca uma varredura
      // ampla do arquivo. Uma linha em branco legítima em qualquer outro
      // lugar do arquivo nunca é tocada por este `pop`.
      if (out.length > 0 && out[out.length - 1] === "") out.pop();
      i++; // pula marcador + linha de dados — remove os dois
      continue;
    }
    // edição: marcador fica, linha de dados é regenerada
    const spawn = ops.edits.get(markerId)!;
    const mob = mobById.get(markerId);
    if (!mob) return { ok: false, message: `spawn "${markerId}" sem monstro resolvido pra regenerar a linha` };
    const generated = generateSpawnLine(spawn, mob);
    if (!generated.ok) return { ok: false, message: generated.reason ?? "falha ao gerar linha de spawn" };
    out.push(line, generated.text!);
    i++; // já consumiu a linha de dados original
  }

  for (const { spawnId, spawn } of ops.creates) {
    const mob = mobById.get(spawnId);
    if (!mob) return { ok: false, message: `spawn "${spawnId}" sem monstro resolvido pra gerar a linha` };
    const block = generateSpawnBlock(spawn, mob, spawnId);
    if (!block.ok) return { ok: false, message: block.reason ?? "falha ao gerar bloco de spawn" };
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(...block.text!.split("\n"));
  }

  let text = out.join("\n");
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  return { ok: true, text };
}

/**
 * Sincroniza `before` → `after` (spawns de UM monstro) com os arquivos
 * `.txt` reais. `mob` é o próprio monstro sendo salvo (nome/id — não precisa
 * de resolver externo, o corpo do PUT/POST já é o monstro inteiro).
 */
export function applyMonsterSpawnSync(
  paths: MonsterSpawnWriterPaths,
  mob: { id: number; name: string },
  before: MonsterSpawn[],
  after: MonsterSpawn[],
): MonsterSpawnSyncResult {
  // 1) toda entrada de `after` ganha spawnId — atribuído aqui, devolvido pro
  //    chamador persistir no catálogo (é a identidade estável).
  const resolvedAfter = after.map((s) => (s.spawnId ? s : { ...s, spawnId: randomUUID() }));

  const beforeById = new Map(before.filter((s) => s.spawnId).map((s) => [s.spawnId!, s]));
  const afterById = new Map(resolvedAfter.map((s) => [s.spawnId!, s]));

  const opsByMap = new Map<string, FileOps>();
  const opsFor = (mapId: string): FileOps => {
    let o = opsByMap.get(mapId);
    if (!o) {
      o = { mapId, removeIds: new Set(), edits: new Map(), creates: [] };
      opsByMap.set(mapId, o);
    }
    return o;
  };

  for (const [id, b] of beforeById) {
    if (!afterById.has(id)) opsFor(b.mapId).removeIds.add(id);
  }
  for (const [id, a] of afterById) {
    const b = beforeById.get(id);
    if (!b) {
      opsFor(a.mapId).creates.push({ spawnId: id, spawn: a });
    } else if (b.mapId !== a.mapId) {
      opsFor(b.mapId).removeIds.add(id);
      opsFor(a.mapId).creates.push({ spawnId: id, spawn: a });
    } else if (!sameSpawnContent(b, a)) {
      opsFor(a.mapId).edits.set(id, a);
    }
  }

  if (opsByMap.size === 0) return { kind: "skip" };

  // 2) valida registro ANTES de tocar qualquer arquivo — tudo ou nada.
  for (const mapId of opsByMap.keys()) {
    if (!isMapRegistered(paths.mapConfPath, mapId)) {
      return {
        kind: "refused",
        httpStatus: 422,
        error: "map-not-registered",
        mapId,
        message: `mapa "${mapId}" não tem "npc: npc/game-project/mobs/${mapId}.txt" registrado em map_conf.txt — spawn não pode ser gravado sem esse registro manual (requer restart do map-server pra valer, fora do escopo desta escrita)`,
      };
    }
  }

  const mobById = new Map<string, { id: number; name: string }>();
  for (const s of resolvedAfter) mobById.set(s.spawnId!, mob);
  for (const s of before) if (s.spawnId) mobById.set(s.spawnId, mob);

  // 3) gera o texto novo de cada arquivo tocado, tudo em memória, antes de
  //    escrever qualquer coisa (mesma garantia de "todos ou nenhum" do
  //    JobDatabaseWriter/NpcScriptSync).
  const previousState = new Map<string, { existed: boolean; text: string }>();
  const newTexts = new Map<string, string>();
  for (const [mapId, ops] of opsByMap) {
    const absPath = spawnFilePath(paths.spawnRoot, mapId);
    const existed = existsSync(absPath);
    const currentText = existed ? readFileSync(absPath, "utf8") : "";
    if (currentText.includes("\r")) {
      return { kind: "refused", httpStatus: 500, error: "operational", mapId, message: `${mapId}.txt usa CRLF — escrita não suportada nesta versão` };
    }
    const result = applyFileOps(currentText, ops, mobById);
    if (!result.ok) {
      return { kind: "refused", httpStatus: 500, error: "operational", mapId, message: result.message };
    }
    previousState.set(absPath, { existed, text: currentText });
    newTexts.set(absPath, result.text);
  }

  // 4) só agora: escrita atômica (tmp + rename) de todos os arquivos tocados.
  const tmpPaths: string[] = [];
  try {
    for (const [absPath, text] of newTexts) {
      mkdirSync(dirname(absPath), { recursive: true });
      const tmp = `${absPath}.tmp`;
      writeFileSync(tmp, text, "utf8");
      tmpPaths.push(tmp);
    }
    for (const absPath of newTexts.keys()) {
      renameSync(`${absPath}.tmp`, absPath);
    }
  } catch (err) {
    for (const tmp of tmpPaths) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        /* melhor esforço */
      }
    }
    return { kind: "refused", httpStatus: 500, error: "operational", message: `falha ao escrever arquivo(s) de spawn: ${(err as Error).message}` };
  }

  return {
    kind: "applied",
    spawns: resolvedAfter,
    touchedFiles: [...newTexts.keys()],
    rollback: () => {
      for (const [absPath, prev] of previousState) {
        if (prev.existed) writeFileSync(absPath, prev.text, "utf8");
        else rmSync(absPath, { force: true });
      }
    },
  };
}
