import type { VfxDefinition, VfxLayer } from "../../core/types";
import { SOUL_FLIGHT_MS } from "./SoulStrikeImpact";

/**
 * Soul Strike em GPU (Directive B, prioridade #5, última da lista
 * explícita) — PROTÓTIPO. `SoulStrikeImpact.tsx` (DOM real) INTOCADO.
 *
 * Arquiteturalmente igual a Cold Bolt: NÃO está no Core hoje (dispatch
 * legado `vfx/SkillVfx.tsx: IMPACT_VFX.MG_SOULSTRIKE`), toggle é
 * bind/unbind (`soulStrikeRenderMode.ts`), não troca de receita.
 *
 * `anchor:"caster-to-target"` + `payload.flightMs`/`arriveY` — MESMO
 * mecanismo genérico (`flightOffset.ts`) já usado pela bola da Fire Ball;
 * a própria doc daquele helper já cita Soul Strike como o outro
 * consumidor esperado.
 *
 * Simplificação deliberada MAIOR que Cold Bolt: o DOM original anima 5
 * almas INDEPENDENTES, cada uma com sua própria curva ondulada
 * (`PROFILES`) e atraso (`SOUL_STRIKE_STAGGER_MS`) — uma `VfxDefinition`
 * com `layers` estáticos não tem como reproduzir N sub-projéteis
 * defasados sem um renderer novo dedicado. Reconstrução: UM voo só
 * (trail+sprite+partículas), representando a rajada inteira como um
 * enxame coeso — identidade essencial preservada (forma: alma/orbe
 * pálido; cor: branco-azulado espiritual; movimento: vai do caster ao
 * alvo; impacto: partículas no alvo; sensação de poder: partículas
 * escalam com o burst). Os NÚMEROS de dano continuam exatos por hit
 * (`soul_strike_dmgnum`, dom layer) — só a coreografia visual das 5
 * trajetórias curvas foi simplificada, nunca a informação de dano.
 */

const SOUL_COLOR = "#eaf6ff";
const SOUL_CORE_COLOR = "#ffffff";
const ARRIVE_Y = 1.0;

function buildSoulStrikeGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "trail",
      scale: { base: 0.22 },
      params: { trailLength: 8, color: SOUL_COLOR, flightMs: SOUL_FLIGHT_MS, arriveY: ARRIVE_Y },
    },
    {
      renderer: "sprite",
      scale: { base: 0.4 },
      params: { color: SOUL_CORE_COLOR, opacity: 0.95, flightMs: SOUL_FLIGHT_MS, arriveY: ARRIVE_Y },
    },
    {
      renderer: "particle",
      scale: { base: 0.16 },
      params: { particleCount: 18, radius: 0.4, color: SOUL_COLOR, flightMs: SOUL_FLIGHT_MS, arriveY: ARRIVE_Y },
    },
    {
      renderer: "dom",
      dom: { art: "soul_strike_dmgnum" },
    },
  ];
}

export const SOUL_STRIKE_IMPACT_GPU_DEF: VfxDefinition = {
  id: "soul_strike_impact_gpu",
  renderer: "trail",
  anchor: "caster-to-target",
  // continua perseguindo o alvo DURANTE o voo (correto — o projétil ainda
  // não chegou), congela exatamente quando `SOUL_FLIGHT_MS` decorre desde
  // o spawn: a posição onde o dano aconteceu de verdade, não onde o alvo
  // estava no cast nem onde ele foi depois (auditoria multi-hit
  // 2026-08-17).
  freezeAnchorAfterMs: SOUL_FLIGHT_MS,
  layers: buildSoulStrikeGpuLayers(),
};

/**
 * Cast de Soul Strike em GPU (2026-08-19, "GPU é o padrão pra VFX de
 * gameplay inteiro") — substitui `SoulStrikeCastSpirit.tsx` (DOM). MESMA
 * composição já provada (Thunder Storm/Cold Bolt/Fire Lance: sprite de
 * glow + partículas na ponta do cajado, `anchor:"caster-tip"`) — reusa
 * renderer existente, só paleta muda. Identidade preservada: "branco,
 * branco-azulado, azul muito claro" (nunca vermelho/laranja de fogo nem
 * azul elétrico saturado — mesma paleta que `SoulStrikeCastSpirit.tsx`
 * já documentava pros WISPS espirituais).
 */
const SOUL_CAST_GLOW = "#eaf6ff";
const SOUL_CAST_SPARK = "#ffffff";

function buildSoulStrikeCastLayers(): VfxLayer[] {
  return [
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: SOUL_CAST_GLOW, opacity: 0.7 } },
    { renderer: "particle", scale: { base: 0.14 }, params: { particleCount: 12, radius: 0.35, color: SOUL_CAST_SPARK } },
  ];
}

export const SOUL_STRIKE_CAST_GPU_DEF: VfxDefinition = {
  id: "soul_strike_cast_gpu",
  renderer: "sprite",
  anchor: "caster-tip",
  layers: buildSoulStrikeCastLayers(),
};
