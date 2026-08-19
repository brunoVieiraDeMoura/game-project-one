import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { multiHitTotalMs } from "../multiHitShared";
import { createSeededRng } from "../../core/particleMath";

/**
 * Fire Lance (MG_FIREBOLT) — lança de fogo em CSS puro, MESMA estrutura de
 * `mage/cold-bolt/ColdBoltImpact.tsx` (N hits escalonados pelo nível da
 * skill, dano repartido, cascata de números, total amarelo no último hit —
 * ver o docblock daquele arquivo pro raciocínio completo de timing/posição/
 * `<Html>`/escala por alvo, não duplicado aqui). Só o VFX — arte da lança e
 * do burst de impacto — é próprio de fogo; os NÚMEROS de dano usam a mesma
 * receita visual (só cor), porque o pedido foi reutilizar o sistema de dano
 * e trocar só o elemento.
 */

/** teto de lanças no nível MÁXIMO da skill — a quantidade de VERDADE por
 * lançamento vem do nível real (`getSkillProjectileCount`,
 * `vfx/mage/multiHitShared`), nunca fixa em 5 */
// teto REAL do skill_db (Lv10→10), não mais um chute de 5 (auditoria
// "count real" 2026-08-19).
export const FIRE_LANCE_MAX_HITS = 10;
/** pedido 2026-08-19 (sincronizar velocidade da animação/áudio): era 200,
 * mesma razão de `ColdBoltImpact.ICICLE_STAGGER_MS`. */
export const FIRE_LANCE_STAGGER_MS = 130;
export const FIRE_LANCE_FALL_MS = 560;
export const FIRE_LANCE_IMPACT_FRACTION = 0.82;
const IMPACT_AT_MS = FIRE_LANCE_FALL_MS * FIRE_LANCE_IMPACT_FRACTION;
export const FIRE_LANCE_DAMAGE_NUMBER_MS = 1000;
export const FIRE_LANCE_VISIBLE_MS = IMPACT_AT_MS + FIRE_LANCE_DAMAGE_NUMBER_MS;
export const FIRE_LANCE_TOTAL_VISIBLE_MS = 1500;
/** duração total que o efeito precisa ficar vivo no `vfxStore` PARA `hits`
 * lanças de verdade — mesma fórmula compartilhada do Cold Bolt/Thunder
 * Storm/Soul Strike, só com o timing próprio do fogo. */
export function fireLanceTotalMs(hits: number): number {
  return multiHitTotalMs(hits, FIRE_LANCE_STAGGER_MS, IMPACT_AT_MS, FIRE_LANCE_DAMAGE_NUMBER_MS, FIRE_LANCE_TOTAL_VISIBLE_MS);
}

function splitDamage(total: number, hits: number): number[] {
  const base = Math.floor(total / hits);
  const resto = total - base * hits;
  return Array.from({ length: hits }, (_, i) => base + (i === hits - 1 ? resto : 0));
}

const HEAD_Y = 5.5;
const BODY_Y = 0.65;
const SPREAD_RADIUS = 0.5;
const CONVERGE_RADIUS = 0;
const HEAD_TOP_Y = 1.8;
const TOTAL_GAP_ABOVE_HEAD = 0.4;
const DMG_SPAWN_Y = 1.3;
const DMG_STACK_STEP = 0.08;

interface LanceSpec {
  angle: number;
  delayMs: number;
  dmg?: number;
  dmgJitterPx: number;
  dmgStackY: number;
}

function buildSpecs(seed: number, hits: number, dmgSlices: number[] | undefined): LanceSpec[] {
  const specs: LanceSpec[] = [];
  for (let i = 0; i < hits; i++) {
    const angle = (i / hits) * Math.PI * 2 + seed * Math.PI * 2;
    specs.push({
      angle,
      delayMs: i * FIRE_LANCE_STAGGER_MS,
      dmg: dmgSlices?.[i],
      dmgJitterPx: (Math.random() - 0.5) * 64,
      dmgStackY: i * DMG_STACK_STEP,
    });
  }
  return specs;
}

