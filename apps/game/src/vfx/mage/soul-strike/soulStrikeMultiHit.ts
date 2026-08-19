import { vfxManager } from "../../core/manager";
import { criticalScaleFor } from "../../core/hitVfxResolver";
import { createSeededRng } from "../../core/particleMath";
import { SOUL_FLIGHT_MS, SOUL_STRIKE_STAGGER_MS } from "./SoulStrikeImpact";
import { soulStrikeProjectileVfxId, soulStrikeImpactBurstVfxId, curveAmountFor, type SoulStrikeGpuTier } from "./soulStrikeVfxDefGpu";

/**
 * Driver per-hit dedicado de Esferas Espirituais/Soul Strike (reconstrução
 * 2026-08-19-z) — MESMO padrão de `fire-lance/fireLanceMultiHit.ts` (ver
 * docblock lá pro raciocínio completo do agendamento/tracking, não
 * duplicado aqui): `hits` real do servidor, `setTimeout` escalonado,
 * `trackTargetSafely` contra o sentinela.
 *
 * Diferença estrutural real (identidade da skill, não da arquitetura): Fire
 * Lance CAI de cima do alvo (`anchor:"entity"`, só precisa saber onde o
 * alvo está); Soul Strike VOA do CASTER até o alvo (`anchor:
 * "caster-to-target"`, precisa das DUAS pontas — mesmo mecanismo que Fire
 * Ball já usa, `flightOffset.ts`) E faz uma curva lateral própria por hit
 * (`curveOffset.ts`, novo — `payload.curveLateral`/`curveVertical`).
 *
 * ## Distribuição esquerda/centro/direita (pedido item 15)
 *
 * `normalizedIndex = count<=1 ? 0 : (index/(count-1))*2-1` — varre -1
 * (esquerda) a +1 (direita) uniformemente pra QUALQUER `count`, nunca uma
 * tabela hardcoded por quantidade (item 2 do pedido: "funciona pra
 * qualquer quantidade de hits", "não criar uma trajetória hardcoded pra 3,
 * outra pra 5"). `curveLateral = normalizedIndex * curveAmountFor(tier)` —
 * o SINAL decide o lado, a MAGNITUDE (igual pra todo hit do mesmo cast) vem
 * do tier. A direção "esquerda/direita" em si é relativa à reta
 * caster→alvo, resolvida por `curveOffset.ts` a partir do `casterOffset` já
 * calculado por `anchor.ts` — nunca eixo mundial fixo (item 17).
 *
 * Uma pequena variação vertical determinística por esfera (`curveVertical`,
 * seed = `targetGid+index`, calculada UMA VEZ aqui — nunca por quadro,
 * pedido item 5) evita que esferas com o MESMO `normalizedIndex` sequencial
 * (ex. hit 0 e hit 4 de 5, ambos nos extremos, mas em casts DIFERENTES)
 * pareçam clones idênticos; dentro do MESMO cast cada índice já tem seu
 * próprio `normalizedIndex`, então a variação vertical é só o toque extra
 * pedido, não o que distingue as trajetórias entre si.
 */
const VISUAL_CAP = 20;

export interface SpawnSoulStrikeHitsOptions {
  sourceGid?: number;
  targetGid: number;
  hits: number;
  staggerMs?: number;
  critical?: boolean;
  tier: SoulStrikeGpuTier;
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

/** pequena variação vertical determinística — não é o que separa as
 * trajetórias (isso é `normalizedIndex`), só evita clones visuais exatos. */
const VERTICAL_JITTER_MAX = 0.35;

export function spawnSoulStrikeHits(opts: SpawnSoulStrikeHitsOptions): void {
  const realHits = Math.max(1, Math.floor(opts.hits));
  const visualHits = Math.min(realHits, VISUAL_CAP);
  const staggerMs = opts.staggerMs ?? SOUL_STRIKE_STAGGER_MS;
  const scale = criticalScaleFor(opts.critical === true);
  const projectileId = soulStrikeProjectileVfxId(opts.tier);
  const impactId = soulStrikeImpactBurstVfxId(opts.tier);
  const curveAmount = curveAmountFor(opts.tier);
  const rng = createSeededRng((opts.targetGid % 100000) * 7919 + 5);

  function fireHit(index: number, lastKnownPos: Pos | undefined): Pos | undefined {
    const normalizedIndex = visualHits <= 1 ? 0 : (index / (visualHits - 1)) * 2 - 1;
    const curveVertical = (rng() - 0.5) * 2 * VERTICAL_JITTER_MAX;
    const handle = vfxManager.play(projectileId, {
      sourceGid: opts.sourceGid,
      targetGid: opts.targetGid,
      position: lastKnownPos,
      scale,
      payload: {
        flightMs: SOUL_FLIGHT_MS,
        arriveY: 1,
        curveLateral: normalizedIndex * curveAmount,
        curveVertical,
        trackTargetSafely: true,
      },
    });
    if (!handle) return lastKnownPos;
    const spawned = vfxManager.getInstance(handle.instanceId);
    const spawnedPos = spawned ? { x: spawned.position.x, y: spawned.position.y, z: spawned.position.z } : lastKnownPos;

    schedule(() => {
      const landed = vfxManager.getInstance(handle.instanceId);
      const impactPos = landed ? { x: landed.position.x, y: landed.position.y, z: landed.position.z } : spawnedPos;
      if (impactPos) vfxManager.play(impactId, { position: impactPos, scale });
    }, SOUL_FLIGHT_MS);

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

export function clearPendingSoulStrikeHits(): void {
  for (const id of pendingTimeouts) clearTimeout(id);
  pendingTimeouts.clear();
}
