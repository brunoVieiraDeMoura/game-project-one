import { marcarVfxCancel, marcarVfxEnd, marcarVfxPulse, marcarVfxStart } from "../../core/diagnostics/vfxProbe";
import { useSkillCatalog } from "../../net/skillCatalog";
import type { VfxInstanceRuntime } from "./types";

/**
 * Ponte com a instrumentação já existente (`core/diagnostics/vfxProbe.ts`,
 * reusada por inteiro — nada é reconstruído aqui, ver Context do plano).
 *
 * Para VFX roteados pelo Core, `manager.ts` É tanto o "modelo" (o que
 * `vfxStore.spawn/prune/removeUnit` fazia pro caminho legado) QUANTO o
 * "mount" (o que `VfxNode` fazia) — não existe mais a distinção React
 * mount≠model create que motivava dois pares de evento separados
 * (START/END × MOUNT/UNMOUNT) no código antigo. Por isso este módulo emite
 * só START/END/CANCEL/PULSE — o par MOUNT/UNMOUNT continua existindo em
 * `vfxProbe.ts` só para o caminho legado (`vfx/SkillVfx.tsx: VfxNode`).
 *
 * `instanceId` do `VFXManager` usa um OFFSET alto (`manager.ts:
 * INSTANCE_ID_OFFSET`) de propósito — nunca pode colidir com o id de
 * `vfxStore` (que também é lido por `vfxProbe.ativos`, um `Map` único
 * global, sem namespace por origem).
 */
export function markInstanceStart(instance: VfxInstanceRuntime): void {
  const skillId = instance.spawnOptions.skillId;
  const skillInfo = skillId !== undefined ? useSkillCatalog.getState().byId[skillId] : undefined;
  marcarVfxStart({
    instanceId: instance.instanceId,
    skillId: skillId ?? 0,
    skillName: skillInfo?.name,
    vfxId: instance.vfxId,
    kind: instance.def.renderer,
    expectedDurationMs: instance.expiresAt !== null ? instance.expiresAt - instance.bornAt : null,
    casterGid: instance.spawnOptions.sourceGid,
    targetGid: instance.spawnOptions.targetGid,
  });
}

export function markInstancePulse(instance: VfxInstanceRuntime): void {
  marcarVfxPulse(instance.instanceId);
}

export function markInstanceEnd(instance: VfxInstanceRuntime): void {
  marcarVfxEnd(instance.instanceId);
}

/** parada EXPLÍCITA antes do fim natural — `manager.stop()` chamado de
 * fora (`skill:ground-gone`, recast de buff) em vez de `expiresAt` vencer
 * sozinho. Mesma distinção que `vfxStore.reset()`/recast de buff já faziam
 * pro caminho legado (`marcarVfxCancel`, não `marcarVfxEnd`). */
export function markInstanceCancelled(instance: VfxInstanceRuntime, motivo: string): void {
  marcarVfxCancel(instance.instanceId, motivo);
}