export function FireLanceImpact({
  onHit,
  damage,
  crit,
  onSelf,
  targetScale = 1,
  hits = FIRE_LANCE_MAX_HITS,
}: {
  onHit?: (index: number) => void;
  damage?: number;
  crit?: boolean;
  onSelf?: boolean;
  targetScale?: number;
  /** quantidade REAL de lanças — vem do nível da skill
   * (`getSkillProjectileCount`, `net/useWorldEvents`), nunca fixa em 5. */
  hits?: number;
}) {
  useFireLanceStyles();
  const bornAt = useRef(performance.now());
  const hitCount = Math.min(FIRE_LANCE_MAX_HITS, Math.max(1, hits));
  const dmgSlices = useMemo(
    () => (damage !== undefined && damage > 0 ? splitDamage(damage, hitCount) : undefined),
    [damage, hitCount],
  );
  const specs = useMemo(() => buildSpecs(Math.random(), hitCount, dmgSlices), [hitCount, dmgSlices]);
  const totalRef = useRef<FinalTotalHandle>(null);
  const hitsLanded = useRef(0);

  const handleHit = (i: number) => {
    onHit?.(i);
    hitsLanded.current += 1;
    if (hitsLanded.current === hitCount) totalRef.current?.trigger();
  };

  return (
    <group name="fire-lance-impact">
      {specs.map((spec, i) => (
        <Lance
          key={i}
          spec={spec}
          bornAt={bornAt.current}
          crit={crit ?? false}
          onSelf={onSelf ?? false}
          targetScale={targetScale}
          onHit={() => handleHit(i)}
        />
      ))}
      {dmgSlices && <FinalTotal ref={totalRef} total={damage ?? 0} crit={crit ?? false} targetScale={targetScale} />}
    </group>
  );
}

const FRAGMENT_COUNT = 8;

interface FragmentSpec {
  fx: number;
  fy: number;
}

function buildFragments(seed: number): FragmentSpec[] {
  const out: FragmentSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < FRAGMENT_COUNT; i++) {
    const angle = ((i / FRAGMENT_COUNT) * 360 + rnd() * 24) * (Math.PI / 180);
    const dist = 60 + rnd() * 52;
    const fall = 16 + rnd() * 28;
    out.push({ fx: Math.cos(angle) * dist, fy: Math.sin(angle) * dist + fall });
  }
  return out;
}

/** partículas que sobem (brasas) — separadas dos fragmentos radiais: o
 * pedido pede as duas coisas ("fragmentos/centelhas" E "partículas
 * subindo"), o fragmento espalha, esta sobe reto com um pouco de deriva. */
const EMBER_RISE_COUNT = 6;
interface EmberRiseSpec {
  ex: number;
  delayMs: number;
}
function buildEmberRise(seed: number): EmberRiseSpec[] {
  const out: EmberRiseSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < EMBER_RISE_COUNT; i++) {
    out.push({ ex: (rnd() - 0.5) * 70, delayMs: rnd() * 120 });
  }
  return out;
}

