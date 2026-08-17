import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { multiHitTotalMs } from "../multiHitShared";

/**
 * Soul Strike (MG_SOULSTRIKE) — MESMA infra de dano/cascata de
 * `mage/cold-bolt/ColdBoltImpact.tsx` (`splitDamage`, fatias, número por
 * hit, total amarelo no último, `<Html>`, escala por espécie) — ver aquele
 * arquivo pro raciocínio completo. A diferença estrutural de verdade:
 *
 * Cold Bolt/Fire Lance CAEM de cima do alvo (só precisam da posição do
 * ALVO — `SPREAD_RADIUS`/`CONVERGE_RADIUS` num leque vertical). Soul Strike
 * VOA do CASTER até o alvo — precisa das DUAS pontas. O `<group>` que
 * `vfx/SkillVfx.tsx` já monta pra todo "impact" segue o ALVO sozinho (é a
 * âncora de sempre); a posição do CASTER chega como prop já PRÉ-CALCULADA
 * — `casterOffsetX/Y/Z` = (posição do caster no instante do disparo) MENOS
 * (posição do alvo no MESMO instante), em unidades LOCAIS (o grupo já
 * escala por `cellSize`). Isso é o suficiente pra cada alma trilhar do
 * caster até o alvo, e funciona com QUALQUER distância/direção sem este
 * arquivo saber nada de mapa/célula — só soma o offset ao ponto local
 * (0,0,0), que É o alvo, sempre.
 *
 * Trajetória: `soulLocalPos` interpola caster→alvo em linha reta e SOMA um
 * desvio lateral perpendicular (função seno que nasce e morre em 0 — some
 * exatamente nas duas pontas, nunca "erra" o alvo) mais um pequeno
 * ondulado secundário de frequência diferente por alma, e um arco vertical
 * na mesma lógica. Cinco perfis fixos (`PROFILES`) dão a distribuição
 * pedida (1 ampla-esquerda, 2 direita, 3 esquerda-interna, 4
 * ampla-direita/espelho da 1, 5 quase-central) — puro `Math.sin`, sem
 * bezier nem sistema de path novo.
 */

/** teto de almas no nível MÁXIMO da skill — a quantidade de VERDADE por
 * lançamento vem do nível real (`getSkillProjectileCount`,
 * `vfx/mage/multiHitShared`), nunca fixa em 5 */
export const SOUL_STRIKE_MAX_HITS = 5;
/** ms entre o disparo de uma alma e a próxima — pequeno de propósito
 * ("intervalo pequeno e fluido", pedido explícito) */
export const SOUL_STRIKE_STAGGER_MS = 180;
/** ms de voo de UMA alma, caster → alvo */
export const SOUL_FLIGHT_MS = 520;
/** fração do voo em que ela "chega" (dano/flash/ondulação/wisps) */
export const SOUL_IMPACT_FRACTION = 0.95;
const IMPACT_AT_MS = SOUL_FLIGHT_MS * SOUL_IMPACT_FRACTION;
export const SOUL_DAMAGE_NUMBER_MS = 1000;
export const SOUL_VISIBLE_MS = IMPACT_AT_MS + SOUL_DAMAGE_NUMBER_MS;
export const SOUL_TOTAL_VISIBLE_MS = 1500;
/** duração total que o efeito precisa ficar vivo no `vfxStore` PARA `hits`
 * almas de verdade — mesma fórmula compartilhada das outras três. */
export function soulStrikeTotalMs(hits: number): number {
  return multiHitTotalMs(hits, SOUL_STRIKE_STAGGER_MS, IMPACT_AT_MS, SOUL_DAMAGE_NUMBER_MS, SOUL_TOTAL_VISIBLE_MS);
}

function splitDamage(total: number, hits: number): number[] {
  const base = Math.floor(total / hits);
  const resto = total - base * hits;
  return Array.from({ length: hits }, (_, i) => base + (i === hits - 1 ? resto : 0));
}

/** altura (local) onde a alma CHEGA no alvo — região do peito, não os pés
 * nem a cabeça, mesma faixa que `DMG_SPAWN_Y` das outras três skills */
