import type { VfxDefinition, VfxLayer } from "../../core/types";
import type { VfxQualityTier } from "../../vfxQualityStore";

/**
 * Fire Ball em GPU — reconstrução visual 2026-08-19-v ("bola de fogo GRANDE,
 * trail grande, explosão AoE — identidade própria, nunca a de Fire Lance/
 * Eletrocutar"). Substitui o protótipo genérico anterior (Fase 5) por uma
 * composição dedicada, MESMA arquitetura de sempre: single target, 1 cast →
 * 1 bola → 1 voo → 1 impacto — nunca multi-hit, nunca `spawnFireLanceHits`.
 *
 * ## Por que UMA instância só (nunca um driver `spawnFireBall` com
 * `setTimeout` agendando um segundo `play()`)
 *
 * Fire Lance/Cold Bolt/Eletrocutar precisam de um driver por-hit porque são
 * N hits REAIS (`hits` do servidor) — cada um vira uma instância própria,
 * agendada. Fire Ball tem `HitCount:1` no `skill_db.yml` (verificado, não
 * chutado): 1 cast = 1 instância inteira (projétil+trail+impacto+AoE), do
 * jeito que a versão DOM original (`fireBallVfxDef.tsx`) sempre fez —
 * `anchor:"caster-to-target"` já resolve a origem (ponta do cajado,
 * `anchor.ts: resolveWeaponTip`) e rastreia o alvo AO VIVO durante o voo
 * inteiro de graça (`manager.ts` só congela em `freezeAnchorAfterMs`),
 * sem precisar de nenhum driver novo. O único trabalho real desta
 * reconstrução foi ensinar o Core a GATEAR uma camada por tempo DENTRO da
 * mesma instância (`payload.burstStartMs` em `burstEnvelope.ts`,
 * `payload.burstDelayBaseMs` — já existia — pras partículas) — pra
 * flash/explosão/fumaça só aparecerem quando a bola REALMENTE chega, não
 * durante o voo inteiro.
 *
 * ## Origem: ponta do cajado
 *
 * `anchor:"caster-to-target"` já resolve `casterOffset` via
 * `anchor.ts: resolveWeaponTip(sourceGid)` (ponta REAL da arma equipada,
 * com fallback pro peito só se o attachment ainda não montou) — nenhuma
 * posição fixa arbitrária, reusa a MESMA âncora que o cast já usava.
 *
 * ## Target tracking
 *
 * `manager.ts` re-resolve `instance.position` (o ALVO) TODO quadro até
 * `freezeAnchorAfterMs:FIREBALL_FLIGHT_MS` — a bola persegue a posição AO
 * VIVO do alvo durante o voo inteiro (não um ponto congelado no cast) e
 * para de rastrear exatamente na chegada (não vira míssil eterno).
 * `payload.trackTargetSafely:true` (novo em `anchor.ts` pra este anchor
 * kind) seguraaposição se o alvo morrer/sumir no meio do voo, em vez de
 * saltar pro sentinela `{0,-999,0}`.
 *
 * ## Área real (verificada, não assumida)
 *
 * `rathena/db/re/skill_db.yml: MG_FIREBALL.SplashArea` = `Area:2` em TODOS
 * os níveis 1-10 (nível 11, fora do `MaxLevel:10` normal, sobe pra 3) —
 * pela fórmula documentada em `rathena/doc/skill_db.txt` (`valor*2+1`),
 * `Area:2` = **5×5**, não 3×3. `payload.areaRadius` (real, por nível, via
 * `net/skillCatalog.ts` → `migratedVfxBridge.ts`) alimenta o RAIO de
 * espalhamento da fumaça (`ParticleRenderer`, fallback pra `payload.radius`
 * ausente — mesmo mecanismo de `RingRenderer.ts`) — sem raio hardcoded
 * nenhum na composição.
 *
 * ## Fumaça+explosão no lugar do anel (2026-08-19-w)
 *
 * Pedido explícito: "ao invés do círculo [`ring`] nessa AoE, um efeito de
 * fumaça e explosão". A explosão (flash+corpo+núcleo, `buildImpactLayers`)
 * já existia — o que faltava era a FUMAÇA: uma segunda camada `particle`
 * (`SMOKE_COLOR`, puffs grandes/escuros, `burstDurBaseMs` bem maior que o
 * das brasas — fumaça PAIRA depois que o fogo já apagou, não estoura e
 * some junto) espalhada pelo raio REAL da área. Nenhum `ring`/`Mesh` novo:
 * mesmo `ParticleRenderer` que já desenhava as brasas, só uma 2ª camada com
 * cor/escala/timing diferentes — reaproveita o raio real que o anel usava.
 */
