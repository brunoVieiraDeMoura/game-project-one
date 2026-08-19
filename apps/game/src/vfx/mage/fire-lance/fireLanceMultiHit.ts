import { vfxManager } from "../../core/manager";
import { criticalScaleFor } from "../../core/hitVfxResolver";
import { createSeededRng } from "../../core/particleMath";
import { FIRE_LANCE_FALL_MS, FIRE_LANCE_STAGGER_MS } from "./FireLanceImpact";
import { fireLanceProjectileVfxId, fireLanceImpactBurstVfxId, FIRE_LANCE_DIAMOND_ROTATION, type FireLanceGpuTier } from "./fireLanceVfxDefGpu";

/**
 * Driver per-hit dedicado de Fire Lance — substitui `spawnMultiHitShards`/
 * `GENERIC_HIT_SHARD_ID` (`multiHitShardImpact.ts`) só para `MG_FIREBOLT`
 * (removida de `MULTI_HIT_SHARD_VFX`, ver `multiHitRegistry.ts`). MESMO
 * padrão de agendamento por `setTimeout` que o fragmento genérico já usava
 * — a diferença é que cada hit agora dispara DUAS instâncias (projétil +
 * burst de impacto, ambas tier-específicas), não uma só.
 *
 * `hits` continua o valor REAL vindo do servidor (`useWorldEvents.ts`) —
 * este módulo nunca decide quantidade, só quantas dessas lanças REALMENTE
 * ganham representação visual (`VISUAL_CAP`, mesma margem generosa que o
 * fragmento genérico usava).
 *
 * ## Tracking de alvo (correção 2026-08-19-e)
 *
 * Achado do bug real: o projétil nascia com `freezeAnchorAfterMs:0` (congela
 * NO SPAWN) — a lança inteira caía num ponto do CHÃO fixado no instante do
 * cast, nunca acompanhando o alvo se ele andasse durante a queda. A
 * correção mora inteira em `fireLanceVfxDefGpu.ts`
 * (`freezeAnchorAfterMs:FIRE_LANCE_FALL_MS`, rastreia ao vivo a queda
 * inteira) — este driver só passa `targetGid` (nunca uma `position`
 * congelada como antes) pra CADA hit, real tracking, não perseguição
 * lateral (a âncora segue X/Z/Y do alvo; `dropStretch`/`dropOffset` — Y da
 * QUEDA em si — continuam por cima, intocados).
 *
 * `payload.trackTargetSafely:true` (`anchor.ts`) evita o salto pro
 * sentinela `{0,-999,0}` se o alvo morrer/sumir NO MEIO da queda de um hit
 * específico — a posição trava na ÚLTIMA boa, nunca quebra/pisca. O burst
 * de IMPACTO de cada hit lê a posição final REAL do próprio projétil
 * daquele hit (`vfxManager.getInstance(handle.instanceId)!.position`, no
 * instante em que o timeout de impacto dispara) — nunca uma posição
 * pré-calculada em outro momento, então nasce exatamente onde a lança
 * pousou de verdade, mesmo se o alvo tiver morrido no meio do caminho.
 *
 * `lastKnownPos` é o fallback pra `position` de CADA `play()` (a mesma
 * cadeia `targetGid ?? opts.position` que `anchor.ts` já resolve sozinho)
 * — cobre o caso do alvo já estar morto ANTES de um hit tardio (ex.: hit 7
 * de 10) sequer nascer: cai na última posição conhecida em vez do
 * sentinela, sem precisar consultar o `worldStore` direto daqui (o driver
 * nunca vira uma segunda fonte de verdade de posição — só lê de volta o
 * que o Core já resolveu).
 */
const VISUAL_CAP = 20;
/** pequena variação horizontal entre lanças (célula) — aplicada como
 * JITTER AO VIVO (`payload.anchorJitterX/Z`, `anchor.ts`), soma em cima da
 * posição atual do alvo TODO quadro — nunca um offset fixo calculado uma
 * vez, senão o jitter "descolaria" assim que o alvo se movesse. */
const HIT_SPREAD_RADIUS = 0.35;

export interface SpawnFireLanceHitsOptions {
  targetGid: number;
  hits: number;
  staggerMs?: number;
  critical?: boolean;
  tier: FireLanceGpuTier;
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

/**
 * Dispara `hits` lanças reais — cada uma: projétil (queda, rastreando o
 * alvo ao vivo) imediato + burst de impacto agendado `FIRE_LANCE_FALL_MS`
 * depois, na posição REAL onde aquele projétil pousou. `tier` decide só a
 * densidade visual (`fireLanceVfxDefGpu.ts: TIER_SPECS`) — nunca a
 * contagem de hits nem o timing (`staggerMs`/`FIRE_LANCE_FALL_MS` são os
 * MESMOS já usados pela cascata de números/áudio, nunca reinventados
 * aqui).
 */
export function spawnFireLanceHits(opts: SpawnFireLanceHitsOptions): void {
  const realHits = Math.max(1, Math.floor(opts.hits));
  const visualHits = Math.min(realHits, VISUAL_CAP);
  const staggerMs = opts.staggerMs ?? FIRE_LANCE_STAGGER_MS;
  const scale = criticalScaleFor(opts.critical === true);
  const projectileId = fireLanceProjectileVfxId(opts.tier);
  const impactId = fireLanceImpactBurstVfxId(opts.tier);
  const rng = visualHits > 1 ? createSeededRng((opts.targetGid % 100000) * 7919 + 1) : undefined;

  function fireHit(index: number, lastKnownPos: Pos | undefined): Pos | undefined {
    const jitter = index === 0 || !rng ? undefined : { x: (rng() - 0.5) * 2 * HIT_SPREAD_RADIUS, z: (rng() - 0.5) * 2 * HIT_SPREAD_RADIUS };
    const handle = vfxManager.play(projectileId, {
      targetGid: opts.targetGid,
      position: lastKnownPos,
      rotation: FIRE_LANCE_DIAMOND_ROTATION,
      scale,
      payload: jitter ? { trackTargetSafely: true, anchorJitterX: jitter.x, anchorJitterZ: jitter.z } : { trackTargetSafely: true },
    });
    if (!handle) return lastKnownPos;
    const spawned = vfxManager.getInstance(handle.instanceId);
    const spawnedPos = spawned ? { x: spawned.position.x, y: spawned.position.y, z: spawned.position.z } : lastKnownPos;

    schedule(() => {
      const landed = vfxManager.getInstance(handle.instanceId);
      const impactPos = landed ? { x: landed.position.x, y: landed.position.y, z: landed.position.z } : spawnedPos;
      if (impactPos) vfxManager.play(impactId, { position: impactPos, rotation: FIRE_LANCE_DIAMOND_ROTATION, scale });
    }, FIRE_LANCE_FALL_MS);

    return spawnedPos;
  }

  let lastKnownPos = fireHit(0, undefined);
  if (!lastKnownPos || visualHits <= 1) return;

  for (let i = 1; i < visualHits; i++) {
    const delay = i * staggerMs;
    schedule(() => {
      // lê `lastKnownPos` NO INSTANTE em que o timeout dispara, não no
      // instante em que foi agendado (todos os `setTimeout` são
      // registrados de uma vez, síncrono, no início da função) — assim o
      // fallback de cada hit usa a posição mais FRESCA já resolvida por um
      // hit anterior, não a de `hit 0` congelada.
      const result = fireHit(i, lastKnownPos);
      if (result) lastKnownPos = result;
    }, delay);
  }
}

export function clearPendingFireLanceHits(): void {
  for (const id of pendingTimeouts) clearTimeout(id);
  pendingTimeouts.clear();
}
