import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";

/**
 * Thunder Storm (MG_THUNDERSTORM) — MESMA infra de dano/cascata de
 * `mage/cold-bolt/ColdBoltImpact.tsx` (`splitDamage`, 5 fatias, número por
 * hit, total amarelo no 5º, `<Html>` seguindo o alvo, escala por espécie) —
 * mas a DIFERENÇA estrutural pedida é literal: um raio SÓ (`Bolt`, sempre
 * visível durante a sequência inteira) em vez de 5 projéteis caindo. O que
 * se repete 5 vezes é o PULSO de impacto no chão — cada `Pulse` não cai, só
 * dispara no seu instante (`delayMs`), sem trajetória própria.
 *
 * Cada pulso tem DOIS efeitos, em Y diferentes (mesma técnica de offsets
 * verticais que `ColdBoltImpact` já usa pros números/total): a eletricidade
 * se espalhando pelo CHÃO (ramificações + anel, perto de `BODY_Y`) e o
 * choque no MONSTRO (flash + arcos ao redor do corpo, perto de `SHOCK_Y`) —
 * "não reutilizar o impacto de gelo nem de fogo" e "efeito proporcional ao
 * alvo" (`--tscale`, mesmo mecanismo dos outros dois).
 */

export const THUNDER_PULSES = 5;
export const THUNDER_PULSE_STAGGER_MS = 260;
export const THUNDER_PULSE_DAMAGE_NUMBER_MS = 1000;
const LAST_PULSE_AT_MS = (THUNDER_PULSES - 1) * THUNDER_PULSE_STAGGER_MS;
export const THUNDER_TOTAL_VISIBLE_MS = 1500;
/** duração total que o efeito precisa ficar vivo no `vfxStore` — mesmo
 * cálculo dos outros dois, usado por `vfx/mage/multiHitRegistry`. */
export const THUNDER_STORM_TOTAL_MS =
  Math.max(LAST_PULSE_AT_MS + THUNDER_PULSE_DAMAGE_NUMBER_MS, LAST_PULSE_AT_MS + THUNDER_TOTAL_VISIBLE_MS) + 300;
/** o raio PRINCIPAL (o que carrega dano de verdade, sempre no alvo) dissipa
 * um pouco depois do último pulso, não junto com ele — "raio permanece
 * visível" durante toda a sequência, só sai no fim */
const BOLT_DISSIPATE_AT_MS = LAST_PULSE_AT_MS + 420;

/**
 * Raios DECORATIVOS — a skill é AoE (`type:"area"` no skill_db), não um tiro
 * mirado num ponto só. O servidor só manda UM alvo/dano de verdade (o
 * monstro que realmente apanhou — "cliente nunca calcula dano"), então o
 * raio PRINCIPAL continua exatamente em cima dele (garante "se o inimigo
 * estiver na área, pega o dano nele"). Estes aqui caem em pontos ALEATÓRIOS
 * espalhados pelo raio da área (mesmo `areaRadius` que `AreaDisc`/`AreaCell`
 * já usam pro disco de telegrafia) — puramente visuais, sem número de dano,
 * pra tempestade parecer larga em vez de um feixe preso no alvo. Tocam
 * mesmo que não haja NADA naquela célula específica — "a animação da skill
 * na área independente de ter ou não inimigo".
 */
const DECOY_BOLT_COUNT = 5;
/** raio da área em unidades LOCAIS (o grupo já escala por `cellSize` em
 * `vfx/SkillVfx.tsx`, então isto vira "raio em células" na prática — mesma
 * convenção de `SPREAD_RADIUS` no Cold Bolt/Fire Lance). Só o PISO — o valor
 * de verdade vem do catálogo (`areaRadius` da skill, `vfx/SkillVfx.tsx` já
 * lê pro `AreaDisc`/`AreaCell` genéricos) e chega por prop; isto aqui só
 * cobre o efeito de teste/`__testarThunderStorm` e uma skill nunca vista
 * pelo catálogo ainda. */
const DEFAULT_AREA_RADIUS = 2.6;
/** os raios decorativos ficam de pé bem menos tempo que o principal — é
 * "vários raios caindo", não vários raios parados ao mesmo tempo */
const DECOY_HOLD_MS = 480;

