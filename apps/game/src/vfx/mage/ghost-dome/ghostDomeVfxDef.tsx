import type { CSSProperties } from "react";
import { defineVfx } from "../../core/registry";
import { registerDomArt } from "../../core/renderers/domArtRegistry";
import { bindSkillVfx } from "../../core/registry";
import type { DomArtComponentProps, DomArtRefs, DomArtUpdateCtx } from "../../core/renderers/domArtRegistry";

/**
 * Cúpula Fantasma (MG_SAFETYWALL) — MIGRADA pro VFX Core (leia1.txt,
 * Fase 3, primeira das 5 provas). Substitui
 * `vfx/mage/ghost-dome/GhostDomeCell.tsx` (removido) e a entrada
 * `AREA_VFX.MG_SAFETYWALL` de `vfx/SkillVfx.tsx` (também removida).
 *
 * `unit.layout:0` — SEMPRE uma célula só (ao contrário de Fire Wall,
 * `layout:-1`) — por isso `coalesce` não se aplica aqui: cada
 * `skill:ground` já É uma célula distinta, não há "mesmo alvo repetido"
 * pra fundir.
 *
 * Estrutura idêntica ao componente antigo — só a MONTAGEM virou registro
 * (`registerDomArt`) em vez de JSX solto na árvore; a arte (JSX + CSS) é
 * byte-a-byte a mesma (CSS movido pra `vfx/css/legacyVfxArt.ts`).
 */

const GHOSTS = [
  { angle: 0, speed: 1, radiusFrac: 0.42, bob: 0 },
  { angle: 120, speed: 0.82, radiusFrac: 0.3, bob: 1.3 },
  { angle: 240, speed: 1.15, radiusFrac: 0.36, bob: 2.6 },
] as const;

const WISPS = [
  { angleDeg: 18, delayMs: 0, durMs: 3200 },
  { angleDeg: 96, delayMs: 900, durMs: 3600 },
  { angleDeg: 152, delayMs: 1800, durMs: 3000 },
  { angleDeg: 64, delayMs: 2500, durMs: 3400 },
] as const;

/** fração do `cellSize` convertida em px de tela — mesma constante do
 * componente antigo, calibrada pra 1 célula real (2.0 unidades) ficar
 * contida no anel a `DISTANCE_FACTOR=9` (`DomRenderer.ts`). */
function cellPxFor(cellSize: number): number {
  return 170 * (cellSize / 2);
}

function GhostDomeArt({ registerRef, cellSize }: DomArtComponentProps) {
  const cellPx = cellPxFor(cellSize);
  return (
    <div
      ref={(el) => registerRef("wrap", el)}
      className="gd-wrap"
      style={{ opacity: 0, "--cellpx": `${cellPx}px` } as CSSProperties}
    >
      <div className="gd-border" />
      <div className="gd-mist" />
      {WISPS.map((w, i) => (
        <div
          key={i}
          className="gd-wisp"
          style={{ "--wangle": `${w.angleDeg}deg`, "--wdelay": `${w.delayMs}ms`, "--wdur": `${w.durMs}ms` } as CSSProperties}
        />
      ))}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="gd-rise" style={{ "--rangle": `${i * 45}deg`, "--rdelay": `${i * 220}ms` } as CSSProperties} />
      ))}
      {GHOSTS.map((_, i) => (
        <div key={i} ref={(el) => registerRef(`ghost-${i}`, el)} className="gd-ghost">
          <div className="gd-ghost__body" />
          <div className="gd-ghost__glow" />
        </div>
      ))}
    </div>
  );
}

/** posição LOCAL do fantasma `i` no instante `t` (s) — mesma fórmula do
 * `Ghost`/`useFrame` antigo, extraída em função pura porque agora roda de
 * dentro de `update()`, não de um closure de componente. */
function ghostTransform(spec: (typeof GHOSTS)[number], cellPx: number, t: number): { transform: string; opacity: number } {
  const angle = spec.angle + t * spec.speed * 70;
  const r = cellPx * spec.radiusFrac;
  const bobY = Math.sin(t * 1.6 + spec.bob) * 6;
  const scale = 0.85 + 0.15 * Math.sin(t * 1.1 + spec.bob);
  const opacity = 0.55 + 0.35 * Math.sin(t * 0.9 + spec.bob * 1.4);
  return {
    transform: `translate(-50%, -50%) rotate(${angle}deg) translateX(${r}px) rotate(${-angle}deg) translateY(${bobY}px) scale(${scale})`,
    opacity: Math.max(0.15, opacity),
  };
}

/**
 * `update()` não recebe `cellSize` no `ctx` (só o `Component` recebe, na
 * montagem, ver `DomArtComponentProps` — item 21 "posicionamento" pede um
 * padrão único, e o raio de órbita É uma dessas constantes estáveis). O
 * raio já está "impresso" no DOM via `--cellpx` (CSS var setada uma vez em
 * `GhostDomeArt`) — `update()` lê de volta essa MESMA fonte em vez de
 * receber o número por um segundo canal, nunca podendo dessincronizar.
 */
function updateGhostDome(refs: DomArtRefs, ctx: DomArtUpdateCtx): void {
  const wrap = refs.wrap as HTMLDivElement | undefined;
  if (!wrap) return;
  wrap.style.opacity = String(Math.min(1, ctx.elapsedMs / 260));

  const cellPx = parseFloat(wrap.style.getPropertyValue("--cellpx")) || 0;
  const t = ctx.elapsedMs / 1000;
  for (let i = 0; i < GHOSTS.length; i++) {
    const el = refs[`ghost-${i}`] as HTMLDivElement | undefined;
    if (!el) continue;
    const { transform, opacity } = ghostTransform(GHOSTS[i]!, cellPx, t);
    el.style.transform = transform;
    el.style.opacity = String(opacity);
  }
}

registerDomArt("ghost_dome", { Component: GhostDomeArt, update: updateGhostDome });

defineVfx({
  id: "ghost_dome",
  renderer: "dom",
  anchor: "cell",
  dom: { art: "ghost_dome" },
  // sem `lifetimeMs`: área do servidor, vive até `skill:ground-gone`
  // (`vfx/migratedVfxBridge.ts: stopMigratedVfxByUnit`) — mesma regra do
  // caminho legado.
});

bindSkillVfx("MG_SAFETYWALL", "area", "ghost_dome");
