import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Oráculo em GPU (Fase 5, rodada "migração agressiva performance-first") —
 * PROTÓTIPO com 4 orçamentos visuais (LOW/MEDIUM/HIGH/ULTRA), comparados
 * entre si e contra a versão DOM real via `oracleRenderMode.ts`. A versão
 * DOM (`oracleVfxDef.tsx`) é INTOCADA — nem importada aqui.
 *
 * Oracle foi o PRIMEIRO penhasco confirmado do combo (44→8fps ao entrar,
 * Fase 5 anterior, decomposição incremental) — candidata #1 de migração
 * por pedido explícito do usuário.
 *
 * Composição (3 caveiras orbitando + rastro + partículas de área — mesma
 * identidade visual: forma, cor, movimento, "sensação de poder"):
 *   - 3× `sprite` (uma caveira cada) com órbita genérica
 *     (`payload.orbitRadius/orbitSpeedDegPerSec/orbitAngle0Deg`, ver
 *     `orbitOffset.ts` — sem `if ORACLE` em nenhum renderer);
 *   - 3× `trail` (rastro de cada caveira, MESMOS parâmetros de órbita —
 *     LOW não tem, MEDIUM/HIGH/ULTRA têm com tamanho crescente);
 *   - 1× `particle` (as partículas de área/"glimmers" — a distribuição
 *     radial seed+delay+dur que `ParticleRenderer.buildParticles` já faz
 *     é estruturalmente a MESMA fórmula que `oracleVfxDef.tsx:
 *     buildAreaParticles` usava, só sem DOM).
 *
 * Reduzido deliberadamente vs. a versão DOM (permitido/pedido
 * explicitamente): sem glow radial separado por caveira, sem "bob"
 * vertical (altura de órbita fixa), sem drop-shadow/filter algum — tudo
 * shader puro. Contagens exatas por tier abaixo, calibradas por benchmark
 * (não chutadas às cegas — Fase seguinte mede e escolhe o tier padrão).
 */

export type OracleGpuTier = "low" | "medium" | "high" | "ultra";

const ORBIT_SPEED_DEG_PER_SEC = 82;
const ORBIT_HEIGHT = 1.05;
const SKULL_ANGLES = [0, 120, 240] as const;
const DEFAULT_AREA_RADIUS = 3;

interface TierSpec {
  skullScale: number;
  trailLength: number; // 0 = sem camada de trail
  glimmerCount: number;
  glimmerScale: number;
}

const TIER_SPECS: Record<OracleGpuTier, TierSpec> = {
  low: { skullScale: 0.35, trailLength: 0, glimmerCount: 12, glimmerScale: 0.1 },
  medium: { skullScale: 0.4, trailLength: 4, glimmerCount: 30, glimmerScale: 0.12 },
  high: { skullScale: 0.45, trailLength: 8, glimmerCount: 66, glimmerScale: 0.14 },
  ultra: { skullScale: 0.5, trailLength: 14, glimmerCount: 120, glimmerScale: 0.16 },
};

function buildOracleGpuLayers(tier: OracleGpuTier): VfxLayer[] {
  const spec = TIER_SPECS[tier];
  const layers: VfxLayer[] = [];

  for (const angle0 of SKULL_ANGLES) {
    layers.push({
      renderer: "sprite",
      scale: { base: spec.skullScale },
      params: {
        color: "#ff5c5c",
        opacity: 0.95,
        orbitRadius: DEFAULT_AREA_RADIUS,
        orbitSpeedDegPerSec: ORBIT_SPEED_DEG_PER_SEC,
        orbitAngle0Deg: angle0,
        orbitHeight: ORBIT_HEIGHT,
      },
    });
    if (spec.trailLength > 0) {
      layers.push({
        renderer: "trail",
        scale: { base: spec.skullScale * 0.6 },
        params: {
          color: "#ff9494",
          trailLength: spec.trailLength,
          orbitRadius: DEFAULT_AREA_RADIUS,
          orbitSpeedDegPerSec: ORBIT_SPEED_DEG_PER_SEC,
          orbitAngle0Deg: angle0,
          orbitHeight: ORBIT_HEIGHT,
        },
      });
    }
  }

  layers.push({
    renderer: "particle",
    scale: { base: spec.glimmerScale },
    params: { particleCount: spec.glimmerCount, radius: DEFAULT_AREA_RADIUS, color: "#eaf2ff" },
  });

  return layers;
}

export function oracleGpuDef(tier: OracleGpuTier): VfxDefinition {
  return {
    id: "oracle_buff",
    renderer: "sprite",
    anchor: "entity",
    layers: buildOracleGpuLayers(tier),
  };
}
