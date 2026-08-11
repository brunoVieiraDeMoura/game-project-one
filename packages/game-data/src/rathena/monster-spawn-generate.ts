import type { MonsterSpawn } from "../monster";

/**
 * Gerador de linha de spawn de monstro (Fase 4, auditoria de spawn de mob no
 * admin) — formato oficial confirmado em `rathena/doc/script_commands.txt`
 * ("Create a permanent monster spawn") e conferido byte a byte contra
 * `npc-idle/mobs/{prontera,gpqa01}.txt`:
 *
 * ```
 * <mapa>{,<x>{,<y>{,<xs>{,<ys>}}}}\tmonster\t<nome>\t<mobId>,<quantidade>{,<delay1>{,<delay2>}}
 * ```
 *
 * `boss_monster` no lugar de `monster` é a mesma sintaxe, só troca o comando
 * (doc: habilita `SC_BOSSMAPINFO`/Convex Mirror). Campos opcionais do fim
 * (nível do nome, event, mob size, mob ai) NÃO são gerados aqui — não têm
 * representação em `MonsterSpawnSchema`, e "não inventar formato" inclui não
 * inventar campo que o schema não modela.
 *
 * Identidade do spawn (Fase 3.5, aprendizado do drift de `legacyRef`): NUNCA
 * o número da linha. Cada spawn ganha uma linha de comentário própria
 * (`// spawnId:<id>`) IMEDIATAMENTE ANTES da linha de dados — o writer
 * (`apps/api/src/store/monster-spawn-writer.ts`) sempre re-escaneia o
 * arquivo procurando esse marcador antes de editar/remover, nunca confia
 * numa posição lembrada de uma leitura anterior. Comentário de linha cheia
 * (`//` isolado, nunca em sufixo de linha de dados) é sintaxe já usada em
 * toda a árvore de `npc/`/`npc-idle/` — não há ambiguidade de parsing.
 */

export interface SpawnLineResult {
  ok: boolean;
  text?: string;
  reason?: string;
  code?: "unsafe-name";
}

/** nome de monstro vira o 3º campo (tab-separated) de uma linha de spawn —
 * tab/quebra de linha ali quebraria o formato de coluna inteiro. */
export function isSafeMonsterSpawnName(name: string): boolean {
  return !/[\t\r\n]/.test(name);
}

export function generateSpawnLine(spawn: MonsterSpawn, mob: { id: number; name: string }): SpawnLineResult {
  if (!isSafeMonsterSpawnName(mob.name)) {
    return { ok: false, code: "unsafe-name", reason: `nome do monstro "${mob.name}" contém tab ou quebra de linha — quebraria a linha de spawn` };
  }
  const header = spawn.area
    ? `${spawn.mapId},${spawn.area.x},${spawn.area.y},${spawn.area.xs},${spawn.area.ys}`
    : `${spawn.mapId},0,0`;
  const cmd = spawn.boss ? "boss_monster" : "monster";
  const fields: (string | number)[] = [mob.id, spawn.amount, spawn.respawnTimeMs];
  // delay2 (variância) só sai quando > 0 — mesma convenção do corpus real
  // (`prt_fild00,0,0\tmonster\tRoda Frog\t1012,169,5000`, sem 4º campo;
  // ausente = 0 no parser do rAthena, então omitir é lossless).
  if (spawn.respawnVarianceMs > 0) fields.push(spawn.respawnVarianceMs);
  return { ok: true, text: `${header}\t${cmd}\t${mob.name}\t${fields.join(",")}` };
}

export const SPAWN_ID_MARKER_PREFIX = "// spawnId:";

export function spawnMarkerLine(spawnId: string): string {
  return `${SPAWN_ID_MARKER_PREFIX}${spawnId}`;
}

/** `undefined` quando a linha não é um marcador — usado pelo writer pra
 * escanear o arquivo procurando o spawn certo. */
export function parseSpawnMarker(line: string): string | undefined {
  return line.startsWith(SPAWN_ID_MARKER_PREFIX) ? line.slice(SPAWN_ID_MARKER_PREFIX.length).trim() : undefined;
}

/** confere se a linha logo depois de um marcador é mesmo uma linha de spawn
 * (`monster`/`boss_monster` na 2ª coluna) — mesma disciplina defensiva de
 * `locateNpcScript`'s `isScriptHeader`: nunca assumir, sempre confirmar antes
 * de sobrescrever. */
export function isSpawnDataLine(line: string): boolean {
  const cols = line.split("\t");
  return cols[1] === "monster" || cols[1] === "boss_monster";
}

/** marcador + linha de dados juntos — a unidade atômica de 2 linhas que o
 * writer anexa (criação) ou usa como molde pra substituir só a 2ª linha
 * (edição, marcador intocado — `spawnId` nunca muda). */
export function generateSpawnBlock(spawn: MonsterSpawn, mob: { id: number; name: string }, spawnId: string): SpawnLineResult {
  const line = generateSpawnLine(spawn, mob);
  if (!line.ok) return line;
  return { ok: true, text: `${spawnMarkerLine(spawnId)}\n${line.text}` };
}
