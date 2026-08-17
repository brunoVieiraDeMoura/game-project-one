import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Thunder Storm em GPU (Directive B, prioridade #4) — PROTÓTIPO.
 * `thunderStormVfxDef.tsx` (DOM real, produção) INTOCADO. Toggle troca a
 * MESMA receita pelo MESMO id, técnica já provada em Fire Ball/Oracle/
 * Fire Wall (`defineVfx` registra OU SUBSTITUI).
 *
 * SEM `ring`: lição da Fase 5/Fire Wall (Fase AW) — `ring` é `Mesh`
 * separado do `InstancedMesh` de sprite/particle, os dois com
 * `depthTest:false`; o Three ordena transparente por distância
 * aproximada da câmera, não por ordem de `layers[]`, e um `ring` grande o
 * bastante pra ler como "aro no chão" cobria os sprites por cima. Corpo
 * elétrico usa só `sprite`+`particle` (mesmo buffer/depth-sort).
 *
 * Cast (`thunder_storm_cast`, compartilhado com Light Bolt): glow +
 * faíscas orbitando — MESMA receita da Fire Ball (glow central + burst de
 * partículas), cor elétrica em vez de fogo.
 *
 * Impact (`thunder_storm_impact`, `coalesce:{by:"target",windowMs:400}`
 * preservado — item 14 do pedido, 1 raio por mob mesmo com N pulsos):
 * flash central (substitui `.ts-bolt__glow`+`__core`) + faíscas
 * radiais (substitui `.ts-shock__arc`+`__spark`+`.ts-ground__branch`) +
 * números de dano (`thunder_storm_dmgnum`, mesma exceção documentada —
 * cascata por pulso + total não cabe no `damageFeed` genérico).
 */

const ELECTRIC_GLOW = "#b4dcff";
const ELECTRIC_CORE = "#f2fbff";
const ELECTRIC_SPARK = "#c8ecff";

function buildCastGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "sprite",
      scale: { base: 0.55 },
      params: { color: ELECTRIC_GLOW, opacity: 0.75 },
    },
    {
      renderer: "particle",
      scale: { base: 0.14 },
      params: { particleCount: 14, radius: 0.4, color: ELECTRIC_SPARK },
    },
  ];
}

export const THUNDER_STORM_CAST_GPU_DEF: VfxDefinition = {
  id: "thunder_storm_cast",
  renderer: "sprite",
  anchor: "caster-tip",
  layers: buildCastGpuLayers(),
};

function buildImpactGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "sprite",
      scale: { base: 0.6 },
      offset: [0, 1.1, 0],
      params: { color: ELECTRIC_CORE, opacity: 0.95 },
    },
    {
      renderer: "particle",
      scale: { base: 0.16 },
      params: { particleCount: 24, radius: 0.55, color: ELECTRIC_SPARK },
    },
    {
      renderer: "dom",
      dom: { art: "thunder_storm_dmgnum" },
    },
  ];
}

export const THUNDER_STORM_IMPACT_GPU_DEF: VfxDefinition = {
  id: "thunder_storm_impact",
  renderer: "sprite",
  anchor: "entity",
  coalesce: { by: "target", windowMs: 400 },
  // congela no spawn — mesma razão de Cold Bolt/Fire Lance (auditoria
  // multi-hit 2026-08-17). `bornAt` não muda em `pulse()`, então pulsos
  // coalescidos seguintes continuam desenhando na posição do PRIMEIRO
  // hit desta sequência (correto: "onde a sequência de dano aconteceu",
  // não onde o alvo estava a cada pulso).
  freezeAnchorAfterMs: 0,
  layers: buildImpactGpuLayers(),
};