function splitDamage(total: number, hits: number): number[] {
  const base = Math.floor(total / hits);
  const resto = total - base * hits;
  return Array.from({ length: hits }, (_, i) => base + (i === hits - 1 ? resto : 0));
}

const BODY_Y = 0.05;
/** altura do "choque" no corpo do monstro — mesma referência de `DMG_SPAWN_Y`
 * dos outros dois VFX (região do peito/torso, não a cabeça nem o chão) */
const SHOCK_Y = 1.1;
const HEAD_TOP_Y = 1.8;
const TOTAL_GAP_ABOVE_HEAD = 0.4;
const DMG_SPAWN_Y = 1.3;
const DMG_STACK_STEP = 0.08;
/** topo do raio (mundo) — bem acima da cabeça, "desceu do céu"; a arte em si
 * é `<Html>` (tela), então a ALTURA DESENHADA do raio é um número de PIXELS
 * separado (`BOLT_PIXEL_HEIGHT`), não este valor em unidades de mundo */
const BOLT_TOP_Y = 6.2;
/** altura em px do próprio desenho do raio, do topo (âncora) até o chão */
const BOLT_PIXEL_HEIGHT = 640;

interface PulseSpec {
  delayMs: number;
  dmg?: number;
  dmgJitterPx: number;
  dmgStackY: number;
  rotDeg: number;
}

function buildPulses(seed: number, dmgSlices: number[] | undefined): PulseSpec[] {
  const specs: PulseSpec[] = [];
  for (let i = 0; i < THUNDER_PULSES; i++) {
    specs.push({
      delayMs: i * THUNDER_PULSE_STAGGER_MS,
      dmg: dmgSlices?.[i],
      dmgJitterPx: (Math.random() - 0.5) * 64,
      dmgStackY: i * DMG_STACK_STEP,
      rotDeg: (i / THUNDER_PULSES) * 360 + seed * 360,
    });
  }
  return specs;
}

interface DecoySpec {
  dx: number;
  dz: number;
  appearAtMs: number;
}

/** espalhados por SORTEIO no disco (não numa grade) — é assim que uma
 * tempestade de raios cai de verdade, sem padrão visível. `radius` mínimo
 * 0.6 sempre respeitado: evita um decorativo nascer colado no raio
 * PRINCIPAL (que já fica exatamente no centro, em cima do alvo de verdade). */
function buildDecoys(seed: number, radius: number): DecoySpec[] {
  const out: DecoySpec[] = [];
  const raioUtil = Math.max(0.6, radius);
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < DECOY_BOLT_COUNT; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = 0.6 + rnd() * (raioUtil - 0.6);
    out.push({ dx: Math.cos(angle) * r, dz: Math.sin(angle) * r, appearAtMs: rnd() * LAST_PULSE_AT_MS });
  }
  return out;
}

export function ThunderStormImpact({
  onHit,
  damage,
  crit,
  onSelf,
  targetScale = 1,
  areaRadius,
}: {
  onHit?: (index: number) => void;
  damage?: number;
  crit?: boolean;
  onSelf?: boolean;
  targetScale?: number;
  /** raio de VERDADE da área da skill (célula, mesmo catálogo que
   * `AreaDisc`/`AreaCell` já leem em `vfx/SkillVfx.tsx`) — os raios
   * decorativos caem espalhados NESSE raio, não num chute fixo. Ausente
   * (skill nova/catálogo ainda não respondeu) cai no `DEFAULT_AREA_RADIUS`. */
  areaRadius?: number;
}) {
  useThunderStormStyles();
  const bornAt = useRef(performance.now());
  const dmgSlices = useMemo(
    () => (damage !== undefined && damage > 0 ? splitDamage(damage, THUNDER_PULSES) : undefined),
    [damage],
  );
  const specs = useMemo(() => buildPulses(Math.random(), dmgSlices), [dmgSlices]);
  const decoys = useMemo(
    () => buildDecoys(Math.random(), areaRadius ?? DEFAULT_AREA_RADIUS),
    [areaRadius],
  );
  const totalRef = useRef<FinalTotalHandle>(null);
  const hitsLanded = useRef(0);

  const handleHit = (i: number) => {
    onHit?.(i);
    hitsLanded.current += 1;
    if (hitsLanded.current === THUNDER_PULSES) totalRef.current?.trigger();
  };

  return (
    <group name="thunder-storm-impact">
      {/* raio PRINCIPAL — sempre exatamente em cima do alvo real */}
      <Bolt bornAt={bornAt.current} targetScale={targetScale} appearAtMs={0} goneAtMs={BOLT_DISSIPATE_AT_MS} />
      {/* raios decorativos — a AoE inteira, mesmo onde não há ninguém */}
      {decoys.map((d, i) => (
        <DecoyStrike key={i} spec={d} bornAt={bornAt.current} targetScale={targetScale} />
      ))}
      {specs.map((spec, i) => (
        <Pulse key={i} spec={spec} bornAt={bornAt.current} crit={crit ?? false} onSelf={onSelf ?? false} targetScale={targetScale} onHit={() => handleHit(i)} />
      ))}
      {dmgSlices && <FinalTotal ref={totalRef} total={damage ?? 0} crit={crit ?? false} targetScale={targetScale} />}
    </group>
  );
}

