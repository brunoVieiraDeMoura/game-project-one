import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";

/**
 * Congelar (MG_FROSTDIVER, id 15, `hits:1`) — trilha de gelo no CHÃO do
 * caster até o alvo, UM ÚNICO burst de impacto curto — nunca fica de pé
 * pela duração do status.
 *
 * Congelamento não passa por dano/cascata nenhuma (`hits:1`, fora da família
 * multi-hit) — dano sai pelo `damageFeed` normal, igual Fire Ball.
 *
 * A prisão de gelo CONDICIONAL (`opt1 === OPT1_FREEZE`) é outro componente,
 * `FreezeBodyVfx` (`vfx/mage/frost-diver/FreezeBodyVfx.tsx`), montado por
 * `net/NetEntity.tsx` — persiste enquanto o status durar de verdade,
 * independente de quantas vezes esta skill for lançada no mesmo alvo.
 * Separar os dois evita que recast/renovação duplique o VFX persistente
 * (cada cast só cria UM burst de impacto, de vida curta).
 */

const TRAIL_SPIKE_COUNT = 7;
/** ms pra trilha inteira aparecer, caster → alvo */
const TRAIL_MS = 520;
const IMPACT_AT_MS = TRAIL_MS + 60;
const LAUNCH_Y_BIAS = 0;

export function FrostDiverImpact({
  targetScale = 1,
  casterOffsetX = 0,
  casterOffsetY = 0,
  casterOffsetZ = 0,
}: {
  targetScale?: number;
  casterOffsetX?: number;
  casterOffsetY?: number;
  casterOffsetZ?: number;
}) {
  useFrostDiverStyles();
  const bornAt = useRef(performance.now());
  const hasCasterPos = casterOffsetX !== 0 || casterOffsetZ !== 0;
  const start = useMemo(
    () =>
      new THREE.Vector3(
        hasCasterPos ? casterOffsetX : 0,
        (hasCasterPos ? casterOffsetY : 0) + LAUNCH_Y_BIAS,
        hasCasterPos ? casterOffsetZ : 2.2,
      ),
    [hasCasterPos, casterOffsetX, casterOffsetY, casterOffsetZ],
  );
  const spikes = useMemo(
    () =>
      Array.from({ length: TRAIL_SPIKE_COUNT }, (_, i) => {
        const u = (i + 1) / (TRAIL_SPIKE_COUNT + 1);
        return {
          x: start.x * (1 - u),
          y: start.y * (1 - u),
          z: start.z * (1 - u),
          appearAtMs: u * TRAIL_MS,
          rotDeg: (i * 47) % 360,
          heightScale: 0.75 + ((i * 37) % 50) / 100,
        };
      }),
    [start],
  );

  const impactWrap = useRef<HTMLDivElement>(null);
  const impacted = useRef(false);
  useFrame(() => {
    const t = performance.now() - bornAt.current;
    if (!impacted.current && t >= IMPACT_AT_MS) {
      impacted.current = true;
      impactWrap.current?.classList.add("fd-impact--go");
    }
  });

  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return (
    <group name="frost-diver-impact">
      {spikes.map((s, i) => (
        <TrailSpike key={i} spec={s} bornAt={bornAt.current} />
      ))}
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={impactWrap} className="fd-impact" style={tscaleStyle}>
          <div className="fd-impact__flash" />
          <div className="fd-impact__ring" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="fd-impact__shard" style={{ "--sangle": `${i * 45}deg` } as CSSProperties} />
          ))}
          <div className="fd-impact__snow" />
        </div>
      </Html>
    </group>
  );
}

