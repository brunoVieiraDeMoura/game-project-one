import { defineVfx } from "../../core/registry";
import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Congelar persistente (`FreezeBodyVfx.tsx`) em GPU — auditoria "fechar o
 * arco de VFX" (2026-08-19): único VFX de gameplay que ainda sobrava em DOM
 * no projeto inteiro (categoria B desde a Rodada 9, `<Html>` + 5 losangos
 * CSS + `document.createElement("style")` pra injetar `@keyframes`).
 *
 * Não tenta reproduzir os 5 losangos em ângulos fixos 1:1 (mesmo princípio
 * de Fire Ball: "preserve a linguagem visual, não a implementação" — não
 * existe atlas/geometria de cristal ainda). Preserva: corpo do alvo
 * envolto em brilho azul-gelo translúcido (`sprite`, cobre da base até
 * acima da cabeça) + estilhaços flutuando ao redor (`particle`) + placa de
 * gelo no chão (`ring`, mesma técnica que Frost Diver/Fire Ball já usam
 * pro impacto — pago UMA VEZ por aplicação de congelamento, nunca por
 * hit, então o custo de 81 amostras de terreno do `RingRenderer` nunca se
 * repete em cascata).
 *
 * PERSISTENTE por natureza (`lifetimeMs` ausente de propósito — igual
 * Ghost Dome/Oracle): dura até `vfxManager.stop()` explícito, dirigido
 * pelo `opt1` real da entidade (`FreezeBodyVfx.tsx`), nunca por timer
 * local. `anchor:"entity"` SEM `freezeAnchorAfterMs` de propósito — ao
 * contrário de um impacto pontual, isto precisa continuar seguindo a
 * posição real da entidade enquanto ela existir (o `opt1` já garante que
 * uma entidade congelada não anda, mas ela pode ser reposicionada por
 * fixpos/teleporte e o efeito tem que acompanhar).
 */

const ICE_COLOR = "#bdeeff";
const ICE_CORE_COLOR = "#eaf9ff";

function buildFreezeBodyLayers(): VfxLayer[] {
  return [
    // corpo — brilho vertical translúcido, cresce/encolhe com o tamanho
    // real do alvo (`byTarget`, mesma escala que qualquer burst de
    // impacto já usa — `anchor.ts: entityVisualScale`).
    { renderer: "sprite", scale: { base: 1.4, byTarget: true }, offset: [0, 1.0, 0], params: { color: ICE_COLOR, opacity: 0.5 } },
    { renderer: "sprite", scale: { base: 0.8, byTarget: true }, offset: [0, 1.0, 0], params: { color: ICE_CORE_COLOR, opacity: 0.35 } },
    // estilhaços — poucos, decorativos, parados na cena enquanto a
    // instância viver (mesma distribuição radial que Oracle/Fire Wall já
    // usam pra decoração ao redor do alvo/caster).
    { renderer: "particle", scale: { base: 0.12 }, offset: [0, 0.6, 0], params: { particleCount: 10, radius: 0.5, color: ICE_COLOR } },
    // placa de gelo no chão — 1×/aplicação, nunca 1×/hit (ver docblock).
    { renderer: "ring", params: { radius: 0.4, mode: "disc", color: ICE_COLOR } },
  ];
}

export const FREEZE_BODY_GPU_ID = "freeze_body_gpu";

export const FREEZE_BODY_GPU_DEF: VfxDefinition = {
  id: FREEZE_BODY_GPU_ID,
  renderer: "sprite",
  anchor: "entity",
  layers: buildFreezeBodyLayers(),
};
defineVfx(FREEZE_BODY_GPU_DEF);

/**
 * Estilhaçar — burst curto, um `play()` só, disparado quando o `opt1`
 * deixa de ser `OPT1_FREEZE` (substitui a animação CSS `fbvShardGone*`).
 * Sprite+particle, sem `ring` (efeito de vida curta — mesma regra de
 * `multiHitShardImpact.ts`: `ring` pago em cascata é caro, aqui é só 1
 * disparo por descongelamento, mas segue a regra por hábito/consistência
 * de custo mínimo em efeitos curtos).
 */
export const FREEZE_SHATTER_GPU_ID = "freeze_shatter_gpu";
const SHATTER_MS = 380;

export const FREEZE_SHATTER_GPU_DEF: VfxDefinition = {
  id: FREEZE_SHATTER_GPU_ID,
  renderer: "sprite",
  anchor: "entity",
  freezeAnchorAfterMs: 0,
  lifetimeMs: SHATTER_MS,
  scale: { base: 1.1, byTarget: true },
  layers: [
    { renderer: "sprite", offset: [0, 1.0, 0], params: { color: ICE_CORE_COLOR, opacity: 0.7 } },
    { renderer: "particle", scale: { base: 0.14 }, offset: [0, 0.8, 0], params: { particleCount: 12, radius: 0.6, color: ICE_COLOR } },
  ],
};
defineVfx(FREEZE_SHATTER_GPU_DEF);
