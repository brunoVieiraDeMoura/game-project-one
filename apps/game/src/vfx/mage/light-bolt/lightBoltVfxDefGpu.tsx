import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Light Bolt em GPU — skill fora da lista original de 5, migrada na
 * mesma varredura. `LightBoltImpact.tsx` (DOM real) INTOCADA.
 *
 * Diferente de Cold Bolt/Fire Lance/Soul Strike: o raio de Light Bolt é
 * ÚNICO e fica DE PÉ (não cai, não voa) — forma ideal pra `beam`
 * (primeiro uso real de `BeamRenderer` nesta migração inteira; até agora
 * só Sprite/Particle/Ring/Trail tinham skill real usando). `BeamRenderer`
 * já resolve cor por instância via atributo (`aColor`, corrigido na
 * Rodada 2) — sem o risco de "todo beam vivo fica da mesma cor" que a
 * auditoria original apontou.
 *
 * Composição: 1× `beam` (o raio, base no alvo — MESMO anchor:"entity" de
 * sempre — esticando até `height`) + 1× `particle` (faíscas concentradas
 * na cabeça/pés, MESMA regra de contagem fixa) + 1× `dom` (números).
 */

const ELECTRIC_COLOR = "#a9d8ff";
const SPARK_COLOR = "#eaf6ff";
const BEAM_HEIGHT = 6.2; // BOLT_TOP_Y do original — mesma altura visual

function buildLightBoltGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "beam",
      params: { width: 0.35, height: BEAM_HEIGHT, color: ELECTRIC_COLOR },
    },
    {
      renderer: "particle",
      scale: { base: 0.14 },
      offset: [0, 1.7, 0],
      params: { particleCount: 16, radius: 0.35, color: SPARK_COLOR },
    },
    {
      renderer: "dom",
      dom: { art: "light_bolt_dmgnum" },
    },
  ];
}

export const LIGHT_BOLT_IMPACT_GPU_DEF: VfxDefinition = {
  id: "light_bolt_impact_gpu",
  renderer: "beam",
  anchor: "entity",
  // congela no spawn — mesma razão das outras 3 skills sem fase de voo
  // (auditoria multi-hit 2026-08-17).
  freezeAnchorAfterMs: 0,
  layers: buildLightBoltGpuLayers(),
};
