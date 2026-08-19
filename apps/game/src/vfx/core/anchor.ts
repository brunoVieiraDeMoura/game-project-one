import * as THREE from "three";
import { cellToWorld } from "../../net/legacyCells";
import { interpolatedCell, useWorldStore } from "../../net/worldStore";
import { anchorDeArma } from "../../entities/weaponAnchors";
import { mobModel, NPC_MODEL } from "../../entities/mobModels";
import { classModelFor } from "../../entities/classModels";
import { terrainFollowDeltaY } from "../terrainFollow";
import type { Vec3, VfxAnchorKind, VfxSpawnOptions, VfxWorldContext } from "./types";

/**
 * Resolução de posição — TODA a lógica de "onde no mundo 3D isto desenha"
 * mora aqui, nunca num renderer nem numa skill. Substitui `worldPositionOf`/
 * o cálculo de `casterOffset`/ponta do cajado que hoje vivem espalhados em
 * `vfx/SkillVfx.tsx` (`VfxNode`).
 */

/** alias — nome usado historicamente neste arquivo; `Vec3` é o tipo
 * compartilhado com `types.ts`/`manager.ts`. */
export type WorldPoint = Vec3;

/** tamanho visual de uma entidade (mob/player/npc) — MESMO catálogo que o
 * modelo 3D já usa pra escalar, nunca uma tabela nova (docblock original em
 * `vfx/SkillVfx.tsx: targetVisualScale`). */
export function entityVisualScale(gid: number | undefined): number {
  if (gid === undefined) return 1;
  const entity = useWorldStore.getState().entities[gid];
  if (!entity) return 1;
  if (entity.kind === "mob") return mobModel(entity.job).scale;
  if (entity.kind === "player") return classModelFor(entity.job).scale;
  if (entity.kind === "npc") return NPC_MODEL.scale;
  return 1;
}

/** posição de mundo de uma entidade viva (interpolada) ou de uma célula —
 * mesma função que `worldPositionOf` fazia em `SkillVfx.tsx`, generalizada
 * pra aceitar célula OU gid explícito (não só o `effect` inteiro). */
export function resolveEntityOrCellPosition(
  world: VfxWorldContext,
  point: { gid?: number; cell?: { x: number; y: number } },
): WorldPoint | null {
  if (point.cell) return cellToWorld(world.map, world.mapping, point.cell.x, point.cell.y);
  if (point.gid === undefined) return null;
  const store = useWorldStore.getState();
  const source = point.gid === store.selfGid ? store.self : store.entities[point.gid];
  if (!source) return null;
  const cell = interpolatedCell(source, performance.now());
  return cellToWorld(world.map, world.mapping, cell.x, cell.y);
}

/** ponta real da arma equipada, em mundo — `undefined` enquanto o
 * `WeaponAttachment` do caster ainda não montou (primeiro quadro). */
export function resolveWeaponTip(gid: number): WorldPoint | undefined {
  const tip = anchorDeArma(gid);
  if (!tip) return undefined;
  const world = new THREE.Vector3();
  tip.getWorldPosition(world);
  return { x: world.x, y: world.y, z: world.z };
}

/** altura chutada só pro FALLBACK de posição do caster (peito/mão) —
 * mesmo valor documentado em `SkillVfx.tsx: FALLBACK_LAUNCH_Y_BIAS`. */
export const FALLBACK_LAUNCH_Y_BIAS = 1.0;

export interface ResolvedAnchor {
  /** posição de mundo do PONTO DE ANCORAGEM do efeito (o que
   * `VfxRoot`/renderer usa como origem local 0,0,0) */
  position: WorldPoint;
  /** offset LOCAL, em unidades de MUNDO (2026-08-19-zb: nunca dividido por
   * `cellSize` — os renderers GPU somam isto direto em `instance.position`,
   * que já é mundo, sem nenhum `<group>` reescalando no meio), do CASTER
   * relativo à âncora — só preenchido para `anchor:"caster-to-target"`;
   * `null` quando não há dado de caster nenhum (mesmo fallback documentado
   * em `SkillVfx.tsx`). */
  casterOffset: WorldPoint | null;
  targetScale: number;
  /** entidade de `anchor:"entity"` não resolveu (gid sumiu do `worldStore`)
   * E `opts.payload?.trackTargetSafely === true` — sinal pro `manager.ts`
   * NÃO sobrescrever `instance.position` neste quadro (mantém a última
   * posição boa em vez de saltar pro sentinela `{0,-999,0}`). Opt-in de
   * PROPÓSITO (Fire Lance/Cold Bolt tracking, 2026-08-19-e): o
   * comportamento DEFAULT (flag ausente) continua EXATAMENTE o de sempre —
   * `manager.test.ts` já prova/documenta o salto pro sentinela como
   * intencional pra quem não pede o contrário. `undefined`/`false` = não
   * mexe em nada. */
  stale?: boolean;
}

/**
 * Resolve UMA âncora completa — o equivalente ao que `VfxNode` calculava
 * espalhado por `initial`/`anchorRef`/`casterOffsetFallback`/`casterTipOffset`.
 * Chamado pelo `manager` no spawn (posição inicial) e todo quadro pelo
 * `VfxRoot` para quem segue entidade (`anchor:"entity"`).
 */
