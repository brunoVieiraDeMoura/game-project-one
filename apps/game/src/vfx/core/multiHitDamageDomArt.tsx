import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { registerDomArt } from "./renderers/domArtRegistry";
import type { DomArtComponentProps, DomArtRefs, DomArtUpdateCtx } from "./renderers/domArtRegistry";
import { aoImpactoMultiHit } from "../../audio/mage/multiHitCastAudio";
import { createSeededRng } from "./particleMath";

/**
 * Arte DOM genérica pra números de dano em cascata de skill multi-hit
 * (Cold Bolt/Thunder Storm/Soul Strike/Fire Lance/Light Bolt) — auditoria
 * de arquitetura multi-hit (2026-08-17, plano aprovado): os 5 arquivos
 * `<skill>DamageDomArt.tsx` eram cópias quase idênticas (mesma função
 * `hitCountFrom`/`splitDamage`/componente/`update`, só timing e classe
 * CSS diferentes) — auditoria confirmou que o payload que chega em CADA
 * spawn já é genérico (`{hits,damage,crit,onSelf}`, mesmo formato pras
 * 5), então a única parte não-genérica era este componente, não a
 * arquitetura de disparo (não existe "N eventos de hit" no protocolo —
 * é sempre 1 evento por cast com dano TOTAL + `hits`, ver
 * `docs/claude-context/09-vfx-gpu-migration.md` FASE do plano pra
 * detalhe completo do rastreio DB→servidor→rede→frontend).
 *
 * Cada skill continua registrando a PRÓPRIA paleta (cor/timing vêm dos
 * arquivos DOM originais, nunca reescritos) — só o COMPONENTE que
 * desenha virou 1 função genérica em vez de 5 quase-clones.
 */
export interface MultiHitDamagePalette {
  /** chave registrada em `domArtRegistry` — ex. "cold_bolt_dmgnum". */
  artKey: string;
  /** teto de hits — mesmo papel de `ICICLE_MAX_HITS`/`THUNDER_MAX_PULSES`. */
  maxHits: number;
  /** ms entre o início de um hit e o próximo. */
  staggerMs: number;
  /** ms (relativo ao início DESTE hit) em que ele "impacta" — 0 pra quem
   * não tem fase de queda (Thunder Storm/Light Bolt: descarga já em pé,
   * impacta em t=0 do próprio hit). */
  impactAtMs: number;
  /** ms que o número individual fica na tela depois de "impactar". */
  damageNumberMs: number;
  /** ms que o total (dourado) fica visível depois de disparado. */
  totalVisibleMs: number;
  /** altura (unidades de célula) onde a CABEÇA do alvo fica — referência
   * pro total (`headY + 0.4`, mesma folga nas 5 skills originais). */
  headY: number;
  /** classe CSS do número individual (ex. "cb-ice-dmgnum") — total é
   * SEMPRE a mesma raiz com sufixo `-total` nas 5 skills originais,
   * exceto o prefixo completo mudar (fl-fire-dmgnum → fl-fire-total),
   * por isso os dois vêm explícitos em vez de derivados. */
  dmgClass: string;
  totalClass: string;
  /** seed-base pro jitter horizontal (`createSeededRng`, mesma técnica
   * das 4 skills que usavam RNG determinístico) — IGNORADO se `jitterFn`
   * for passado. */
  jitterSeedBase?: number;
  /** override pro jitter — Thunder Storm NUNCA usou `createSeededRng`
   * pro `--dmgx` (usava `((i*37)%64)-32`, puramente determinístico por
   * índice); preservado aqui pixel-a-pixel em vez de forçado pro padrão
   * das outras 4. */
  jitterFn?: (i: number) => number;
}

/** mesmas 3 constantes, IDÊNTICAS nos 5 arquivos originais (1.3/0.08/0.4)
 * — nunca variaram entre skill, por isso viram módulo em vez de campo da
 * paleta (uma paleta que "esquecesse" de setar teria um bug silencioso;
 * assim não tem como). */
const DMG_SPAWN_Y = 1.3;
const DMG_STACK_STEP = 0.08;
const TOTAL_GAP_ABOVE_HEAD = 0.4;

const FREE_POS_STYLE: CSSProperties = { position: "absolute", left: 0, top: 0, pointerEvents: "none" };

function splitDamage(total: number, hits: number): number[] {
  const base = Math.floor(total / hits);
  const resto = total - base * hits;
  return Array.from({ length: hits }, (_, i) => base + (i === hits - 1 ? resto : 0));
}

function hitCountFrom(palette: MultiHitDamagePalette, payload: Record<string, unknown> | undefined): number {
  const hits = (payload?.hits as number | undefined) ?? palette.maxHits;
  return Math.min(palette.maxHits, Math.max(1, hits));
}

/** faixa 0..-64px — sempre à ESQUERDA do alvo, nunca à direita (pedido do
 * usuário 2026-08-19: cascata de números favorecia visualmente o lado
 * direito; invertido pra todas as skills multi-hit de uma vez, não por
 * skill). */
