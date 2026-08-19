import type { VfxDefinition, VfxLayer } from "../../core/types";
import type { VfxQualityTier } from "../../vfxQualityStore";
import { ICICLE_FALL_MS } from "./ColdBoltImpact";

/**
 * Cold Bolt em GPU — reconstrução visual 2026-08-19-d, MESMO padrão da
 * reconstrução Fire Lance (2026-08-19-b/c): losango de gelo grande +
 * stretch na queda + trail + burst de impacto dedicado, 3 tiers globais
 * (`vfx/vfxQualityStore.ts`), cast com crescimento+pulso na ponta do
 * cajado. Substitui o fragmento GENÉRICO compartilhado
 * (`multiHitShardImpact.ts: GENERIC_HIT_SHARD_ID`) que Cold Bolt usava até
 * aqui — mesma decisão que tirou Fire Lance de lá: identidade visual
 * própria o bastante (losango de gelo GRANDE, trail, burst dedicado)
 * justifica composição dedicada.
 *
 * `ColdBoltImpact.tsx` (DOM real, dispatch legado) continua INTOCADA — só
 * fornece as constantes de timing (`ICICLE_FALL_MS`) que o driver
 * (`coldBoltMultiHit.ts`) e esta composição ficam em sincronia com a
 * cascata de números/áudio já estabelecidas.
 */
export type ColdBoltGpuTier = VfxQualityTier;

const OUTER_COLOR = "#61c9f5";
const CORE_COLOR = "#f4feff";
const TRAIL_COLOR = "#8fd9ff";
const FLASH_COLOR = "#eafcff";
const EMBER_COLOR = "#a8e9ff";

/** grande em relação ao personagem, mesma razão de Fire Lance (cabeças
 * grandes, corpos pequenos — exagerar em escala, não em partículas). */
const PROJECTILE_SCALE = 1.9;
const CORE_SCALE_MUL = 0.55;
const FALL_HEIGHT = 8;
const STRETCH_FROM = 1.2;
const STRETCH_TO = 2.1;
export const COLD_BOLT_DIAMOND_ROTATION = Math.PI / 4;
const FLASH_SCALE_TO = 2.6;

interface ColdBoltTierSpec {
  hasCoreLayer: boolean;
  trailLength: number;
  emberCount: number;
  burstMs: number;
}

const TIER_SPECS: Record<ColdBoltGpuTier, ColdBoltTierSpec> = {
  low: { hasCoreLayer: false, trailLength: 3, emberCount: 0, burstMs: 150 },
  medium: { hasCoreLayer: true, trailLength: 6, emberCount: 5, burstMs: 190 },
  high: { hasCoreLayer: true, trailLength: 10, emberCount: 9, burstMs: 230 },
};

function buildProjectileLayers(tier: ColdBoltGpuTier): VfxLayer[] {
  const spec = TIER_SPECS[tier];
  const layers: VfxLayer[] = [];
  if (spec.trailLength > 0) {
    layers.push({
      renderer: "trail",
      scale: { base: PROJECTILE_SCALE * 0.35 },
      params: { color: TRAIL_COLOR, trailLength: spec.trailLength, fallMs: ICICLE_FALL_MS, fallHeight: FALL_HEIGHT, arriveY: 0 },
    });
  }
  layers.push({
    renderer: "sprite",
    scale: { base: PROJECTILE_SCALE },
    params: {
      color: OUTER_COLOR,
      opacity: 0.92,
      fallMs: ICICLE_FALL_MS,
      fallHeight: FALL_HEIGHT,
      arriveY: 0,
      stretchFrom: STRETCH_FROM,
      stretchTo: STRETCH_TO,
    },
  });
  if (spec.hasCoreLayer) {
    layers.push({
      renderer: "sprite",
      scale: { base: PROJECTILE_SCALE * CORE_SCALE_MUL },
      params: {
        color: CORE_COLOR,
        opacity: 0.95,
        fallMs: ICICLE_FALL_MS,
        fallHeight: FALL_HEIGHT,
        arriveY: 0,
        stretchFrom: STRETCH_FROM * 0.9,
        stretchTo: STRETCH_TO * 0.85,
      },
    });
  }
  return layers;
}

export function coldBoltProjectileVfxId(tier: ColdBoltGpuTier): string {
  return `cold_bolt_bolt_${tier}`;
}
export function coldBoltImpactBurstVfxId(tier: ColdBoltGpuTier): string {
  return `cold_bolt_impact_burst_${tier}`;
}

/** `freezeAnchorAfterMs: ICICLE_FALL_MS` — MESMA correção de
 * `fire-lance/fireLanceVfxDefGpu.tsx: fireLanceProjectileGpuDef`
 * (2026-08-19-e: rastreia o alvo AO VIVO durante a queda, congela só no
 * pouso). */
