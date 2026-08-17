import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Fire Lance em GPU — reconstrução visual 2026-08-19 ("losango de fogo
 * caindo do céu, um impacto por hit"). `FireLanceImpact.tsx` (DOM real,
 * dispatch legado) continua INTOCADA.
 *
 * O burst antigo saiu daqui — virou `fire_lance_shard_impact`
 * (`../multiHitShardImpact.ts`, composição COMPARTILHADA com Cold Bolt,
 * mesma estrutura, só cor muda), tocado UMA VEZ POR HIT real pelo driver
 * (`fireLanceRenderMode.ts` chama `spawnMultiHitShards` a partir de
 * `net/useWorldEvents.ts`). Esta definição agora só carrega os NÚMEROS
 * (`dom`) — mesma exceção de sempre.
 */
export const FIRE_LANCE_IMPACT_GPU_DEF: VfxDefinition = {
  id: "fire_lance_impact_gpu",
  renderer: "dom",
  anchor: "entity",
  freezeAnchorAfterMs: 0,
  dom: { art: "fire_lance_dmgnum" },
};

/**
 * Cast de Fire Lance em GPU (2026-08-19) — substitui `FireLanceCastFire.
 * tsx` (DOM). MESMA composição/renderer já provados pelo cast de Thunder
 * Storm (`thunderStormVfxDefGpu.tsx: THUNDER_STORM_CAST_GPU_DEF`) e agora
 * também pelo de Cold Bolt (`coldBoltVfxDefGpu.tsx:
 * COLD_BOLT_CAST_GPU_DEF`) — `anchor:"caster-tip"`, sprite de glow +
 * partículas na ponta do cajado, só cor/contagem próprias (identidade de
 * fogo, não gelo). `FireLanceCastFire.tsx` continua INTOCADA (nenhuma
 * outra skill reaproveita ela, ao contrário do cast de Cold Bolt).
 */
const FIRE_CAST_GLOW = "#ffb35c";
const FIRE_CAST_SPARK = "#fff2c2";

function buildFireLanceCastLayers(): VfxLayer[] {
  return [
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: FIRE_CAST_GLOW, opacity: 0.75 } },
    { renderer: "particle", scale: { base: 0.14 }, params: { particleCount: 12, radius: 0.35, color: FIRE_CAST_SPARK } },
  ];
}

export const FIRE_LANCE_CAST_GPU_DEF: VfxDefinition = {
  id: "fire_lance_cast_gpu",
  renderer: "sprite",
  anchor: "caster-tip",
  layers: buildFireLanceCastLayers(),
};
