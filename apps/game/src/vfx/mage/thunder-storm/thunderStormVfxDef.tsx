import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { defineVfx } from "../../core/registry";
import { registerDomArt } from "../../core/renderers/domArtRegistry";
import { bindSkillVfx } from "../../core/registry";
import type { DomArtComponentProps, DomArtRefs, DomArtUpdateCtx } from "../../core/renderers/domArtRegistry";
import { aoImpactoMultiHit } from "../../../audio/mage/multiHitCastAudio";
import { thunderStormTotalMs } from "../multiHitShared";
import { createSeededRng } from "../../core/particleMath";

/**
 * Thunder Storm (MG_THUNDERSTORM) — MIGRADA pro VFX Core (leia1.txt,
 * Fase 3, última das 5 provas). Substitui `ThunderStormImpact.tsx`
 * (removido). O CAST elétrico (`ThunderStormCastElectric.tsx`) continua
 * vivo de propósito — Light Bolt (`MG_LIGHTNINGBOLT`) ainda o usa
 * (`vfx/SkillVfx.tsx: CAST_VFX`), e migrar Light Bolt é escopo da Fase 5,
 * não desta. `thunder_storm_cast` (abaixo) é a MESMA arte, movida agora
 * pro Core só para Thunder Storm — quando Light Bolt migrar, sua definição
 * aponta pro MESMO `vfxId`, e o componente antigo é removido de vez.
 *
 * `thunder_storm_impact` — `anchor:"entity"` (segue o ALVO, o raio cai nele
 * de cima) + `coalesce:{by:"target"}` — item 14 do pedido ("1 raio por mob
 * acertado, nunca vários VFX pro mesmo hit"): pacote repetido pro MESMO
 * alvo numa janela curta funde na instância viva em vez de abrir um raio
 * novo. A rede desta skill já entrega os hits num pacote SÓ (`hits`
 * calculado client-side por nível, não N pacotes por pulso — auditoria
 * confirmada em `net/useWorldEvents.ts`), então isto é uma trava
 * defensiva: nunca dois raios simultâneos no mesmo mob, mesmo num
 * recast/retry de rede.
 *
 * Números de dano (cascata por hit + total) permanecem DENTRO da arte —
 * exceção documentada (leia1.txt: "priorize a arquitetura do Core e
 * registre a exceção"): o feed compartilhado (`net/damageFeed`) só tem UM
 * estilo (`dmg-num--skill`, amarelo grande), e a cascata desta skill usa
 * DOIS (números pequenos gelados por hit + um total grande amarelo) — sair
 * do VFX pra o feed perderia a distinção visual. Continua 100% dentro do
 * MESMO `DomRenderer`/registro de arte, nunca uma segunda arquitetura.
 */

// ---------------------------------------------------------------- cast (compartilhado com Light Bolt)

const CAST_FADE_IN_FRAC = 0.2;
const CAST_RELEASE_FRAC = 0.86;
const CAST_SPARK_COUNT = 8;
const CAST_ARC_COUNT = 4;
const CAST_RISE_COUNT = 5;

interface OrbitSpec {
  angleDeg: number;
  radiusPx: number;
  risePx: number;
  durMs: number;
  delayMs: number;
}

function buildOrbit(seed: number, count: number, radiusBase: number, radiusJitter: number): OrbitSpec[] {
  const out: OrbitSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < count; i++) {
    out.push({
      angleDeg: (i / count) * 360 + rnd() * 40,
      radiusPx: radiusBase + rnd() * radiusJitter,
      risePx: i % 2 === 0 ? 20 + rnd() * 14 : 4 + rnd() * 6,
      durMs: 500 + rnd() * 320,
      delayMs: rnd() * 400,
    });
  }
  return out;
}

interface ArcSpec {
  rotateDeg: number;
  lenPx: number;
  durMs: number;
  delayMs: number;
}

function buildArcs(seed: number): ArcSpec[] {
  const out: ArcSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < CAST_ARC_COUNT; i++) {
    out.push({ rotateDeg: (i / CAST_ARC_COUNT) * 360 + rnd() * 50, lenPx: 26 + rnd() * 20, durMs: 260 + rnd() * 220, delayMs: rnd() * 500 });
  }
  return out;
}

