import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";

/**
 * Petrificar (MG_STONECURSE, id 16, `hits:1`, `damageFlags:["no_damage"]` —
 * dano zero de propósito, é uma maldição) — olhar/energia sobrenatural do
 * caster até o alvo (motes de luz ao longo da linha, mesma técnica de
 * `FrostDiverImpact.TrailSpike`, só que "olhar" em vez de "trilha no chão":
 * paira na altura do peito/cabeça, não gruda no chão), impacto sempre, UM
 * ÚNICO burst curto — nunca fica de pé pela duração do status.
 *
 * A transformação em pedra CONDICIONAL (`opt1 === OPT1_STONEWAIT`/
 * `OPT1_STONE`) NÃO é VFX — é tint aplicado direto no material do body do
 * alvo (`net/NetEntity.tsx: usePetrifyMaterial`, `entities/
 * petrifyMaterial.ts`), persistindo enquanto o status durar de verdade,
 * independente de quantas vezes esta skill for lançada no mesmo alvo.
 * Separar os dois evita que recast/renovação duplique qualquer coisa (cada
 * cast só cria UM burst de impacto, de vida curta; o tint reage ao `opt1`
 * puro, nunca ao cast em si).
 */

const BEAM_MOTE_COUNT = 6;
const BEAM_MS = 340;
const IMPACT_AT_MS = BEAM_MS + 40;
/** altura do "olhar" — peito/rosto, não o chão */
const BEAM_Y = 1.1;
/** só usado se NEM a posição de célula do caster resolveu (dado nenhum) —
 * o offset normal já chega PRONTO de `vfx/SkillVfx.tsx` (ponta real do
 * cajado, ou fallback com altura já embutida). */
const NO_DATA_Y_FALLBACK = 1.0;

export function StoneCurseImpact({
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
  useStoneCurseStyles();
  const bornAt = useRef(performance.now());
  const hasCasterPos = casterOffsetX !== 0 || casterOffsetZ !== 0;
  const start = useMemo(
    () =>
      new THREE.Vector3(
        hasCasterPos ? casterOffsetX : 0,
        hasCasterPos ? casterOffsetY : NO_DATA_Y_FALLBACK,
        hasCasterPos ? casterOffsetZ : 2.2,
      ),
    [hasCasterPos, casterOffsetX, casterOffsetY, casterOffsetZ],
  );
  const moteUs = useMemo(
    () => Array.from({ length: BEAM_MOTE_COUNT }, (_, i) => (i + 1) / (BEAM_MOTE_COUNT + 1)),
    [],
  );

  const impactWrap = useRef<HTMLDivElement>(null);
  const impacted = useRef(false);
  useFrame(() => {
    const t = performance.now() - bornAt.current;
    if (!impacted.current && t >= IMPACT_AT_MS) {
      impacted.current = true;
      impactWrap.current?.classList.add("sc-impact--go");
    }
  });

  const tscaleStyle = { "--tscale": targetScale } as CSSProperties;

  return (
    <group name="stone-curse-impact">
      {moteUs.map((u, i) => (
        <BeamMote key={i} u={u} start={start} bornAt={bornAt.current} />
      ))}
      <group position={[0, BEAM_Y * targetScale, 0]}>
        <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
          <div ref={impactWrap} className="sc-impact" style={tscaleStyle}>
            <div className="sc-impact__flash" />
            <div className="sc-impact__ring" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="sc-impact__frag" style={{ "--fangle": `${i * 60}deg` } as CSSProperties} />
            ))}
          </div>
        </Html>
      </group>
    </group>
  );
}

