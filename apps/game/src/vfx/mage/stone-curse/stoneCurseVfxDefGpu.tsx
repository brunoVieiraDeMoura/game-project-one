import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Petrificar (MG_STONECURSE) em GPU — skill fora da lista original de 5.
 * `StoneCurseImpact.tsx` (DOM real) INTOCADA. `hits:1`,
 * `damageFlags:["no_damage"]` — sem número de dano nenhum, generic ou
 * próprio (a maldição não causa dano). Mesma família estrutural de Frost
 * Diver (motes caster→alvo + burst de impacto, sem `infinite`).
 *
 * A transformação em pedra persistente (`usePetrifyMaterial`) é tint de
 * material no `NetEntity`, fora do ciclo de vida deste VFX — não tocada.
 *
 * Composição: 1× `trail` (o "olhar" caster→alvo, na altura do peito —
 * substitui as 6 motes discretas por 1 rastro contínuo) + 1× `particle`
 * (fragmentos de pedra do impacto) + 1× `ring` (onda de impacto).
 */

const STONE_COLOR = "#9c8f7a";
const FLIGHT_MS = 340; // BEAM_MS do original
const BEAM_Y = 1.1; // altura do "olhar" — peito/rosto, mesma referência do original

function buildStoneCurseGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "trail",
      scale: { base: 0.16 },
      params: { trailLength: 6, color: STONE_COLOR, flightMs: FLIGHT_MS, arriveY: BEAM_Y },
    },
    {
      renderer: "particle",
      scale: { base: 0.2 },
      offset: [0, BEAM_Y, 0],
      params: { particleCount: 12, radius: 0.35, color: STONE_COLOR },
    },
    {
      renderer: "ring",
      offset: [0, BEAM_Y, 0],
      params: { radius: 0.18, mode: "disc", color: STONE_COLOR },
    },
  ];
}

export const STONE_CURSE_IMPACT_GPU_DEF: VfxDefinition = {
  id: "stone_curse_impact_gpu",
  renderer: "trail",
  anchor: "caster-to-target",
  // mesmo mecanismo genérico de Soul Strike/Frost Diver — congela na
  // chegada, nunca segue o alvo depois (auditoria 2026-08-18).
  freezeAnchorAfterMs: FLIGHT_MS,
  layers: buildStoneCurseGpuLayers(),
};

/**
 * Cast de Stone Curse em GPU (2026-08-19) — substitui `StoneCurseCast.tsx`
 * (DOM). MESMA composição já provada (sprite de glow + partículas na
 * ponta do cajado, `anchor:"caster-tip"`), paleta roxo/cinza sobrenatural
 * (mesma identidade que `StoneCurseCast.tsx` já documentava: "energia
 * amaldiçoada se concentrando", nunca fogo/gelo).
 */
const STONE_CAST_GLOW = "#9c8f7a";
const STONE_CAST_SPARK = "#c8b8ff";

function buildStoneCurseCastLayers(): VfxLayer[] {
  return [
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: STONE_CAST_GLOW, opacity: 0.7 } },
    { renderer: "particle", scale: { base: 0.14 }, params: { particleCount: 12, radius: 0.35, color: STONE_CAST_SPARK } },
  ];
}

export const STONE_CURSE_CAST_GPU_DEF: VfxDefinition = {
  id: "stone_curse_cast_gpu",
  renderer: "sprite",
  anchor: "caster-tip",
  layers: buildStoneCurseCastLayers(),
};
