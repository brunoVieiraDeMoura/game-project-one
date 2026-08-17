import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { multiHitTotalMs } from "../multiHitShared";

/**
 * Light Bolt (MG_LIGHTNINGBOLT) — MESMA infra de dano/cascata de
 * `mage/cold-bolt/ColdBoltImpact.tsx` e a MESMA arte de raio de
 * `mage/thunder-storm/ThunderStormImpact.tsx` (pedido explícito: Thunder
 * Storm como referência visual/estrutural do raio) — mas SINGLE TARGET, não
 * AoE. Raio ÚNICO nascendo do céu, sempre em cima da CABEÇA do alvo (nunca
 * do caster — ao contrário de Soul Strike, que voa horizontalmente).
 *
 * Diferenças deliberadas em relação à Thunder Storm (não é "copiar cego"):
 *  • SEM raios decorativos (não é AoE, não tem "área" pra encher);
 *  • SEM eletricidade se espalhando pelo chão numa área — cada hit
 *    ("`Strike`") é uma descarga CONCENTRADA na cabeça + uma linha
 *    descendo até os pés do MESMO alvo, nunca ramificações radiais longas;
 *  • o raio nasce, ataca, e dissipa depois do ÚLTIMO hit — mesmo raio, sem
 *    reaparecer entre hits (é uma descarga contínua, não N relâmpagos).
 */

// teto REAL do skill_db (Lv10→10), não mais um chute de 5 (auditoria
// "count real" 2026-08-19).
export const LIGHT_BOLT_MAX_HITS = 10;
export const LIGHT_BOLT_STAGGER_MS = 260;
export const LIGHT_BOLT_DAMAGE_NUMBER_MS = 1000;
export const LIGHT_BOLT_TOTAL_VISIBLE_MS = 1500;
/** duração total que o efeito precisa ficar vivo no `vfxStore` PARA `hits`
 * de verdade — mesma fórmula compartilhada das outras três. */
export function lightBoltTotalMs(hits: number): number {
  return multiHitTotalMs(hits, LIGHT_BOLT_STAGGER_MS, 0, LIGHT_BOLT_DAMAGE_NUMBER_MS, LIGHT_BOLT_TOTAL_VISIBLE_MS, 300);
}

function splitDamage(total: number, hits: number): number[] {
  const base = Math.floor(total / hits);
  const resto = total - base * hits;
  return Array.from({ length: hits }, (_, i) => base + (i === hits - 1 ? resto : 0));
}

const BODY_Y = 0.05;
/** cabeça — mesma referência que `HEAD_TOP_Y` usa nas outras três, é ONDE
 * o raio ATINGE de verdade (pedido explícito: "na cabeça do inimigo") */
const HEAD_Y = 1.7;
const TOTAL_GAP_ABOVE_HEAD = 0.4;
const DMG_SPAWN_Y = 1.3;
const DMG_STACK_STEP = 0.08;
const BOLT_TOP_Y = 6.2;
const BOLT_PIXEL_HEIGHT = 640;

interface StrikeSpec {
  delayMs: number;
  dmg?: number;
  dmgJitterPx: number;
  dmgStackY: number;
  rotDeg: number;
}

function buildStrikes(seed: number, hits: number, dmgSlices: number[] | undefined): StrikeSpec[] {
  const specs: StrikeSpec[] = [];
  for (let i = 0; i < hits; i++) {
    specs.push({
      delayMs: i * LIGHT_BOLT_STAGGER_MS,
      dmg: dmgSlices?.[i],
      dmgJitterPx: (Math.random() - 0.5) * 64,
      dmgStackY: i * DMG_STACK_STEP,
      rotDeg: (i / hits) * 360 + seed * 360,
    });
  }
  return specs;
}