function ThunderStormCastArt({ registerRef }: DomArtComponentProps) {
  const sparks = buildOrbit(Math.random() * 1000 + 1, CAST_SPARK_COUNT, 20, 16);
  const rising = buildOrbit(Math.random() * 1000 + 2, CAST_RISE_COUNT, 14, 22);
  const arcs = buildArcs(Math.random() * 1000 + 3);

  return (
    <div ref={(el) => registerRef("wrap", el)} className="ts-cast-elec">
      <div ref={(el) => registerRef("glow", el)} className="ts-cast-elec__glow" />
      {sparks.map((p, i) => (
        <div key={`sp${i}`} className="ts-cast-elec__spark" style={{ "--angle": `${p.angleDeg}deg`, "--radius": `${p.radiusPx}px`, "--pdur": `${p.durMs}ms`, "--pdelay": `${p.delayMs}ms` } as CSSProperties} />
      ))}
      {rising.map((p, i) => (
        <div key={`ri${i}`} className="ts-cast-elec__rise" style={{ "--angle": `${p.angleDeg}deg`, "--radius": `${p.radiusPx}px`, "--rise": `${p.risePx * 2.4}px`, "--pdur": `${p.durMs * 1.6}ms`, "--pdelay": `${p.delayMs}ms` } as CSSProperties} />
      ))}
      {arcs.map((a, i) => (
        <div key={`arc${i}`} className="ts-cast-elec__arc" style={{ "--rot": `${a.rotateDeg}deg`, "--len": `${a.lenPx}px`, "--pdur": `${a.durMs}ms`, "--pdelay": `${a.delayMs}ms` } as CSSProperties} />
      ))}
      <div className="ts-cast-elec__burst" />
    </div>
  );
}

function updateThunderStormCast(refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const wrap = refs.wrap as HTMLDivElement | undefined;
  const glow = refs.glow as HTMLDivElement | undefined;
  if (!wrap) return;
  const total = ctx.lifetimeMs !== null ? Math.max(200, ctx.lifetimeMs) : 3000;
  const life = Math.min(1, ctx.elapsedMs / total);
  wrap.style.opacity = life < CAST_FADE_IN_FRAC ? String(life / CAST_FADE_IN_FRAC) : "1";
  glow?.style.setProperty("--intensity", String(0.45 + life * 0.75));
  if (life >= CAST_RELEASE_FRAC) wrap.classList.add("ts-cast-elec--release");
}

registerDomArt("thunder_storm_cast", { Component: ThunderStormCastArt, update: updateThunderStormCast });

defineVfx({ id: "thunder_storm_cast", renderer: "dom", anchor: "caster-tip", dom: { art: "thunder_storm_cast" } });

// ---------------------------------------------------------------- impact

const THUNDER_MAX_PULSES = 5;
// pedido 2026-08-19 (sincronizar velocidade da animação/áudio): era 260 —
// manter os DOIS lados em sync ao mudar, ver `../multiHitShared.ts`.
const THUNDER_PULSE_STAGGER_MS = 170;
const THUNDER_PULSE_DAMAGE_NUMBER_MS = 1000;
const THUNDER_TOTAL_VISIBLE_MS = 1500;
const BODY_Y = 0.05;
const SHOCK_Y = 1.1;
const HEAD_TOP_Y = 1.8;
const TOTAL_GAP_ABOVE_HEAD = 0.4;
const DMG_SPAWN_Y = 1.3;
const DMG_STACK_STEP = 0.08;
const BOLT_TOP_Y = 6.2;
const GROUND_ARC_COUNT = 7;

// `thunderStormTotalMs` (duração de rede) mora em `../multiHitShared.ts`
// agora, não aqui — `net/useWorldEvents.ts`/`multiHitRegistry.ts` nunca
// deveriam puxar o registro do VFX Core só pra ler um número de duração.
// Reexportado aqui só por conveniência de quem já importa deste arquivo.
export { thunderStormTotalMs };

function splitDamage(total: number, hits: number): number[] {
  const base = Math.floor(total / hits);
  const resto = total - base * hits;
  return Array.from({ length: hits }, (_, i) => base + (i === hits - 1 ? resto : 0));
}

function pulseCountFrom(payload: Record<string, unknown> | undefined): number {
  const hits = (payload?.hits as number | undefined) ?? THUNDER_MAX_PULSES;
  return Math.min(THUNDER_MAX_PULSES, Math.max(1, hits));
}

const FREE_POS_STYLE: CSSProperties = { position: "absolute", left: 0, top: 0, pointerEvents: "none" };