function TrailSpike({
  spec,
  bornAt,
}: {
  spec: { x: number; y: number; z: number; appearAtMs: number; rotDeg: number; heightScale: number };
  bornAt: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  useFrame(() => {
    const el = wrap.current;
    if (!el) return;
    const t = performance.now() - bornAt;
    if (!shown.current && t >= spec.appearAtMs) {
      shown.current = true;
      el.classList.add("fd-trail--go");
    }
  });
  return (
    <group position={[spec.x, spec.y, spec.z]}>
      {/* `occlude={false}` de propósito, de novo — LIGAR oclusão aqui
          (raycast contra a cena inteira) pra 7 espinhos ao mesmo tempo,
          todo quadro, foi o que causou o travamento reportado: cada `<Html
          occlude>` faz seu PRÓPRIO raycast contra `scene.children` inteiro
          por quadro, e `ColdBoltCastFrost`/o resto do projeto só paga esse
          custo com UMA instância por vez, nunca sete. O jeito CERTO de
          resolver "personagem por cima dos espinhos" é ocluir contra uma
          lista pequena e específica (só a malha do personagem, não a cena
          toda) — infra que ainda não existe neste projeto (`weaponAnchors`
          resolve ponta de arma, não malha de corpo inteiro). Fica pro
          padrão de sempre (VFX por cima) até essa infra existir; sem isto o
          jogo trava de verdade, o que é pior que a leitura visual errada. */}
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div
          ref={wrap}
          className="fd-trail"
          style={{ "--rot": `${spec.rotDeg}deg`, "--hscale": spec.heightScale } as CSSProperties}
        >
          <div className="fd-trail__crack" />
          <div className="fd-trail__spike" />
          <div className="fd-trail__glow" />
        </div>
      </Html>
    </group>
  );
}

const FROST_DIVER_STYLE_ID = "frost-diver-impact-style";
const FROST_DIVER_CSS = `
/* --- trilha no chão --- */
.fd-trail { position: relative; width: 0; height: 0; pointer-events: none; transform: rotate(var(--rot, 0deg)); }
.fd-trail__crack {
  position: absolute; left: 50%; bottom: 0; width: 46px; height: 10px; margin-left: -23px;
  background: radial-gradient(ellipse, rgba(180, 235, 255, 0.55), rgba(180, 235, 255, 0) 75%);
  opacity: 0;
}
.fd-trail__spike {
  position: absolute; left: 50%; bottom: 2px; width: 20px; height: calc(64px * var(--hscale, 1)); margin-left: -10px;
  transform-origin: 50% 100%;
  clip-path: polygon(50% 0%, 80% 55%, 62% 68%, 50% 100%, 38% 68%, 20% 55%);
  background: linear-gradient(180deg, #f4feff 0%, #bdeeff 30%, #61c9f5 62%, #2189cf 100%);
  filter: drop-shadow(0 0 8px rgba(140, 225, 255, 0.8));
  opacity: 0;
  transform: scale(0.4, 0.2);
}
.fd-trail__glow {
  position: absolute; left: 50%; bottom: 0; width: 60px; height: 24px; margin-left: -30px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(150, 220, 255, 0.5), rgba(150, 220, 255, 0) 72%);
  opacity: 0;
}
/* aparece rápido, segura por um instante bem curto, e some por OPACIDADE
   rápido — "desaparecer com o rastro por opacidade mais rápido assim que
   ele passar" (pedido explícito: a onda não deve deixar gelo persistente
   no chão, só marcar por onde passou). */
.fd-trail--go .fd-trail__crack { animation: fdTrailCrack 380ms ease-out forwards; }
.fd-trail--go .fd-trail__spike { animation: fdTrailSpike 380ms cubic-bezier(0.2, 1.4, 0.4, 1) forwards; }
.fd-trail--go .fd-trail__glow { animation: fdTrailGlow 380ms ease-out forwards; }
@keyframes fdTrailCrack {
  0% { opacity: 0; }
  25% { opacity: 0.9; }
  45% { opacity: 0.6; }
  100% { opacity: 0; }
}
@keyframes fdTrailSpike {
  0% { opacity: 0; transform: scale(0.4, 0.15); }
  35% { opacity: 1; transform: scale(1.08, 1.08); }
  50% { opacity: 0.92; transform: scale(1, 1); }
  100% { opacity: 0; transform: scale(0.9, 0.85); }
}
@keyframes fdTrailGlow {
  0% { opacity: 0; }
  20% { opacity: 0.8; }
  45% { opacity: 0.4; }
  100% { opacity: 0; }
}

/* --- impacto (sempre, congelando ou não) --- */
.fd-impact { position: relative; width: 0; height: 0; pointer-events: none; }
.fd-impact__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(84px * var(--tscale, 1)); height: calc(84px * var(--tscale, 1));
  margin: calc(-42px * var(--tscale, 1)) 0 0 calc(-42px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, #cdf3ff 32%, rgba(140, 225, 255, 0.6) 60%, rgba(140, 225, 255, 0) 76%);
  opacity: 0;
}
.fd-impact__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(190px * var(--tscale, 1)); height: calc(190px * var(--tscale, 1));
  margin: calc(-95px * var(--tscale, 1)) 0 0 calc(-95px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(5px * var(--tscale, 1)) solid rgba(190, 235, 255, 0.85);
  box-shadow: 0 0 30px rgba(140, 225, 255, 0.7);
  opacity: 0;
}
.fd-impact__shard {
  position: absolute; left: 50%; top: 50%;
  width: calc(16px * var(--tscale, 1)); height: calc(16px * var(--tscale, 1));
  margin: calc(-8px * var(--tscale, 1)) 0 0 calc(-8px * var(--tscale, 1));
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  background: linear-gradient(160deg, #f2ffff, #a8e9ff 55%, #2f97d6);
  filter: drop-shadow(0 0 8px rgba(140, 220, 255, 0.9));
  opacity: 0;
  transform: rotate(var(--sangle));
}
.fd-impact__snow {
  position: absolute; left: 50%; top: 50%;
  width: calc(120px * var(--tscale, 1)); height: calc(120px * var(--tscale, 1));
  margin: calc(-60px * var(--tscale, 1)) 0 0 calc(-60px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, rgba(220, 245, 255, 0) 70%);
  opacity: 0;
}
.fd-impact--go .fd-impact__flash { animation: fdImpFlash 260ms ease-out forwards; }
.fd-impact--go .fd-impact__ring { animation: fdImpRing 480ms ease-out forwards; }
.fd-impact--go .fd-impact__shard { animation: fdImpShard 460ms ease-out forwards; }
.fd-impact--go .fd-impact__snow { animation: fdImpSnow 700ms ease-out forwards; }
@keyframes fdImpFlash { 0% { opacity: 0; transform: scale(0.3); } 22% { opacity: 1; transform: scale(1.25); } 100% { opacity: 0; transform: scale(2); } }
@keyframes fdImpRing { 0% { opacity: 0.9; transform: scale(0.25); } 100% { opacity: 0; transform: scale(1.9); } }
@keyframes fdImpShard { 0% { opacity: 1; transform: rotate(var(--sangle)) translateX(0) scale(1); } 100% { opacity: 0; transform: rotate(var(--sangle)) translateX(calc(70px * var(--tscale, 1))) scale(0.35); } }
@keyframes fdImpSnow { 0% { opacity: 0; transform: scale(0.4); } 30% { opacity: 0.7; } 100% { opacity: 0; transform: scale(1.6); } }
`;

function useFrostDiverStyles(): void {
  useEffect(() => {
    if (document.getElementById(FROST_DIVER_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = FROST_DIVER_STYLE_ID;
    tag.textContent = FROST_DIVER_CSS;
    document.head.appendChild(tag);
  }, []);
}
