import type { VfxDefinition, VfxLayer, VfxAnimation } from "../../core/types";
import type { VfxQualityTier } from "../../vfxQualityStore";
import { LIGHT_BOLT_ATLAS_KEY, LIGHT_BOLT_FRAME_NAMES } from "./lightBoltAtlas";

/**
 * Eletrocutar / Light Bolt (`MG_LIGHTNINGBOLT`) em GPU — per-hit driver,
 * projétil+impacto tier-específicos, tracking de alvo ao vivo, config
 * global de qualidade (MESMA arquitetura de Fire Lance/Cold Bolt).
 *
 * `LightBoltImpact.tsx` (DOM real, dispatch legado) continua INTOCADA — só
 * fornece `LIGHT_BOLT_STAGGER_MS` (cascata de números/áudio já
 * estabelecida, nunca reinventada aqui).
 *
 * ## Atlas real (2026-08-19-p, retomado em 2026-08-19-r)
 *
 * O raio é a ARTE REAL do usuário (`lightBoltAtlas.ts`/
 * `lightning-sheet.png`, 5 quadros distintos) — PRIMEIRA skill do projeto
 * a usar um atlas de verdade (o mecanismo já existia pronto no
 * `SpriteRenderer`/`animation.frames`, nunca tinha um asset real
 * registrado). Cada hit sorteia 1 dos 5 quadros (`lightBoltMultiHit.ts`)
 * — a "distorção a cada vez que bate" vem da arte, não de geometria
 * procedural. `stretchFrom`/`stretchTo` NUNCA passados aqui de propósito:
 * esticar uma textura real a deformaria (só fazia sentido pro placeholder
 * procedural das rodadas anteriores).
 *
 * Sem custo extra medido: MESMO `SpriteRenderer`/`InstancedMesh`
 * compartilhado por toda skill, 1 textura pequena (384×64px) carregada
 * UMA vez (`textureManager.ts`, cache por URL), nenhum draw call novo —
 * ver `docs/claude-context/09-vfx-gpu-migration.md` pro porquê desse
 * modelo já escalar a dezenas de players. As 15 `VfxDefinition`
 * (5 quadros × 3 tiers) são só objetos JS registrados uma vez no
 * module-load, custo desprezível.
 *
 * `TrailRenderer` deliberadamente NÃO usado: eletricidade é uma descarga
 * quase instantânea, não um rastro suave. `fallHeight` pequeno (1.0) — não
 * parece um objeto descendo, só assenta no lugar rápido.
 */
export type LightBoltGpuTier = VfxQualityTier;

const FLASH_COLOR = "#ffffff";
const SPARK_COLOR = "#eaf6ff";

/** queda RÁPIDA — eletricidade é instantânea, não um projétil físico caindo
 * devagar (Fire Lance/Cold Bolt usam 560ms; um raio "cai" em bem menos). */
export const LIGHTNING_FALL_MS = 260;
/** PEQUENO de propósito — "não parecer um objeto descendo", só um leve
 * assentar no lugar, não uma queda física visível. */
export const LIGHTNING_FALL_HEIGHT = 1.0;
/** altura da CABEÇA acima da âncora (pés do alvo), em unidades de célula.
 * `arriveYByTarget:true` (`dropOffset.ts`) escala isto pelo `targetScale`
 * REAL do alvo — Poring baixo recebe o raio mais perto do chão que um
 * Boss alto, sem tabela nova. */
export const HEAD_OFFSET_Y = 1.75;

/** tamanho do sprite do raio, em unidades de célula (quad quadrado —
 * `lightning-sheet.json` já tem cada quadro em 64×64px, escalar
 * uniformemente preserva a proporção real da arte, sem esticar). Grande
 * de propósito — "personagem pequeno, efeito exagerado", pedido de
 * sempre. */
const BOLT_SCALE = 2.4;
/** desloca o quad pra CIMA em cima da âncora — a arte tem o "impacto" perto
 * da base do quadro; sem isto o CENTRO do sprite (não a base) ficaria na
 * cabeça, cortando a metade de baixo do raio dentro do alvo. */
const BOLT_Y_OFFSET = BOLT_SCALE * 0.42;

interface LightBoltTierSpec {
  /** camada extra de glow atrás do raio (MESMO quadro, maior e translúcido)
   * — só HIGH, "camada adicional se for barata" do pedido original. */
  hasSecondaryGlow: boolean;
  sparkCount: number;
  burstMs: number;
}

const TIER_SPECS: Record<LightBoltGpuTier, LightBoltTierSpec> = {
  low: { hasSecondaryGlow: false, sparkCount: 0, burstMs: 130 },
  medium: { hasSecondaryGlow: false, sparkCount: 4, burstMs: 170 },
  high: { hasSecondaryGlow: true, sparkCount: 8, burstMs: 200 },
};

