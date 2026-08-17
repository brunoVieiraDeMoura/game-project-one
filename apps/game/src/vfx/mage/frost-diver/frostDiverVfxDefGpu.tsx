import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Congelar (MG_FROSTDIVER) em GPU — skill fora da lista original de 5.
 * `FrostDiverImpact.tsx` (DOM real) INTOCADA. Diferente de Cold Bolt/Fire
 * Lance/Soul Strike: `hits:1` (sem cascata de dano — dano sai pelo
 * `damageFeed` genérico, já funciona sem nenhuma camada `dom` aqui) e
 * NENHUMA animação `infinite` no original (7 espinhos + burst, todos
 * `forwards`, um único disparo) — já era mais barata que as skills
 * multi-hit por design, migrada agora só por completude/consistência
 * (mesmo mecanismo `anchor:"caster-to-target"` de Soul Strike).
 *
 * A prisão de gelo persistente (`FreezeBodyVfx.tsx`) é OUTRO componente,
 * fora do ciclo de vida deste VFX — não tocado aqui.
 *
 * Composição: 1× `trail` (a trilha caster→alvo, substitui os 7 espinhos
 * discretos por 1 rastro contínuo — mesma simplificação já aceita em
 * Soul Strike) + 1× `particle` (estilhaços do impacto) + 1× `ring`
 * (onda de impacto).
 */

const ICE_COLOR = "#bdeeff";
const FLIGHT_MS = 520; // TRAIL_MS do original

function buildFrostDiverGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "trail",
      scale: { base: 0.18 },
      params: { trailLength: 6, color: ICE_COLOR, flightMs: FLIGHT_MS, arriveY: 0 },
    },
    {
      renderer: "particle",
      scale: { base: 0.22 },
      params: { particleCount: 16, radius: 0.4, color: ICE_COLOR },
    },
    {
      renderer: "ring",
      params: { radius: 0.22, mode: "disc", color: "#bdeeff" },
    },
  ];
}

export const FROST_DIVER_IMPACT_GPU_DEF: VfxDefinition = {
  id: "frost_diver_impact_gpu",
  renderer: "trail",
  anchor: "caster-to-target",
  // rastreia o alvo DURANTE o voo, congela exatamente na chegada — mesmo
  // mecanismo genérico já provado em Soul Strike (auditoria "Congelar
  // ainda segue o mob", 2026-08-18): sem isto, `manager.ts` continua
  // re-resolvendo posição pra sempre depois do impacto, inclusive se o
  // alvo morrer/sumir/respawnar.
  freezeAnchorAfterMs: FLIGHT_MS,
  layers: buildFrostDiverGpuLayers(),
};
