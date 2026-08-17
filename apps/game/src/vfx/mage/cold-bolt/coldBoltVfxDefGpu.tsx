import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Cold Bolt em GPU — reconstrução visual 2026-08-19 ("losango de gelo
 * caindo do céu, um impacto por hit"). `ColdBoltImpact.tsx` (DOM real,
 * dispatch legado) continua INTOCADA.
 *
 * O burst antigo (particle+ring+sprite estático, 1 instância representando
 * a cascata INTEIRA) saiu daqui — virou `cold_bolt_shard_impact`
 * (`../multiHitShardImpact.ts`, composição COMPARTILHADA com Fire Lance),
 * tocado UMA VEZ POR HIT real pelo driver (`coldBoltRenderMode.ts` chama
 * `spawnMultiHitShards` a partir de `net/useWorldEvents.ts`). Esta
 * definição agora só carrega os NÚMEROS (`dom`) — mesma exceção de sempre
 * (`damageFeed` genérico não tem o estilo de cascata + total dourado).
 */
export const COLD_BOLT_IMPACT_GPU_DEF: VfxDefinition = {
  id: "cold_bolt_impact_gpu",
  renderer: "dom",
  anchor: "entity",
  // congela no spawn — mesma razão de sempre (auditoria multi-hit
  // 2026-08-17): desacopla do lifecycle do alvo.
  freezeAnchorAfterMs: 0,
  dom: { art: "cold_bolt_dmgnum" },
};

/**
 * Cast de Cold Bolt em GPU (2026-08-19, "GPU é o padrão pra VFX de
 * gameplay inteiro") — substitui `ColdBoltCastFrost.tsx` (DOM, 242
 * linhas, `<Html>`+`useFrame` próprios). MESMA composição já provada em
 * produção pelo cast de Thunder Storm (`thunderStormVfxDefGpu.tsx:
 * THUNDER_STORM_CAST_GPU_DEF`) — reusa o renderer/padrão existente em vez
 * de inventar um novo (`anchor:"caster-tip"`, sprite de glow + partículas
 * na ponta do cajado), só cor/contagem próprias. Identidade preservada:
 * nuvem de cristais de gelo concentrando na ponta do cajado durante a
 * conjuração — a mesma leitura que a versão DOM já dava, só sem o
 * `<Html>`/`useFrame` por trás. `durationMs` continua vindo de fora
 * (`net/useWorldEvents.ts: onSkillCasting`, tempo REAL de conjuração do
 * rAthena) — esta definição não tem `lifetimeMs` próprio de propósito,
 * igual ao cast de Thunder Storm.
 *
 * `ColdBoltCastFrost.tsx` continua INTOCADA — Congelar (MG_FROSTDIVER)
 * ainda reaproveita ela de propósito (`vfx/SkillVfx.tsx: CAST_VFX.
 * MG_FROSTDIVER`), dispatch separado por aegis, nunca afetado por este
 * binding (que só liga `MG_COLDBOLT:cast`).
 */
const ICE_CAST_GLOW = "#c9f3ff";
const ICE_CAST_SPARK = "#eafcff";

function buildColdBoltCastLayers(): VfxLayer[] {
  return [
    { renderer: "sprite", scale: { base: 0.5 }, params: { color: ICE_CAST_GLOW, opacity: 0.7 } },
    { renderer: "particle", scale: { base: 0.14 }, params: { particleCount: 12, radius: 0.35, color: ICE_CAST_SPARK } },
  ];
}

export const COLD_BOLT_CAST_GPU_DEF: VfxDefinition = {
  id: "cold_bolt_cast_gpu",
  renderer: "sprite",
  anchor: "caster-tip",
  layers: buildColdBoltCastLayers(),
};
