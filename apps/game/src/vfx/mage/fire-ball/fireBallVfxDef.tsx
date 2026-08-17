import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { defineVfx } from "../../core/registry";
import { registerDomArt } from "../../core/renderers/domArtRegistry";
import { bindSkillVfx } from "../../core/registry";
import type { DomArtComponentProps, DomArtRefs, DomArtUpdateCtx } from "../../core/renderers/domArtRegistry";
import { createSeededRng } from "../../core/particleMath";
import { TrailEchoes, updateTrailEchoes, type TrailStyle } from "../../core/primitives/trailDom";

/**
 * Fire Ball (MG_FIREBALL, id 17) — MIGRADA pro VFX Core (leia1.txt,
 * Fase 3). Substitui `FireBallCastFire.tsx`/`FireBallImpact.tsx`
 * (removidos). DUAS `VfxDefinition` (cast + impact), como a skill sempre
 * teve dois eventos de rede distintos — nunca um componente monolítico.
 *
 * `fireball_cast` — `anchor:"caster-tip"`: o Core já resolve a posição
 * (ponta do cajado, com fallback pro peito) TODO quadro sozinho
 * (`anchor.ts`); a arte só precisa da órbita de partículas em CSS (já era
 * 100% CSS `@keyframes`, nenhum JS por quadro) + o fade-in/glow/liberação.
 *
 * `fireball_impact` — `anchor:"caster-to-target"`: âncora fica no ALVO
 * (posição real do efeito), `ctx.casterOffset` dá de onde a bola PARTIU
 * (congelado no spawn, mesma semântica de `casterOffsetX/Y/Z` antigo).
 * Bola + 14 ecos + explosão + 5 estouros decorativos são SUB-PONTOS dentro
 * da MESMA instância — cada um projetado à mão via `ctx.projectLocalOffset`
 * e portado pro container sem transform (`portalTarget`), MESMA técnica de
 * `oracleVfxDef.tsx`.
 *
 * Sem `damage`/`crit`/`onSelf`/`hits` de propósito — Fire Ball não é
 * multi-hit (`hits:1` no skill_db), o dano sai pelo `damageFeed` normal
 * (`net/useWorldEvents.ts`, já assim antes da migração).
 */

const FIREBALL_FLIGHT_MS = 480;
const IMPACT_FRACTION = 0.93;
const IMPACT_AT_MS = FIREBALL_FLIGHT_MS * IMPACT_FRACTION;
const IMPACT_TAIL_MS = 650;
const ARRIVE_Y = 1.0;
const NO_DATA_Y_FALLBACK = 1.0;
const ECHO_LAGS = [0.03, 0.06, 0.1, 0.15, 0.21, 0.28, 0.36, 0.45, 0.55, 0.66, 0.78, 0.91, 1.05, 1.08];
const DEFAULT_AREA_RADIUS = 2;
const DECOY_COUNT = 5;

/** receita visual do rastro da bola — valores byte-idênticos ao antigo
 * `.fbi-echo` (`legacyVfxArt.ts`, removido: agora vive como dado, não CSS
 * duplicada — `vfx-trail-echo` compartilhada com Oráculo). Único ponto
 * onde Fire Ball difere do Oráculo na primitive: escala por `--tscale`
 * (`tscaleStyle`, ver `FireBallImpactArt`) — Oráculo nunca setava essa
 * variável no eco original, preservado passando `undefined` lá. */
const FIREBALL_TRAIL_STYLE: TrailStyle = {
  widthPx: 80,
  heightPx: 32,
  opacityBase: 0.8,
  opacityStep: 0.052,
  scaleStep: 0.045,
  glowPx: 5,
  glowColor: "rgba(255, 140, 40, 0.85)",
  strokeColor: "#ff9a3d",
  strokeWidth: 4.5,
  pathEven: "M2,16 Q13,2 22,16 T42,16 T62,16 T78,16",
  pathOdd: "M2,16 Q13,30 22,16 T42,16 T62,16 T78,16",
};