const ARRIVE_Y = 1.0;
/** só usado se NEM a posição de célula do caster resolveu (dado nenhum) —
 * o offset normal (`casterOffsetY`, vindo de `vfx/SkillVfx.tsx`) já chega
 * PRONTO: ponta real do cajado, ou fallback de célula com a altura já
 * embutida. Somar de novo aqui jogaria o disparo pra cima da cabeça. */
const NO_DATA_Y_FALLBACK = 1.0;
/** quanto (em fração de `u`, o progresso 0..1 do voo) cada rastro fica
 * ATRÁS da alma principal — reavalia a MESMA função de posição num `u`
 * menor, então o rastro sempre cai EXATAMENTE em cima da curva já
 * percorrida, sem precisar calcular ângulo/rotação nenhum */
const ECHO_LAG = 0.09;
const HEAD_TOP_Y = 1.8;
const TOTAL_GAP_ABOVE_HEAD = 0.4;
const DMG_SPAWN_Y = 1.3;
const DMG_STACK_STEP = 0.08;

interface SoulProfile {
  side: -1 | 0 | 1;
  amp: number;
  wobbleAmp: number;
  wobbleFreq: number;
  vArc: number;
  vFreq: number;
}

/**
 * As cinco trajetórias da referência, na ORDEM de disparo pedida:
 * 1 ampla-esquerda · 2 direita/centro-direita · 3 esquerda-interna ·
 * 4 ampla-direita (espelho da 1) · 5 quase-central com ondulação pequena.
 * Em nível baixo (`hits < 5`) só as PRIMEIRAS `hits` desta lista disparam —
 * é a mesma ordem 1→2→3→4→5, só que mais curta, nunca reordenada.
 */
const PROFILES: SoulProfile[] = [
  { side: -1, amp: 1.9, wobbleAmp: 0.22, wobbleFreq: 2.4, vArc: 0.85, vFreq: 1.6 },
  { side: 1, amp: 1.05, wobbleAmp: 0.28, wobbleFreq: 3.0, vArc: 0.5, vFreq: 2.1 },
  { side: -1, amp: 0.65, wobbleAmp: 0.32, wobbleFreq: 2.7, vArc: 0.65, vFreq: 1.9 },
  { side: 1, amp: 1.9, wobbleAmp: 0.22, wobbleFreq: 2.2, vArc: 0.85, vFreq: 1.7 },
  { side: 0, amp: 0.12, wobbleAmp: 0.38, wobbleFreq: 3.6, vArc: 0.32, vFreq: 2.5 },
];

interface SoulSpec extends SoulProfile {
  delayMs: number;
  phase: number;
  vPhase: number;
  dmg?: number;
  dmgJitterPx: number;
  dmgStackY: number;
}

function buildSpecs(seed: number, hits: number, dmgSlices: number[] | undefined): SoulSpec[] {
  const specs: SoulSpec[] = [];
  for (let i = 0; i < hits; i++) {
    const p = PROFILES[i % PROFILES.length]!;
    specs.push({
      ...p,
      delayMs: i * SOUL_STRIKE_STAGGER_MS,
      phase: seed * Math.PI * 2 + i * 1.3,
      vPhase: seed * Math.PI * 2 + i * 1.9,
      dmg: dmgSlices?.[i],
      dmgJitterPx: (Math.random() - 0.5) * 64,
      dmgStackY: i * DMG_STACK_STEP,
    });
  }
  return specs;
}

/**
 * Posição LOCAL da alma no progresso `u` (0 = caster, 1 = alvo) — linha
 * reta caster→alvo (`start` → origem local) com um desvio lateral (eixo
 * `perp`, perpendicular à reta) e um arco vertical, os dois em envelope
 * `sin(π·eased)`: zero nas DUAS pontas, pico no meio. `eased` (smoothstep)
 * em vez de `u` cru só pra suavizar a entrada/saída da curva, sem mexer em
 * ONDE ela começa/termina.
 */