export function LightBoltImpact({
  onHit,
  damage,
  crit,
  onSelf,
  targetScale = 1,
  hits = LIGHT_BOLT_MAX_HITS,
}: {
  onHit?: (index: number) => void;
  damage?: number;
  crit?: boolean;
  onSelf?: boolean;
  targetScale?: number;
  /** quantidade REAL de descargas — vem do nível da skill
   * (`getSkillProjectileCount`, `net/useWorldEvents`), nunca fixa em 5. */
  hits?: number;
}) {
  useLightBoltStyles();
  const bornAt = useRef(performance.now());
  const hitCount = Math.min(LIGHT_BOLT_MAX_HITS, Math.max(1, hits));
  const lastHitAtMs = (hitCount - 1) * LIGHT_BOLT_STAGGER_MS;
  const boltDissipateAtMs = lastHitAtMs + 420;
  const dmgSlices = useMemo(
    () => (damage !== undefined && damage > 0 ? splitDamage(damage, hitCount) : undefined),
    [damage, hitCount],
  );
  const specs = useMemo(() => buildStrikes(Math.random(), hitCount, dmgSlices), [hitCount, dmgSlices]);
  const totalRef = useRef<FinalTotalHandle>(null);
  const hitsLanded = useRef(0);

  const handleHit = (i: number) => {
    onHit?.(i);
    hitsLanded.current += 1;
    if (hitsLanded.current === hitCount) totalRef.current?.trigger();
  };

  return (
    <group name="light-bolt-impact">
      {/* raio ÚNICO — nasce, fica de pé durante TODOS os hits, dissipa no fim */}
      <Bolt bornAt={bornAt.current} targetScale={targetScale} goneAtMs={boltDissipateAtMs} />
      {specs.map((spec, i) => (
        <Strike key={i} spec={spec} bornAt={bornAt.current} crit={crit ?? false} onSelf={onSelf ?? false} targetScale={targetScale} onHit={() => handleHit(i)} />
      ))}
      {dmgSlices && <FinalTotal ref={totalRef} total={damage ?? 0} crit={crit ?? false} targetScale={targetScale} />}
    </group>
  );
}

/** raio único descendo do céu — MESMA arte (zigzag em `clip-path`, glow,
 * arcos, motes) de `ThunderStormImpact.Bolt`, própria namespace CSS
 * (`lb-bolt-*`) pra não acoplar os dois arquivos — mesmo padrão que Fire
 * Lance já usa (reaproveita a IDEIA/geometria da Cold Bolt, não importa o
 * componente interno dela). */
function Bolt({ bornAt, targetScale, goneAtMs }: { bornAt: number; targetScale: number; goneAtMs: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const dissipated = useRef(false);

  useFrame(() => {
    const el = wrap.current;
    if (!el) return;
    const t = performance.now() - bornAt;
    if (t < 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    if (!dissipated.current && t >= goneAtMs) {
      dissipated.current = true;
      el.classList.add("lb-bolt-wrap--gone");
    }
  });

  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return (
    <group position={[0, BOLT_TOP_Y * targetScale, 0]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className="lb-bolt-wrap" style={{ display: "none", ...tscaleStyle }}>
          <div className="lb-bolt__glow" />
          <div className="lb-bolt__core" />
          <div className="lb-bolt__branch" style={{ "--by": "30%", "--brot": "-32deg" } as CSSProperties} />
          <div className="lb-bolt__branch" style={{ "--by": "56%", "--brot": "26deg" } as CSSProperties} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="lb-bolt__mote" style={{ "--mangle": `${i * 72}deg`, "--mdelay": `${i * 100}ms` } as CSSProperties} />
          ))}
        </div>
      </Html>
    </group>
  );
}

/**
 * UM hit = descarga concentrada na CABEÇA (flash + anel + arcos) + linha
 * descendo até os pés do MESMO alvo + poucas centelhas concentradas junto
 * aos pés — nunca ramificações longas espalhando por uma área (isso é
 * exclusivo da Thunder Storm, que É AoE).
 */