interface Vec3Local {
  x: number;
  y: number;
  z: number;
}

/** posição LOCAL da bola no progresso `u` (0=caster,1=alvo) — reta, sem
 * arco nem desvio lateral (pedido original: "sair reta do usuário ao
 * inimigo"). */
function ballLocalPos(u: number, start: Vec3Local, out: Vec3Local): void {
  const eased = u * u * (3 - 2 * u);
  out.x = start.x * (1 - eased);
  out.y = start.y * (1 - eased) + ARRIVE_Y * eased;
  out.z = start.z * (1 - eased);
}

interface DecoySpec {
  dx: number;
  dz: number;
  appearAtMs: number;
}

function buildDecoys(seed: number, radius: number): DecoySpec[] {
  const out: DecoySpec[] = [];
  const raioUtil = Math.max(0.6, radius);
  const rnd = createSeededRng(seed);
  for (let i = 0; i < DECOY_COUNT; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = 0.6 + rnd() * (raioUtil - 0.6);
    out.push({ dx: Math.cos(angle) * r, dz: Math.sin(angle) * r, appearAtMs: 40 + rnd() * 180 });
  }
  return out;
}

const FREE_POS_STYLE: CSSProperties = { position: "absolute", left: 0, top: 0, pointerEvents: "none" };

// ---------------------------------------------------------------- cast

const CAST_FADE_IN_FRAC = 0.2;
const CAST_RELEASE_FRAC = 0.88;
const CAST_EMBER_COUNT = 8;
const CAST_SPARK_COUNT = 6;
const CAST_FLAME_COUNT = 5;

interface CastParticleSpec {
  angleDeg: number;
  radiusPx: number;
  risePx: number;
  durMs: number;
  delayMs: number;
}

function buildCastParticles(seed: number, count: number, radiusBase: number, radiusJitter: number): CastParticleSpec[] {
  const out: CastParticleSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < count; i++) {
    out.push({
      angleDeg: (i / count) * 360 + rnd() * 40,
      radiusPx: radiusBase + rnd() * radiusJitter,
      risePx: i % 2 === 0 ? 26 + rnd() * 16 : 6 + rnd() * 8,
      durMs: 720 + rnd() * 440,
      delayMs: rnd() * 520,
    });
  }
  return out;
}

function FireBallCastArt({ registerRef }: DomArtComponentProps) {
  const embers = buildCastParticles(Math.random() * 1000 + 1, CAST_EMBER_COUNT, 26, 22);
  const sparks = buildCastParticles(Math.random() * 1000 + 2, CAST_SPARK_COUNT, 20, 26);
  const flames = buildCastParticles(Math.random() * 1000 + 3, CAST_FLAME_COUNT, 30, 12);

  return (
    <div ref={(el) => registerRef("wrap", el)} className="fb-cast-fire">
      <div ref={(el) => registerRef("glow", el)} className="fb-cast-fire__glow" />
      <div className="fb-cast-fire__core" />
      {embers.map((p, i) => (
        <div
          key={`e${i}`}
          className="fb-cast-fire__ember"
          style={{ "--angle": `${p.angleDeg}deg`, "--radius": `${p.radiusPx}px`, "--rise": `${p.risePx}px`, "--pdur": `${p.durMs}ms`, "--pdelay": `${p.delayMs}ms` } as CSSProperties}
        />
      ))}
      {sparks.map((p, i) => (
        <div
          key={`s${i}`}
          className="fb-cast-fire__spark"
          style={{ "--angle": `${p.angleDeg}deg`, "--radius": `${p.radiusPx}px`, "--pdur": `${Math.max(220, p.durMs * 0.4)}ms`, "--pdelay": `${p.delayMs}ms` } as CSSProperties}
        />
      ))}
      {flames.map((p, i) => (
        <div
          key={`f${i}`}
          className="fb-cast-fire__flame"
          style={{ "--angle": `${p.angleDeg}deg`, "--radius": `${p.radiusPx}px`, "--pdur": `${p.durMs * 1.3}ms`, "--pdelay": `${p.delayMs}ms` } as CSSProperties}
        />
      ))}
      <div className="fb-cast-fire__burst" />
      {embers.slice(0, 5).map((_, i) => (
        <div key={`fw${i}`} className="fb-cast-fire__forward" style={{ "--fwangle": `${i * 18 - 36}deg` } as CSSProperties} />
      ))}
    </div>
  );
}