function Lance({
  spec,
  bornAt,
  crit,
  onSelf,
  targetScale,
  onHit,
}: {
  spec: LanceSpec;
  bornAt: number;
  crit: boolean;
  onSelf: boolean;
  targetScale: number;
  onHit?: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const dmgWrap = useRef<HTMLDivElement>(null);
  const hit = useRef(false);
  const fragments = useMemo(() => buildFragments(Math.random() * 1000 + 1), []);
  const embers = useMemo(() => buildEmberRise(Math.random() * 1000 + 2), []);

  useFrame(() => {
    const g = group.current;
    const wrapEl = wrap.current;
    const el = art.current;
    const dmgEl = dmgWrap.current;
    if (!g || !wrapEl || !el) return;
    const t = performance.now() - bornAt - spec.delayMs;
    const alive = t >= 0 && t < FIRE_LANCE_VISIBLE_MS;
    wrapEl.style.display = alive ? "block" : "none";
    if (dmgEl) dmgEl.style.display = alive ? "block" : "none";
    if (!alive) return;

    const fallLife = Math.min(1, t / FIRE_LANCE_FALL_MS);

    const dirX = Math.cos(spec.angle);
    const dirZ = Math.sin(spec.angle);
    const r = SPREAD_RADIUS + (CONVERGE_RADIUS - SPREAD_RADIUS) * fallLife;
    const y = HEAD_Y + (BODY_Y - HEAD_Y) * fallLife;
    g.position.set(dirX * r, y, dirZ * r);

    const scale = 0.75 + fallLife * 0.3;
    el.style.transform = `scale(${scale})`;
    el.style.opacity =
      fallLife > FIRE_LANCE_IMPACT_FRACTION
        ? String(Math.max(0, 1 - (fallLife - FIRE_LANCE_IMPACT_FRACTION) / (1 - FIRE_LANCE_IMPACT_FRACTION)))
        : "1";

    if (!hit.current && fallLife >= FIRE_LANCE_IMPACT_FRACTION) {
      hit.current = true;
      wrapEl.classList.add("fl-fire-wrap--impact");
      dmgEl?.classList.add("fl-fire-dmgnum--impact");
      onHit?.();
    }
  });

  useEffect(() => {
    hit.current = false;
    wrap.current?.classList.remove("fl-fire-wrap--impact");
    dmgWrap.current?.classList.remove("fl-fire-dmgnum--impact");
  }, [spec]);

  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return (
    <group ref={group}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className="fl-fire-wrap" style={{ display: "none", ...tscaleStyle }}>
          <div ref={art} className="fl-fire-spike">
            <div className="fl-fire-spike__glow" />
            <div className="fl-fire-spike__flicker" />
            <div className="fl-fire-spike__body" />
          </div>
          <div className="fl-fire-hit">
            <div className="fl-fire-hit__ring" />
            <div className="fl-fire-hit__flash" />
            {fragments.map((f, i) => (
              <div key={`frag${i}`} className="fl-fire-hit__frag" style={{ "--fx": `${f.fx}px`, "--fy": `${f.fy}px` } as CSSProperties} />
            ))}
            {embers.map((e, i) => (
              <div
                key={`ember${i}`}
                className="fl-fire-hit__ember"
                style={{ "--ex": `${e.ex}px`, "--edelay": `${e.delayMs}ms` } as CSSProperties}
              />
            ))}
          </div>
        </div>
      </Html>
      {spec.dmg !== undefined && (
        <group position={[0, (DMG_SPAWN_Y + spec.dmgStackY) * targetScale, 0]}>
          <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
            <div
              ref={dmgWrap}
              className={`fl-fire-dmgnum${crit ? " fl-fire-dmgnum--crit" : ""}${onSelf ? " fl-fire-dmgnum--self" : ""}`}
              style={{ display: "none", "--dmgx": `${spec.dmgJitterPx}px` } as CSSProperties}
            >
              {spec.dmg}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

interface FinalTotalHandle {
  trigger: () => void;
}

const FinalTotal = forwardRef<FinalTotalHandle, { total: number; crit: boolean; targetScale: number }>(function FinalTotal(
  { total, crit, targetScale },
  ref,
) {
  const wrap = useRef<HTMLDivElement>(null);
  const triggeredAt = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    trigger: () => {
      if (triggeredAt.current === null) triggeredAt.current = performance.now();
    },
  }));

  useFrame(() => {
    const el = wrap.current;
    if (!el) return;
    if (triggeredAt.current === null) {
      el.style.display = "none";
      return;
    }
    const t = performance.now() - triggeredAt.current;
    el.style.display = t < FIRE_LANCE_TOTAL_VISIBLE_MS ? "block" : "none";
  });

  return (
    <group position={[0, (HEAD_TOP_Y + TOTAL_GAP_ABOVE_HEAD) * targetScale, 0]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className={`fl-fire-total${crit ? " fl-fire-total--crit" : ""}`} style={{ display: "none" }}>
          {total}
        </div>
      </Html>
    </group>
  );
});

/**
 * Lança de fogo: ponta afiada, núcleo amarelo/branco, exterior laranja,
 * bordas vermelhas — mesma técnica do Cold Bolt (`clip-path` + gradientes +
 * pseudo-elementos, um `<div>` só, injetado uma vez no `<head>`), reskin
 * completo pra fogo. O impacto troca o aro cristalino por um anel de fogo
 * (`repeating-conic-gradient` simulando labaredas em vez de "pedaços
 * quebrados") e soma partículas que sobem (brasas) ao fragmento radial que
 * o Cold Bolt já tinha.
 */
const FIRE_LANCE_STYLE_ID = "fire-lance-fire-spike-style";
const FIRE_LANCE_CSS = `
.fl-fire-wrap { position: relative; width: 0; height: 0; pointer-events: none; }
.fl-fire-spike {
  position: absolute;
  left: 50%;
  bottom: 0;
  margin-left: -30px;
  width: 60px;
  height: 264px;
  transform-origin: 50% 25%;
  animation: flSpikeAppear 110ms ease-out;
  filter: drop-shadow(0 0 12px rgba(255, 140, 40, 0.85)) drop-shadow(0 0 30px rgba(255, 70, 20, 0.55));
}
.fl-fire-spike__body {
  position: absolute;
  inset: 0;
  clip-path: polygon(50% 100%, 26% 60%, 34% 22%, 46% 2%, 54% 2%, 66% 22%, 74% 60%);
  background: linear-gradient(155deg, #fffbe6 0%, #ffe27a 16%, #ff9d3a 42%, #ff5a1f 70%, #8a1a06 100%);
  box-shadow: inset 0 0 10px rgba(255, 230, 160, 0.55);
}
.fl-fire-spike__body::before {
  content: "";
  position: absolute;
  inset: 0;
  /* núcleo branco/amarelo bem no centro da lança */
  clip-path: polygon(50% 92%, 42% 56%, 47% 24%, 50% 10%, 53% 24%);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 240, 200, 0) 78%);
  mix-blend-mode: screen;
  opacity: 0.95;
}
.fl-fire-spike__body::after {
  content: "";
  position: absolute;
  inset: 0;
  /* borda vermelha/escura na lateral, o oposto do brilho do núcleo */
  clip-path: polygon(50% 100%, 62% 60%, 70% 22%, 60% 2%, 76% 60%);
  background: linear-gradient(205deg, rgba(120, 10, 0, 0.1), rgba(90, 8, 0, 0.65));
  opacity: 0.8;
}
/* sem filter:blur — mesma troca de ColdBoltImpact.tsx (.cb-ice-spike__glow):
   já é radial-gradient, o blur(3px) só somava raster por cima de um degradê
   que já nasce macio. Estágio extra em 45% no lugar do único de 70% pra
   preservar a suavidade da transição. */
.fl-fire-spike__glow {
  position: absolute;
  left: 50%;
  top: 58%;
  width: 138%;
  height: 85%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(255, 140, 40, 0.55), rgba(255, 110, 25, 0.32) 45%, rgba(255, 90, 20, 0) 75%);
  animation: flSpikeGlow 420ms ease-in-out infinite;
}
/* labareda fina lambendo a lança — chamas animadas, distinto do glow difuso acima */
.fl-fire-spike__flicker {
  position: absolute;
  left: 50%;
  bottom: 8%;
  width: 46%;
  height: 40%;
  margin-left: -23%;
  clip-path: polygon(50% 0%, 78% 45%, 62% 60%, 88% 82%, 50% 100%, 12% 82%, 38% 60%, 22% 45%);
  background: linear-gradient(0deg, #ff5a1f 0%, #ffb347 60%, rgba(255, 210, 140, 0) 100%);
  opacity: 0.75;
  transform-origin: 50% 100%;
  animation: flSpikeFlicker 260ms ease-in-out infinite;
}
.fl-fire-wrap--impact .fl-fire-spike {
  animation: flSpikeImpact 160ms ease-out forwards;
}
@keyframes flSpikeAppear {
  from { opacity: 0; transform: scale(0.5, 0.25); }
  to { opacity: 1; transform: scale(1, 1); }
}
@keyframes flSpikeGlow {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.95; }
}
@keyframes flSpikeFlicker {
  0%, 100% { transform: scaleY(1) rotate(-2deg); }
  50% { transform: scaleY(1.15) rotate(3deg); }
}
@keyframes flSpikeImpact {
  0% { transform: scale(1, 1); opacity: 1; }
  40% { transform: scale(1.5, 0.55); opacity: 1; }
  100% { transform: scale(1.9, 0.25); opacity: 0; }
}

/* Burst de impacto: explosão de fogo, flash amarelo/laranja, anel de
   labaredas, fragmentos/centelhas radiais e brasas subindo — o pedido
   explícito é "explosão/incêndio atingindo o monstro", não trocar cor. */
.fl-fire-hit { position: absolute; left: 50%; top: 0; width: 0; height: 0; }
.fl-fire-hit__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(64px * var(--tscale, 1)); height: calc(64px * var(--tscale, 1));
  margin: calc(-32px * var(--tscale, 1)) 0 0 calc(-32px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #fffbe6 0%, #ffd27a 32%, rgba(255, 120, 30, 0.65) 58%, rgba(255, 90, 20, 0) 75%);
  opacity: 0;
}
/* anel de fogo: borda + segmentos em leque simulando labaredas ao redor,
   troca do "aro cristalino" do gelo pelo "fire ring" pedido */
.fl-fire-hit__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(210px * var(--tscale, 1)); height: calc(210px * var(--tscale, 1));
  margin: calc(-105px * var(--tscale, 1)) 0 0 calc(-105px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(6px * var(--tscale, 1)) solid rgba(255, 160, 70, 0.85);
  box-shadow: 0 0 40px rgba(255, 110, 30, 0.75), inset 0 0 22px rgba(255, 190, 110, 0.5);
  opacity: 0;
}
.fl-fire-hit__ring::before {
  content: "";
  position: absolute;
  inset: calc(-18px * var(--tscale, 1));
  border-radius: 50%;
  background: repeating-conic-gradient(rgba(255, 140, 40, 0.95) 0deg 6deg, transparent 6deg 26deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 12px), #fff calc(100% - 12px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 12px), #fff calc(100% - 12px));
  opacity: 0.85;
}
.fl-fire-hit__frag {
  position: absolute; left: 50%; top: 50%;
  width: calc(18px * var(--tscale, 1)); height: calc(18px * var(--tscale, 1));
  margin: calc(-9px * var(--tscale, 1)) 0 0 calc(-9px * var(--tscale, 1));
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: linear-gradient(160deg, #fff3c4, #ff9d3a 55%, #b5290b);
  filter: drop-shadow(0 0 8px rgba(255, 130, 40, 0.95));
  opacity: 0;
}
/* brasas subindo do ponto de impacto — reto com leve deriva, distinto do
   fragmento radial (esse espalha, a brasa sobe) */
.fl-fire-hit__ember {
  position: absolute; left: 50%; top: 50%;
  width: calc(8px * var(--tscale, 1)); height: calc(8px * var(--tscale, 1));
  margin: calc(-4px * var(--tscale, 1)) 0 0 calc(-4px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #fff3c4, #ff8a3d 60%, transparent 78%);
  opacity: 0;
}
.fl-fire-wrap--impact .fl-fire-hit__flash { animation: flHitFlash 240ms ease-out forwards; }
.fl-fire-wrap--impact .fl-fire-hit__ring { animation: flHitRing 440ms ease-out forwards; }
.fl-fire-wrap--impact .fl-fire-hit__frag { animation: flHitFrag 420ms ease-out forwards; }
.fl-fire-wrap--impact .fl-fire-hit__ember { animation: flHitEmber 620ms ease-out forwards; animation-delay: var(--edelay, 0ms); }
@keyframes flHitFlash {
  0% { opacity: 0; transform: scale(0.4); }
  20% { opacity: 1; transform: scale(1.35); }
  100% { opacity: 0; transform: scale(2.3); }
}
@keyframes flHitRing {
  0% { opacity: 0.9; transform: scale(0.3); }
  100% { opacity: 0; transform: scale(2.2); }
}
@keyframes flHitFrag {
  0% { opacity: 1; transform: translate(0, 0) scale(1); }
  100% { opacity: 0; transform: translate(calc(var(--fx) * var(--tscale, 1)), calc(var(--fy) * var(--tscale, 1))) scale(0.4); }
}
@keyframes flHitEmber {
  0% { opacity: 0; transform: translate(calc(var(--ex, 0px) * 0.2), 0) scale(0.6); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--ex, 0px), -90px) scale(0.5); }
}

/* Número de dano individual — mesma cachoeira do Cold Bolt, cor de brasa em
   vez de gelo. */
.fl-fire-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #fff3d6;
  text-shadow: 0 0 32px rgba(255, 140, 40, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(230, 90, 20, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.fl-fire-dmgnum--crit {
  font-size: 108px;
  color: #ffe7a8;
  text-shadow: 0 0 40px rgba(255, 180, 60, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.fl-fire-dmgnum--self { color: #ffb4b4; }
.fl-fire-dmgnum--impact {
  animation: flDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards;
}
@keyframes flDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}

.fl-fire-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffb84d;
  text-shadow: 0 0 64px rgba(255, 120, 20, 0.95), 0 12px 0 rgba(70, 20, 0, 0.95), 0 -12px 0 rgba(70, 20, 0, 0.95),
    12px 0 0 rgba(70, 20, 0, 0.95), -12px 0 0 rgba(70, 20, 0, 0.95), 0 0 104px rgba(255, 90, 20, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: flTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.fl-fire-total--crit { color: #ffe6a8; }
@keyframes flTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

function useFireLanceStyles(): void {
  useEffect(() => {
    if (document.getElementById(FIRE_LANCE_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = FIRE_LANCE_STYLE_ID;
    tag.textContent = FIRE_LANCE_CSS;
    document.head.appendChild(tag);
  }, []);
}