export type FireBallGpuTier = VfxQualityTier;

const OUTER_COLOR = "#ff6a1a";
const BODY_COLOR = "#ff9a3d";
const CORE_COLOR = "#fff3c4";
const TRAIL_OUTER_COLOR = "#ff7a1f";
const TRAIL_INNER_COLOR = "#ffcf80";
const FLASH_COLOR = "#fff2c2";
const EXPLOSION_COLOR = "#ff7a1f";
const EMBER_COLOR = "#ffb35c";
/** cinza-quente (cinza de fuligem, não cinza puro) — lê como fumaça de
 * fogo, não como poeira/fumaça fria. */
const SMOKE_COLOR = "#5a5248";

/** rápido e perceptível — nem teleporte, nem voo arrastado (mesmo valor já
 * tunado da versão anterior, nunca reinventado sem motivo). */
export const FIREBALL_FLIGHT_MS = 480;
/** impacto dispara um pouco ANTES do easing terminar 100% — sincronia
 * perceptual (a bola "parece" chegar um instante antes do valor matemático
 * exato do `smoothstep`), mesma técnica já usada na versão anterior. */
const IMPACT_FRACTION = 0.95;
const IMPACT_AT_MS = FIREBALL_FLIGHT_MS * IMPACT_FRACTION;
const IMPACT_TAIL_MS = 700;
/** altura de chegada (unidades de célula) — meio do corpo do alvo, mesma
 * referência de sempre. */
const ARRIVE_Y = 1.0;

/** grande de propósito — bola de fogo é a habilidade mais icônica de "bola
 * grande" do jogo (personagens pequenos, cabeças grandes — exagero de
 * ESCALA, não de quantidade de elementos). */
const OUTER_SCALE = 2.6;
const BODY_SCALE = 1.7;
const CORE_SCALE = 0.9;
const FLICKER_SCALE = 0.45;

const TRAIL_OUTER_SCALE = 0.85;
const TRAIL_INNER_SCALE = 0.5;

const FLASH_SCALE_BASE = 1.2;
const FLASH_SCALE_TO = 3.0;
const EXPLOSION_SCALE_BASE = 1.9;
const EXPLOSION_SCALE_TO = 3.7;
const INNER_CORE_SCALE_BASE = 0.7;
const INNER_CORE_SCALE_TO = 1.6;

interface FireBallTierSpec {
  /** camada de corpo entre o glow externo e o núcleo — "bola maior/
   * detalhada" do pedido, primeira coisa que entra em MEDIUM. */
  hasMidBodyLayer: boolean;
  /** pequena variação de chama extra na bola — só HIGH. */
  hasFlickerLayer: boolean;
  /** brasas voando JUNTO com a bola (`flightMs`, mesmo helper genérico) —
   * partículas são SEMPRE o primeiro corte por desempenho. */
  flyingEmberCount: number;
  trailLength: number;
  /** 2ª camada de trail (mais estreita/brilhante por cima da larga/opaca) —
   * fake de "irregular, formato de chama" sem inventar renderer novo. */
  trailHasInnerLayer: boolean;
  /** flash interno extra na explosão (núcleo bem quente, curto) — MED/HIGH. */
  hasInnerCoreBurst: boolean;
  impactEmberCount: number;
  /** puffs de fumaça espalhados pela área real — última coisa a nascer,
   * última a sumir; primeiro corte de tier (partículas, item 17 do pedido). */
  smokePuffCount: number;
  /** duração do CORPO da explosão (mais lento/maior que o flash). */
  explosionBurstMs: number;
  /** duração do FLASH (pico rápido, primeiro a aparecer). */
  flashBurstMs: number;
}

const TIER_SPECS: Record<FireBallGpuTier, FireBallTierSpec> = {
  low: {
    hasMidBodyLayer: false,
    hasFlickerLayer: false,
    flyingEmberCount: 0,
    trailLength: 5,
    trailHasInnerLayer: false,
    hasInnerCoreBurst: false,
    impactEmberCount: 6,
    smokePuffCount: 4,
    explosionBurstMs: 260,
    flashBurstMs: 140,
  },
  medium: {
    hasMidBodyLayer: true,
    hasFlickerLayer: false,
    flyingEmberCount: 6,
    trailLength: 9,
    trailHasInnerLayer: true,
    hasInnerCoreBurst: true,
    impactEmberCount: 14,
    smokePuffCount: 8,
    explosionBurstMs: 320,
    flashBurstMs: 170,
  },
  high: {
    hasMidBodyLayer: true,
    hasFlickerLayer: true,
    flyingEmberCount: 10,
    trailLength: 13,
    trailHasInnerLayer: true,
    hasInnerCoreBurst: true,
    impactEmberCount: 20,
    smokePuffCount: 12,
    explosionBurstMs: 380,
    flashBurstMs: 200,
  },
};

