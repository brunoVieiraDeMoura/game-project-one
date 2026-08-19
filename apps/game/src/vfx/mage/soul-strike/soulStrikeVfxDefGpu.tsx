import type { VfxDefinition, VfxLayer } from "../../core/types";
import type { VfxQualityTier } from "../../vfxQualityStore";
import { SOUL_FLIGHT_MS } from "./SoulStrikeImpact";

/**
 * Esferas Espirituais / Soul Strike (`MG_SOULSTRIKE`) em GPU — reconstrução
 * 2026-08-19-z, driver per-hit dedicado (`soulStrikeMultiHit.ts`), MESMA
 * arquitetura de Fire Lance/Cold Bolt/Eletrocutar (nunca uma segunda
 * arquitetura — `defineVfx`/`bindSkillVfx`/tiers via `vfxQualityStore.ts`).
 *
 * Substitui o protótipo anterior (Directive B): aquele desenhava a rajada
 * INTEIRA como 1 voo só (5 almas simultâneas viravam 1 swarm), simplificação
 * documentada como "sem um driver por-hit não dá pra separar N trajetórias
 * defasadas". Este driver agora existe (mesmo padrão de Fire Lance) —
 * `curveOffset.ts` (novo, `core/renderers/`) dá a cada hit sua PRÓPRIA
 * curva caster→alvo, não um voo reto compartilhado.
 *
 * ## Trajetória: curva, não linha reta
 *
 * `anchor:"caster-to-target"` — MESMO mecanismo que a bola da Fire Ball já
 * usa (`flightOffset.ts`: origem = ponta do cajado via `anchor.ts:
 * resolveWeaponTip`, interpolação até o alvo). Por cima disso,
 * `curveOffset.ts` soma um desvio lateral em envelope `sin(π·u)` — zero nas
 * duas pontas (nasce alinhado, chega exatamente no alvo), pico no meio
 * (abre e converge) — vem de `payload.curveLateral`, calculado pelo driver
 * como `normalizedIndex * curveAmountFor(tier)` (item 15 do pedido: sinal
 * decide esquerda/direita, magnitude vem do tier, nunca hardcoded por
 * quantidade de hits).
 *
 * ## Identidade visual
 *
 * Núcleo branco forte + halo translúcido maior (2-3 camadas `sprite`,
 * nunca dezenas de partículas — item 8 do pedido: "large core + soft glow +
 * large trail", não "50 partículas"), trail largo/luminoso
 * (`renderer:"trail"`, `trailLength`/escala maiores que o convencional —
 * item 9), poucas brasas espirituais viajando junto em MED/HIGH (item 18).
 * Cor: branco/branco-azulado espiritual (`#eaf6ff`/`#ffffff`, MESMA paleta
 * já estabelecida pela versão DOM original — identidade da PRÓPRIA skill,
 * nunca emprestada de Fire Lance/Eletrocutar).
 */
export type SoulStrikeGpuTier = VfxQualityTier;

const CORE_COLOR = "#ffffff";
const GLOW_COLOR = "#eaf6ff";
const HALO_COLOR = "#cfe6ff";
const TRAIL_COLOR = "#eaf6ff";
const EMBER_COLOR = "#ffffff";
const FLASH_COLOR = "#ffffff";
const RIPPLE_COLOR = "#cfe6ff";

/** altura de chegada (peito do alvo) — mesma referência da versão DOM
 * (`SoulStrikeImpact.tsx: ARRIVE_Y`). */
const ARRIVE_Y = 1;

interface SoulStrikeTierSpec {
  coreScale: number;
  glowScale: number;
  /** 3ª camada de halo translúcido — só HIGH ("camada espiritual adicional
   * se o renderer suportar de forma barata", item 18). */
  hasOuterHalo: number | null;
  trailLength: number;
  trailScale: number;
  /** brasas viajando junto com a esfera — primeiro corte de performance
   * (item 23: partículas secundárias primeiro). */
  flyingEmberCount: number;
  /** magnitude do desvio lateral (mundo) pro hit mais extremo
   * (`normalizedIndex=±1`) — "curva simples" → "mais larga e expressiva". */
  curveAmount: number;
  flashScale: number;
  burstEmberCount: number;
  burstMs: number;
}

