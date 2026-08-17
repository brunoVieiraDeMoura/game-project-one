import { useMemo } from "react";
import type { CSSProperties } from "react";
import { defineVfx } from "../../core/registry";
import { registerDomArt } from "../../core/renderers/domArtRegistry";
import { bindSkillVfx } from "../../core/registry";
import type { DomArtComponentProps, DomArtRefs, DomArtUpdateCtx } from "../../core/renderers/domArtRegistry";
import { fireWallBenchConfig } from "./fireWallBenchConfig";
import { createSeededRng } from "../../core/particleMath";

/**
 * Parede de Fogo (MG_FIREWALL, `unit.layout:-1`) — MIGRADA pro VFX Core
 * (leia1.txt, Fase 3). Substitui `FireWallGroup.tsx`/`FireWallCell.tsx`
 * (removidos, ver docblock antigo de `FireWallGroup` pro histórico: 19
 * `<Html>` independentes → 1 grupo agrupado à mão → agora o `DomRenderer`
 * do Core faz o MESMO agrupamento de graça, pra qualquer skill, sem
 * precisar de um componente especial por skill agrupada).
 *
 * Continua N instâncias (uma por `skill:ground`, correto — é assim que o
 * servidor manda sumir célula por célula) — só que agora N instâncias do
 * MESMO `vfxId`, cada uma com `anchor:"cell"` própria, todas desenhadas
 * pelo ÚNICO React root que `DomRenderer` já mantém pro jogo inteiro. Sem
 * `coalesce`: cada célula É um evento distinto (unidade própria no
 * servidor), nunca deve fundir com a vizinha.
 *
 * Visual byte-idêntico ao antigo `FireWallVisual`: mesma CSS, mesmas até 40
 * brasas, mesma coluna, mesmas línguas de fogo, mesmo fade-in de 220ms.
 * `fireWallBenchConfig` (matriz de diagnóstico temporária, ver o próprio
 * arquivo) continua funcionando igual — lida a cada render da arte.
 */

const EMBER_COUNT = 40;

interface EmberSpec {
  angleDeg: number;
  radiusPx: number;
  delayMs: number;
  durMs: number;
  sizeMult: number;
}

function pickSizeMult(roll: number): number {
  if (roll < 0.55) return 1;
  if (roll < 0.85) return 2;
  return 3;
}

function buildEmbers(seed: number): EmberSpec[] {
  const out: EmberSpec[] = [];
  const rnd = createSeededRng(seed);
  for (let i = 0; i < EMBER_COUNT; i++) {
    out.push({
      angleDeg: (i / EMBER_COUNT) * 360 + rnd() * 20,
      radiusPx: 6 + rnd() * 26,
      delayMs: rnd() * 1600,
      durMs: 1100 + rnd() * 700,
      sizeMult: pickSizeMult(rnd()),
    });
  }
  return out;
}

function FireWallArt({ registerRef }: DomArtComponentProps) {
  const embers = useMemo(() => buildEmbers(Math.random()), []);
  const cfg = fireWallBenchConfig();
  const embersVisiveis = cfg.emberCount >= embers.length ? embers : embers.slice(0, cfg.emberCount);

  return (
    <div ref={(el) => registerRef("wrap", el)} className="fw-wrap" style={{ opacity: 0 }}>
      {cfg.showGlow && <div className="fw-glow" />}
      <div className="fw-column">
        <div className="fw-column__core" />
        {cfg.showLicks && (
          <div className="fw-column__licks">
            <div className="fw-lick fw-lick--a" />
            <div className="fw-lick fw-lick--b" />
            <div className="fw-lick fw-lick--c" />
            <div className="fw-lick fw-lick--d" />
          </div>
        )}
        {cfg.showSmoke && <div className="fw-smoke" />}
      </div>
      {embersVisiveis.map((e, i) => (
        <div
          key={i}
          className="fw-ember"
          style={
            {
              "--angle": `${e.angleDeg}deg`,
              "--radius": `${e.radiusPx}px`,
              "--pdelay": `${e.delayMs}ms`,
              "--pdur": `${e.durMs}ms`,
              "--esize": String(e.sizeMult),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function updateFireWall(refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const wrap = refs.wrap as HTMLDivElement | undefined;
  if (!wrap) return;
  wrap.style.opacity = String(Math.min(1, ctx.elapsedMs / 220));
}

registerDomArt("fire_wall", { Component: FireWallArt, update: updateFireWall });

defineVfx({
  id: "fire_wall",
  renderer: "dom",
  anchor: "cell",
  dom: { art: "fire_wall" },
  // sem `lifetimeMs`: área do servidor, vive até `skill:ground-gone`
  // (`vfx/migratedVfxBridge.ts: stopMigratedVfxByUnit`).
});

bindSkillVfx("MG_FIREWALL", "area", "fire_wall");