export function resolveAnchor(
  world: VfxWorldContext,
  anchorKind: VfxAnchorKind,
  opts: VfxSpawnOptions,
): ResolvedAnchor {
  // mesma prioridade de `anchorKind === "entity"` abaixo: alvo primeiro,
  // caster como fallback (buff — Oráculo escala pelo CASTER, nunca há
  // "alvo" nenhum nesse caso).
  const targetScale = entityVisualScale(opts.targetGid ?? opts.sourceGid);

  if (anchorKind === "cell") {
    const pos = (opts.cell && resolveEntityOrCellPosition(world, { cell: opts.cell })) ?? opts.position ?? { x: 0, y: -999, z: 0 };
    return { position: pos, casterOffset: null, targetScale };
  }

  if (anchorKind === "entity") {
    // `targetGid` primeiro (impacto — segue o ALVO); sem alvo, cai pro
    // `sourceGid` (buff — segue o CASTER, ex. Oráculo). Nunca os dois ao
    // mesmo tempo (`vfx/migratedVfxBridge.ts: toSpawnOptions` só preenche
    // um dos dois por `kind`), então a ordem de fallback nunca é ambígua.
    const gid = opts.targetGid ?? opts.sourceGid;
    const resolved = resolveEntityOrCellPosition(world, { gid, cell: opts.cell });
    const base = resolved ?? opts.position ?? { x: 0, y: -999, z: 0 };
    // jitter horizontal opcional (Fire Lance/Cold Bolt: pequena variação
    // entre lanças do MESMO alvo, aplicado TODO quadro em cima da posição
    // AO VIVO — nunca congelado, senão a lança pararia de acompanhar o
    // alvo assim que ele se move). Ausente/zero = sem mudança nenhuma pra
    // qualquer skill que não passar isto.
    const jitterX = Number(opts.payload?.anchorJitterX ?? 0);
    const jitterZ = Number(opts.payload?.anchorJitterZ ?? 0);
    const pos = jitterX !== 0 || jitterZ !== 0 ? { x: base.x + jitterX, y: base.y, z: base.z + jitterZ } : base;
    const stale = opts.payload?.trackTargetSafely === true && gid !== undefined && !opts.cell && resolved === null;
    return { position: pos, casterOffset: null, targetScale, stale };
  }

  if (anchorKind === "caster-tip") {
    const tip = opts.sourceGid !== undefined ? resolveWeaponTip(opts.sourceGid) : undefined;
    if (tip) return { position: tip, casterOffset: null, targetScale };
    const cellPos =
      (opts.sourceGid !== undefined && resolveEntityOrCellPosition(world, { gid: opts.sourceGid })) ||
      opts.position ||
      { x: 0, y: -999, z: 0 };
    return {
      position: { x: cellPos.x, y: cellPos.y + FALLBACK_LAUNCH_Y_BIAS, z: cellPos.z },
      casterOffset: null,
      targetScale,
    };
  }

  // caster-to-target: âncora fica no ALVO (posição real do efeito), e o
  // offset local do caster é o que os renderers de projétil usam pra saber
  // de onde "partir" (mesmo contrato de `casterOffsetX/Y/Z` hoje).
  const resolvedTarget = resolveEntityOrCellPosition(world, { gid: opts.targetGid, cell: opts.cell });
  const targetPos = resolvedTarget ?? opts.position ?? { x: 0, y: -999, z: 0 };
  // `trackTargetSafely` (Fire Ball, 2026-08-19-v — mesmo mecanismo de
  // `anchorKind==="entity"` acima, nunca um segundo campo): se o alvo
  // morrer/sumir NO MEIO do voo caster→alvo, `manager.ts` já sabe segurar a
  // última posição boa em vez de saltar pro sentinela — só faltava este
  // anchor kind computar `stale` também (antes só `"entity"` fazia). Opt-in
  // por payload, comportamento DEFAULT (flag ausente) continua o mesmo salto
  // de sempre pra quem não pede o contrário.
  const stale = opts.payload?.trackTargetSafely === true && opts.targetGid !== undefined && !opts.cell && resolvedTarget === null;

  let casterOffset: WorldPoint | null = null;
  if (opts.sourceGid !== undefined) {
    const tip = resolveWeaponTip(opts.sourceGid);
    const casterWorld = tip ?? resolveEntityOrCellPosition(world, { gid: opts.sourceGid });
    if (casterWorld) {
      const yBias = tip ? 0 : FALLBACK_LAUNCH_Y_BIAS;
      // MUNDO, nunca dividido por `cellSize` (bug real, 2026-08-19-zb:
      // "a esfera nasce do meio do caminho, não da ponta do cajado" — a
      // divisão aqui era resquício do `<group>` da versão DOM antiga, que
      // escalava por `cellSize` sozinho; `flightOffset.ts`/`curveOffset.ts`
      // somam isto DIRETO em `instance.position` (unidades de mundo, sem
      // nenhum group intermediário reescalando) — dividir por `cellSize`
      // encolhia o ponto de partida pra `1/cellSize` da distância real
      // até o alvo (com `cellSize:2`, a bola nascia na METADE do caminho).
      casterOffset = {
        x: casterWorld.x - targetPos.x,
        y: casterWorld.y - targetPos.y + yBias,
        z: casterWorld.z - targetPos.z,
      };
    }
  }

  return { position: targetPos, casterOffset, targetScale, stale };
}

/** correção de altura pra um ponto deslocado do centro do efeito (partícula
 * de área, rastro) — mesma função que já existia, só reexportada daqui pra
 * quem usa o Core não precisar importar de dois lugares. */
export { terrainFollowDeltaY };