function soulLocalPos(
  u: number,
  spec: SoulSpec,
  start: THREE.Vector3,
  perpX: number,
  perpZ: number,
  out: THREE.Vector3,
): void {
  const eased = u * u * (3 - 2 * u);
  const env = Math.sin(Math.PI * eased);
  const lateral = spec.side * spec.amp * env + spec.wobbleAmp * env * Math.sin(spec.wobbleFreq * Math.PI * eased + spec.phase);
  const vertical = spec.vArc * env + spec.wobbleAmp * 0.6 * env * Math.sin(spec.vFreq * Math.PI * eased + spec.vPhase);
  const bx = start.x * (1 - eased);
  const by = start.y * (1 - eased) + ARRIVE_Y * eased;
  const bz = start.z * (1 - eased);
  out.set(bx + perpX * lateral, by + vertical, bz + perpZ * lateral);
}

export function SoulStrikeImpact({
  onHit,
  damage,
  crit,
  onSelf,
  targetScale = 1,
  hits = SOUL_STRIKE_MAX_HITS,
  casterOffsetX = 0,
  casterOffsetY = 0,
  casterOffsetZ = 0,
}: {
  onHit?: (index: number) => void;
  damage?: number;
  crit?: boolean;
  onSelf?: boolean;
  targetScale?: number;
  /** quantidade REAL de almas — vem do nível da skill
   * (`getSkillProjectileCount`, `net/useWorldEvents`), nunca fixa em 5. */
  hits?: number;
  /** posição do CASTER menos a posição do ALVO, em unidades locais, no
   * instante do disparo (ver docblock do arquivo) — ausente (skill sem
   * `sourceGid` resolvido) cai num offset padrão pra trás/baixo, pra nunca
   * nascer exatamente em cima do alvo por falta de dado. */
  casterOffsetX?: number;
  casterOffsetY?: number;
  casterOffsetZ?: number;
}) {
  useSoulStrikeStyles();
  const bornAt = useRef(performance.now());
  const hitCount = Math.min(SOUL_STRIKE_MAX_HITS, Math.max(1, hits));
  const dmgSlices = useMemo(
    () => (damage !== undefined && damage > 0 ? splitDamage(damage, hitCount) : undefined),
    [damage, hitCount],
  );
  const specs = useMemo(() => buildSpecs(Math.random(), hitCount, dmgSlices), [hitCount, dmgSlices]);
  const hasCasterPos = casterOffsetX !== 0 || casterOffsetZ !== 0;
  const startOffset = useMemo(
    () =>
      new THREE.Vector3(
        hasCasterPos ? casterOffsetX : 0,
        hasCasterPos ? casterOffsetY : NO_DATA_Y_FALLBACK,
        // fallback: nasce um pouco atrás/abaixo do alvo (nunca em cima dele)
        // se por algum motivo o caster não resolveu posição nenhuma
        hasCasterPos ? casterOffsetZ : 2.2,
      ),
    [hasCasterPos, casterOffsetX, casterOffsetY, casterOffsetZ],
  );
  const totalRef = useRef<FinalTotalHandle>(null);
  const hitsLanded = useRef(0);

  const handleHit = (i: number) => {
    onHit?.(i);
    hitsLanded.current += 1;
    if (hitsLanded.current === hitCount) totalRef.current?.trigger();
  };

  return (
    <group name="soul-strike-impact">
      {specs.map((spec, i) => (
        <Soul
          key={i}
          spec={spec}
          bornAt={bornAt.current}
          crit={crit ?? false}
          onSelf={onSelf ?? false}
          targetScale={targetScale}
          startOffset={startOffset}
          onHit={() => handleHit(i)}
        />
      ))}
      {dmgSlices && <FinalTotal ref={totalRef} total={damage ?? 0} crit={crit ?? false} targetScale={targetScale} />}
    </group>
  );
}