function Strike({
  spec,
  bornAt,
  crit,
  onSelf,
  targetScale,
  onHit,
}: {
  spec: StrikeSpec;
  bornAt: number;
  crit: boolean;
  onSelf: boolean;
  targetScale: number;
  onHit?: () => void;
}) {
  const headWrap = useRef<HTMLDivElement>(null);
  const dmgWrap = useRef<HTMLDivElement>(null);
  const hit = useRef(false);

  useFrame(() => {
    const t = performance.now() - bornAt - spec.delayMs;
    const alive = t >= 0 && t < LIGHT_BOLT_DAMAGE_NUMBER_MS;
    if (headWrap.current) headWrap.current.style.display = alive ? "block" : "none";
    if (dmgWrap.current) dmgWrap.current.style.display = alive ? "block" : "none";
    if (!alive) return;

    if (!hit.current && t >= 0) {
      hit.current = true;
      headWrap.current?.classList.add("lb-strike--impact");
      dmgWrap.current?.classList.add("lb-dmgnum--impact");
      onHit?.();
    }
  });

  useEffect(() => {
    hit.current = false;
    headWrap.current?.classList.remove("lb-strike--impact");
    dmgWrap.current?.classList.remove("lb-dmgnum--impact");
  }, [spec]);

  const tscaleStyle = { "--tscale": targetScale, "--rot": `${spec.rotDeg}deg` } as CSSProperties;

  return (
    <group>
      <group position={[0, HEAD_Y * targetScale, 0]}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={headWrap} className="lb-strike" style={{ display: "none", ...tscaleStyle }}>
            <div className="lb-strike__flash" />
            <div className="lb-strike__ring" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="lb-strike__arc" style={{ "--sangle": `${i * 72}deg` } as CSSProperties} />
            ))}
            {/* descarga descendo até os pés — MESMO alvo, nunca uma área */}
            <div className="lb-strike__down" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={`s${i}`} className="lb-strike__spark" style={{ "--pangle": `${i * 120 + 20}deg` } as CSSProperties} />
            ))}
          </div>
        </Html>
      </group>
      {spec.dmg !== undefined && (
        <group position={[0, (DMG_SPAWN_Y + spec.dmgStackY) * targetScale, 0]}>
          <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
            <div
              ref={dmgWrap}
              className={`lb-dmgnum${crit ? " lb-dmgnum--crit" : ""}${onSelf ? " lb-dmgnum--self" : ""}`}
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
    el.style.display = t < LIGHT_BOLT_TOTAL_VISIBLE_MS ? "block" : "none";
  });

  return (
    <group position={[0, (HEAD_Y + TOTAL_GAP_ABOVE_HEAD) * targetScale, 0]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className={`lb-total${crit ? " lb-total--crit" : ""}`} style={{ display: "none" }}>
          {total}
        </div>
      </Html>
    </group>
  );
});