/**
 * O raio principal — nasce quase instantâneo (appear rápido), fica de pé
 * durante TODOS os pulsos, e só dissipa depois do último (`goneAtMs`).
 * `<Html>` fixo em `BOLT_TOP_Y` (mais `offsetX/offsetZ`, pros decorativos),
 * e a arte do próprio raio desce dele até o chão via CSS (altura fixa em
 * px) — não segue trajetória nenhuma porque ele NÃO é um projétil, é uma
 * coluna que fica de pé.
 */
function Bolt({
  bornAt,
  targetScale,
  appearAtMs,
  goneAtMs,
  offsetX = 0,
  offsetZ = 0,
}: {
  bornAt: number;
  targetScale: number;
  appearAtMs: number;
  goneAtMs: number;
  offsetX?: number;
  offsetZ?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const dissipated = useRef(false);

  useFrame(() => {
    const el = wrap.current;
    if (!el) return;
    const t = performance.now() - bornAt - appearAtMs;
    if (t < 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    if (!dissipated.current && t >= goneAtMs - appearAtMs) {
      dissipated.current = true;
      el.classList.add("ts-bolt-wrap--gone");
    }
  });

  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return (
    <group position={[offsetX, BOLT_TOP_Y * targetScale, offsetZ]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className="ts-bolt-wrap" style={{ display: "none", ...tscaleStyle }}>
          <div className="ts-bolt__glow" />
          <div className="ts-bolt__core" />
          <div className="ts-bolt__branch" style={{ "--by": "28%", "--brot": "-34deg" } as CSSProperties} />
          <div className="ts-bolt__branch" style={{ "--by": "52%", "--brot": "28deg" } as CSSProperties} />
          <div className="ts-bolt__branch" style={{ "--by": "74%", "--brot": "-22deg" } as CSSProperties} />
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="ts-bolt__mote"
              style={{ "--mangle": `${i * 60}deg`, "--mdelay": `${i * 90}ms` } as CSSProperties}
            />
          ))}
        </div>
      </Html>
    </group>
  );
}

/**
 * Um raio decorativo + um flash curto no chão onde ele cai — SEM número de
 * dano, sem choque no monstro (isto pode cair em célula vazia). `holdMs`
 * bem menor que o raio principal: "vários raios CAINDO", não vários de pé
 * ao mesmo tempo.
 */
function DecoyStrike({ spec, bornAt, targetScale }: { spec: DecoySpec; bornAt: number; targetScale: number }) {
  const flash = useRef<HTMLDivElement>(null);
  const struck = useRef(false);

  useFrame(() => {
    const el = flash.current;
    if (!el) return;
    const t = performance.now() - bornAt - spec.appearAtMs;
    const alive = t >= 0 && t < DECOY_HOLD_MS;
    el.style.display = alive ? "block" : "none";
    if (!alive) return;
    if (!struck.current) {
      struck.current = true;
      el.classList.add("ts-ground--impact");
    }
  });

  useEffect(() => {
    struck.current = false;
    flash.current?.classList.remove("ts-ground--impact");
  }, [spec]);

  const tscaleStyle = { "--tscale": targetScale * 0.7 } as CSSProperties;

  return (
    <>
      <Bolt
        bornAt={bornAt}
        targetScale={targetScale * 0.85}
        appearAtMs={spec.appearAtMs}
        goneAtMs={spec.appearAtMs + DECOY_HOLD_MS}
        offsetX={spec.dx}
        offsetZ={spec.dz}
      />
      <group position={[spec.dx, BODY_Y * targetScale, spec.dz]}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={flash} className="ts-ground" style={{ display: "none", ...tscaleStyle }}>
            <div className="ts-ground__flash" />
            <div className="ts-ground__ring" />
          </div>
        </Html>
      </group>
    </>
  );
}

