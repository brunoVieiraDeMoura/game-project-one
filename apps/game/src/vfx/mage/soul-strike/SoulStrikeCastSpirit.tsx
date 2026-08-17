import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { CSSProperties } from "react";
import { anchorDeArma } from "../../../entities/weaponAnchors";
import { createSeededRng } from "../../core/particleMath";

/**
 * Soul Strike (MG_SOULSTRIKE) — cast espiritual no CASTER, CSS puro.
 *
 * MESMA estrutura de `mage/cold-bolt/ColdBoltCastFrost.tsx` (relógio único
 * `expiresAt`/`durationMs`, ancorado na ponta do cajado, fallback no peito) —
 * ver aquele arquivo pro raciocínio completo, não duplicado aqui.
 *
 * Em vez de cristal/brasa/faísca, o que orbita são WISPS — pequenos borrões
 * brancos/azulados com um "rastro" (glow alongado atrás), a mesma ideia
 * visual dos espíritos que depois viram os 5 projéteis (`SoulStrikeImpact`).
 * Sem vermelho/laranja (fogo) nem azul elétrico saturado (raio) — só
 * branco, branco-azulado e azul muito claro, como pedido.
 */

const FADE_IN_FRAC = 0.2;
const RELEASE_FRAC = 0.86;
const WISP_COUNT = 7;
const CLOUD_Y = 1.05;

interface WispSpec {
  angleDeg: number;
  radiusPx: number;
  risePx: number;
  durMs: number;
  delayMs: number;
}

function buildWisps(seed: number): WispSpec[] {
  const out: WispSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < WISP_COUNT; i++) {
    out.push({
      angleDeg: (i / WISP_COUNT) * 360 + rnd() * 40,
      radiusPx: 20 + rnd() * 20,
      risePx: 10 + rnd() * 18,
      durMs: 950 + rnd() * 500,
      delayMs: rnd() * 500,
    });
  }
  return out;
}

export function SoulStrikeCastSpirit({
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
  useCastSpiritStyles();
  const born = useRef(performance.now());
  const total = Math.max(200, expiresAt - born.current);
  const wisps = useMemo(() => buildWisps(Math.random() * 1000 + 1), []);
  const group = useRef<THREE.Group>(null);
  const wrap = useRef<HTMLDivElement>(null);
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
    if (!released.current && life >= RELEASE_FRAC) {
      released.current = true;
      el.classList.add("ss-cast-spirit--release");
    }
  });

  return (
    <group ref={group}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude pointerEvents="none">
        <div ref={wrap} className="ss-cast-spirit">
          <div className="ss-cast-spirit__glow" />
          {wisps.map((p, i) => (
            <div
              key={i}
              className="ss-cast-spirit__wisp"
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
          <div className="ss-cast-spirit__burst" />
        </div>
      </Html>
    </group>
  );
}

const CAST_SPIRIT_STYLE_ID = "soul-strike-cast-spirit-style";
const CAST_SPIRIT_CSS = `
.ss-cast-spirit { position: relative; width: 4px; height: 4px; pointer-events: none; }
.ss-cast-spirit__glow {
  position: absolute; left: 50%; top: 50%; width: 104px; height: 104px;
  margin: -52px 0 0 -52px; border-radius: 50%;
  background: radial-gradient(circle, rgba(210, 235, 255, 0.4), rgba(210, 235, 255, 0) 72%);
  animation: ssCastGlow 900ms ease-in-out infinite;
}
/* wisp: corpo oval + rastro alongado atrás (gradiente cônico simples via
   elongação + blur) — não é um losango/ponto, é um borrão etéreo */
.ss-cast-spirit__wisp {
  position: absolute; left: 50%; top: 50%; width: 14px; height: 8px; margin: -4px 0 0 -10px;
  border-radius: 50%;
  background: radial-gradient(ellipse, #ffffff 0%, #dff1ff 45%, rgba(180, 220, 255, 0) 78%);
  filter: blur(0.4px) drop-shadow(0 0 5px rgba(200, 230, 255, 0.85));
  opacity: 0;
  transform-origin: center;
  animation: ssCastOrbit var(--pdur) ease-in-out var(--pdelay) infinite;
}
.ss-cast-spirit--release .ss-cast-spirit__wisp {
  animation: ssCastScatter 340ms ease-out forwards;
}
.ss-cast-spirit__burst {
  position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #cfe9ff 45%, rgba(180, 220, 255, 0) 72%);
  opacity: 0;
}
.ss-cast-spirit--release .ss-cast-spirit__burst { animation: ssCastBurst 300ms ease-out forwards; }
@keyframes ssCastGlow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.9; transform: scale(1.15); }
}
@keyframes ssCastOrbit {
  0% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) translateY(0) scale(0.6);
  }
  20% { opacity: 0.9; }
  100% {
    opacity: 0.2;
    transform: rotate(calc(var(--angle) + 120deg)) translateX(var(--radius)) rotate(calc((var(--angle) + 120deg) * -1))
      translateY(calc(-1 * var(--rise))) scale(1);
  }
}
@keyframes ssCastScatter {
  0% { opacity: 0.9; transform: rotate(var(--angle)) translateX(var(--radius)) rotate(calc(var(--angle) * -1)) scale(1); }
  100% {
    opacity: 0;
    transform: rotate(var(--angle)) translateX(calc(var(--radius) * 3.2)) rotate(calc(var(--angle) * -1)) scale(0.4);
  }
}
@keyframes ssCastBurst {
  0% { opacity: 0; transform: scale(0.3); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(5.5); }
}
`;

function useCastSpiritStyles(): void {
  useEffect(() => {
    if (document.getElementById(CAST_SPIRIT_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = CAST_SPIRIT_STYLE_ID;
    tag.textContent = CAST_SPIRIT_CSS;
    document.head.appendChild(tag);
  }, []);
}
