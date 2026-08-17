import { defineVfx } from "../../core/registry";
import type { VfxDefinition } from "../../core/types";
import { FIREBALL_CAST_GPU_DEF, FIREBALL_IMPACT_GPU_DEF } from "./fireBallVfxDefGpu";

/**
 * Flag DOM↔GPU pra Fire Ball (Fase 5, rodada "reestruturar VFX pra escala",
 * leia1.txt item 3: "flag clara de benchmark, implementação antiga
 * continua disponível como baseline"). `fireBallVfxDef.tsx` (a versão DOM
 * real, em produção) NUNCA é importado nem tocado por este arquivo — ele
 * já registrou as próprias `VfxDefinition` no module-load de sempre, e
 * continua sendo o que o jogo usa por padrão. Isto aqui só existe pra
 * TROCAR a receita das mesmas duas `VfxDefinition` (`fireball_cast`/
 * `fireball_impact`) em runtime, pra comparação lado a lado — `defineVfx`
 * já "registra OU SUBSTITUI" (`registry.ts`), então recadastrar o mesmo id
 * com outro `renderer`/`layers` troca só a receita de desenho, nunca
 * dano/alvo/timing/rede (isso continua 100% no servidor, nunca aqui).
 *
 * Cópia local dos metadados DOM (id/renderer/anchor/dom/lifetimeMs) — NÃO
 * a arte em si (nenhum componente/CSS duplicado) — só pra poder VOLTAR pro
 * estado original depois de testar GPU, sem precisar recarregar a página.
 *
 * **GPU é o padrão de produção** (Directive B, rodada de virada) — o
 * `setFireBallRenderMode("gpu")` no fim deste arquivo roda no module-load,
 * sempre, substituindo a `VfxDefinition` DOM que `fireBallVfxDef.tsx`
 * acabou de registrar (import ANTES deste em `skillVfxBindings.ts` —
 * ordem garante que este `defineVfx` vence por último). `window.
 * __fireballBench.set("dom")` continua disponível em dev pra comparar/
 * reverter sem rebuild.
 */
const FIREBALL_FLIGHT_MS = 480;
const IMPACT_AT_MS = FIREBALL_FLIGHT_MS * 0.93;
const IMPACT_TAIL_MS = 650;

const FIREBALL_CAST_DOM_DEF: VfxDefinition = {
  id: "fireball_cast",
  renderer: "dom",
  anchor: "caster-tip",
  dom: { art: "fireball_cast" },
};

const FIREBALL_IMPACT_DOM_DEF: VfxDefinition = {
  id: "fireball_impact",
  renderer: "dom",
  anchor: "caster-to-target",
  dom: { art: "fireball_impact" },
  lifetimeMs: IMPACT_AT_MS + IMPACT_TAIL_MS,
};

export type FireBallRenderMode = "dom" | "gpu";

let mode: FireBallRenderMode = "gpu";

export function setFireBallRenderMode(next: FireBallRenderMode): void {
  mode = next;
  defineVfx(next === "gpu" ? FIREBALL_CAST_GPU_DEF : FIREBALL_CAST_DOM_DEF);
  defineVfx(next === "gpu" ? FIREBALL_IMPACT_GPU_DEF : FIREBALL_IMPACT_DOM_DEF);
}

export function fireBallRenderMode(): FireBallRenderMode {
  return mode;
}

setFireBallRenderMode(mode); // aplica o padrão de produção no module-load

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __fireballBench?: unknown }).__fireballBench = {
    set: setFireBallRenderMode,
    get: fireBallRenderMode,
  };
}
