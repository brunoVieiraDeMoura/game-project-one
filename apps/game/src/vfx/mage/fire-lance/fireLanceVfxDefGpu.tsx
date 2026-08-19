import type { VfxDefinition, VfxLayer } from "../../core/types";
import { FIRE_LANCE_FALL_MS } from "./FireLanceImpact";
import type { VfxQualityTier } from "../../vfxQualityStore";

/**
 * Fire Lance em GPU — reconstrução visual 2026-08-19-b ("losango de fogo
 * grande, stretch na queda, trail, impact dedicado, 3 tiers"). Substitui o
 * fragmento GENÉRICO compartilhado (`multiHitShardImpact.ts:
 * GENERIC_HIT_SHARD_ID`) que Fire Lance usava até aqui — a skill ganhou
 * identidade visual PRÓPRIA o bastante (losango grande+esticado, trail,
 * burst dedicado) pra justificar composição dedicada (skill-vfx-authoring:
 * "reusar a infraestrutura não é o mesmo que reusar a receita visual").
 *
 * `FireLanceImpact.tsx` (DOM real, dispatch legado) continua INTOCADA —
 * só fornece as constantes de timing (`FIRE_LANCE_FALL_MS`) que o driver
 * (`fireLanceMultiHit.ts`) e esta composição precisam ficar em sincronia
 * com a cascata de números/áudio, já estabelecidas.
 */
/** alias, nunca uma segunda enumeração — `vfxQualityStore.ts` é a fonte
 * canônica (config GLOBAL, "Qualidade dos efeitos" nas Configurações,
 * pedido 2026-08-19-c), Fire Lance só consome. */
export type FireLanceGpuTier = VfxQualityTier;

const OUTER_COLOR = "#ff7a1f";
const CORE_COLOR = "#fff3c4";
const TRAIL_COLOR = "#ff9d3a";
const FLASH_COLOR = "#ffe7a8";
const EMBER_COLOR = "#ff8a3d";

/** grande em relação ao personagem de propósito (cabeças grandes, corpos
 * pequenos — pedido explícito "exagerar em escala, não em partículas"). */
const PROJECTILE_SCALE = 1.9;
const CORE_SCALE_MUL = 0.55;
const FALL_HEIGHT = 8;
const STRETCH_FROM = 1.2;
const STRETCH_TO = 2.1;
/** rotação fixa do losango — mesma técnica que o fragmento genérico já
 * usava (`SHARD_ROTATION`): sprite quadrado a 45° vira diamante de graça. */
export const FIRE_LANCE_DIAMOND_ROTATION = Math.PI / 4;

const FLASH_SCALE_TO = 2.6;

interface FireLanceTierSpec {
  /** camada extra de núcleo brilhante — "camada extra de glow", primeira
   * coisa cortada em LOW pela ordem de otimização do pedido. */
  hasCoreLayer: boolean;
  trailLength: number;
  emberCount: number;
  burstMs: number;
}

const TIER_SPECS: Record<FireLanceGpuTier, FireLanceTierSpec> = {
  low: { hasCoreLayer: false, trailLength: 3, emberCount: 0, burstMs: 150 },
  medium: { hasCoreLayer: true, trailLength: 6, emberCount: 5, burstMs: 190 },
  high: { hasCoreLayer: true, trailLength: 10, emberCount: 9, burstMs: 230 },
};

function buildProjectileLayers(tier: FireLanceGpuTier): VfxLayer[] {
  const spec = TIER_SPECS[tier];
  const layers: VfxLayer[] = [];
  if (spec.trailLength > 0) {
    layers.push({
      renderer: "trail",
      scale: { base: PROJECTILE_SCALE * 0.35 },
      params: { color: TRAIL_COLOR, trailLength: spec.trailLength, fallMs: FIRE_LANCE_FALL_MS, fallHeight: FALL_HEIGHT, arriveY: 0 },
    });
  }
  // losango externo — SEMPRE presente, mesmo em LOW (identidade visual da
  // skill, nunca é o primeiro corte — regra explícita do pedido).
  layers.push({
    renderer: "sprite",
    scale: { base: PROJECTILE_SCALE },
    params: {
      color: OUTER_COLOR,
      opacity: 0.92,
      fallMs: FIRE_LANCE_FALL_MS,
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
        fallMs: FIRE_LANCE_FALL_MS,
        fallHeight: FALL_HEIGHT,
        arriveY: 0,
        stretchFrom: STRETCH_FROM * 0.9,
        stretchTo: STRETCH_TO * 0.85,
      },
    });
  }
  return layers;
}

/** ids estáveis — únicos lugares que montam a string, driver
 * (`fireLanceMultiHit.ts`) e `renderMode` importam daqui, nunca duplicam. */
export function fireLanceProjectileVfxId(tier: FireLanceGpuTier): string {
  return `fire_lance_bolt_${tier}`;
}
export function fireLanceImpactBurstVfxId(tier: FireLanceGpuTier): string {
  return `fire_lance_impact_burst_${tier}`;
}

/** projétil (losango + núcleo opcional + trail) — vive só durante a queda,
 * morre exatamente quando pousa (o burst de impacto é uma instância
 * SEPARADA, agendada pelo driver — ver `fireLanceMultiHit.ts`).
 *
 * `freezeAnchorAfterMs: FIRE_LANCE_FALL_MS` (não mais `0`, correção
 * 2026-08-19-e: "a lança tem que acompanhar o alvo durante a queda, não
 * cair num ponto fixo do cast") — rastreia o alvo AO VIVO (`anchor.ts`,
 * `payload.trackTargetSafely` no driver protege contra sentinela se o
 * alvo sumir no meio) durante a queda inteira, só congela exatamente no
 * instante do pouso — depois disso a instância morre logo em seguida
 * (`lifetimeMs`), sem virar um "míssil" perseguindo pós-impacto. */