function Soul({
  spec,
  bornAt,
  crit,
  onSelf,
  targetScale,
  startOffset,
  onHit,
}: {
  spec: SoulSpec;
  bornAt: number;
  crit: boolean;
  onSelf: boolean;
  targetScale: number;
  startOffset: THREE.Vector3;
  onHit?: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const echo1 = useRef<THREE.Group>(null);
  const echo2 = useRef<THREE.Group>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const echo1Wrap = useRef<HTMLDivElement>(null);
  const echo2Wrap = useRef<HTMLDivElement>(null);
  const dmgWrap = useRef<HTMLDivElement>(null);
  const hit = useRef(false);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  // perpendicular à reta caster→alvo — computado UMA VEZ (as duas pontas
  // não mudam durante o voo desta alma)
  const perp = useMemo(() => {
    const dx = -startOffset.x;
    const dz = -startOffset.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: -dz / len, z: dx / len };
  }, [startOffset]);

  useFrame(() => {
    const g = group.current;
    const wrapEl = wrap.current;
    if (!g || !wrapEl) return;
    const t = performance.now() - bornAt - spec.delayMs;
    const alive = t >= 0 && t < SOUL_VISIBLE_MS;
    wrapEl.style.display = alive ? "block" : "none";
    if (echo1Wrap.current) echo1Wrap.current.style.display = alive ? "block" : "none";
    if (echo2Wrap.current) echo2Wrap.current.style.display = alive ? "block" : "none";
    if (dmgWrap.current) dmgWrap.current.style.display = alive ? "block" : "none";
    if (!alive) return;

    const u = Math.min(1, t / SOUL_FLIGHT_MS);
    soulLocalPos(u, spec, startOffset, perp.x, perp.z, tmp);
    g.position.copy(tmp);
    if (echo1.current) {
      soulLocalPos(Math.max(0, u - ECHO_LAG), spec, startOffset, perp.x, perp.z, tmp);
      echo1.current.position.copy(tmp);
    }
    if (echo2.current) {
      soulLocalPos(Math.max(0, u - ECHO_LAG * 2), spec, startOffset, perp.x, perp.z, tmp);
      echo2.current.position.copy(tmp);
    }

    if (!hit.current && u >= SOUL_IMPACT_FRACTION) {
      hit.current = true;
      wrapEl.classList.add("ss-wrap--impact");
      dmgWrap.current?.classList.add("ss-dmgnum--impact");
      onHit?.();
    }
  });

  useEffect(() => {
    hit.current = false;
    wrap.current?.classList.remove("ss-wrap--impact");
    dmgWrap.current?.classList.remove("ss-dmgnum--impact");
  }, [spec]);

  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return (
    <>
      <group ref={echo2}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={echo2Wrap} className="ss-echo ss-echo--2" style={{ display: "none", ...tscaleStyle }} />
        </Html>
      </group>
      <group ref={echo1}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={echo1Wrap} className="ss-echo ss-echo--1" style={{ display: "none", ...tscaleStyle }} />
        </Html>
      </group>
      <group ref={group}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={wrap} className="ss-wrap" style={{ display: "none", ...tscaleStyle }}>
            <div className="ss-ghost">
              <div className="ss-ghost__glow" />
              <div className="ss-ghost__body" />
              <div className="ss-ghost__eye ss-ghost__eye--l" />
              <div className="ss-ghost__eye ss-ghost__eye--r" />
            </div>
            <div className="ss-hit">
              <div className="ss-hit__flash" />
              <div className="ss-hit__ripple" />
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={`w${i}`} className="ss-hit__wisp" style={{ "--wangle": `${i * 60}deg` } as CSSProperties} />
              ))}
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={`f${i}`} className="ss-hit__frag" style={{ "--fangle": `${i * 60 + 30}deg` } as CSSProperties} />
              ))}
            </div>
          </div>
        </Html>
      </group>
      {spec.dmg !== undefined && (
        <group position={[0, (DMG_SPAWN_Y + spec.dmgStackY) * targetScale, 0]}>
          <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
            <div
              ref={dmgWrap}
              className={`ss-dmgnum${crit ? " ss-dmgnum--crit" : ""}${onSelf ? " ss-dmgnum--self" : ""}`}
              style={{ display: "none", "--dmgx": `${spec.dmgJitterPx}px` } as CSSProperties}
            >
              {spec.dmg}
            </div>
          </Html>
        </group>
      )}
    </>
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
    el.style.display = t < SOUL_TOTAL_VISIBLE_MS ? "block" : "none";
  });

  return (
    <group position={[0, (HEAD_TOP_Y + TOTAL_GAP_ABOVE_HEAD) * targetScale, 0]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className={`ss-total${crit ? " ss-total--crit" : ""}`} style={{ display: "none" }}>
          {total}
        </div>
      </Html>
    </group>
  );
});

