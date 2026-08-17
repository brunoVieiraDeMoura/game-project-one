import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { LIGHT_BOLT_IMPACT_GPU_DEF } from "./lightBoltVfxDefGpu";
import "./lightBoltDamageDomArt"; // side-effect: registra a arte DOM dos números

/**
 * Flag DOM↔GPU pra Light Bolt — MESMO padrão bind/unbind de
 * `cold-bolt/coldBoltRenderMode.ts`.
 *
 * **Achado real, corrigido 2026-08-19** (auditoria "GPU é o padrão pra
 * todo VFX de gameplay"): este arquivo AFIRMAVA em comentário que o cast
 * já era compartilhado com Thunder Storm (`thunder_storm_cast`) "sem
 * precisar de nada aqui" — falso. Só `MG_THUNDERSTORM:cast` tinha
 * `bindSkillVfx` de verdade (`thunderStormVfxDef.tsx:326`); Light Bolt
 * nunca teve o PRÓPRIO bind pra esse id, então `resolveSkillVfx
 * ("MG_LIGHTNINGBOLT","cast")` sempre voltou `undefined` e o cast de
 * Light Bolt SEMPRE caiu no legado DOM (`vfx/SkillVfx.tsx: CAST_VFX.
 * MG_LIGHTNINGBOLT → ThunderStormCastElectric`), apesar do que o
 * comentário dizia. Corrigido: bind próprio pro MESMO id compartilhado
 * (a definição continua uma só, registrada em `thunderStormRenderMode.
 * ts`; só faltava este arquivo apontar pra ela).
 *
 * **GPU é o padrão de produção** — aplicado no module-load abaixo.
 */
defineVfx(LIGHT_BOLT_IMPACT_GPU_DEF);

export type LightBoltRenderMode = "dom" | "gpu";

let mode: LightBoltRenderMode = "gpu";

export function setLightBoltRenderMode(next: LightBoltRenderMode): void {
  mode = next;
  if (next === "gpu") {
    bindSkillVfx("MG_LIGHTNINGBOLT", "impact", LIGHT_BOLT_IMPACT_GPU_DEF.id);
    bindSkillVfx("MG_LIGHTNINGBOLT", "cast", "thunder_storm_cast");
  } else {
    unbindSkillVfx("MG_LIGHTNINGBOLT", "impact");
    unbindSkillVfx("MG_LIGHTNINGBOLT", "cast");
  }
}

export function lightBoltRenderMode(): LightBoltRenderMode {
  return mode;
}

setLightBoltRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __lightBoltRenderBench?: unknown }).__lightBoltRenderBench = {
    set: setLightBoltRenderMode,
    get: lightBoltRenderMode,
  };
}