const LIGHT_BOLT_STYLE_ID = "light-bolt-impact-style";
const LIGHT_BOLT_CSS = `
/* ---- raio único ---- */
.lb-bolt-wrap { position: relative; width: 0; height: 0; pointer-events: none; animation: lbBoltAppear 100ms ease-out; }
.lb-bolt-wrap--gone { animation: lbBoltGone 260ms ease-in forwards; }
.lb-bolt__core {
  position: absolute; left: 50%; top: 0;
  width: calc(64px * var(--tscale, 1)); height: calc(${BOLT_PIXEL_HEIGHT}px * var(--tscale, 1));
  margin-left: calc(-32px * var(--tscale, 1));
  clip-path: polygon(45.5% 0%, 57.5% 14%, 35.5% 30%, 53.5% 46%, 33.5% 62%, 47.5% 80%, 43.5% 100%,
    52.5% 100%, 56.5% 80%, 42.5% 62%, 62.5% 46%, 44.5% 30%, 66.5% 14%, 54.5% 0%);
  background: linear-gradient(180deg, #ffffff 0%, #eaf6ff 30%, #a9d8ff 60%, #6ab4ff 100%);
  filter: drop-shadow(0 0 10px rgba(150, 210, 255, 0.95)) drop-shadow(0 0 26px rgba(90, 170, 255, 0.7));
  animation: lbBoltFlicker 180ms ease-in-out infinite;
}
/* halo sem blur — mesma troca e mesma medição de ThunderStormImpact.tsx
   (.ts-bolt__glow, comentário junto de THUNDER_CSS lá): radial-gradient
   já nasce com borda suave, sem pagar o filter:blur (raster ~4,6× mais caro
   com blur(10px) em elemento deste tamanho, medido isoladamente). */
.lb-bolt__glow {
  position: absolute; left: 50%; top: 0;
  width: calc(166px * var(--tscale, 1)); height: calc(${Math.round(BOLT_PIXEL_HEIGHT * 1.05)}px * var(--tscale, 1));
  margin-left: calc(-83px * var(--tscale, 1));
  background: radial-gradient(ellipse 50% 46% at 50% 50%, rgba(150, 205, 255, 0.5) 0%, rgba(130, 195, 255, 0.28) 45%, rgba(120, 190, 255, 0) 78%);
  opacity: 0.85;
}
.lb-bolt__branch {
  position: absolute; left: 50%; top: var(--by, 40%); width: calc(36px * var(--tscale, 1)); height: 2px;
  margin-left: calc(-18px * var(--tscale, 1));
  transform: rotate(var(--brot, 0deg));
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 5px rgba(180, 225, 255, 0.9));
  opacity: 0;
  animation: lbBoltBranch 420ms ease-in-out infinite;
}
.lb-bolt__mote {
  position: absolute; left: 50%; top: 42%; width: calc(4px * var(--tscale, 1)); height: calc(4px * var(--tscale, 1));
  margin: calc(-2px * var(--tscale, 1)) 0 0 calc(-2px * var(--tscale, 1));
  border-radius: 50%;
  background: #eaf6ff;
  box-shadow: 0 0 6px 2px rgba(160, 215, 255, 0.9);
  opacity: 0;
  animation: lbBoltMote 900ms ease-in-out var(--mdelay, 0ms) infinite;
}
@keyframes lbBoltAppear { from { opacity: 0; } to { opacity: 1; } }
@keyframes lbBoltGone { from { opacity: 1; } to { opacity: 0; } }
@keyframes lbBoltFlicker { 0%, 100% { opacity: 1; } 45% { opacity: 0.55; } 60% { opacity: 1; } 80% { opacity: 0.7; } }
@keyframes lbBoltBranch {
  0%, 100% { opacity: 0; transform: rotate(var(--brot, 0deg)) scaleX(0.6); }
  50% { opacity: 0.9; transform: rotate(var(--brot, 0deg)) scaleX(1); }
}
@keyframes lbBoltMote {
  0%, 100% { opacity: 0; transform: rotate(var(--mangle)) translateX(calc(46px * var(--tscale, 1))) scale(0.6); }
  50% { opacity: 1; transform: rotate(var(--mangle)) translateX(calc(58px * var(--tscale, 1))) scale(1); }
}

/* ---- hit na cabeça: flash + anel + arcos + descarga descendo + poucas
   centelhas concentradas nos pés (single target, nunca uma área) ---- */
.lb-strike { position: relative; width: 0; height: 0; pointer-events: none; }
.lb-strike__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(60px * var(--tscale, 1)); height: calc(60px * var(--tscale, 1));
  margin: calc(-30px * var(--tscale, 1)) 0 0 calc(-30px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #eaf6ff 40%, rgba(140, 200, 255, 0.6) 62%, rgba(140, 200, 255, 0) 76%);
  opacity: 0;
}
.lb-strike__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(170px * var(--tscale, 1)); height: calc(170px * var(--tscale, 1));
  margin: calc(-85px * var(--tscale, 1)) 0 0 calc(-85px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(4px * var(--tscale, 1)) solid rgba(170, 220, 255, 0.85);
  box-shadow: 0 0 30px rgba(120, 190, 255, 0.7);
  opacity: 0;
}
.lb-strike__arc {
  position: absolute; left: 50%; top: 50%; width: calc(28px * var(--tscale, 1)); height: calc(3px * var(--tscale, 1));
  margin-top: calc(-1.5px * var(--tscale, 1));
  transform: rotate(var(--sangle));
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 5px rgba(180, 225, 255, 0.95));
  opacity: 0;
}
/* linha fina descendo da cabeça até perto dos pés — CONCENTRADA no MESMO
   alvo, não uma ramificação radial */
.lb-strike__down {
  position: absolute; left: 50%; top: 50%;
  width: calc(3px * var(--tscale, 1)); height: calc(150px * var(--tscale, 1));
  margin-left: calc(-1.5px * var(--tscale, 1));
  transform-origin: 50% 0%;
  background: linear-gradient(180deg, #ffffff, rgba(150, 210, 255, 0.6) 60%, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 4px rgba(180, 225, 255, 0.9));
  opacity: 0;
  transform: scaleY(0);
}
.lb-strike__spark {
  position: absolute; left: 50%; top: calc(50% + 148px * var(--tscale, 1));
  width: calc(5px * var(--tscale, 1)); height: calc(5px * var(--tscale, 1));
  margin: calc(-2.5px * var(--tscale, 1)) 0 0 calc(-2.5px * var(--tscale, 1));
  border-radius: 50%;
  background: #eaf6ff;
  box-shadow: 0 0 6px 2px rgba(160, 215, 255, 0.9);
  opacity: 0;
}
.lb-strike--impact .lb-strike__flash { animation: lbHitFlash 220ms ease-out forwards; }
.lb-strike--impact .lb-strike__ring { animation: lbHitRing 440ms ease-out forwards; }
.lb-strike--impact .lb-strike__arc { animation: lbHitArc 360ms ease-out forwards; }
.lb-strike--impact .lb-strike__down { animation: lbHitDown 320ms ease-out forwards; }
.lb-strike--impact .lb-strike__spark { animation: lbHitSpark 420ms ease-out forwards; }
@keyframes lbHitFlash {
  0% { opacity: 0; transform: scale(0.4); }
  25% { opacity: 1; transform: scale(1.25); }
  100% { opacity: 0; transform: scale(2); }
}
@keyframes lbHitRing {
  0% { opacity: 0.9; transform: scale(0.25); }
  100% { opacity: 0; transform: scale(1.9); }
}
@keyframes lbHitArc {
  0% { opacity: 1; transform: rotate(var(--sangle)) scaleX(0.3); }
  35% { opacity: 1; transform: rotate(var(--sangle)) scaleX(1.2); }
  100% { opacity: 0; transform: rotate(var(--sangle)) scaleX(1); }
}
@keyframes lbHitDown {
  0% { opacity: 0.95; transform: scaleY(0); }
  40% { opacity: 1; transform: scaleY(1); }
  100% { opacity: 0; transform: scaleY(1); }
}
@keyframes lbHitSpark {
  0% { opacity: 1; transform: rotate(var(--pangle)) translateX(0) scale(1); }
  100% { opacity: 0; transform: rotate(var(--pangle)) translateX(calc(22px * var(--tscale, 1))) scale(0.4); }
}

/* ---- número de dano — mesma cachoeira, tom elétrico ---- */
.lb-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #eaf6ff;
  text-shadow: 0 0 32px rgba(130, 195, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(90, 160, 230, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.lb-dmgnum--crit {
  font-size: 108px;
  color: #f2f9ff;
  text-shadow: 0 0 40px rgba(180, 220, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.lb-dmgnum--self { color: #ffb4b4; }
.lb-dmgnum--impact { animation: lbDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards; }
@keyframes lbDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}

.lb-total {
  position: relative;
  transform: translate(-50%, 0) scale(0.3);
  font: 900 168px/1 "Segoe UI", system-ui, sans-serif;
  color: #ffe27a;
  text-shadow: 0 0 64px rgba(255, 220, 110, 0.95), 0 12px 0 rgba(60, 45, 0, 0.95), 0 -12px 0 rgba(60, 45, 0, 0.95),
    12px 0 0 rgba(60, 45, 0, 0.95), -12px 0 0 rgba(60, 45, 0, 0.95), 0 0 104px rgba(255, 210, 90, 0.65);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
  animation: lbTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.lb-total--crit { color: #fff3c4; }
@keyframes lbTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

function useLightBoltStyles(): void {
  useEffect(() => {
    if (document.getElementById(LIGHT_BOLT_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = LIGHT_BOLT_STYLE_ID;
    tag.textContent = LIGHT_BOLT_CSS;
    document.head.appendChild(tag);
  }, []);
}
