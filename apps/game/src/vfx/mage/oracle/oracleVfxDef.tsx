import { createPortal } from "react-dom";
import { Fragment } from "react";
import type { CSSProperties } from "react";
import { defineVfx } from "../../core/registry";
import { registerDomArt } from "../../core/renderers/domArtRegistry";
import { bindSkillVfx } from "../../core/registry";
import type { DomArtComponentProps, DomArtRefs, DomArtUpdateCtx } from "../../core/renderers/domArtRegistry";
import { oracleBenchConfig } from "./oracleBenchConfig";
import { createSeededRng } from "../../core/particleMath";
import { TrailEchoes, updateTrailEchoes, type TrailStyle } from "../../core/primitives/trailDom";

/**
 * Oráculo (MG_SIGHT) — MIGRADO pro VFX Core (leia1.txt, Fase 3). Era o
 * PRINCIPAL hotspot identificado na investigação: 111 `<Html>` por
 * instância (3 caveiras × (1 + 14 ecos de rastro) + 66 partículas de área)
 * e 69 assinaturas de `useFrame` PRÓPRIAS. Substitui `OracleBuff.tsx`
 * (removido).
 *
 * `anchor:"entity"` — segue o CASTER (self-buff, `target:"self"` no
 * skill_db, nunca planta célula). Cada caveira/eco/partícula é um
 * SUB-PONTO 3D dentro da MESMA instância — em vez de posicionar via
 * `<group position>` do R3F (que não existe mais aqui), cada um é portado
 * direto pro `portalTarget` (o container SEM transform que `DomRenderer`
 * mantém) e projetado à mão via `ctx.projectLocalOffset`, MESMA fórmula
 * que posiciona o wrapper da instância inteira.
 *
 * Órbita/rastro são funções PURAS dos ângulos/fases ESTÁTICOS
 * (`SKULLS`/`TRAIL_LAGS_DEG`, nunca sorteados) — `update()` os recalcula
 * direto, sem precisar guardar estado por instância. As 66 partículas de
 * área SÃO sorteadas por instância (`buildAreaParticles`); a posição local
 * de cada uma fica gravada em CSS custom properties no próprio elemento
 * (`--gdx`/`--gdz`, setadas uma vez no `Component`) — `update()` lê de
 * volta essa MESMA fonte pra reprojetar a cada quadro, nunca um canal
 * separado (mesmo truque de `ghostDomeVfxDef.tsx: --cellpx`).
 */

const AREA_PARTICLE_COUNT = 66;
const ORBIT_SPEED_DEG_PER_SEC = 82;
const TRAIL_LAGS_DEG = [3, 6, 10, 14, 19, 24, 30, 37, 45, 54, 64, 75, 87, 100];
const SKULLS = [
  { angle0: 0, bobPhase: 0 },
  { angle0: 120, bobPhase: 2.1 },
  { angle0: 240, bobPhase: 4.2 },
] as const;
const DEFAULT_AREA_RADIUS = 3;
const SKULL_HEIGHT = 1.05;

/** receita visual do rastro da caveira — valores byte-idênticos ao antigo
 * `.or-echo` (`legacyVfxArt.ts`, removido: agora vive como dado, não CSS
 * duplicada — `vfx-trail-echo` compartilhada com Fire Ball). */
const ORACLE_TRAIL_STYLE: TrailStyle = {
  widthPx: 40,
  heightPx: 16,
  opacityBase: 0.9,
  opacityStep: 0.055,
  scaleStep: 0.045,
  glowPx: 3,
  glowColor: "rgba(255, 200, 80, 0.8)",
  strokeColor: "#ffb23c",
  strokeWidth: 2.4,
  pathEven: "M1,8 Q6,1 11,8 T21,8 T31,8 T39,8",
  pathOdd: "M1,8 Q6,15 11,8 T21,8 T31,8 T39,8",
};

interface Vec3Local {
  x: number;
  y: number;
  z: number;
}

function skullLocalPos(angleDeg: number, radius: number, targetScale: number, bobPhase: number, t: number, out: Vec3Local): void {
  const rad = (angleDeg * Math.PI) / 180;
  const r = radius * targetScale;
  const bobFreq = 0.9 + bobPhase * 0.08;
  const bob = Math.sin(t * bobFreq + bobPhase) * 0.32;
  out.x = Math.cos(rad) * r;
  out.y = (SKULL_HEIGHT + bob) * targetScale;
  out.z = Math.sin(rad) * r;
}

interface AreaParticleSpec {
  dx: number;
  dz: number;
  delayMs: number;
  durMs: number;
}

function buildAreaParticles(seed: number, radius: number): AreaParticleSpec[] {
  const out: AreaParticleSpec[] = [];
  const raioUtil = Math.max(0.8, radius);
  const rnd = createSeededRng(seed);
  for (let i = 0; i < AREA_PARTICLE_COUNT; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = 0.25 + rnd() ** 1.8 * (raioUtil - 0.25);
    out.push({ dx: Math.cos(angle) * r, dz: Math.sin(angle) * r, delayMs: rnd() * 2200, durMs: 1800 + rnd() * 1400 });
  }
  return out;
}

const FREE_POS_STYLE: CSSProperties = { position: "absolute", left: 0, top: 0, pointerEvents: "none" };