/**
 * Fantasma pequeno em CSS: silhueta de topo arredondado + base ondulada
 * (`clip-path` de 3 lóbulos, o "rabo" clássico de fantasma) num gradiente
 * radial branco/azul-claro translúcido — nada de losango/esfera genérica.
 * O impacto troca flash/aro/fragmentos por um tom espiritual (branco/azul
 * muito claro) e soma "wisps" (pequenos borrões alongados) se afastando —
 * pedido explícito de não parecer gelo/fogo/raio.
 */
const SOUL_STYLE_ID = "soul-strike-impact-style";
const SOUL_CSS = `
.ss-wrap { position: relative; width: 0; height: 0; pointer-events: none; }
.ss-ghost {
  position: absolute; left: 50%; top: 50%;
  width: 51px; height: 45px; margin: -27px 0 0 -25.5px;
  animation: ssGhostAppear 90ms ease-out, ssGhostBob 420ms ease-in-out infinite;
}
.ss-ghost__body {
  position: absolute;
  inset: 0;
  clip-path: polygon(
    50% 2%, 82% 10%, 96% 34%, 92% 58%, 80% 72%, 70% 58%, 58% 80%, 50% 64%, 42% 80%, 30% 58%, 18% 72%, 6% 58%, 2% 34%, 16% 10%
  );
  background: radial-gradient(ellipse at 50% 35%, #ffffff 0%, #eaf6ff 45%, #bfe0ff 78%, rgba(170, 210, 255, 0.5) 100%);
  opacity: 0.92;
}
.ss-ghost__glow {
  position: absolute; left: 50%; top: 40%; width: 150%; height: 120%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(220, 240, 255, 0.5), rgba(220, 240, 255, 0) 70%);
}
.ss-ghost__eye {
  position: absolute; top: 38%; width: 6px; height: 9px; border-radius: 50%;
  background: rgba(120, 160, 210, 0.55);
}
.ss-ghost__eye--l { left: 36%; }
.ss-ghost__eye--r { left: 58%; }
.ss-wrap--impact .ss-ghost { animation: ssGhostDissolve 200ms ease-out forwards; }
@keyframes ssGhostAppear {
  from { opacity: 0; transform: scale(0.4); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes ssGhostBob {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-3px) scale(1.03, 0.97); }
}
@keyframes ssGhostDissolve {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.4); }
}

/* rastro — reavalia a MESMA curva num u anterior (ver ECHO_LAG), então
   nunca precisa saber pra onde a alma está indo, só ficar mais fraco/menor */
.ss-echo {
  position: absolute; left: 50%; top: 50%; width: 30px; height: 27px; margin: -13.5px 0 0 -15px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(255, 255, 255, 0.6), rgba(190, 220, 255, 0) 75%);
  opacity: 0.55;
}
.ss-echo--2 { opacity: 0.28; width: 24px; height: 21px; margin: -10.5px 0 0 -12px; }

/* Burst de impacto — flash branco, onda circular, "wisps" se afastando
   (pequenos borrões alongados, não fragmentos angulares de cristal/fogo) e
   fragmentos de energia arredondados. NÃO renderiza (display:none): a 30
   players, até 1800 wisps/frags animando simultaneamente respondiam pela
   maior fatia do custo de raster/GPU do impacto (medido); fantasma + rastro
   + número seguem intactos, só o "punch" visual do impacto some. */
.ss-hit { position: absolute; left: 50%; top: 0; width: 0; height: 0; display: none; }
.ss-hit__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(56px * var(--tscale, 1)); height: calc(56px * var(--tscale, 1));
  margin: calc(-28px * var(--tscale, 1)) 0 0 calc(-28px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #eaf6ff 40%, rgba(190, 220, 255, 0.6) 62%, rgba(190, 220, 255, 0) 76%);
  opacity: 0;
}
.ss-hit__ripple {
  position: absolute; left: 50%; top: 50%;
  width: calc(170px * var(--tscale, 1)); height: calc(170px * var(--tscale, 1));
  margin: calc(-85px * var(--tscale, 1)) 0 0 calc(-85px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(3px * var(--tscale, 1)) solid rgba(220, 240, 255, 0.8);
  box-shadow: 0 0 26px rgba(190, 220, 255, 0.6), inset 0 0 16px rgba(220, 240, 255, 0.4);
  opacity: 0;
}
.ss-hit__wisp {
  position: absolute; left: 50%; top: 50%;
  width: calc(10px * var(--tscale, 1)); height: calc(14px * var(--tscale, 1));
  margin: calc(-7px * var(--tscale, 1)) 0 0 calc(-5px * var(--tscale, 1));
  border-radius: 50% 50% 40% 40%;
  background: radial-gradient(ellipse, #ffffff, rgba(200, 225, 255, 0) 75%);
  filter: blur(0.3px);
  opacity: 0;
  transform: rotate(var(--wangle, 0deg));
}
.ss-hit__frag {
  position: absolute; left: 50%; top: 50%;
  width: calc(7px * var(--tscale, 1)); height: calc(7px * var(--tscale, 1));
  margin: calc(-3.5px * var(--tscale, 1)) 0 0 calc(-3.5px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff, #cfe6ff 60%, transparent 78%);
  opacity: 0;
  transform: rotate(var(--fangle, 0deg));
}
.ss-wrap--impact .ss-hit__flash { animation: ssHitFlash 220ms ease-out forwards; }
.ss-wrap--impact .ss-hit__ripple { animation: ssHitRipple 460ms ease-out forwards; }
.ss-wrap--impact .ss-hit__wisp { animation: ssHitWisp 620ms ease-out forwards; }
.ss-wrap--impact .ss-hit__frag { animation: ssHitFrag 380ms ease-out forwards; }
@keyframes ssHitFlash {
  0% { opacity: 0; transform: scale(0.4); }
  25% { opacity: 1; transform: scale(1.25); }
  100% { opacity: 0; transform: scale(2); }
}
@keyframes ssHitRipple {
  0% { opacity: 0.9; transform: scale(0.3); }
  100% { opacity: 0; transform: scale(2); }
}
@keyframes ssHitWisp {
  0% { opacity: 0; transform: rotate(var(--wangle, 0deg)) translateY(0) scale(0.6); }
  20% { opacity: 0.9; }
  100% { opacity: 0; transform: rotate(var(--wangle, 0deg)) translateY(calc(-46px * var(--tscale, 1))) scale(1.1); }
}
@keyframes ssHitFrag {
  0% { opacity: 1; transform: rotate(var(--fangle, 0deg)) translateX(0) scale(1); }
  100% { opacity: 0; transform: rotate(var(--fangle, 0deg)) translateX(calc(52px * var(--tscale, 1))) scale(0.4); }
}

/* Número de dano individual — mesma cachoeira das outras três, tom
   espiritual branco/azul. */
.ss-dmgnum {
  position: relative;
  left: var(--dmgx, 0px);
  transform: translate(-50%, 0) scale(0.4);
  font: 800 84px/1 "Segoe UI", system-ui, sans-serif;
  color: #eef8ff;
  text-shadow: 0 0 32px rgba(190, 220, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9), 0 0 56px rgba(150, 195, 240, 0.6);
  white-space: nowrap;
  opacity: 0;
  user-select: none;
  -webkit-user-select: none;
}
.ss-dmgnum--crit {
  font-size: 108px;
  color: #ffffff;
  text-shadow: 0 0 40px rgba(210, 235, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.ss-dmgnum--self { color: #ffb4b4; }
.ss-dmgnum--impact { animation: ssDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards; }
@keyframes ssDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}

/* total — SEMPRE amarelo, mesma convenção das outras três (só os hits
   individuais/impacto são coloridos por elemento; o número final de maior
   destaque não muda). */
.ss-total {
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
  animation: ssTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.ss-total--crit { color: #fff3c4; }
@keyframes ssTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

function useSoulStrikeStyles(): void {
  useEffect(() => {
    if (document.getElementById(SOUL_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = SOUL_STYLE_ID;
    tag.textContent = SOUL_CSS;
    document.head.appendChild(tag);
  }, []);
}