const FLIGHT_PARAMS = { flightMs: FIREBALL_FLIGHT_MS, arriveY: ARRIVE_Y };

/** trail — SEMPRE presente mesmo em LOW (item 17 do pedido: nunca é o
 * primeiro corte, é identidade da skill junto com a bola). Camada interna
 * (mais estreita/brilhante) só entra em MED/HIGH — 2 camadas do MESMO
 * `TrailRenderer` bastam pra ler como "cauda de fogo larga e irregular" sem
 * nenhum mecanismo de jitter-por-segmento novo. */
function buildTrailLayers(spec: FireBallTierSpec): VfxLayer[] {
  const layers: VfxLayer[] = [
    {
      renderer: "trail",
      scale: { base: TRAIL_OUTER_SCALE },
      params: { color: TRAIL_OUTER_COLOR, trailLength: spec.trailLength, ...FLIGHT_PARAMS },
    },
  ];
  if (spec.trailHasInnerLayer) {
    layers.push({
      renderer: "trail",
      scale: { base: TRAIL_INNER_SCALE },
      params: { color: TRAIL_INNER_COLOR, trailLength: Math.max(3, Math.round(spec.trailLength * 0.7)), ...FLIGHT_PARAMS },
    });
  }
  return layers;
}

/** bola — glow externo + núcleo SEMPRE presentes (identidade, nunca
 * cortados); corpo intermediário e chama extra entram por tier. Brasas
 * voando junto (`particle`) são o primeiro corte (LOW=0). */
function buildProjectileLayers(spec: FireBallTierSpec): VfxLayer[] {
  const layers: VfxLayer[] = [...buildTrailLayers(spec)];
  layers.push({
    renderer: "sprite",
    scale: { base: OUTER_SCALE },
    params: { color: OUTER_COLOR, opacity: 0.5, ...FLIGHT_PARAMS },
  });
  if (spec.hasMidBodyLayer) {
    layers.push({
      renderer: "sprite",
      scale: { base: BODY_SCALE },
      params: { color: BODY_COLOR, opacity: 0.85, ...FLIGHT_PARAMS },
    });
  }
  layers.push({
    renderer: "sprite",
    scale: { base: CORE_SCALE },
    params: { color: CORE_COLOR, opacity: 1, ...FLIGHT_PARAMS },
  });
  if (spec.hasFlickerLayer) {
    layers.push({
      renderer: "sprite",
      scale: { base: FLICKER_SCALE },
      params: { color: CORE_COLOR, opacity: 0.6, ...FLIGHT_PARAMS },
    });
  }
  if (spec.flyingEmberCount > 0) {
    layers.push({
      renderer: "particle",
      scale: { base: 0.14 },
      params: { particleCount: spec.flyingEmberCount, radius: 0.4, color: EMBER_COLOR, ...FLIGHT_PARAMS },
    });
  }
  return layers;
}

/** impacto+AoE — todas as camadas nascem NA MESMA instância do projétil
 * (`payload.burstStartMs`/`burstDelayBaseMs` seguram cada uma invisível até
 * `IMPACT_AT_MS`, ver docblock do topo). Flash+corpo da explosão SEMPRE
 * presentes (identidade, "claramente mais forte que o projétil"); núcleo
 * interno extra e brasas em quantidade maior entram por tier; a FUMAÇA
 * (espalhada pelo raio REAL da área) representa o AoE, presente em TODO
 * tier (é dado de jogo, não decoração a cortar — só a CONTAGEM de puffs
 * varia por tier). */
