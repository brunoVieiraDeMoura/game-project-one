import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { CSSProperties } from "react";
import { anchorDeArma } from "../../../entities/weaponAnchors";
import { createSeededRng } from "../../core/particleMath";

/**
 * Fire Lance (MG_FIREBOLT) — cast de fogo no CASTER, CSS puro.
 *
 * MESMA estrutura de `mage/cold-bolt/ColdBoltCastFrost.tsx` (relógio único
 * `expiresAt`/`durationMs`, ancorado na ponta do cajado via `anchorDeArma`,
 * fallback no peito se a arma ainda não montou) — só o VFX muda pra fogo.
 * Ver o docblock daquele arquivo pra o raciocínio completo de posição/timing;
 * não duplicado aqui de propósito.
 *
 * Três famílias de partícula (pedido explícito): brasas (losango, sobe
 * devagar), faíscas (ponto pequeno, pisca rápido) e chamas orbitando (forma
 * de labareda, maior, gira mais lento). Ao contrário do gelo, o glow CRESCE
 * ao longo do cast (`--intensity`, escrito por quadro a partir de `life`) —
 * "intensidade aumentando" é um pedido próprio desta skill, não só o
 * fade-in que o Cold Bolt já tinha.
 */

const FADE_IN_FRAC = 0.22;
const RELEASE_FRAC = 0.86;
const EMBER_COUNT = 6;
const SPARK_COUNT = 5;
const FLAME_COUNT = 4;
/** altura acima do pé do caster onde a chama paira — mesma referência do Cold Bolt */
const CLOUD_Y = 1.05;

interface ParticleSpec {
  angleDeg: number;
  radiusPx: number;
  risePx: number;
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
      risePx: i % 2 === 0 ? 22 + rnd() * 14 : 4 + rnd() * 6,
      durMs: 700 + rnd() * 420,
      delayMs: rnd() * 500,
    });
  }
  return out;
}