export function fireLanceProjectileGpuDef(tier: FireLanceGpuTier): VfxDefinition {
  return {
    id: fireLanceProjectileVfxId(tier),
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: FIRE_LANCE_FALL_MS,
    lifetimeMs: FIRE_LANCE_FALL_MS + 40,
    layers: buildProjectileLayers(tier),
  };
}

function buildImpactBurstLayers(tier: FireLanceGpuTier): VfxLayer[] {
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

/** burst de impacto (flash losango expandindo + brasas opcionais por tier) —
 * instância curta e própria, agendada pelo driver pra nascer no instante em
 * que o projétil (acima) pousa (`FIRE_LANCE_FALL_MS` depois do spawn do
 * projétil correspondente). */
export function fireLanceImpactBurstGpuDef(tier: FireLanceGpuTier): VfxDefinition {
  const spec = TIER_SPECS[tier];
  return {
    id: fireLanceImpactBurstVfxId(tier),
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: 0,
    lifetimeMs: spec.burstMs + 60,
    layers: buildImpactBurstLayers(tier),
  };
}

/**
 * `fire_lance_impact_gpu` — SÓ os NÚMEROS de dano (`dom`), nunca tocado no
 * `renderer:"dom"` desde a reconstrução 2026-08-19: continua igual, o burst
 * visual saiu inteiramente pros defs tiered acima.
 */
export const FIRE_LANCE_IMPACT_GPU_DEF: VfxDefinition = {
  id: "fire_lance_impact_gpu",
  renderer: "dom",
  anchor: "entity",
  freezeAnchorAfterMs: 0,
  dom: { art: "fire_lance_dmgnum" },
};

/**
 * Cast de Fire Lance em GPU (pedido 2026-08-19-c: "efeito na ponta do
 * cajado cresce + pulsa durante o cast, transmite concentração antes do
 * disparo") — MESMA base já provada (glow + partículas na ponta do
 * cajado), agora com `castChargeEnvelope.ts` (crescimento+pulso ao longo
 * do `durationMs` REAL do cast, nunca um tempo inventado) e tier-
 * específico via `CAST_TIER_SPECS`. Único id ESTÁVEL
 * (`FIRE_LANCE_CAST_VFX_ID`) — troca de tier RE-REGISTRA a receita sob o
 * MESMO id (`defineVfx` "registra OU SUBSTITUI", mesmo padrão de
 * `oracleRenderMode.ts: setOracleRenderMode`), nunca precisa de
 * `bindSkillVfx` novo por tier.
 */
export const FIRE_LANCE_CAST_VFX_ID = "fire_lance_cast_gpu";

const FIRE_CAST_GLOW = "#ffb35c";
const FIRE_CAST_SPARK = "#fff2c2";
const CAST_CORE_COLOR = "#fff3c4";

interface CastTierSpec {
  /** multiplicador de escala no PICO do cast (fim), sobre a base de
   * `0.4×` no início — "cresce progressivamente" do pedido. */
  growTo: number;
  /** 0 = sem pulso (LOW: "pulse simples" = estático, sem oscilar). */
  pulseHz: number;
  pulseAmp: number;
  /** núcleo extra (glow concentrado) — só HIGH, "camada adicional/glow se
   * o renderer permitir barato" do pedido; nunca em LOW/MEDIUM. */
  hasCoreLayer: boolean;
  sparkCount: number;
}

const CAST_TIER_SPECS: Record<FireLanceGpuTier, CastTierSpec> = {
  low: { growTo: 1.0, pulseHz: 0, pulseAmp: 0, hasCoreLayer: false, sparkCount: 6 },
  medium: { growTo: 1.4, pulseHz: 3.2, pulseAmp: 0.05, hasCoreLayer: false, sparkCount: 12 },
  high: { growTo: 1.8, pulseHz: 4.2, pulseAmp: 0.08, hasCoreLayer: true, sparkCount: 12 },
};

function buildFireLanceCastLayers(tier: FireLanceGpuTier): VfxLayer[] {
  const spec = CAST_TIER_SPECS[tier];
  const chargeParams = { castCharge: true, castGrowFrom: 0.4, castGrowTo: spec.growTo, castPulseHz: spec.pulseHz, castPulseAmp: spec.pulseAmp };
  const layers: VfxLayer[] = [
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: FIRE_CAST_GLOW, opacity: 0.75, ...chargeParams } },
  ];
  if (spec.hasCoreLayer) {
    layers.push({ renderer: "sprite", scale: { base: 0.22 }, params: { color: CAST_CORE_COLOR, opacity: 0.9, ...chargeParams } });
  }
  layers.push({ renderer: "particle", scale: { base: 0.14 }, params: { particleCount: spec.sparkCount, radius: 0.35, color: FIRE_CAST_SPARK } });
  return layers;
}

export function fireLanceCastGpuDef(tier: FireLanceGpuTier): VfxDefinition {
  return {
    id: FIRE_LANCE_CAST_VFX_ID,
    renderer: "sprite",
    anchor: "caster-tip",
    layers: buildFireLanceCastLayers(tier),
  };
}