function buildImpactLayers(spec: FireBallTierSpec): VfxLayer[] {
  const layers: VfxLayer[] = [
    {
      renderer: "sprite",
      scale: { base: FLASH_SCALE_BASE },
      params: {
        color: FLASH_COLOR,
        opacity: 1,
        burstMs: spec.flashBurstMs,
        burstStartMs: IMPACT_AT_MS,
        burstScaleFrom: 0.4,
        burstScaleTo: FLASH_SCALE_TO,
      },
    },
    {
      renderer: "sprite",
      scale: { base: EXPLOSION_SCALE_BASE },
      params: {
        color: EXPLOSION_COLOR,
        opacity: 0.85,
        burstMs: spec.explosionBurstMs,
        burstStartMs: IMPACT_AT_MS,
        burstScaleFrom: 0.5,
        burstScaleTo: EXPLOSION_SCALE_TO,
      },
    },
  ];
  if (spec.hasInnerCoreBurst) {
    layers.push({
      renderer: "sprite",
      scale: { base: INNER_CORE_SCALE_BASE },
      params: {
        color: CORE_COLOR,
        opacity: 1,
        burstMs: Math.round(spec.flashBurstMs * 0.8),
        burstStartMs: IMPACT_AT_MS,
        burstScaleFrom: 0.3,
        burstScaleTo: INNER_CORE_SCALE_TO,
      },
    });
  }
  layers.push({
    renderer: "particle",
    scale: { base: 0.2 },
    params: {
      particleCount: spec.impactEmberCount,
      radius: 0.9,
      color: EMBER_COLOR,
      burstDelayBaseMs: IMPACT_AT_MS,
      burstDelayMaxMs: 60,
      burstDurBaseMs: spec.explosionBurstMs + 80,
      burstDurJitterMs: 150,
    },
  });
  // fumaça — puffs grandes/escuros espalhados pelo raio REAL da área
  // (`payload.areaRadius`, sem `radius` fixo aqui de propósito — mesmo
  // `ParticleRenderer` das brasas acima, só um fallback a mais, ver
  // docblock do topo). Nasce um pouco DEPOIS do flash (a explosão precisa
  // "acontecer" primeiro) e dura bem mais (`burstDurBaseMs` grande) — a
  // fumaça paira e dissipa devagar, não estoura e some junto com o fogo.
  layers.push({
    renderer: "particle",
    scale: { base: 0.55 },
    params: {
      particleCount: spec.smokePuffCount,
      color: SMOKE_COLOR,
      opacity: 0.55,
      burstDelayBaseMs: IMPACT_AT_MS + 60,
      burstDelayMaxMs: 120,
      burstDurBaseMs: spec.explosionBurstMs + 500,
      burstDurJitterMs: 220,
    },
  });
  return layers;
}

export function fireBallImpactGpuDef(tier: FireBallGpuTier): VfxDefinition {
  const spec = TIER_SPECS[tier];
  return {
    id: "fireball_impact",
    renderer: "sprite",
    anchor: "caster-to-target",
    freezeAnchorAfterMs: FIREBALL_FLIGHT_MS,
    lifetimeMs: IMPACT_AT_MS + IMPACT_TAIL_MS,
    layers: [...buildProjectileLayers(spec), ...buildImpactLayers(spec)],
  };
}

// ---------------------------------------------------------------- cast

const CAST_GLOW = "#ffb35c";
const CAST_SPARK = "#fff2c2";
const CAST_CORE = "#fff3c4";

interface CastTierSpec {
  growTo: number;
  pulseHz: number;
  pulseAmp: number;
  hasCoreLayer: boolean;
  sparkCount: number;
}

const CAST_TIER_SPECS: Record<FireBallGpuTier, CastTierSpec> = {
  low: { growTo: 1.0, pulseHz: 0, pulseAmp: 0, hasCoreLayer: false, sparkCount: 8 },
  medium: { growTo: 1.35, pulseHz: 3.0, pulseAmp: 0.05, hasCoreLayer: false, sparkCount: 14 },
  high: { growTo: 1.7, pulseHz: 4.0, pulseAmp: 0.08, hasCoreLayer: true, sparkCount: 16 },
};

/** cast na ponta do cajado — glow crescendo/pulsando durante a conjuração
 * REAL (`castChargeEnvelope.ts`, mesmo mecanismo de Fire Lance), tier só
 * muda intensidade, nunca a composição. */
function buildFireBallCastLayers(tier: FireBallGpuTier): VfxLayer[] {
  const spec = CAST_TIER_SPECS[tier];
  const chargeParams = { castCharge: true, castGrowFrom: 0.4, castGrowTo: spec.growTo, castPulseHz: spec.pulseHz, castPulseAmp: spec.pulseAmp };
  const layers: VfxLayer[] = [{ renderer: "sprite", scale: { base: 0.55 }, params: { color: CAST_GLOW, opacity: 0.8, ...chargeParams } }];
  if (spec.hasCoreLayer) {
    layers.push({ renderer: "sprite", scale: { base: 0.24 }, params: { color: CAST_CORE, opacity: 0.9, ...chargeParams } });
  }
  layers.push({ renderer: "particle", scale: { base: 0.15 }, params: { particleCount: spec.sparkCount, radius: 0.38, color: CAST_SPARK } });
  return layers;
}

export function fireBallCastGpuDef(tier: FireBallGpuTier): VfxDefinition {
  return {
    id: "fireball_cast",
    renderer: "sprite",
    anchor: "caster-tip",
    layers: buildFireBallCastLayers(tier),
  };
}
