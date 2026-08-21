import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Reação de bloqueio da Cúpula Fantasma (MG_SAFETYWALL, 2026-08-19-zj:
 * "ao tomar hit dentro da habilidade, criar uma animação de barreira
 * 'block' na direção de onde o hit foi aplicado") — flash reativo, não uma
 * skill nova: nasce na posição REAL de quem bloqueou (`anchor:
 * "caster-to-target"`, reaproveitado com os papéis trocados — "source" é o
 * ATACANTE, "target" é quem tem a Cúpula sob os pés, `freezeAnchorAfterMs:
 * 0` congela na chegada) e usa `payload.facingOffsetDistance/Height`
 * (`core/renderers/facingOffset.ts`, novo) pra nascer deslocado na direção
 * de quem atacou — o "lado" que bloqueou o golpe.
 *
 * Disparado por `ghostDomeBlockReaction.ts: spawnGhostDomeBlock`, reagindo
 * ao evento AUTORITATIVO `ghost-dome-block` do servidor (2026-08-20,
 * `rathena-patches/0001`) — não mais heurística de miss/célula. O servidor
 * decrementa a carga da Safety Wall e notifica ANTES do hit/miss ser
 * decidido, então este VFX nasce em toda carga consumida (HIT ou MISS,
 * tanto faz) — ver aquele arquivo pro raciocínio completo.
 *
 * Composição mínima (flash central + aro) — reação rápida, não um evento
 * grande: nunca deve competir visualmente com a própria gaiola.
 */
export const GHOST_DOME_BLOCK_VFX_ID = "ghost_dome_block";

const FLASH_COLOR = "#ffffff";
const RIM_COLOR = "#ffe9a8"; // mesmo dourado da faixa da gaiola — identidade da MESMA skill
/** distância (mundo) do centro do personagem — "peito", mesma referência
 * de altura usada em outros impactos (`ARRIVE_Y`). */
const FACING_DISTANCE = 0.55;
const FACING_HEIGHT = 1.0;

function buildBlockLayers(): VfxLayer[] {
  const facingParams = { facingOffsetDistance: FACING_DISTANCE, facingOffsetHeight: FACING_HEIGHT };
  return [
    {
      renderer: "sprite",
      scale: { base: 0.5 },
      params: { color: FLASH_COLOR, opacity: 1, burstMs: 140, burstScaleFrom: 0.3, burstScaleTo: 1.5, ...facingParams },
    },
    {
      renderer: "sprite",
      scale: { base: 0.75 },
      params: { color: RIM_COLOR, opacity: 0.5, burstMs: 190, burstScaleFrom: 0.4, burstScaleTo: 1.8, ...facingParams },
    },
  ];
}

export const GHOST_DOME_BLOCK_GPU_DEF: VfxDefinition = {
  id: GHOST_DOME_BLOCK_VFX_ID,
  renderer: "sprite",
  anchor: "caster-to-target",
  freezeAnchorAfterMs: 0,
  lifetimeMs: 260,
  layers: buildBlockLayers(),
};