const GROUND_ARC_COUNT = 7;
interface GroundArcSpec {
  angleDeg: number;
  lenPx: number;
}
function buildGroundArcs(seed: number): GroundArcSpec[] {
  const out: GroundArcSpec[] = [];
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < GROUND_ARC_COUNT; i++) {
    out.push({ angleDeg: (i / GROUND_ARC_COUNT) * 360 + rnd() * 30, lenPx: 46 + rnd() * 46 });
  }
  return out;
}

function Pulse({
  spec,
  bornAt,
  crit,
  onSelf,
  targetScale,
  onHit,
}: {
  spec: PulseSpec;
  bornAt: number;
  crit: boolean;
  onSelf: boolean;
  targetScale: number;
  onHit?: () => void;
}) {
  const groundWrap = useRef<HTMLDivElement>(null);
  const shockWrap = useRef<HTMLDivElement>(null);
  const dmgWrap = useRef<HTMLDivElement>(null);
  const hit = useRef(false);
  const groundArcs = useMemo(() => buildGroundArcs(Math.random() * 1000 + spec.delayMs + 1), [spec.delayMs]);

  useFrame(() => {
    const t = performance.now() - bornAt - spec.delayMs;
    const alive = t >= 0 && t < THUNDER_PULSE_DAMAGE_NUMBER_MS;
    if (groundWrap.current) groundWrap.current.style.display = alive ? "block" : "none";
    if (shockWrap.current) shockWrap.current.style.display = alive ? "block" : "none";
    if (dmgWrap.current) dmgWrap.current.style.display = alive ? "block" : "none";
    if (!alive) return;

    if (!hit.current && t >= 0) {
      hit.current = true;
      groundWrap.current?.classList.add("ts-ground--impact");
      shockWrap.current?.classList.add("ts-shock--impact");
      dmgWrap.current?.classList.add("ts-dmgnum--impact");
      onHit?.();
    }
  });

  useEffect(() => {
    hit.current = false;
    groundWrap.current?.classList.remove("ts-ground--impact");
    shockWrap.current?.classList.remove("ts-shock--impact");
    dmgWrap.current?.classList.remove("ts-dmgnum--impact");
  }, [spec]);

  const tscaleStyle = { "--tscale": targetScale, "--rot": `${spec.rotDeg}deg` } as CSSProperties;

  return (
    <group>
      {/* chão: anel + ramificações elétricas correndo e sumindo */}
      <group position={[0, BODY_Y * targetScale, 0]}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={groundWrap} className="ts-ground" style={{ display: "none", ...tscaleStyle }}>
            <div className="ts-ground__flash" />
            <div className="ts-ground__ring" />
            {groundArcs.map((a, i) => (
              <div
                key={i}
                className="ts-ground__branch"
                style={{ "--gangle": `${a.angleDeg}deg`, "--glen": `${a.lenPx}px` } as CSSProperties}
              />
            ))}
          </div>
        </Html>
      </group>
      {/* monstro: choque elétrico no corpo — flash + arcos ao redor, efeito
          PRÓPRIO, não o mesmo do chão */}
      <group position={[0, SHOCK_Y * targetScale, 0]}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={shockWrap} className="ts-shock" style={{ display: "none", ...tscaleStyle }}>
            <div className="ts-shock__flash" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="ts-shock__arc" style={{ "--sangle": `${i * 72}deg` } as CSSProperties} />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="ts-shock__spark" style={{ "--pangle": `${i * 60 + 30}deg` } as CSSProperties} />
            ))}
          </div>
        </Html>
      </group>
      {spec.dmg !== undefined && (
        <group position={[0, (DMG_SPAWN_Y + spec.dmgStackY) * targetScale, 0]}>
          <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
            <div
              ref={dmgWrap}
              className={`ts-dmgnum${crit ? " ts-dmgnum--crit" : ""}${onSelf ? " ts-dmgnum--self" : ""}`}
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
    el.style.display = t < THUNDER_TOTAL_VISIBLE_MS ? "block" : "none";
  });

  return (
    <group position={[0, (HEAD_TOP_Y + TOTAL_GAP_ABOVE_HEAD) * targetScale, 0]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className={`ts-total${crit ? " ts-total--crit" : ""}`} style={{ display: "none" }}>
          {total}
        </div>
      </Html>
    </group>
  );
});