function updateFireBallCast(refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const wrap = refs.wrap as HTMLDivElement | undefined;
  const glow = refs.glow as HTMLDivElement | undefined;
  if (!wrap) return;
  const total = ctx.lifetimeMs !== null ? Math.max(200, ctx.lifetimeMs) : 3000;
  const life = Math.min(1, ctx.elapsedMs / total);
  wrap.style.opacity = life < CAST_FADE_IN_FRAC ? String(life / CAST_FADE_IN_FRAC) : "1";
  glow?.style.setProperty("--intensity", String(0.55 + life * 0.85));
  if (life >= CAST_RELEASE_FRAC) wrap.classList.add("fb-cast-fire--release");
}

registerDomArt("fireball_cast", { Component: FireBallCastArt, update: updateFireBallCast });

defineVfx({
  id: "fireball_cast",
  renderer: "dom",
  anchor: "caster-tip",
  dom: { art: "fireball_cast" },
});

// ---------------------------------------------------------------- impact

function FireBallImpactArt({ registerRef, targetScale, payload, portalTarget }: DomArtComponentProps) {
  const areaRadius = (payload?.areaRadius as number | undefined) ?? DEFAULT_AREA_RADIUS;
  const decoys = buildDecoys(Math.random(), areaRadius);
  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return createPortal(
    <>
      <TrailEchoes
        spec={{ count: ECHO_LAGS.length, style: FIREBALL_TRAIL_STYLE }}
        refPrefix="echo"
        registerRef={registerRef}
        tscaleStyle={tscaleStyle}
      />
      <div ref={(el) => registerRef("ball-pos", el)} style={{ ...FREE_POS_STYLE, display: "none" }}>
        <div className="fbi-ball" style={tscaleStyle}>
          <div className="fbi-ball__glow" />
          <div className="fbi-ball__core" />
          <div className="fbi-ball__mid" />
          <div className="fbi-ball__rim" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`t${i}`} className="fbi-ball__tendril" style={{ "--tangle": `${i * 90}deg` } as CSSProperties} />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`ej${i}`} className="fbi-ball__eject" style={{ "--eangle": `${i * 72}deg` } as CSSProperties} />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`sw${i}`} className="fbi-ball__swirl" style={{ "--sangle": `${i * 60}deg`, "--sdelay": `${i * -55}ms` } as CSSProperties} />
          ))}
        </div>
      </div>
      <div ref={(el) => registerRef("blast-pos", el)} style={FREE_POS_STYLE}>
        <div ref={(el) => registerRef("blast", el)} className="fbi-blast" style={tscaleStyle}>
          <div className="fbi-blast__flash" />
          <div className="fbi-blast__ring fbi-blast__ring--1" />
          <div className="fbi-blast__ring fbi-blast__ring--2" />
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={`f${i}`} className="fbi-blast__frag" style={{ "--fangle": `${i * 36}deg` } as CSSProperties} />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`u${i}`} className="fbi-blast__up" style={{ "--uangle": `${i * 60 - 90}deg` } as CSSProperties} />
          ))}
        </div>
      </div>
      {decoys.map((d, i) => (
        <div
          key={`decoy${i}`}
          ref={(el) => registerRef(`decoy-${i}-pos`, el)}
          style={{ ...FREE_POS_STYLE, display: "none", "--ddx": String(d.dx), "--ddz": String(d.dz), "--dappear": String(d.appearAtMs) } as CSSProperties}
        >
          <div ref={(el) => registerRef(`decoy-${i}`, el)} className="fbi-decoy" style={{ "--tscale": targetScale * 0.6 } as CSSProperties}>
            <div className="fbi-decoy__flash" />
            <div className="fbi-decoy__ring" />
          </div>
        </div>
      ))}
    </>,
    portalTarget,
  );
}

