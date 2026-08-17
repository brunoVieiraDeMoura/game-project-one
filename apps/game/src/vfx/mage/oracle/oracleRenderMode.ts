import { defineVfx } from "../../core/registry";
import type { VfxDefinition } from "../../core/types";
import { oracleGpuDef, type OracleGpuTier } from "./oracleVfxDefGpu";

/**
 * Flag DOM↔GPU pro Oráculo, MESMO padrão de `fire-ball/fireBallRenderMode.
 * ts` — `oracleVfxDef.tsx` (a versão DOM real, em produção) nunca é
 * importado/tocado aqui; `defineVfx` "registra OU SUBSTITUI" a mesma
 * `VfxDefinition` id (`oracle_buff`), então trocar de modo só troca a
 * receita de desenho, nunca dano/duração/rede (buff continua 100%
 * decidido pelo servidor).
 *
 * **GPU (tier "high") é o padrão de produção** — melhor fidelidade
 * testada com custo idêntico a low/medium (Fase AR, 09-vfx-gpu-
 * migration.md seção T). `setOracleRenderMode("high")` no fim deste
 * arquivo aplica no module-load, depois de `oracleVfxDef.tsx` já ter
 * registrado o DOM (ordem de import em `skillVfxBindings.ts`).
 */
const ORACLE_DOM_DEF: VfxDefinition = {
  id: "oracle_buff",
  renderer: "dom",
  anchor: "entity",
  dom: { art: "oracle_buff" },
};

export type OracleRenderMode = "dom" | OracleGpuTier;

let mode: OracleRenderMode = "high";

export function setOracleRenderMode(next: OracleRenderMode): void {
  mode = next;
  defineVfx(next === "dom" ? ORACLE_DOM_DEF : oracleGpuDef(next));
}

export function oracleRenderMode(): OracleRenderMode {
  return mode;
}

setOracleRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __oracleRenderBench?: unknown }).__oracleRenderBench = {
    set: setOracleRenderMode,
    get: oracleRenderMode,
  };
}