export function coldBoltProjectileGpuDef(tier: ColdBoltGpuTier): VfxDefinition {
  return {
    id: coldBoltProjectileVfxId(tier),
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: ICICLE_FALL_MS,
    lifetimeMs: ICICLE_FALL_MS + 40,
    layers: buildProjectileLayers(tier),
  };
}

function buildImpactBurstLayers(tier: ColdBoltGpuTier): VfxLayer[] {
  const spec = TIER_SPECS[tier];
  const layers: VfxLayer[] = [
    {
      renderer: "sprite",
      scale: { base: PROJECTILE_SCALE * 1.1 },
      params: { color: FLASH_COLOR, opacity: 0.95, burstMs: spec.burstMs, burstScaleFrom: 0.5, burstScaleTo: FLASH_SCALE_TO },
    },
  ];
  if (spec.emberCount > 0) {
    layers.push({
      renderer: "particle",
      scale: { base: 0.22 },
      params: {
        particleCount: spec.emberCount,
        radius: 0.55,
        color: EMBER_COLOR,
        burstDelayBaseMs: 0,
        burstDelayMaxMs: 30,
        burstDurBaseMs: spec.burstMs,
        burstDurJitterMs: 80,
      },
    });
  }
  return layers;
}

export function coldBoltImpactBurstGpuDef(tier: ColdBoltGpuTier): VfxDefinition {
  const spec = TIER_SPECS[tier];
  return {
    id: coldBoltImpactBurstVfxId(tier),
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: 0,
    lifetimeMs: spec.burstMs + 60,
    layers: buildImpactBurstLayers(tier),
  };
}

/** SÓ os NÚMEROS de dano (`dom`) — igual sempre, nunca tocado nesta
 * reconstrução. */
export const COLD_BOLT_IMPACT_GPU_DEF: VfxDefinition = {
  id: "cold_bolt_impact_gpu",
  renderer: "dom",
  anchor: "entity",
  freezeAnchorAfterMs: 0,
  dom: { art: "cold_bolt_dmgnum" },
};

/**
 * Cast de Cold Bolt em GPU — MESMO mecanismo de crescimento+pulso do
 * cajado que Fire Lance ganhou (`castChargeEnvelope.ts`), agora também
 * pra Cold Bolt: "nuvem de gelo se concentrando na ponta do cajado antes
 * do disparo". Único id estável (`COLD_BOLT_CAST_VFX_ID`) — troca de tier
 * re-registra a receita sob o MESMO id (mesma técnica de
 * `oracleRenderMode.ts`/`fireLanceRenderMode.ts`).
 */
export const COLD_BOLT_CAST_VFX_ID = "cold_bolt_cast_gpu";

const ICE_CAST_GLOW = "#c9f3ff";
const ICE_CAST_SPARK = "#eafcff";
const CAST_CORE_COLOR = "#f4feff";

interface ColdBoltCastTierSpec {
  growTo: number;
  pulseHz: number;
  pulseAmp: number;
  hasCoreLayer: boolean;
  sparkCount: number;
}

const CAST_TIER_SPECS: Record<ColdBoltGpuTier, ColdBoltCastTierSpec> = {
  low: { growTo: 1.0, pulseHz: 0, pulseAmp: 0, hasCoreLayer: false, sparkCount: 6 },
  medium: { growTo: 1.4, pulseHz: 3.2, pulseAmp: 0.05, hasCoreLayer: false, sparkCount: 12 },
  high: { growTo: 1.8, pulseHz: 4.2, pulseAmp: 0.08, hasCoreLayer: true, sparkCount: 12 },
};

function buildColdBoltCastLayers(tier: ColdBoltGpuTier): VfxLayer[] {
  const spec = CAST_TIER_SPECS[tier];
  const chargeParams = { castCharge: true, castGrowFrom: 0.4, castGrowTo: spec.growTo, castPulseHz: spec.pulseHz, castPulseAmp: spec.pulseAmp };
  const layers: VfxLayer[] = [
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: ICE_CAST_GLOW, opacity: 0.7, ...chargeParams } },
  ];
  if (spec.hasCoreLayer) {
    layers.push({ renderer: "sprite", scale: { base: 0.22 }, params: { color: CAST_CORE_COLOR, opacity: 0.9, ...chargeParams } });
  }
  layers.push({ renderer: "particle", scale: { base: 0.14 }, params: { particleCount: spec.sparkCount, radius: 0.35, color: ICE_CAST_SPARK } });
  return layers;
}

export function coldBoltCastGpuDef(tier: ColdBoltGpuTier): VfxDefinition {
  return {
    id: COLD_BOLT_CAST_VFX_ID,
    renderer: "sprite",
    anchor: "caster-tip",
    layers: buildColdBoltCastLayers(tier),
  };
}
