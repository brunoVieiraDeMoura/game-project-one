import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { CSSProperties } from "react";
import { anchorDeArma } from "../../../entities/weaponAnchors";
import { createSeededRng } from "../../core/particleMath";

/**
 * Petrificar (MG_STONECURSE) — cast no CASTER, CSS puro. MESMA estrutura de
 * `mage/fire-lance/FireLanceCastFire.tsx` (relógio único, âncora na ponta do
 * cajado, `--intensity` crescente) — paleta roxo/cinza sobrenatural em vez
 * de fogo, e as partículas orbitam mais LENTO/pesado (sensação de energia
 * amaldiçoada se concentrando, não faísca rápida).
 */

const FADE_IN_FRAC = 0.22;
const RELEASE_FRAC = 0.86;
const MOTE_COUNT = 7;
const GLIMMER_COUNT = 5;
const CLOUD_Y = 1.05;

interface ParticleSpec {
  angleDeg: number;
  radiusPx: number;
  durMs: number;
  delayMs: number;
}

function buildParticles(seed: number, count: number, radiusBase: number, radiusJitter: number): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < count; i++) {
    out.push({
      angleDeg: (i / count) * 360 + rnd() * 40,
      radiusPx: radiusBase + rnd() * radiusJitter,
      durMs: 900 + rnd() * 500,
      delayMs: rnd() * 560,
    });
  }
  return out;
}

export function StoneCurseCast({
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
  useCurseCastStyles();
  const born = useRef(performance.now());
  const total = Math.max(200, expiresAt - born.current);
  const motes = useMemo(() => buildParticles(Math.random() * 1000 + 1, MOTE_COUNT, 24, 20), []);
  const glimmers = useMemo(() => buildParticles(Math.random() * 1000 + 2, GLIMMER_COUNT, 18, 24), []);
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
    if (glow.current) glow.current.style.setProperty("--intensity", String(0.5 + life * 0.7));
    if (!released.current && life >= RELEASE_FRAC) {
      released.current = true;
      el.classList.add("sc-cast--release");
    }
  });

  return (
    <group ref={group}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude pointerEvents="none">
        <div ref={wrap} className="sc-cast">
          <div ref={glow} className="sc-cast__glow" />
          {motes.map((p, i) => (
            <div
              key={`m${i}`}
              className="sc-cast__mote"
              style={{ "--angle": `${p.angleDeg}deg`, "--radius": `${p.radiusPx}px`, "--pdur": `${p.durMs}ms`, "--pdelay": `${p.delayMs}ms` } as CSSProperties}
            />
          ))}
          {glimmers.map((p, i) => (
            <div
              key={`g${i}`}
              className="sc-cast__glimmer"
              style={{ "--angle": `${p.angleDeg}deg`, "--radius": `${p.radiusPx}px`, "--pdur": `${Math.max(260, p.durMs * 0.5)}ms`, "--pdelay": `${p.delayMs}ms` } as CSSProperties}
            />
          ))}
          <div className="sc-cast__eye" />
          <div className="sc-cast__burst" />
        </div>
      </Html>
    </group>
  );
}

const CAST_STYLE_ID = "stone-curse-cast-style";
const CAST_CSS = `
.sc-cast { position: relative; width: 4px; height: 4px; pointer-events: none; }
.sc-cast__glow {
  position: absolute; left: 50%; top: 50%; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%;
  background: radial-gradient(circle, rgba(150, 110, 190, calc(0.3 * var(--intensity, 0.5))), rgba(80, 40, 110, 0) 72%);
  animation: scCastGlow 760ms ease-in-out infinite;
}
.sc-cast__eye {
  position: absolute; left: 50%; top: 50%; width: 14px; height: 8px; margin: -4px 0 0 -7px;
  border-radius: 50%;
  background: radial-gradient(circle, #f4e6ff 0%, #b98aff 55%, rgba(120, 60, 170, 0) 80%);
  opacity: 0.85;
  animation: scCastEye 900ms ease-in-out infinite;
}
.sc-cast__mote {
  position: absolute; left: 50%; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: radial-gradient(circle, #e6d4ff, #8a5cc9 60%, transparent 78%);
  filter: drop-shadow(0 0 5px rgba(150, 100, 200, 0.85));
  opacity: 0;
  animation: scCastOrbit var(--pdur) ease-in-out var(--pdelay) infinite;
}
.sc-cast__glimmer {
  position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: #d8c2ff;
  box-shadow: 0 0 6px 2px rgba(160, 120, 210, 0.85);
  opacity: 0;
  animation: scCastGlimmer var(--pdur) ease-in-out var(--pdelay) infinite;
}
.sc-cast--release .sc-cast__mote,
.sc-cast--release .sc-cast__glimmer,
.sc-cast--release .sc-cast__eye {
  animation: scCastScatter 320ms ease-out forwards;
}
.sc-cast__burst {
  position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
  background: radial-gradient(circle, #efe0ff 0%, #9a68d6 45%, rgba(80, 40, 110, 0) 72%);
  opacity: 0;
}
.sc-cast--release .sc-cast__burst { animation: scCastBurst 300ms ease-out forwards; }
@keyframes scCastGlow { 0%, 100% { transform: scale(1); } 50% { transform: scale(calc(1 + 0.16 * var(--intensity, 0.5))); } }
@keyframes scCastEye { 0%, 100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
@keyframes scCastOrbit {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) scale(0.5); }
  20% { opacity: 0.95; }
  100% { opacity: 0.2; transform: rotate(calc(var(--angle) + 120deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 120deg) * -1)) scale(0.9); }
}
@keyframes scCastGlimmer {
  0%, 100% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) scale(0.6); }
  10% { opacity: 1; transform: rotate(var(--angle)) translateX(var(--radius)) scale(1.2); }
  24% { opacity: 0; }
}
@keyframes scCastScatter {
  0% { opacity: 1; transform: rotate(var(--angle, 0deg)) translateX(var(--radius, 0px)) scale(1); }
  100% { opacity: 0; transform: rotate(var(--angle, 0deg)) translateX(calc(var(--radius, 0px) * 3)) scale(0.3); }
}
@keyframes scCastBurst {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(6); }
}
`;

function useCurseCastStyles(): void {
  useEffect(() => {
    if (document.getElementById(CAST_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = CAST_STYLE_ID;
    tag.textContent = CAST_CSS;
    document.head.appendChild(tag);
  }, []);
}
