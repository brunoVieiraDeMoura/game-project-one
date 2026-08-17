import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { CSSProperties } from "react";
import { anchorDeArma } from "../../../entities/weaponAnchors";
import { createSeededRng } from "../../core/particleMath";

/**
 * Thunder Storm (MG_THUNDERSTORM) — cast elétrico no CASTER, CSS puro.
 *
 * MESMA estrutura de `mage/cold-bolt/ColdBoltCastFrost.tsx` (relógio único
 * `expiresAt`/`durationMs`, ancorado na ponta do cajado, fallback no peito) —
 * ver aquele arquivo pro raciocínio completo, não duplicado aqui.
 *
 * Partículas elétricas (ponto brilhante orbitando) + pequenos arcos (linha
 * fina entre dois pontos próximos, pisca) + partículas subindo — três
 * famílias, pedido explícito. "Sensação de eletricidade aumentando" é o
 * MESMO mecanismo de `--intensity` do Fire Lance (glow cresce com `life`),
 * aqui azul/branco em vez de laranja.
 */

const FADE_IN_FRAC = 0.2;
const RELEASE_FRAC = 0.86;
const SPARK_COUNT = 8;
const ARC_COUNT = 4;
const RISE_COUNT = 5;
const CLOUD_Y = 1.05;

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
  for (let i = 0; i < ARC_COUNT; i++) {
    out.push({
      rotateDeg: (i / ARC_COUNT) * 360 + rnd() * 50,
      lenPx: 26 + rnd() * 20,
      durMs: 260 + rnd() * 220,
      delayMs: rnd() * 500,
    });
  }
  return out;
}