function OracleArt({ registerRef, payload, portalTarget }: DomArtComponentProps) {
  const radius = (payload?.areaRadius as number | undefined) ?? DEFAULT_AREA_RADIUS;
  const particles = buildAreaParticles(Math.random(), radius);
  // matriz de benchmark temporária (Fase 5, Etapa 6) — `cfg` idêntico à
  // produção fora do `/vfx-bench`; ver `oracleBenchConfig.ts`.
  const cfg = oracleBenchConfig();
  const trailLags = cfg.echoCountPerSkull >= TRAIL_LAGS_DEG.length ? TRAIL_LAGS_DEG : TRAIL_LAGS_DEG.slice(0, cfg.echoCountPerSkull);
  const particlesVisiveis = cfg.glimmerCount >= particles.length ? particles : particles.slice(0, cfg.glimmerCount);

  return createPortal(
    <>
      {SKULLS.map((_, si) => (
        <Fragment key={si}>
          <TrailEchoes
            spec={{ count: trailLags.length, style: ORACLE_TRAIL_STYLE }}
            refPrefix={`skull-${si}-echo`}
            registerRef={registerRef}
          />
          <div key={`skull-${si}`} ref={(el) => registerRef(`skull-${si}-pos`, el)} style={FREE_POS_STYLE}>
            <div ref={(el) => registerRef(`skull-${si}-inner`, el)} className="or-skull">
              {cfg.showSkullGlow && <div className="or-skull__glow" />}
              <div className="or-skull__cranium" />
              <div className="or-skull__jaw" />
              <div className="or-skull__eye or-skull__eye--l" />
              <div className="or-skull__eye or-skull__eye--r" />
              <div className="or-skull__nose" />
            </div>
          </div>
        </Fragment>
      ))}
      {particlesVisiveis.map((p, i) => (
        <div
          key={`glimmer-${i}`}
          ref={(el) => registerRef(`glimmer-${i}`, el)}
          style={{ ...FREE_POS_STYLE, "--gdx": String(p.dx), "--gdz": String(p.dz) } as CSSProperties}
        >
          <div className="or-glimmer" style={{ "--pdelay": `${p.delayMs}ms`, "--pdur": `${p.durMs}ms` } as CSSProperties} />
        </div>
      ))}
    </>,
    portalTarget,
  );
}

const tmp: Vec3Local = { x: 0, y: 0, z: 0 };

function updateOracle(refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const radius = (ctx.payload?.areaRadius as number | undefined) ?? DEFAULT_AREA_RADIUS;
  const t = ctx.elapsedMs / 1000;
  // matriz de benchmark temporária (Fase 5, Etapa 6) — mesmos limites que
  // `OracleArt` usou pra decidir quais refs existem de verdade.
  const cfg = oracleBenchConfig();
  if (cfg.freezeUpdates) return; // controle C/D — árvore intacta, zero escrita de style/transform
  const echoCount = Math.min(cfg.echoCountPerSkull, TRAIL_LAGS_DEG.length);
  const glimmerCount = Math.min(cfg.glimmerCount, AREA_PARTICLE_COUNT);

  for (let si = 0; si < SKULLS.length; si++) {
    const spec = SKULLS[si]!;
    const angle = spec.angle0 + t * ORBIT_SPEED_DEG_PER_SEC;

    skullLocalPos(angle, radius, ctx.targetScale, spec.bobPhase, t, tmp);
    const dy = ctx.terrainFollowDeltaY(tmp.x, tmp.z);
    const screen = ctx.projectLocalOffset(tmp.x, tmp.y + dy, tmp.z);
    const posEl = refs[`skull-${si}-pos`] as HTMLDivElement | undefined;
    if (screen && posEl) posEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;

    const scale = 0.97 + 0.04 * Math.sin(t * 0.8 + spec.bobPhase * 1.6);
    const opacity = 0.85 + 0.15 * Math.sin(t * 0.6 + spec.bobPhase * 2.1);
    const swayFreq = 1.4 + spec.bobPhase * 0.1;
    const swayPx = Math.sin(t * swayFreq + spec.bobPhase * 1.3) * 9;
    const innerEl = refs[`skull-${si}-inner`] as HTMLDivElement | undefined;
    if (innerEl) {
      innerEl.style.transform = `translate(-50%, -50%) translateX(${swayPx}px) scale(${scale})`;
      innerEl.style.opacity = String(Math.max(0.7, opacity));
    }

    updateTrailEchoes(refs, `skull-${si}-echo`, echoCount, (ei) => {
      skullLocalPos(angle - TRAIL_LAGS_DEG[ei]!, radius, ctx.targetScale, spec.bobPhase, t, tmp);
      const edy = ctx.terrainFollowDeltaY(tmp.x, tmp.z);
      return { x: tmp.x, y: tmp.y + edy, z: tmp.z };
    }, ctx.projectLocalOffset);
  }

  for (let i = 0; i < glimmerCount; i++) {
    const el = refs[`glimmer-${i}`] as HTMLDivElement | undefined;
    if (!el) continue;
    const dx = parseFloat(el.style.getPropertyValue("--gdx")) || 0;
    const dz = parseFloat(el.style.getPropertyValue("--gdz")) || 0;
    const dy = ctx.terrainFollowDeltaY(dx, dz);
    const screen = ctx.projectLocalOffset(dx, 0.1 + dy, dz);
    if (screen) el.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;
  }
}

registerDomArt("oracle_buff", { Component: OracleArt, update: updateOracle });

defineVfx({
  id: "oracle_buff",
  renderer: "dom",
  anchor: "entity",
  dom: { art: "oracle_buff" },
  // sem `lifetimeMs` na definição: a duração REAL do buff vem de
  // `opts.durationMs` (calculado em `vfx/migratedVfxBridge.ts` a partir de
  // `expiresAt`, que por sua vez já reflete `BUFF_VFX_AEGIS`/
  // `SkillInfo.durationMs` — mesma fonte autoritativa do caminho legado).
});

bindSkillVfx("MG_SIGHT", "buff", "oracle_buff");