const THUNDER_STYLE_ID = "thunder-storm-impact-style";
const THUNDER_CSS = `
/* ---- o raio único ---- */
.ts-bolt-wrap {
  position: relative; width: 0; height: 0; pointer-events: none;
  animation: tsBoltAppear 100ms ease-out;
}
.ts-bolt-wrap--gone { animation: tsBoltGone 260ms ease-in forwards; }
.ts-bolt__core {
  position: absolute; left: 50%; top: 0;
  width: calc(70px * var(--tscale, 1)); height: calc(${BOLT_PIXEL_HEIGHT}px * var(--tscale, 1));
  margin-left: calc(-35px * var(--tscale, 1));
  clip-path: polygon(45.5% 0%, 57.5% 14%, 35.5% 30%, 53.5% 46%, 33.5% 62%, 47.5% 80%, 43.5% 100%,
    52.5% 100%, 56.5% 80%, 42.5% 62%, 62.5% 46%, 44.5% 30%, 66.5% 14%, 54.5% 0%);
  background: linear-gradient(180deg, #ffffff 0%, #eaf6ff 30%, #a9d8ff 60%, #6ab4ff 100%);
  filter: drop-shadow(0 0 10px rgba(150, 210, 255, 0.95)) drop-shadow(0 0 26px rgba(90, 170, 255, 0.7));
  animation: tsBoltFlicker 180ms ease-in-out infinite;
}
.ts-bolt__glow {
  position: absolute; left: 50%; top: 0;
  width: calc(160px * var(--tscale, 1)); height: calc(${BOLT_PIXEL_HEIGHT}px * var(--tscale, 1));
  margin-left: calc(-80px * var(--tscale, 1));
  clip-path: polygon(45.5% 0%, 57.5% 14%, 35.5% 30%, 53.5% 46%, 33.5% 62%, 47.5% 80%, 43.5% 100%,
    52.5% 100%, 56.5% 80%, 42.5% 62%, 62.5% 46%, 44.5% 30%, 66.5% 14%, 54.5% 0%);
  background: rgba(120, 190, 255, 0.35);
  filter: blur(10px);
  opacity: 0.8;
}
/* pequenos arcos elétricos saindo do corpo do raio, em alturas diferentes */
.ts-bolt__branch {
  position: absolute; left: 50%; top: var(--by, 40%); width: calc(40px * var(--tscale, 1)); height: 2px;
  margin-left: calc(-20px * var(--tscale, 1));
  transform: rotate(var(--brot, 0deg));
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 5px rgba(180, 225, 255, 0.9));
  opacity: 0;
  animation: tsBoltBranch 420ms ease-in-out infinite;
}
/* partículas elétricas soltas ao redor do raio inteiro */
.ts-bolt__mote {
  position: absolute; left: 50%; top: 40%; width: calc(4px * var(--tscale, 1)); height: calc(4px * var(--tscale, 1));
  margin: calc(-2px * var(--tscale, 1)) 0 0 calc(-2px * var(--tscale, 1));
  border-radius: 50%;
  background: #eaf6ff;
  box-shadow: 0 0 6px 2px rgba(160, 215, 255, 0.9);
  opacity: 0;
  animation: tsBoltMote 900ms ease-in-out var(--mdelay, 0ms) infinite;
}
@keyframes tsBoltAppear { from { opacity: 0; } to { opacity: 1; } }
@keyframes tsBoltGone { from { opacity: 1; } to { opacity: 0; } }
@keyframes tsBoltFlicker { 0%, 100% { opacity: 1; } 45% { opacity: 0.55; } 60% { opacity: 1; } 80% { opacity: 0.7; } }
@keyframes tsBoltBranch {
  0%, 100% { opacity: 0; transform: rotate(var(--brot, 0deg)) scaleX(0.6); }
  50% { opacity: 0.9; transform: rotate(var(--brot, 0deg)) scaleX(1); }
}
@keyframes tsBoltMote {
  0%, 100% { opacity: 0; transform: rotate(var(--mangle)) translateX(calc(50px * var(--tscale, 1))) scale(0.6); }
  50% { opacity: 1; transform: rotate(var(--mangle)) translateX(calc(64px * var(--tscale, 1))) scale(1); }
}

/* ---- pulso no chão: flash + anel + ramificações espalhando e sumindo ---- */
.ts-ground { position: relative; width: 0; height: 0; pointer-events: none; }
.ts-ground__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(70px * var(--tscale, 1)); height: calc(70px * var(--tscale, 1));
  margin: calc(-35px * var(--tscale, 1)) 0 0 calc(-35px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #cfe9ff 35%, rgba(120, 190, 255, 0.6) 60%, rgba(120, 190, 255, 0) 75%);
  opacity: 0;
}
.ts-ground__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(190px * var(--tscale, 1)); height: calc(70px * var(--tscale, 1));
  margin: calc(-35px * var(--tscale, 1)) 0 0 calc(-95px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(4px * var(--tscale, 1)) solid rgba(170, 220, 255, 0.85);
  box-shadow: 0 0 30px rgba(120, 190, 255, 0.7);
  opacity: 0;
}
/* ramificações radiais no CHÃO — linha reta que estica pra fora e some,
   "energia se espalhando pelo chão" */
.ts-ground__branch {
  position: absolute; left: 50%; top: 50%; height: 2px; width: var(--glen);
  margin-top: -1px;
  transform: rotate(var(--gangle)) scaleX(0.15);
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(140, 205, 255, 0));
  filter: drop-shadow(0 0 4px rgba(160, 215, 255, 0.9));
  opacity: 0;
}
.ts-ground--impact .ts-ground__flash { animation: tsGroundFlash 260ms ease-out forwards; }
.ts-ground--impact .ts-ground__ring { animation: tsGroundRing 520ms ease-out forwards; }
.ts-ground--impact .ts-ground__branch { animation: tsGroundBranch 480ms ease-out forwards; }
@keyframes tsGroundFlash {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; transform: scale(1.2); }
  100% { opacity: 0; transform: scale(1.8); }
}
@keyframes tsGroundRing {
  0% { opacity: 0.9; transform: scale(0.2, 0.2); }
  100% { opacity: 0; transform: scale(2, 2); }
}
@keyframes tsGroundBranch {
  0% { opacity: 1; transform: rotate(var(--gangle)) scaleX(0.15); }
  30% { opacity: 1; transform: rotate(var(--gangle)) scaleX(1); }
  100% { opacity: 0; transform: rotate(var(--gangle)) scaleX(1); }
}

/* ---- choque no monstro: flash + arcos ao redor do corpo ---- */
.ts-shock { position: relative; width: 0; height: 0; pointer-events: none; }
.ts-shock__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(58px * var(--tscale, 1)); height: calc(58px * var(--tscale, 1));
  margin: calc(-29px * var(--tscale, 1)) 0 0 calc(-29px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #d8ecff 40%, rgba(140, 205, 255, 0) 72%);
  opacity: 0;
}
/* arcos curtos ao redor do corpo — distinto das ramificações do chão: aqui
   é um leque curto preso perto do centro, não uma linha que estica longe */
.ts-shock__arc {
  position: absolute; left: 50%; top: 50%; width: calc(26px * var(--tscale, 1)); height: calc(3px * var(--tscale, 1));
  margin-top: calc(-1.5px * var(--tscale, 1));
  transform: rotate(var(--sangle));
  transform-origin: 0% 50%;
  background: linear-gradient(90deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 5px rgba(180, 225, 255, 0.95));
  opacity: 0;
}
.ts-shock__spark {
  position: absolute; left: 50%; top: 50%; width: calc(5px * var(--tscale, 1)); height: calc(5px * var(--tscale, 1));
  margin: calc(-2.5px * var(--tscale, 1)) 0 0 calc(-2.5px * var(--tscale, 1));
  border-radius: 50%;
  background: #eaf6ff;
  box-shadow: 0 0 8px 2px rgba(160, 215, 255, 0.95);
  opacity: 0;
}
.ts-shock--impact .ts-shock__flash { animation: tsShockFlash 220ms ease-out forwards; }
.ts-shock--impact .ts-shock__arc { animation: tsShockArc 360ms ease-out forwards; }
.ts-shock--impact .ts-shock__spark { animation: tsShockSpark 500ms ease-out forwards; }
@keyframes tsShockFlash {
  0% { opacity: 0; transform: scale(0.4); }
  30% { opacity: 1; transform: scale(1.3); }
  100% { opacity: 0; transform: scale(1.9); }
}
@keyframes tsShockArc {
  0% { opacity: 1; transform: rotate(var(--sangle)) scaleX(0.3); }
  35% { opacity: 1; transform: rotate(var(--sangle)) scaleX(1.2); }
  100% { opacity: 0; transform: rotate(var(--sangle)) scaleX(1); }
}
@keyframes tsShockSpark {
  0% { opacity: 1; transform: rotate(var(--pangle)) translateX(calc(6px * var(--tscale, 1))) scale(1); }
  100% { opacity: 0; transform: rotate(var(--pangle)) translateX(calc(48px * var(--tscale, 1))) scale(0.4); }
}

/* ---- número de dano — mesma cachoeira, tom elétrico ---- */
.ts-dmgnum {
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
.ts-dmgnum--crit {
  font-size: 108px;
  color: #f2f9ff;
  text-shadow: 0 0 40px rgba(180, 220, 255, 0.95), 0 8px 0 rgba(0, 0, 0, 0.9), 0 -8px 0 rgba(0, 0, 0, 0.9),
    8px 0 0 rgba(0, 0, 0, 0.9), -8px 0 0 rgba(0, 0, 0, 0.9);
}
.ts-dmgnum--self { color: #ffb4b4; }
.ts-dmgnum--impact { animation: tsDmgNum 1000ms cubic-bezier(0.33, 0.4, 0.4, 1) forwards; }
@keyframes tsDmgNum {
  0% { opacity: 0; transform: translate(calc(-50% + 0px), 24px) scale(0.4); }
  10% { opacity: 1; transform: translate(calc(-50% + 0px), -40px) scale(1.2); }
  22% { opacity: 1; transform: translate(calc(-50% + 8px), -56px) scale(1); }
  55% { opacity: 0.75; transform: translate(calc(-50% + 280px), 240px) scale(0.95); }
  100% { opacity: 0; transform: translate(calc(-50% + 520px), 520px) scale(0.8); }
}

/* total SEMPRE amarelo — mesma convenção das outras duas skills (é o número
   de maior destaque da sequência, a cor de "resultado final" não muda por
   elemento; só os hits individuais e os efeitos de impacto são coloridos
   por elemento). Tom levemente mais frio (dourado-elétrico) que o do Cold
   Bolt/Fire Lance só pra combinar com o resto do VFX azul, mas ainda
   inequivocamente amarelo. */
.ts-total {
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
  animation: tsTotalShow 1400ms cubic-bezier(0.16, 0.84, 0.28, 1);
}
.ts-total--crit { color: #fff3c4; }
@keyframes tsTotalShow {
  0% { opacity: 0; transform: translate(-50%, 32px) scale(0.3); }
  16% { opacity: 1; transform: translate(-50%, -24px) scale(1.3); }
  32% { transform: translate(-50%, -40px) scale(1.08); }
  78% { opacity: 1; transform: translate(-50%, -40px) scale(1.08); }
  100% { opacity: 0; transform: translate(-50%, -88px) scale(1); }
}
`;

function useThunderStormStyles(): void {
  useEffect(() => {
    if (document.getElementById(THUNDER_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = THUNDER_STYLE_ID;
    tag.textContent = THUNDER_CSS;
    document.head.appendChild(tag);
  }, []);
}
