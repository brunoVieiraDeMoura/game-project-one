import { vfxManager } from "./core/manager";
import { resolveSkillVfx } from "./core/registry";
import { useSkillCatalog } from "../net/skillCatalog";
import { criticalScaleFor } from "./core/hitVfxResolver";
import type { VfxHandle, VfxSpawnOptions } from "./core/types";
import type { VfxInstance } from "./vfxStore";

/**
 * Ponte entre o MODELO de rede (`vfx/vfxStore.ts`, continua sendo a porta
 * única — invariante do plano) e o VFX Core (`vfx/core/manager.ts`).
 *
 * `vfxStore.spawn()` chama `resolveMigratedVfxId()` primeiro; se resolver,
 * a skill já foi migrada (Fase 3+) e o efeito NUNCA entra no array
 * `effects` (o dispatcher legado, `vfx/SkillVfx.tsx`, nunca vê essas
 * skills). Este módulo só existe pra cobrir os dois pedaços de
 * "gerenciamento" que o array `effects` fazia de graça pro caminho legado
 * e que o Core precisa de um jeito próprio, já que a instância não vive
 * mais nesse array:
 *
 *  1. Área plantada pelo servidor (`unitGid`) — o servidor manda sumir por
 *     `skill:ground-gone`, que hoje chama `vfxStore.removeUnit(unitGid)`.
 *     Sem rastrear `unitGid → handle`, essa mensagem não teria pra onde ir.
 *  2. Buff recastado (`skillId+gid`) — recast ANTES do buff antigo expirar
 *     precisa CANCELAR o antigo (não coalescer: um "Sight" novo substitui o
 *     velho, não empilha; `coalesce` na `VfxDefinition` é pra hit repetido
 *     na MESMA janela curta, categoria de gameplay diferente).
 */

export function resolveMigratedVfxId(aegisName: string | undefined, kind: VfxInstance["kind"]): string | undefined {
  return resolveSkillVfx(aegisName, kind);
}

const unitHandles = new Map<number, VfxHandle>();
const buffHandles = new Map<string, VfxHandle>();

function buffKey(skillId: number, gid: number): string {
  return `${skillId}:${gid}`;
}

/** monta as `VfxSpawnOptions` a partir de um `VfxInstance` (o mesmo objeto
 * que `vfxStore.spawn()` recebe) — única tradução entre os dois formatos. */
function toSpawnOptions(effect: Omit<VfxInstance, "id">): VfxSpawnOptions {
  return {
    cell: effect.cell,
    targetGid: effect.kind === "impact" ? effect.gid : undefined,
    sourceGid: effect.kind === "cast" || effect.kind === "buff" ? effect.gid : effect.sourceGid,
    durationMs: Number.isFinite(effect.expiresAt) ? Math.max(0, effect.expiresAt - performance.now()) : undefined,
    skillId: effect.skillId,
    // "crítico = maior", universal pra QUALQUER VFX de impacto migrado
    // (Thunder Storm/Light Bolt/Soul Strike/Fire Ball/Frost Diver/Stone
    // Curse — não só o fragmento genérico) — mecanismo compartilhado via
    // `Core`, cada skill mantém a PRÓPRIA composição (auditoria "Hit VFX
    // genérico" 2026-08-19). `effect.crit` ausente (buff/área/cast, ou
    // impacto sem crítico) resolve pra `1`, sem efeito nenhum.
    scale: criticalScaleFor(effect.crit === true),
    payload: {
      damage: effect.damage,
      crit: effect.crit,
      onSelf: effect.onSelf,
      hits: effect.hits,
      // só usado por buff (Oráculo: raio das partículas de área) — mesma
      // leitura síncrona do catálogo que `VfxNode` fazia reativamente pro
      // caminho legado (ver `vfx/SkillVfx.tsx`, `buffInfo?.areaRadius`).
      // Catálogo ainda não resolvido pra esta skill = `undefined`, cada
      // arte tem seu próprio default real (nunca um chute).
      areaRadius: effect.kind === "buff" ? useSkillCatalog.getState().byId[effect.skillId]?.areaRadius : undefined,
    },
  };
}

/**
 * Nasce um VFX migrado. Devolve o `VfxHandle` pra quem chama guardar (o
 * `vfxStore` guarda em `unitGid`/`skillId+gid` só quando faz sentido pro
 * `kind` — "impact"/"cast" avulsos não precisam, morrem sozinhos por
 * `durationMs`).
 */
export function spawnMigratedVfx(vfxId: string, effect: Omit<VfxInstance, "id">): VfxHandle | undefined {
  const handle = vfxManager.play(vfxId, toSpawnOptions(effect));
  if (!handle) return undefined;

  if (effect.kind === "area" && effect.unitGid !== undefined) {
    unitHandles.set(effect.unitGid, handle);
  }
  if (effect.kind === "buff") {
    const key = buffKey(effect.skillId, effect.gid!);
    const previous = buffHandles.get(key);
    if (previous && previous.instanceId !== handle.instanceId) vfxManager.stop(previous, "recast");
    buffHandles.set(key, handle);
  }
  return handle;
}

/** espelha `vfxStore.removeUnit()` pro lado migrado — `skill:ground-gone`
 * de uma área que virou `renderer` do Core. */
export function stopMigratedVfxByUnit(unitGid: number): void {
  const handle = unitHandles.get(unitGid);
  if (!handle) return;
  vfxManager.stop(handle, "ground-gone");
  unitHandles.delete(unitGid);
}

/** sessão/mapa trocou — mesmo gatilho que `vfxStore.reset()` já reage. */
export function resetMigratedVfx(): void {
  vfxManager.reset();
  unitHandles.clear();
  buffHandles.clear();
}