export const LIGHT_BOLT_FRAME_COUNT = LIGHT_BOLT_FRAME_NAMES.length;

function frameAnimation(frameName: string): VfxAnimation {
  // 1 frame só, `mode:"once"` — `computeFrame` trava no índice 0 pra
  // sempre (nunca avança), é assim que se pede "este quadro fixo" do
  // atlas sem inventar um mecanismo novo de "frame estático".
  return { frames: [frameName], fps: 1, mode: "once" };
}

function buildProjectileLayers(tier: LightBoltGpuTier, frameIndex: number): VfxLayer[] {
  const spec = TIER_SPECS[tier];
  const frameName = LIGHT_BOLT_FRAME_NAMES[frameIndex] ?? LIGHT_BOLT_FRAME_NAMES[0]!;
  const anim = frameAnimation(frameName);
  const layers: VfxLayer[] = [];
  if (spec.hasSecondaryGlow) {
    layers.push({
      renderer: "sprite",
      atlas: LIGHT_BOLT_ATLAS_KEY,
      animation: anim,
      scale: { base: BOLT_SCALE * 1.3 },
      offset: [0, BOLT_Y_OFFSET, 0],
      params: { color: "#ffffff", opacity: 0.22 },
    });
  }
  layers.push({
    renderer: "sprite",
    atlas: LIGHT_BOLT_ATLAS_KEY,
    animation: anim,
    scale: { base: BOLT_SCALE },
    offset: [0, BOLT_Y_OFFSET, 0],
    params: { color: "#ffffff", opacity: 1 },
  });
  return layers;
}

export function lightBoltProjectileVfxId(tier: LightBoltGpuTier, frameIndex: number): string {
  return `light_bolt_bolt_${tier}_f${frameIndex}`;
}
export function lightBoltImpactBurstVfxId(tier: LightBoltGpuTier): string {
  return `light_bolt_impact_burst_${tier}`;
}

/** `arriveYByTarget:true` — o único payload TOP-LEVEL (spawn), herdado por
 * TODOS os `layers[]` acima (`buildLayerRuntime`, `manager.ts`, já mescla
 * o payload do spawn por baixo do de cada layer). */
export function lightBoltProjectileGpuDef(tier: LightBoltGpuTier, frameIndex: number): VfxDefinition {
  return {
    id: lightBoltProjectileVfxId(tier, frameIndex),
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: LIGHTNING_FALL_MS,
    lifetimeMs: LIGHTNING_FALL_MS + 40,
    layers: buildProjectileLayers(tier, frameIndex),
  };
}

function buildImpactBurstLayers(tier: LightBoltGpuTier): VfxLayer[] {
  const spec = TIER_SPECS[tier];
  const layers: VfxLayer[] = [
    {
      renderer: "sprite",
      scale: { base: 0.85 },
      params: { color: FLASH_COLOR, opacity: 0.95, burstMs: spec.burstMs, burstScaleFrom: 0.5, burstScaleTo: 2.3 },
    },
  ];
  if (spec.sparkCount > 0) {
    layers.push({
      renderer: "particle",
      scale: { base: 0.18 },
      params: {
        particleCount: spec.sparkCount,
        radius: 0.5,
        color: SPARK_COLOR,
        burstDelayBaseMs: 0,
        burstDelayMaxMs: 25,
        burstDurBaseMs: spec.burstMs,
        burstDurJitterMs: 60,
      },
    });
  }
  return layers;
}

/** burst na CABEÇA — mesma âncora `arriveYByTarget` do projétil (o driver
 * spawna com `position` explícita = onde o raio pousou de verdade, ver
 * `lightBoltMultiHit.ts`), então este def não precisa de `fallMs` nenhum.
 * Continua o flash/faíscas PROCEDURAIS (placeholder), não a arte do atlas
 * — a arte é só o raio em si; o impacto é um evento diferente. */
export function lightBoltImpactBurstGpuDef(tier: LightBoltGpuTier): VfxDefinition {
  const spec = TIER_SPECS[tier];
  return {
    id: lightBoltImpactBurstVfxId(tier),
    renderer: "sprite",
    anchor: "entity",
    freezeAnchorAfterMs: 0,
    lifetimeMs: spec.burstMs + 60,
    layers: buildImpactBurstLayers(tier),
  };
}

/** SÓ os NÚMEROS de dano (`dom`) — mesma exceção de sempre. */
export const LIGHT_BOLT_IMPACT_GPU_DEF: VfxDefinition = {
  id: "light_bolt_impact_gpu",
  renderer: "dom",
  anchor: "entity",
  freezeAnchorAfterMs: 0,
  dom: { art: "light_bolt_dmgnum" },
};
