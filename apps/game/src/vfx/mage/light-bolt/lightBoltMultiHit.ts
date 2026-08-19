import { vfxManager } from "../../core/manager";
import { criticalScaleFor } from "../../core/hitVfxResolver";
import { createSeededRng } from "../../core/particleMath";
import { LIGHT_BOLT_STAGGER_MS } from "./LightBoltImpact";
import {
  lightBoltProjectileVfxId,
  lightBoltImpactBurstVfxId,
  LIGHTNING_FALL_MS,
  LIGHTNING_FALL_HEIGHT,
  HEAD_OFFSET_Y,
  LIGHT_BOLT_FRAME_COUNT,
  type LightBoltGpuTier,
} from "./lightBoltVfxDefGpu";

/**
 * Driver per-hit dedicado de Eletrocutar/Light Bolt — MESMO padrão de
 * `fire-lance/fireLanceMultiHit.ts`/`cold-bolt/coldBoltMultiHit.ts` (ver
 * docblock completo lá, não duplicado aqui): tracking de alvo ao vivo via
 * `targetGid`+`trackTargetSafely`, impacto lê a posição REAL do próprio
 * raio no instante em que "cai".
 *
 * Duas diferenças de payload (identidade da skill, não da arquitetura):
 * `arriveY:HEAD_OFFSET_Y`+`arriveYByTarget:true` (pousa na CABEÇA, escalado
 * pelo tamanho do alvo — `dropOffset.ts`) em vez de `arriveY:0` (chão); e
 * `LIGHTNING_FALL_MS` (260ms, queda RÁPIDA de eletricidade) no lugar de
 * `FIRE_LANCE_FALL_MS`/`ICICLE_FALL_MS` (560ms, projétil físico).
 *
 * ## Variedade por hit (atlas real, 2026-08-19-r; espelhamento 2026-08-19-s)
 *
 * `lightBoltVfxDefGpu.tsx` usa a arte REAL do usuário (5 quadros
 * distintos, `lightBoltAtlas.ts`) — cada hit sorteia qual quadro tocar
 * (`LIGHT_BOLT_FRAME_COUNT`), inclusive o primeiro. Cada hit TAMBÉM
 * sorteia se o quadro nasce espelhado horizontalmente (`payload.flipX`,
 * suporte novo genérico em `SpriteRenderer.ts` — troca `u0`/`u1` da UV,
 * MESMA textura, sem asset novo nem draw call novo) — dobra a variedade
 * visual dos 5 quadros (5×2=10 combinações) de graça. Uma pequena rotação
 * adicional (±10°) some por cima, só pra evitar que hits que sorteiam o
 * MESMO quadro+espelho fiquem idênticos pixel a pixel.
 */
const VISUAL_CAP = 20;
/** jitter menor que Fire Lance/Cold Bolt (0.35) — o alvo do raio é a
 * CABEÇA, uma área pequena; um jitter grande faria os raios errarem
 * visualmente a cabeça pra hits fora do centro. */
const HIT_SPREAD_RADIUS = 0.2;
/** pequena, a arte real já carrega a variedade principal (quadro sorteado
 * por hit) — isto só evita repetição exata quando dois hits sorteiam o
 * MESMO quadro. */
const HIT_ROTATION_MAX_RAD = (10 * Math.PI) / 180;

export interface SpawnLightBoltHitsOptions {
  targetGid: number;
  hits: number;
  staggerMs?: number;
  critical?: boolean;
  tier: LightBoltGpuTier;
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

const BASE_PAYLOAD = {
  fallMs: LIGHTNING_FALL_MS,
  fallHeight: LIGHTNING_FALL_HEIGHT,
  arriveY: HEAD_OFFSET_Y,
  arriveYByTarget: true,
  trackTargetSafely: true,
};

export function spawnLightBoltHits(opts: SpawnLightBoltHitsOptions): void {
  const realHits = Math.max(1, Math.floor(opts.hits));
  const visualHits = Math.min(realHits, VISUAL_CAP);
  const staggerMs = opts.staggerMs ?? LIGHT_BOLT_STAGGER_MS;
  const scale = criticalScaleFor(opts.critical === true);
  const impactId = lightBoltImpactBurstVfxId(opts.tier);
  const rng = createSeededRng((opts.targetGid % 100000) * 7919 + 3);

  function fireHit(index: number, lastKnownPos: Pos | undefined): Pos | undefined {
    const frameIndex = Math.floor(rng() * LIGHT_BOLT_FRAME_COUNT) % LIGHT_BOLT_FRAME_COUNT;
    const projectileId = lightBoltProjectileVfxId(opts.tier, frameIndex);
    const jitter = index === 0 ? undefined : { x: (rng() - 0.5) * 2 * HIT_SPREAD_RADIUS, z: (rng() - 0.5) * 2 * HIT_SPREAD_RADIUS };
    const rotation = (rng() - 0.5) * 2 * HIT_ROTATION_MAX_RAD;
    const flipX = rng() < 0.5;
    const handle = vfxManager.play(projectileId, {
      targetGid: opts.targetGid,
      position: lastKnownPos,
      scale,
      rotation,
      payload: { ...BASE_PAYLOAD, flipX, ...(jitter ? { anchorJitterX: jitter.x, anchorJitterZ: jitter.z } : {}) },
    });
    if (!handle) return lastKnownPos;
    const spawned = vfxManager.getInstance(handle.instanceId);
    const spawnedPos = spawned ? { x: spawned.position.x, y: spawned.position.y, z: spawned.position.z } : lastKnownPos;

    schedule(() => {
      const landed = vfxManager.getInstance(handle.instanceId);
      const impactPos = landed ? { x: landed.position.x, y: landed.position.y, z: landed.position.z } : spawnedPos;
      if (impactPos) vfxManager.play(impactId, { position: impactPos, scale });
    }, LIGHTNING_FALL_MS);

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

export function clearPendingLightBoltHits(): void {
  for (const id of pendingTimeouts) clearTimeout(id);
  pendingTimeouts.clear();
}