const tmpLocal: Vec3Local = { x: 0, y: 0, z: 0 };

function updateFireBallImpact(refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const hasCasterPos = ctx.casterOffset !== null && (ctx.casterOffset.x !== 0 || ctx.casterOffset.z !== 0);
  const startOffset: Vec3Local = hasCasterPos ? ctx.casterOffset! : { x: 0, y: NO_DATA_Y_FALLBACK, z: 2.4 };

  const t = ctx.elapsedMs;
  const flying = t < FIREBALL_FLIGHT_MS;
  const ballPosEl = refs["ball-pos"] as HTMLDivElement | undefined;
  if (ballPosEl) ballPosEl.style.display = flying ? "block" : "none";

  if (flying && ballPosEl) {
    const u = Math.min(1, t / FIREBALL_FLIGHT_MS);
    ballLocalPos(u, startOffset, tmpLocal);
    const dy = ctx.terrainFollowDeltaY(tmpLocal.x, tmpLocal.z);
    const screen = ctx.projectLocalOffset(tmpLocal.x, tmpLocal.y + dy, tmpLocal.z);
    if (screen) ballPosEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;

    updateTrailEchoes(refs, "echo", ECHO_LAGS.length, (i) => {
      ballLocalPos(Math.max(0, u - ECHO_LAGS[i]!), startOffset, tmpLocal);
      const edy = ctx.terrainFollowDeltaY(tmpLocal.x, tmpLocal.z);
      return { x: tmpLocal.x, y: tmpLocal.y + edy, z: tmpLocal.z };
    }, ctx.projectLocalOffset);
  } else {
    updateTrailEchoes(refs, "echo", ECHO_LAGS.length, () => null, ctx.projectLocalOffset);
  }

  // explosão — sempre no alvo (offset local fixo), dispara UMA VEZ (classList.add é idempotente)
  const blastPosEl = refs["blast-pos"] as HTMLDivElement | undefined;
  if (blastPosEl) {
    const screen = ctx.projectLocalOffset(0, ARRIVE_Y * ctx.targetScale, 0);
    if (screen) blastPosEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;
  }
  if (t >= IMPACT_AT_MS) (refs.blast as HTMLDivElement | undefined)?.classList.add("fbi-blast--go");

  // estouros decorativos — posição local gravada em CSS vars (`--ddx`/`--ddz`), sorteada no Component
  for (let i = 0; i < DECOY_COUNT; i++) {
    const posEl = refs[`decoy-${i}-pos`] as HTMLDivElement | undefined;
    if (!posEl) continue;
    const dx = parseFloat(posEl.style.getPropertyValue("--ddx")) || 0;
    const dz = parseFloat(posEl.style.getPropertyValue("--ddz")) || 0;
    const appearAtMs = parseFloat(posEl.style.getPropertyValue("--dappear")) || 0;
    const localT = t - IMPACT_AT_MS - appearAtMs;
    const alive = localT >= -50 && localT < IMPACT_TAIL_MS;
    posEl.style.display = alive ? "block" : "none";
    if (!alive) continue;
    const dy = ctx.terrainFollowDeltaY(dx, dz);
    const screen = ctx.projectLocalOffset(dx, 0.15 + dy, dz);
    if (screen) posEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;
    if (localT >= 0) (refs[`decoy-${i}`] as HTMLDivElement | undefined)?.classList.add("fbi-decoy--go");
  }
}

registerDomArt("fireball_impact", { Component: FireBallImpactArt, update: updateFireBallImpact });

defineVfx({
  id: "fireball_impact",
  renderer: "dom",
  anchor: "caster-to-target",
  dom: { art: "fireball_impact" },
  lifetimeMs: IMPACT_AT_MS + IMPACT_TAIL_MS,
});

bindSkillVfx("MG_FIREBALL", "cast", "fireball_cast");
bindSkillVfx("MG_FIREBALL", "impact", "fireball_impact");
