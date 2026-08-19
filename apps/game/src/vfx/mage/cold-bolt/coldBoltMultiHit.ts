import { vfxManager } from "../../core/manager";
import { criticalScaleFor } from "../../core/hitVfxResolver";
import { createSeededRng } from "../../core/particleMath";
import { ICICLE_FALL_MS, ICICLE_STAGGER_MS } from "./ColdBoltImpact";
import { coldBoltProjectileVfxId, coldBoltImpactBurstVfxId, COLD_BOLT_DIAMOND_ROTATION, type ColdBoltGpuTier } from "./coldBoltVfxDefGpu";

/**
 * Driver per-hit dedicado de Cold Bolt — MESMO padrão/correção de
 * `fire-lance/fireLanceMultiHit.ts: spawnFireLanceHits` (2026-08-19-e:
 * tracking de alvo ao vivo durante a queda, `trackTargetSafely` contra
 * sentinela, impacto lê a posição REAL do próprio projétil no instante em
 * que pousa) — ver docblock completo lá, não duplicado aqui.
 */
const VISUAL_CAP = 20;
const HIT_SPREAD_RADIUS = 0.35;

export interface SpawnColdBoltHitsOptions {
  targetGid: number;
  hits: number;
  staggerMs?: number;
  critical?: boolean;
  tier: ColdBoltGpuTier;
}

const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

function schedule(fn: () => void, delayMs: number): void {
  if (delayMs <= 0) {
    fn();
    return;
  }
  const id = setTimeout(() => {
    pendingTimeouts.delete(id);
    fn();
  }, delayMs);
  pendingTimeouts.add(id);
}

interface Pos {
  x: number;
  y: number;
  z: number;
}

export function spawnColdBoltHits(opts: SpawnColdBoltHitsOptions): void {
  const realHits = Math.max(1, Math.floor(opts.hits));
  const visualHits = Math.min(realHits, VISUAL_CAP);
  const staggerMs = opts.staggerMs ?? ICICLE_STAGGER_MS;
  const scale = criticalScaleFor(opts.critical === true);
  const projectileId = coldBoltProjectileVfxId(opts.tier);
  const impactId = coldBoltImpactBurstVfxId(opts.tier);
  const rng = visualHits > 1 ? createSeededRng((opts.targetGid % 100000) * 7919 + 2) : undefined;

  function fireHit(index: number, lastKnownPos: Pos | undefined): Pos | undefined {
    const jitter = index === 0 || !rng ? undefined : { x: (rng() - 0.5) * 2 * HIT_SPREAD_RADIUS, z: (rng() - 0.5) * 2 * HIT_SPREAD_RADIUS };
    const handle = vfxManager.play(projectileId, {
      targetGid: opts.targetGid,
      position: lastKnownPos,
      rotation: COLD_BOLT_DIAMOND_ROTATION,
      scale,
      payload: jitter ? { trackTargetSafely: true, anchorJitterX: jitter.x, anchorJitterZ: jitter.z } : { trackTargetSafely: true },
    });
    if (!handle) return lastKnownPos;
    const spawned = vfxManager.getInstance(handle.instanceId);
    const spawnedPos = spawned ? { x: spawned.position.x, y: spawned.position.y, z: spawned.position.z } : lastKnownPos;

    schedule(() => {
      const landed = vfxManager.getInstance(handle.instanceId);
      const impactPos = landed ? { x: landed.position.x, y: landed.position.y, z: landed.position.z } : spawnedPos;
      if (impactPos) vfxManager.play(impactId, { position: impactPos, rotation: COLD_BOLT_DIAMOND_ROTATION, scale });
    }, ICICLE_FALL_MS);

    return spawnedPos;
  }

  let lastKnownPos = fireHit(0, undefined);
  if (!lastKnownPos || visualHits <= 1) return;

  for (let i = 1; i < visualHits; i++) {
    const delay = i * staggerMs;
    schedule(() => {
      const result = fireHit(i, lastKnownPos);
      if (result) lastKnownPos = result;
    }, delay);
  }
}

export function clearPendingColdBoltHits(): void {
  for (const id of pendingTimeouts) clearTimeout(id);
  pendingTimeouts.clear();
}