const TIER_SPECS: Record<SoulStrikeGpuTier, SoulStrikeTierSpec> = {
  low: {
    coreScale: 0.95,
    glowScale: 1.6,
    hasOuterHalo: null,
    trailLength: 4,
    trailScale: 0.35,
    flyingEmberCount: 0,
    curveAmount: 1.3,
    flashScale: 0.7,
    burstEmberCount: 4,
    burstMs: 160,
  },
  medium: {
    coreScale: 1.1,
    glowScale: 1.9,
    hasOuterHalo: null,
    trailLength: 7,
    trailScale: 0.45,
    flyingEmberCount: 6,
    curveAmount: 1.8,
    flashScale: 0.85,
    burstEmberCount: 8,
    burstMs: 190,
  },
  high: {
    coreScale: 1.25,
    glowScale: 2.3,
    hasOuterHalo: 2.8,
    trailLength: 11,
    trailScale: 0.55,
    flyingEmberCount: 10,
    curveAmount: 2.4,
    flashScale: 1.0,
    burstEmberCount: 14,
    burstMs: 220,
  },
};

/** magnitude da curva pro tier — lida pelo driver (`soulStrikeMultiHit.ts`),
 * exportada pra não duplicar a tabela em dois arquivos. */
export function curveAmountFor(tier: SoulStrikeGpuTier): number {
  return TIER_SPECS[tier].curveAmount;
}

const FLIGHT_PARAMS = { flightMs: SOUL_FLIGHT_MS, arriveY: ARRIVE_Y };

function buildProjectileLayers(spec: SoulStrikeTierSpec): VfxLayer[] {
  const layers: VfxLayer[] = [
    {
      renderer: "trail",
      scale: { base: spec.trailScale },
      params: { color: TRAIL_COLOR, trailLength: spec.trailLength, ...FLIGHT_PARAMS },
    },
    // halo externo — MAIOR e mais translúcido, atrás do núcleo.
    { renderer: "sprite", scale: { base: spec.glowScale }, params: { color: GLOW_COLOR, opacity: 0.35, ...FLIGHT_PARAMS } },
  ];
  if (spec.hasOuterHalo !== null) {
    layers.push({ renderer: "sprite", scale: { base: spec.hasOuterHalo }, params: { color: HALO_COLOR, opacity: 0.16, ...FLIGHT_PARAMS } });
  }
  // núcleo — SEMPRE presente, identidade principal (item 17 do pedido de
  // otimização: nunca o primeiro corte).
  layers.push({ renderer: "sprite", scale: { base: spec.coreScale }, params: { color: CORE_COLOR, opacity: 1, ...FLIGHT_PARAMS } });
  if (spec.flyingEmberCount > 0) {
    layers.push({
      renderer: "particle",
      scale: { base: 0.14 },
      params: { particleCount: spec.flyingEmberCount, radius: 0.35, color: EMBER_COLOR, ...FLIGHT_PARAMS },
    });
  }
  return layers;
}

export function soulStrikeProjectileVfxId(tier: SoulStrikeGpuTier): string {
  return `soul_strike_sphere_${tier}`;
}
export function soulStrikeImpactBurstVfxId(tier: SoulStrikeGpuTier): string {
  return `soul_strike_impact_burst_${tier}`;
}

/**
 * Esfera (voo curvo) — vive só durante o voo, morre exatamente quando
 * chega (o burst de impacto é uma instância SEPARADA, agendada pelo
 * driver — ver `soulStrikeMultiHit.ts`). `freezeAnchorAfterMs:
 * SOUL_FLIGHT_MS` rastreia o alvo AO VIVO durante o voo inteiro (a esfera
 * persegue a posição atual, não um ponto do cast) e só congela exatamente
 * na chegada — nunca vira míssil perseguindo pós-impacto.
 */
export function soulStrikeProjectileGpuDef(tier: SoulStrikeGpuTier): VfxDefinition {
  const spec = TIER_SPECS[tier];
  return {
    id: soulStrikeProjectileVfxId(tier),
    renderer: "sprite",
    anchor: "caster-to-target",
    freezeAnchorAfterMs: SOUL_FLIGHT_MS,
    lifetimeMs: SOUL_FLIGHT_MS + 40,
    layers: buildProjectileLayers(spec),
  };
}