function ThunderStormImpactArt({ registerRef, targetScale, payload, portalTarget }: DomArtComponentProps) {
  const pulseCount = pulseCountFrom(payload);
  const damage = payload?.damage as number | undefined;
  const crit = Boolean(payload?.crit);
  const onSelf = Boolean(payload?.onSelf);
  const dmgSlices = damage !== undefined && damage > 0 ? splitDamage(damage, pulseCount) : undefined;
  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return createPortal(
    <>
      <div ref={(el) => registerRef("bolt-pos", el)} style={FREE_POS_STYLE}>
        <div ref={(el) => registerRef("bolt-wrap", el)} className="ts-bolt-wrap" style={tscaleStyle}>
          <div className="ts-bolt__glow" />
          <div className="ts-bolt__core" />
          <div className="ts-bolt__branch" style={{ "--by": "28%", "--brot": "-34deg" } as CSSProperties} />
          <div className="ts-bolt__branch" style={{ "--by": "52%", "--brot": "28deg" } as CSSProperties} />
          <div className="ts-bolt__branch" style={{ "--by": "74%", "--brot": "-22deg" } as CSSProperties} />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="ts-bolt__mote" style={{ "--mangle": `${i * 60}deg`, "--mdelay": `${i * 90}ms` } as CSSProperties} />
          ))}
        </div>
      </div>

      {Array.from({ length: pulseCount }).map((_, i) => {
        const rnd = createSeededRng(1000 + i);
        const groundArcs = Array.from({ length: GROUND_ARC_COUNT }).map((_a, ai) => ({
          angleDeg: (ai / GROUND_ARC_COUNT) * 360 + rnd() * 30,
          lenPx: 46 + rnd() * 46,
        }));
        return (
          <div key={i}>
            <div ref={(el) => registerRef(`pulse-${i}-ground-pos`, el)} style={FREE_POS_STYLE}>
              <div ref={(el) => registerRef(`pulse-${i}-ground`, el)} className="ts-ground" style={tscaleStyle}>
                <div className="ts-ground__flash" />
                <div className="ts-ground__ring" />
                {groundArcs.map((a, ai) => (
                  <div key={ai} className="ts-ground__branch" style={{ "--gangle": `${a.angleDeg}deg`, "--glen": `${a.lenPx}px` } as CSSProperties} />
                ))}
              </div>
            </div>
            <div ref={(el) => registerRef(`pulse-${i}-shock-pos`, el)} style={FREE_POS_STYLE}>
              <div ref={(el) => registerRef(`pulse-${i}-shock`, el)} className="ts-shock" style={tscaleStyle}>
                <div className="ts-shock__flash" />
                {Array.from({ length: 5 }).map((_s, si) => (
                  <div key={si} className="ts-shock__arc" style={{ "--sangle": `${si * 72}deg` } as CSSProperties} />
                ))}
                {Array.from({ length: 6 }).map((_p, pi) => (
                  <div key={pi} className="ts-shock__spark" style={{ "--pangle": `${pi * 60 + 30}deg` } as CSSProperties} />
                ))}
              </div>
            </div>
            {dmgSlices && (
              <div ref={(el) => registerRef(`pulse-${i}-dmg-pos`, el)} style={FREE_POS_STYLE}>
                <div
                  ref={(el) => registerRef(`pulse-${i}-dmg`, el)}
                  className={`ts-dmgnum${crit ? " ts-dmgnum--crit" : ""}${onSelf ? " ts-dmgnum--self" : ""}`}
                  style={{ "--dmgx": `${(rnd() - 0.5) * 64}px` } as CSSProperties}
                >
                  {dmgSlices[i]}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {dmgSlices && (
        <div ref={(el) => registerRef("total-pos", el)} style={FREE_POS_STYLE}>
          <div ref={(el) => registerRef("total", el)} className={`ts-total${crit ? " ts-total--crit" : ""}`}>
            {damage}
          </div>
        </div>
      )}
    </>,
    portalTarget,
  );
}

function updateThunderStormImpact(refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const pulseCount = pulseCountFrom(ctx.payload);
  const t = ctx.elapsedMs;
  const lastPulseAtMs = (pulseCount - 1) * THUNDER_PULSE_STAGGER_MS;
  const boltDissipateAtMs = lastPulseAtMs + 420;

  // raio único — sempre em cima do alvo, fixo em Y local
  const boltPosEl = refs["bolt-pos"] as HTMLDivElement | undefined;
  if (boltPosEl) {
    const screen = ctx.projectLocalOffset(0, BOLT_TOP_Y * ctx.targetScale, 0);
    if (screen) boltPosEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;
  }
  if (t >= boltDissipateAtMs) (refs["bolt-wrap"] as HTMLDivElement | undefined)?.classList.add("ts-bolt-wrap--gone");

  const boltWrapEl = refs["bolt-wrap"] as HTMLDivElement | undefined;
  let hitsLanded = Number(boltWrapEl?.dataset.hitsLanded ?? "0");

  for (let i = 0; i < pulseCount; i++) {
    const delayMs = i * THUNDER_PULSE_STAGGER_MS;
    const local = t - delayMs;
    const alive = local >= 0 && local < THUNDER_PULSE_DAMAGE_NUMBER_MS;

    const groundPosEl = refs[`pulse-${i}-ground-pos`] as HTMLDivElement | undefined;
    const shockPosEl = refs[`pulse-${i}-shock-pos`] as HTMLDivElement | undefined;
    const dmgPosEl = refs[`pulse-${i}-dmg-pos`] as HTMLDivElement | undefined;
    if (groundPosEl) groundPosEl.style.display = alive ? "block" : "none";
    if (shockPosEl) shockPosEl.style.display = alive ? "block" : "none";
    if (dmgPosEl) dmgPosEl.style.display = alive ? "block" : "none";
    if (!alive) continue;

    const groundScreen = ctx.projectLocalOffset(0, BODY_Y * ctx.targetScale, 0);
    if (groundScreen && groundPosEl) groundPosEl.style.transform = `translate3d(${groundScreen.x}px, ${groundScreen.y}px, 0) scale(${groundScreen.scale})`;
    const shockScreen = ctx.projectLocalOffset(0, SHOCK_Y * ctx.targetScale, 0);
    if (shockScreen && shockPosEl) shockPosEl.style.transform = `translate3d(${shockScreen.x}px, ${shockScreen.y}px, 0) scale(${shockScreen.scale})`;
    if (dmgPosEl) {
      const dmgScreen = ctx.projectLocalOffset(0, (DMG_SPAWN_Y + i * DMG_STACK_STEP) * ctx.targetScale, 0);
      if (dmgScreen) dmgPosEl.style.transform = `translate3d(${dmgScreen.x}px, ${dmgScreen.y}px, 0) scale(${dmgScreen.scale})`;
    }

    const groundEl = refs[`pulse-${i}-ground`] as HTMLDivElement | undefined;
    if (groundEl && !groundEl.classList.contains("ts-ground--impact")) {
      groundEl.classList.add("ts-ground--impact");
      (refs[`pulse-${i}-shock`] as HTMLDivElement | undefined)?.classList.add("ts-shock--impact");
      (refs[`pulse-${i}-dmg`] as HTMLDivElement | undefined)?.classList.add("ts-dmgnum--impact");
      hitsLanded++;
      if (boltWrapEl) boltWrapEl.dataset.hitsLanded = String(hitsLanded);
      // `groundEl` só entra aqui uma vez por pulso `i` (a checagem da classe
      // `--impact` acima já garante isso, mesmo com Thunder Storm coalescendo
      // recasts na MESMA instância) — `<skill>_hit.mp3` toca em CADA pouso
      // real, ver `audio/mage/multiHitCastAudio.ts`.
      if (ctx.skillId !== undefined) aoImpactoMultiHit(ctx.skillId);
    }
  }

  if (hitsLanded >= pulseCount && boltWrapEl && !boltWrapEl.dataset.totalTriggeredAt) {
    boltWrapEl.dataset.totalTriggeredAt = String(t);
  }
  const totalTriggeredAt = boltWrapEl?.dataset.totalTriggeredAt ? Number(boltWrapEl.dataset.totalTriggeredAt) : undefined;
  const totalPosEl = refs["total-pos"] as HTMLDivElement | undefined;
  if (totalPosEl) {
    const totalVisible = totalTriggeredAt !== undefined && t - totalTriggeredAt < THUNDER_TOTAL_VISIBLE_MS;
    totalPosEl.style.display = totalVisible ? "block" : "none";
    if (totalVisible) {
      // `display:none → block` já dispara `tsTotalShow` sozinho (CSS
      // reinicia animação ao voltar a ficar visível) — mesmo comportamento
      // implícito que o componente antigo já dependia, nenhuma classe extra.
      const screen = ctx.projectLocalOffset(0, (HEAD_TOP_Y + TOTAL_GAP_ABOVE_HEAD) * ctx.targetScale, 0);
      if (screen) totalPosEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;
    }
  }
}

registerDomArt("thunder_storm_impact", { Component: ThunderStormImpactArt, update: updateThunderStormImpact });

defineVfx({
  id: "thunder_storm_impact",
  renderer: "dom",
  anchor: "entity",
  dom: { art: "thunder_storm_impact" },
  coalesce: { by: "target", windowMs: 400 },
});

bindSkillVfx("MG_THUNDERSTORM", "cast", "thunder_storm_cast");
bindSkillVfx("MG_THUNDERSTORM", "impact", "thunder_storm_impact");
