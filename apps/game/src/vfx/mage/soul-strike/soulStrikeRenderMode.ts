import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { SOUL_STRIKE_IMPACT_GPU_DEF, SOUL_STRIKE_CAST_GPU_DEF } from "./soulStrikeVfxDefGpu";
import "./soulStrikeDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU pra Soul Strike — MESMO padrão de
 * `cold-bolt/coldBoltRenderMode.ts` (bind/unbind, não troca de receita:
 * Soul Strike não tem `VfxDefinition` no Core hoje, o caminho DOM é o
 * dispatcher LEGADO).
 *
 * **GPU é o padrão de produção** — aplicado no module-load abaixo.
 */
defineVfx(SOUL_STRIKE_IMPACT_GPU_DEF);
defineVfx(SOUL_STRIKE_CAST_GPU_DEF);

export type SoulStrikeRenderMode = "dom" | "gpu";

let mode: SoulStrikeRenderMode = "gpu";

export function setSoulStrikeRenderMode(next: SoulStrikeRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_SOULSTRIKE", "impact", SOUL_STRIKE_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_SOULSTRIKE", "cast", SOUL_STRIKE_CAST_GPU_DEF.id);
  } else {
    unbindSkillVfx("MG_SOULSTRIKE", "impact");
    unbindSkillVfx("MG_SOULSTRIKE", "cast");
  }
}

export function soulStrikeRenderMode(): SoulStrikeRenderMode {
  return mode;
}

setSoulStrikeRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __soulStrikeRenderBench?: unknown }).__soulStrikeRenderBench = {
    set: setSoulStrikeRenderMode,
    get: soulStrikeRenderMode,
  };
}