function buildImpactBurstLayers(spec: SoulStrikeTierSpec): VfxLayer[] {
  const layers: VfxLayer[] = [
    // flash — NUNCA maior que a própria esfera (item 12 do pedido: "o
    // impacto não deve ser maior que a própria esfera").
    {
      renderer: "sprite",
      scale: { base: spec.flashScale },
      params: { color: FLASH_COLOR, opacity: 0.95, burstMs: spec.burstMs, burstScaleFrom: 0.5, burstScaleTo: 1.8 },
    },
    {
      renderer: "sprite",
      scale: { base: spec.flashScale * 1.3 },
      params: { color: RIPPLE_COLOR, opacity: 0.4, burstMs: spec.burstMs * 1.2, burstScaleFrom: 0.4, burstScaleTo: 2.1 },
    },
  ];
  if (spec.burstEmberCount > 0) {
    layers.push({
      renderer: "particle",
      scale: { base: 0.13 },
      params: {
        particleCount: spec.burstEmberCount,
        radius: 0.35,
        color: EMBER_COLOR,
        burstDelayBaseMs: 0,
        burstDelayMaxMs: 25,
        burstDurBaseMs: spec.burstMs,
        burstDurJitterMs: 60,
      },
    });
  }
  return layers;
}

export function soulStrikeImpactBurstGpuDef(tier: SoulStrikeGpuTier): VfxDefinition {
  const spec = TIER_SPECS[tier];
  return {
    id: soulStrikeImpactBurstVfxId(tier),
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: 0,
    lifetimeMs: spec.burstMs * 1.2 + 60,
    layers: buildImpactBurstLayers(spec),
  };
}

/** SÓ os NÚMEROS de dano (`dom`) — mesma exceção de sempre (Fire Lance/
 * Cold Bolt/Eletrocutar), o burst visual saiu inteiramente pro def tiered
 * acima. */
export const SOUL_STRIKE_IMPACT_GPU_DEF: VfxDefinition = {
  id: "soul_strike_impact_gpu",
  renderer: "dom",
  anchor: "entity",
  freezeAnchorAfterMs: 0,
  dom: { art: "soul_strike_dmgnum" },
};

// ---------------------------------------------------------------- cast

export const SOUL_STRIKE_CAST_VFX_ID = "soul_strike_cast_gpu";

const CAST_GLOW = "#eaf6ff";
const CAST_SPARK = "#ffffff";

interface CastTierSpec {
  growTo: number;
  pulseHz: number;
  pulseAmp: number;
  sparkCount: number;
}

const CAST_TIER_SPECS: Record<SoulStrikeGpuTier, CastTierSpec> = {
  low: { growTo: 1.0, pulseHz: 0, pulseAmp: 0, sparkCount: 8 },
  medium: { growTo: 1.3, pulseHz: 3.0, pulseAmp: 0.05, sparkCount: 12 },
  high: { growTo: 1.6, pulseHz: 4.0, pulseAmp: 0.08, sparkCount: 16 },
};

function buildSoulStrikeCastLayers(tier: SoulStrikeGpuTier): VfxLayer[] {
  const spec = CAST_TIER_SPECS[tier];
  const chargeParams = { castCharge: true, castGrowFrom: 0.4, castGrowTo: spec.growTo, castPulseHz: spec.pulseHz, castPulseAmp: spec.pulseAmp };
  return [
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: CAST_GLOW, opacity: 0.7, ...chargeParams } },
    { renderer: "particle", scale: { base: 0.14 }, params: { particleCount: spec.sparkCount, radius: 0.35, color: CAST_SPARK } },
  ];
}

export function soulStrikeCastGpuDef(tier: SoulStrikeGpuTier): VfxDefinition {
  return {
    id: SOUL_STRIKE_CAST_VFX_ID,
    renderer: "sprite",
    anchor: "caster-tip",
    layers: buildSoulStrikeCastLayers(tier),
  };
}
