import type { VfxDefinition, VfxRendererKind } from "./types";

/**
 * Registro de `VfxDefinition` — o único lugar onde uma skill "existe" para
 * o VFX Core. `defineVfx()` é chamado uma vez, no module-load do arquivo de
 * definições de cada família (efeito colateral estático, mesmo padrão de
 * `registrarPerfilEstruturalVfx`/`registrarColetorDeMeta` que já existem em
 * `core/diagnostics/`).
 *
 * Nunca guarda estado de INSTÂNCIA (isso é `manager.ts`) — só o catálogo
 * estático de "quais VFX existem e como são".
 */

const definitions = new Map<string, VfxDefinition>();
/** `aegisName:kind` (ex. "MG_FIREBALL:impact") → vfxId — a ponte entre o
 * nome Aegis do skill_db (fonte autoritativa, nunca adivinhada — invariante
 * do projeto) e o VFX que desenha. Populado por `vfx/skillVfxBindings.ts`,
 * não aqui: registry não sabe nada de rAthena. */
const skillBindings = new Map<string, string>();

const RENDERER_KINDS: ReadonlySet<VfxRendererKind> = new Set(["sprite", "particle", "beam", "ring", "trail", "cage", "dom"]);

export class VfxDefinitionError extends Error {}

function validateDefinition(def: VfxDefinition): void {
  if (!def.id) throw new VfxDefinitionError("VfxDefinition sem id");
  if (!RENDERER_KINDS.has(def.renderer)) {
    throw new VfxDefinitionError(`VfxDefinition "${def.id}": renderer desconhecido "${def.renderer}"`);
  }
  if (def.renderer === "dom" && !def.dom?.art) {
    throw new VfxDefinitionError(`VfxDefinition "${def.id}": renderer:"dom" exige dom.art`);
  }
  if (def.renderer !== "dom" && def.dom) {
    throw new VfxDefinitionError(`VfxDefinition "${def.id}": "dom" só é válido com renderer:"dom"`);
  }
  if (def.animation && def.animation.frames.length === 0) {
    throw new VfxDefinitionError(`VfxDefinition "${def.id}": animation.frames vazio`);
  }
  // `layers` (Fase 5, item 7 do leia1.txt: "primitives genéricas, skill é
  // composição") — cada layer é validado com as MESMAS regras do top-level,
  // nunca um caminho de validação separado.
  if (def.layers) {
    for (const layer of def.layers) {
      if (!RENDERER_KINDS.has(layer.renderer)) {
        throw new VfxDefinitionError(`VfxDefinition "${def.id}": layer com renderer desconhecido "${layer.renderer}"`);
      }
      if (layer.renderer === "dom" && !layer.dom?.art) {
        throw new VfxDefinitionError(`VfxDefinition "${def.id}": layer renderer:"dom" exige dom.art`);
      }
      if (layer.renderer !== "dom" && layer.dom) {
        throw new VfxDefinitionError(`VfxDefinition "${def.id}": layer "dom" só é válido com renderer:"dom"`);
      }
      if (layer.animation && layer.animation.frames.length === 0) {
        throw new VfxDefinitionError(`VfxDefinition "${def.id}": layer animation.frames vazio`);
      }
    }
  }
}

/** registra (ou substitui, em teste/hot-reload) uma definição. */
export function defineVfx(def: VfxDefinition): void {
  validateDefinition(def);
  definitions.set(def.id, def);
}

export function getVfxDefinition(vfxId: string): VfxDefinition | undefined {
  return definitions.get(vfxId);
}

export function listVfxDefinitions(): readonly VfxDefinition[] {
  return [...definitions.values()];
}

/** só para teste/dev: esvazia o registro inteiro. */
export function resetVfxRegistry(): void {
  definitions.clear();
  skillBindings.clear();
}

function bindingKey(aegisName: string, kind: string): string {
  return `${aegisName}:${kind}`;
}

/** liga `(aegisName, kind)` → `vfxId`. Chamado por `vfx/skillVfxBindings.ts`,
 * um por família migrada — nunca um `if` novo em código de dispatch. */
export function bindSkillVfx(aegisName: string, kind: string, vfxId: string): void {
  skillBindings.set(bindingKey(aegisName, kind), vfxId);
}

/** `undefined` = esta skill/kind ainda não foi migrada pro Core — quem
 * chama cai no caminho legado (`vfx/SkillVfx.tsx`, até a Fase 5 terminar). */
export function resolveSkillVfx(aegisName: string | undefined, kind: string): string | undefined {
  if (!aegisName) return undefined;
  return skillBindings.get(bindingKey(aegisName, kind));
}

export function listSkillBindings(): ReadonlyMap<string, string> {
  return skillBindings;
}

/** desliga `(aegisName, kind)` do Core — depois disso `resolveSkillVfx`
 * volta a devolver `undefined` e quem dispara cai no caminho legado de
 * novo. Existe pro toggle DOM↔GPU de skills que (ao contrário de Fire
 * Ball/Oracle) não têm uma `VfxDefinition` DOM registrada no Core — a
 * "volta pro DOM" É a ausência de binding, não uma segunda `defineVfx`. */
export function unbindSkillVfx(aegisName: string, kind: string): void {
  skillBindings.delete(bindingKey(aegisName, kind));
}