export function ThunderStormCastElectric({
  x,
  y,
  z,
  sourceGid,
  expiresAt,
}: {
  x: number;
  y: number;
  z: number;
  sourceGid: number;
  expiresAt: number;
}) {
  useCastElectricStyles();
  const born = useRef(performance.now());
  const total = Math.max(200, expiresAt - born.current);
  const sparks = useMemo(() => buildOrbit(Math.random() * 1000 + 1, SPARK_COUNT, 20, 16), []);
  const rising = useMemo(() => buildOrbit(Math.random() * 1000 + 2, RISE_COUNT, 14, 22), []);
  const arcs = useMemo(() => buildArcs(Math.random() * 1000 + 3), []);
  const group = useRef<THREE.Group>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const released = useRef(false);
  const worldPos = useRef(new THREE.Vector3());

  useFrame(() => {
    const g = group.current;
    const el = wrap.current;
    if (!g || !el) return;

    const tip = anchorDeArma(sourceGid);
    if (tip) {
      tip.getWorldPosition(worldPos.current);
      g.position.copy(worldPos.current);
    } else {
      g.position.set(x, y + CLOUD_Y, z);
    }

    const t = performance.now() - born.current;
    const life = Math.min(1, t / total);
    el.style.opacity = life < FADE_IN_FRAC ? String(life / FADE_IN_FRAC) : "1";
    if (glow.current) glow.current.style.setProperty("--intensity", String(0.45 + life * 0.75));
    if (!released.current && life >= RELEASE_FRAC) {
      released.current = true;
      el.classList.add("ts-cast-elec--release");
    }
  });

  return (
    <group ref={group}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude pointerEvents="none">
        <div ref={wrap} className="ts-cast-elec">
          <div ref={glow} className="ts-cast-elec__glow" />
          {sparks.map((p, i) => (
            <div
              key={`sp${i}`}
              className="ts-cast-elec__spark"
              style={
                {
                  "--angle": `${p.angleDeg}deg`,
                  "--radius": `${p.radiusPx}px`,
                  "--pdur": `${p.durMs}ms`,
                  "--pdelay": `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
          {rising.map((p, i) => (
            <div
              key={`ri${i}`}
              className="ts-cast-elec__rise"
              style={
                {
                  "--angle": `${p.angleDeg}deg`,
                  "--radius": `${p.radiusPx}px`,
                  "--rise": `${p.risePx * 2.4}px`,
                  "--pdur": `${p.durMs * 1.6}ms`,
                  "--pdelay": `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
          {arcs.map((a, i) => (
            <div
              key={`arc${i}`}
              className="ts-cast-elec__arc"
              style={
                {
                  "--rot": `${a.rotateDeg}deg`,
                  "--len": `${a.lenPx}px`,
                  "--pdur": `${a.durMs}ms`,
                  "--pdelay": `${a.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
          <div className="ts-cast-elec__burst" />
        </div>
      </Html>
    </group>
  );
}

const CAST_ELECTRIC_STYLE_ID = "thunder-storm-cast-electric-style";
const CAST_ELECTRIC_CSS = `
.ts-cast-elec { position: relative; width: 4px; height: 4px; pointer-events: none; }
.ts-cast-elec__glow {
  position: absolute; left: 50%; top: 50%; width: 100px; height: 100px;
  margin: -50px 0 0 -50px; border-radius: 50%;
  background: radial-gradient(circle, rgba(180, 220, 255, calc(0.32 * var(--intensity, 0.45))), rgba(120, 190, 255, 0) 72%);
  animation: tsCastGlow 560ms ease-in-out infinite;
}
.ts-cast-elec__spark {
  position: absolute; left: 50%; top: 50%; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: #f2fbff;
  box-shadow: 0 0 7px 2px rgba(150, 210, 255, 0.95);
  opacity: 0;
  animation: tsCastSpark var(--pdur) ease-in-out var(--pdelay) infinite;
}
.ts-cast-elec__rise {
  position: absolute; left: 50%; top: 50%; width: 4px; height: 10px; margin: -5px 0 0 -2px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ffffff, #8ecbff);
  filter: drop-shadow(0 0 5px rgba(140, 200, 255, 0.9));
  opacity: 0;
  animation: tsCastRise var(--pdur) ease-in var(--pdelay) infinite;
}
/* arco elétrico: um traço fino que pisca rápido — não uma partícula orbitando */
.ts-cast-elec__arc {
  position: absolute; left: 50%; top: 50%; width: 2px; height: var(--len);
  margin-left: -1px;
  transform: rotate(var(--rot));
  transform-origin: 50% 0%;
  background: linear-gradient(180deg, #ffffff, rgba(150, 210, 255, 0));
  filter: drop-shadow(0 0 4px rgba(180, 225, 255, 0.95));
  opacity: 0;
  animation: tsCastArc var(--pdur) linear var(--pdelay) infinite;
}
.ts-cast-elec--release .ts-cast-elec__spark,
.ts-cast-elec--release .ts-cast-elec__rise,
.ts-cast-elec--release .ts-cast-elec__arc {
  animation: tsCastDischarge 260ms ease-out forwards;
}
.ts-cast-elec__burst {
  position: absolute; left: 50%; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #cfe9ff 40%, rgba(120, 190, 255, 0) 72%);
  opacity: 0;
}
.ts-cast-elec--release .ts-cast-elec__burst { animation: tsCastBurst 260ms ease-out forwards; }
@keyframes tsCastGlow {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(calc(1 + 0.2 * var(--intensity, 0.45))); }
}
@keyframes tsCastSpark {
  0%, 100% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) scale(0.6); }
  10% { opacity: 1; transform: rotate(var(--angle)) translateX(var(--radius)) scale(1.4); }
  24% { opacity: 0; }
}
@keyframes tsCastRise {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) translateY(0) scale(0.6); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) translateY(calc(-1 * var(--rise))) scale(0.9); }
}
@keyframes tsCastArc {
  0%, 100% { opacity: 0; }
  6% { opacity: 1; }
  12% { opacity: 0; }
  50% { opacity: 0; }
  56% { opacity: 0.9; }
  60% { opacity: 0; }
}
@keyframes tsCastDischarge {
  0% { opacity: 1; }
  100% { opacity: 0; transform: scale(0.4); }
}
@keyframes tsCastBurst {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(6); }
}
`;

function useCastElectricStyles(): void {
  useEffect(() => {
    if (document.getElementById(CAST_ELECTRIC_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = CAST_ELECTRIC_STYLE_ID;
    tag.textContent = CAST_ELECTRIC_CSS;
    document.head.appendChild(tag);
  }, []);
}