function jitterFor(palette: MultiHitDamagePalette, i: number): number {
  if (palette.jitterFn) return palette.jitterFn(i);
  const rnd = createSeededRng((palette.jitterSeedBase ?? 0) + i);
  return -(rnd() * 64);
}

function MultiHitDamageArt(palette: MultiHitDamagePalette) {
  return function Component({ registerRef, payload, portalTarget }: DomArtComponentProps) {
    const hitCount = hitCountFrom(palette, payload);
    const damage = payload?.damage as number | undefined;
    const crit = Boolean(payload?.crit);
    const onSelf = Boolean(payload?.onSelf);
    const dmgSlices = damage !== undefined && damage > 0 ? splitDamage(damage, hitCount) : undefined;

    return createPortal(
      <>
        {dmgSlices &&
          Array.from({ length: hitCount }).map((_, i) => (
            <div key={i} ref={(el) => registerRef(`dmg-${i}-pos`, el)} style={FREE_POS_STYLE}>
              <div
                ref={(el) => registerRef(`dmg-${i}`, el)}
                className={`${palette.dmgClass}${crit ? ` ${palette.dmgClass}--crit` : ""}${onSelf ? ` ${palette.dmgClass}--self` : ""}`}
                style={{ "--dmgx": `${jitterFor(palette, i)}px` } as CSSProperties}
              >
                {dmgSlices[i]}
              </div>
            </div>
          ))}
        {dmgSlices && (
          <div ref={(el) => registerRef("total-pos", el)} style={FREE_POS_STYLE}>
            <div ref={(el) => registerRef("total", el)} className={`${palette.totalClass}${crit ? ` ${palette.totalClass}--crit` : ""}`}>
              {damage}
            </div>
          </div>
        )}
      </>,
      portalTarget,
    );
  };
}

function updateMultiHitDamage(palette: MultiHitDamagePalette, refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const hitCount = hitCountFrom(palette, ctx.payload);
  const t = ctx.elapsedMs;
  const totalEl = refs.total as HTMLDivElement | undefined;
  let hitsLanded = Number(totalEl?.dataset.hitsLanded ?? "0");

  for (let i = 0; i < hitCount; i++) {
    const delayMs = i * palette.staggerMs;
    const local = t - delayMs;
    const alive = local >= 0 && local < palette.impactAtMs + palette.damageNumberMs;

    const dmgPosEl = refs[`dmg-${i}-pos`] as HTMLDivElement | undefined;
    if (dmgPosEl) dmgPosEl.style.display = alive ? "block" : "none";
    if (!alive) continue;

    const screen = ctx.projectLocalOffset(0, (DMG_SPAWN_Y + i * DMG_STACK_STEP) * ctx.targetScale, 0);
    if (screen && dmgPosEl) dmgPosEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;

    const dmgEl = refs[`dmg-${i}`] as HTMLDivElement | undefined;
    if (local >= palette.impactAtMs && dmgEl && !dmgEl.classList.contains(`${palette.dmgClass}--impact`)) {
      dmgEl.classList.add(`${palette.dmgClass}--impact`);
      hitsLanded++;
      if (totalEl) totalEl.dataset.hitsLanded = String(hitsLanded);
      // `dmgEl` só entra aqui uma vez por hit `i` (a própria checagem da
      // classe `--impact` acima já garante isso) — `<skill>_hit.mp3` é UM
      // golpe, toca em CADA pouso real, ver `audio/mage/multiHitCastAudio.ts`.
      if (ctx.skillId !== undefined) aoImpactoMultiHit(ctx.skillId);
    }
  }

  if (hitsLanded >= hitCount && totalEl && !totalEl.dataset.totalTriggeredAt) {
    totalEl.dataset.totalTriggeredAt = String(t);
  }
  const totalTriggeredAt = totalEl?.dataset.totalTriggeredAt ? Number(totalEl.dataset.totalTriggeredAt) : undefined;
  const totalPosEl = refs["total-pos"] as HTMLDivElement | undefined;
  if (totalPosEl) {
    const totalVisible = totalTriggeredAt !== undefined && t - totalTriggeredAt < palette.totalVisibleMs;
    totalPosEl.style.display = totalVisible ? "block" : "none";
    if (totalVisible) {
      const screen = ctx.projectLocalOffset(0, (palette.headY + TOTAL_GAP_ABOVE_HEAD) * ctx.targetScale, 0);
      if (screen) totalPosEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;
    }
  }
}

/** registra a paleta de UMA skill — substitui a chamada solta
 * `registerDomArt("<skill>_dmgnum", {Component, update})` que cada
 * arquivo fazia com um componente/update PRÓPRIO; agora é 1 linha por
 * skill em vez de ~110. */
export function registerMultiHitDamageArt(palette: MultiHitDamagePalette): void {
  registerDomArt(palette.artKey, {
    Component: MultiHitDamageArt(palette),
    update: (refs, ctx) => updateMultiHitDamage(palette, refs, ctx),
  });
}