export function FireLanceCastFire({
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
  useCastFireStyles();
  const born = useRef(performance.now());
  const total = Math.max(200, expiresAt - born.current);
  const embers = useMemo(() => buildParticles(Math.random() * 1000 + 1, EMBER_COUNT, 22, 18), []);
  const sparks = useMemo(() => buildParticles(Math.random() * 1000 + 2, SPARK_COUNT, 16, 22), []);
  const flames = useMemo(() => buildParticles(Math.random() * 1000 + 3, FLAME_COUNT, 26, 10), []);
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
    // intensidade crescente: o glow engorda e clareia conforme o cast avança,
    // não só aparece — é o que dá a sensação de "energia se concentrando"
    if (glow.current) glow.current.style.setProperty("--intensity", String(0.5 + life * 0.7));
    if (!released.current && life >= RELEASE_FRAC) {
      released.current = true;
      el.classList.add("fl-cast-fire--release");
    }
  });

  return (
    <group ref={group}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude pointerEvents="none">
        <div ref={wrap} className="fl-cast-fire">
          <div ref={glow} className="fl-cast-fire__glow" />
          {embers.map((p, i) => (
            <div
              key={`e${i}`}
              className="fl-cast-fire__ember"
              style={
                {
                  "--angle": `${p.angleDeg}deg`,
                  "--radius": `${p.radiusPx}px`,
                  "--rise": `${p.risePx}px`,
                  "--pdur": `${p.durMs}ms`,
                  "--pdelay": `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
          {sparks.map((p, i) => (
            <div
              key={`s${i}`}
              className="fl-cast-fire__spark"
              style={
                {
                  "--angle": `${p.angleDeg}deg`,
                  "--radius": `${p.radiusPx}px`,
                  "--pdur": `${Math.max(220, p.durMs * 0.4)}ms`,
                  "--pdelay": `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
          {flames.map((p, i) => (
            <div
              key={`f${i}`}
              className="fl-cast-fire__flame"
              style={
                {
                  "--angle": `${p.angleDeg}deg`,
                  "--radius": `${p.radiusPx}px`,
                  "--pdur": `${p.durMs * 1.3}ms`,
                  "--pdelay": `${p.delayMs}ms`,
                } as CSSProperties
              }
            />
          ))}
          <div className="fl-cast-fire__burst" />
          {embers.slice(0, 4).map((_, i) => (
            <div key={`fw${i}`} className="fl-cast-fire__forward" style={{ "--fwangle": `${i * 22 - 33}deg` } as CSSProperties} />
          ))}
        </div>
      </Html>
    </group>
  );
}

const CAST_FIRE_STYLE_ID = "fire-lance-cast-fire-style";
const CAST_FIRE_CSS = `
.fl-cast-fire { position: relative; width: 4px; height: 4px; pointer-events: none; }
.fl-cast-fire__glow {
  position: absolute; left: 50%; top: 50%; width: 96px; height: 96px;
  margin: -48px 0 0 -48px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 170, 60, calc(0.28 * var(--intensity, 0.5))), rgba(255, 90, 20, 0) 72%);
  animation: flCastGlow 640ms ease-in-out infinite;
}
.fl-cast-fire__ember {
  position: absolute; left: 50%; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px;
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: linear-gradient(160deg, #fff3c4 0%, #ffb347 45%, #d1440b 100%);
  filter: drop-shadow(0 0 5px rgba(255, 140, 40, 0.9));
  opacity: 0;
  animation: flCastOrbit var(--pdur) ease-in-out var(--pdelay) infinite;
}
.fl-cast-fire__spark {
  position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: #fff3c4;
  box-shadow: 0 0 6px 2px rgba(255, 210, 120, 0.9);
  opacity: 0;
  animation: flCastSpark var(--pdur) ease-in-out var(--pdelay) infinite;
}
.fl-cast-fire__flame {
  position: absolute; left: 50%; top: 50%; width: 16px; height: 20px; margin: -16px 0 0 -8px;
  clip-path: polygon(50% 0%, 80% 42%, 68% 62%, 92% 78%, 50% 100%, 8% 78%, 32% 62%, 20% 42%);
  background: linear-gradient(0deg, #ff5a1f 0%, #ff9d3a 55%, #ffe27a 100%);
  filter: drop-shadow(0 0 7px rgba(255, 110, 30, 0.85));
  opacity: 0;
  transform-origin: 50% 100%;
  animation: flCastFlameOrbit var(--pdur) ease-in-out var(--pdelay) infinite;
}
.fl-cast-fire--release .fl-cast-fire__ember,
.fl-cast-fire--release .fl-cast-fire__spark,
.fl-cast-fire--release .fl-cast-fire__flame {
  animation: flCastScatter 300ms ease-out forwards;
}
.fl-cast-fire__burst {
  position: absolute; left: 50%; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff7d6 0%, #ffb347 40%, rgba(255, 90, 20, 0) 72%);
  opacity: 0;
}
.fl-cast-fire--release .fl-cast-fire__burst { animation: flCastBurst 280ms ease-out forwards; }
/* brasas lançadas pra frente no disparo — leque estreito em vez de radial:
   "algumas brasas sendo lançadas para frente", diferente do scatter em
   todas as direções que os três tipos de partícula da órbita já fazem */
.fl-cast-fire__forward {
  position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff3c4, #ff8a3d 60%, transparent 75%);
  opacity: 0;
  transform: rotate(var(--fwangle, 0deg));
}
.fl-cast-fire--release .fl-cast-fire__forward { animation: flCastForward 340ms ease-out forwards; }
@keyframes flCastGlow {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(calc(1 + 0.18 * var(--intensity, 0.5))); }
}
@keyframes flCastOrbit {
  0% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) translateY(0) scale(0.5);
  }
  18% { opacity: 1; }
  100% {
    opacity: 0.15;
    transform: rotate(calc(var(--angle) + 130deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 130deg) * -1))
      translateY(calc(-1 * var(--rise))) scale(0.95);
  }
}
@keyframes flCastSpark {
  0%, 100% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) scale(0.6); }
  8% { opacity: 1; transform: rotate(var(--angle)) translateX(var(--radius)) scale(1.3); }
  20% { opacity: 0; }
}
@keyframes flCastFlameOrbit {
  0% { opacity: 0; transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) scale(0.6, 0.6); }
  20% { opacity: 0.95; }
  50% { transform: rotate(calc(var(--angle) + 55deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 55deg) * -1)) scale(1, 1.1); }
  100% { opacity: 0.2; transform: rotate(calc(var(--angle) + 110deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 110deg) * -1)) scale(0.85, 0.9); }
}
@keyframes flCastScatter {
  0% { opacity: 1; transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) scale(1); }
  100% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(calc(var(--radius) * 3.2)) rotate(calc(var(--angle) * -1)) scale(0.3);
  }
}
@keyframes flCastBurst {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(6); }
}
@keyframes flCastForward {
  0% { opacity: 1; transform: rotate(var(--fwangle, 0deg)) translateY(0) scale(1); }
  100% { opacity: 0; transform: rotate(var(--fwangle, 0deg)) translateY(-64px) scale(0.4); }
}
`;

function useCastFireStyles(): void {
  useEffect(() => {
    if (document.getElementById(CAST_FIRE_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = CAST_FIRE_STYLE_ID;
    tag.textContent = CAST_FIRE_CSS;
    document.head.appendChild(tag);
  }, []);
}