function BeamMote({ u, start, bornAt }: { u: number; start: THREE.Vector3; bornAt: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const pos = useMemo(
    () => new THREE.Vector3(start.x * (1 - u), start.y * (1 - u), start.z * (1 - u)),
    [start, u],
  );
  const appearAtMs = u * BEAM_MS;
  useFrame(() => {
    const el = wrap.current;
    if (!el) return;
    const t = performance.now() - bornAt;
    if (!shown.current && t >= appearAtMs) {
      shown.current = true;
      el.classList.add("sc-mote--go");
    }
  });
  return (
    <group position={[pos.x, pos.y, pos.z]}>
      <Html center zIndexRange={[3, 1]} distanceFactor={9} occlude={false} pointerEvents="none">
        <div ref={wrap} className="sc-mote" />
      </Html>
    </group>
  );
}

const STONE_CURSE_STYLE_ID = "stone-curse-impact-style";
const STONE_CURSE_CSS = `
/* --- olhar/energia direcionada --- */
.sc-mote {
  position: relative; left: 50%; top: 50%;
  width: 10px; height: 10px; margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: radial-gradient(circle, #f4e6ff, #a674e0 55%, rgba(120, 60, 170, 0) 78%);
  filter: drop-shadow(0 0 8px rgba(150, 100, 200, 0.85));
  opacity: 0;
  transform: scale(0.4);
}
.sc-mote--go { animation: scMoteAppear 420ms ease-out forwards; }
@keyframes scMoteAppear {
  0% { opacity: 0; transform: scale(0.3); }
  30% { opacity: 1; transform: scale(1.15); }
  100% { opacity: 0.25; transform: scale(0.85); }
}

/* --- impacto (sempre) --- */
.sc-impact { position: relative; width: 0; height: 0; pointer-events: none; }
.sc-impact__flash {
  position: absolute; left: 50%; top: 50%;
  width: calc(80px * var(--tscale, 1)); height: calc(80px * var(--tscale, 1));
  margin: calc(-40px * var(--tscale, 1)) 0 0 calc(-40px * var(--tscale, 1));
  border-radius: 50%;
  background: radial-gradient(circle, #f8f0ff 0%, #cba8ee 34%, rgba(150, 100, 200, 0.5) 62%, rgba(150, 100, 200, 0) 78%);
  opacity: 0;
}
.sc-impact__ring {
  position: absolute; left: 50%; top: 50%;
  width: calc(180px * var(--tscale, 1)); height: calc(180px * var(--tscale, 1));
  margin: calc(-90px * var(--tscale, 1)) 0 0 calc(-90px * var(--tscale, 1));
  border-radius: 50%;
  border: calc(4px * var(--tscale, 1)) solid rgba(190, 150, 230, 0.8);
  box-shadow: 0 0 26px rgba(150, 100, 200, 0.6);
  opacity: 0;
}
.sc-impact__frag {
  position: absolute; left: 50%; top: 50%;
  width: calc(12px * var(--tscale, 1)); height: calc(12px * var(--tscale, 1));
  margin: calc(-6px * var(--tscale, 1)) 0 0 calc(-6px * var(--tscale, 1));
  border-radius: 30%;
  background: linear-gradient(160deg, #d8cad0, #8f8188 55%, #55494f);
  opacity: 0;
  transform: rotate(var(--fangle));
}
.sc-impact--go .sc-impact__flash { animation: scImpFlash 260ms ease-out forwards; }
.sc-impact--go .sc-impact__ring { animation: scImpRing 460ms ease-out forwards; }
.sc-impact--go .sc-impact__frag { animation: scImpFrag 440ms ease-out forwards; }
@keyframes scImpFlash { 0% { opacity: 0; transform: scale(0.3); } 22% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0; transform: scale(1.9); } }
@keyframes scImpRing { 0% { opacity: 0.85; transform: scale(0.25); } 100% { opacity: 0; transform: scale(1.8); } }
@keyframes scImpFrag { 0% { opacity: 1; transform: rotate(var(--fangle)) translateX(0) scale(1); } 100% { opacity: 0; transform: rotate(var(--fangle)) translateX(calc(60px * var(--tscale, 1))) scale(0.3); } }
`;

function useStoneCurseStyles(): void {
  useEffect(() => {
    if (document.getElementById(STONE_CURSE_STYLE_ID)) return;
    const tag = document.createElement("style");
    tag.id = STONE_CURSE_STYLE_ID;
    tag.textContent = STONE_CURSE_CSS;
    document.head.appendChild(tag);
  }, []);
}
