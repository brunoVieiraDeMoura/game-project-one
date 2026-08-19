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
 * Impact (`thunder_storm_impact`) — SÓ os NÚMEROS agora (2026-08-19-t,
 * "faz o mesmo efeito pra Tempestade de Raios, ela é AoE mas é
 * basicamente a mesma habilidade"): o raio caindo em si saiu daqui e
 * virou o MESMO driver por-hit de Eletrocutar (`spawnLightBoltHits`,
 * chamado direto pra `MG_THUNDERSTORM` também em `useWorldEvents.ts`) —
 * mesmos `VfxDefinition` (mesmo atlas, mesmos ids `light_bolt_bolt_*`/
 * `light_bolt_impact_burst_*`), reusados tal qual, não recriados aqui.
 * Correto: o servidor já entrega Tempestade de Raios como N eventos de
 * alvo independentes (um por mob atingido na AoE, cada um com seu
 * próprio `hits`/pulsos) — é exatamente a mesma forma que Eletrocutar já
 * consome hoje, só que Eletrocutar tem 1 alvo por cast e Tempestade tem
 * vários. `coalesce:{by:"target",windowMs:400}` preservado (item 14 do
 * pedido original, defensivo contra pacote duplicado no mesmo alvo) —
 * agora só protege a cascata de números, não mais um flash visual.
 */

const ELECTRIC_GLOW = "#b4dcff";
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

/** SÓ os NÚMEROS (`dom`) — o raio/burst reais vêm do driver por-hit
 * compartilhado com Light Bolt, ver docblock do arquivo. */
export const THUNDER_STORM_IMPACT_GPU_DEF: VfxDefinition = {
  id: "thunder_storm_impact",
  renderer: "dom",
  anchor: "entity",
  coalesce: { by: "target", windowMs: 400 },
  // congela no spawn — mesma razão de Cold Bolt/Fire Lance (auditoria
  // multi-hit 2026-08-17). `bornAt` não muda em `pulse()`, então pulsos
  // coalescidos seguintes continuam desenhando na posição do PRIMEIRO
  // hit desta sequência (correto: "onde a sequência de dano aconteceu",
  // não onde o alvo estava a cada pulso).
  freezeAnchorAfterMs: 0,
  dom: { art: "thunder_storm_dmgnum" },
};
