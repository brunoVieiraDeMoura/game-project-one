import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { COLD_BOLT_IMPACT_GPU_DEF, COLD_BOLT_CAST_GPU_DEF } from "./coldBoltVfxDefGpu";
import "./coldBoltDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU pra Cold Bolt — DIFERENTE do padrão Fire Ball/Oracle
 * (`defineVfx` trocando a MESMA `VfxDefinition`): Cold Bolt não tem
 * `VfxDefinition` nenhuma no Core hoje, o caminho DOM é o dispatcher
 * LEGADO (`vfx/SkillVfx.tsx: IMPACT_VFX.MG_COLDBOLT`), fora do Core
 * inteiramente. "Voltar pro DOM" aqui é `unbindSkillVfx` — sem binding,
 * `resolveSkillVfx("MG_COLDBOLT","impact")` devolve `undefined` de novo e
 * `vfxStore.spawn()` cai no legado sozinho, sem `if` novo em lugar nenhum.
 *
 * `COLD_BOLT_IMPACT_GPU_DEF` é registrada incondicionalmente (só existir no
 * Core não desenha nada sem um binding apontando pra ela) — só o BINDING
 * troca de modo, nunca a definição em si.
 *
 * **GPU é o padrão de produção** — `setColdBoltRenderMode("gpu")` no fim
 * deste arquivo aplica o bind no module-load.
 */
defineVfx(COLD_BOLT_IMPACT_GPU_DEF);
defineVfx(COLD_BOLT_CAST_GPU_DEF);

/**
 * Fragmento de gelo caindo: NÃO tem `VfxDefinition`/bind próprio mais
 * (refatoração "Generic Hit VFX", 2026-08-19) — usa o fragmento GENÉRICO
 * compartilhado (`vfx/mage/multiHitShardImpact.ts: GENERIC_HIT_SHARD_ID`),
 * cor derivada do `element` REAL da skill (`Water`, skill_db), disparado
 * direto por `spawnMultiHitShards()` a partir de `net/useWorldEvents.ts`
 * (via `vfx/mage/multiHitRegistry.ts: MULTI_HIT_SHARD_VFX`). Nenhum
 * registro/bind aqui pra isso — é exatamente o ponto: uma skill multi-hit
 * nova não precisa de nada neste arquivo pro fragmento funcionar.
 */
export type ColdBoltRenderMode = "dom" | "gpu";

let mode: ColdBoltRenderMode = "gpu";

export function setColdBoltRenderMode(next: ColdBoltRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_COLDBOLT", "impact", COLD_BOLT_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_COLDBOLT", "cast", COLD_BOLT_CAST_GPU_DEF.id);
  } else {
    unbindSkillVfx("MG_COLDBOLT", "impact");
    unbindSkillVfx("MG_COLDBOLT", "cast");
  }
}

export function coldBoltRenderMode(): ColdBoltRenderMode {
  return mode;
}

setColdBoltRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __coldBoltRenderBench?: unknown }).__coldBoltRenderBench = {
    set: setColdBoltRenderMode,
    get: coldBoltRenderMode,
  };
}
