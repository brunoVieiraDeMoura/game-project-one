---
name: skill-vfx-authoring
description: >
  How to add or change gameplay VFX (skill casts/impacts, hit feedback, status effects) in
  apps/game so it never regresses into DOM/HTML. Use whenever creating a new skill's visual
  effect, adding hit/impact feedback, wiring a new VfxDefinition, touching vfx/core/**,
  vfx/mage/**, or vfx/combat/**, or reviewing a PR that adds anything under vfx/. Also use
  when deciding whether a new effect needs its own composition or can reuse an existing
  generic mechanism (shard/combat-hit).
---

Gameplay VFX in this project is GPU by default (`three.js` via the VFX Core,
`apps/game/src/vfx/core/`). DOM (`<Html>`, `createPortal`, `document.createElement`) is a
narrow, documented exception — never the default. This file is the checklist: follow it
before writing a new `VfxDefinition`, don't invent a parallel pattern.

**Why this exists**: an earlier version of the game had 51 `<Html>` and zero `<mesh>` in
`vfx/mage/**` — every skill's VFX was DOM/CSS. It was fully migrated to GPU (see
`docs/claude-context/09-vfx-gpu-migration.md` for the history). The invariant now is: no
new skill goes back to that state. Read [[skill-r3f-conventions]] first — this file only
covers what's specific to VFX.

## Decision tree — where does a new effect go?

1. **Is it text (damage number, "Miss", a status label)?** → DOM, but ONLY through one of
   the two existing mechanisms, never a new one:
   - Single-hit skill / basic attack: falls through automatically to
     `net/damageFeed.ts` + `net/NetDamageNumbers.tsx` (`<Html>`) — you don't write anything.
   - Multi-hit skill with its own damage cascade: register a palette with
     `vfx/core/multiHitDamageDomArt.tsx: registerMultiHitDamageArt({...})` (see
     `vfx/mage/cold-bolt/coldBoltDamageDomArt.tsx` for the shape). Never hand-roll a new
     `<Html>` cascade component.

2. **Is it a visual effect (cast glow, projectile, impact burst, trail, persistent status
   icon)?** → GPU, always. Go to "Building a GPU VFX" below.

3. **Does this skill's hit have no visual identity yet (a brand-new skill, or one you
   haven't designed art for)?** → don't build anything. Multi-hit skills fall back to the
   generic shard (`vfx/mage/multiHitShardImpact.ts: GENERIC_HIT_SHARD_ID`, registered per
   skill in `multiHitRegistry.ts: MULTI_HIT_SHARD_VFX`); single-hit/basic-attack hits fall
   back to `vfx/combat/combatHitVfx.ts: COMBAT_HIT_VFX_ID`. Both are shared infrastructure
   — reusing them costs zero new code. Only build a dedicated composition once the skill
   has a real, distinct visual identity worth preserving (see step 4).

4. **Does the skill deserve its own visual identity** (a color/shape/motion that's part of
   what makes it recognizable — Thunder Storm's electric flash, Light Bolt's standing beam,
   Soul Strike's flying orb swarm)? → build a dedicated `VfxDefinition` (below), but never
   at the cost of duplicating the shared MECHANISM (position/lifecycle/crit-scale/budget).
   The rule from this project's own history: "reusar a infraestrutura não é o mesmo que
   reusar a receita visual" — share the plumbing, keep the art distinct when it's earned.

## Building a GPU VFX

**One `VfxDefinition`, composed via `layers[]`** — never N separate objects/components for
N sub-effects. Each layer picks one of the 5 existing renderers
(`vfx/core/renderers/{Sprite,Particle,Beam,Ring,Trail}Renderer.ts`). Do not write a new
renderer unless none of the 5 can express the shape — check with the maintainer/user first,
this hasn't been needed since the Fire Ball/Oracle/Fire Wall prototypes proved the 5 cover
everything tried so far.

```ts
// vfx/mage/<skill>/<skill>VfxDefGpu.tsx
export const MY_SKILL_IMPACT_GPU_DEF: VfxDefinition = {
  id: "my_skill_impact",
  renderer: "sprite",              // top-level = layer 0's renderer
  anchor: "entity",                // "entity" | "caster-tip" | "caster-to-target" | "cell"
  freezeAnchorAfterMs: 0,          // see "Anchoring" below — almost always required
  lifetimeMs: 400,
  scale: { base: 0.5 },
  layers: [
    { renderer: "sprite", params: { color: "#ff9a3d", opacity: 0.9 } },
    { renderer: "particle", scale: { base: 0.15 }, params: { particleCount: 14, radius: 0.5, color: "#ffb35c" } },
  ],
};
```

```ts
// vfx/mage/<skill>/<skill>RenderMode.ts
import { defineVfx, bindSkillVfx, unbindSkillVfx } from "../../core/registry";
import { MY_SKILL_IMPACT_GPU_DEF } from "./mySkillVfxDefGpu";

defineVfx(MY_SKILL_IMPACT_GPU_DEF);

let mode: "dom" | "gpu" = "gpu";               // GPU is the hardcoded default. Never read
                                                 // this from localStorage/sessionStorage/a
                                                 // URL param — a stale dev override must
                                                 // never survive a reload into production.
export function setMySkillRenderMode(next: typeof mode): void {
  mode = next;
  if (next === "gpu") bindSkillVfx("MY_AEGIS_NAME", "impact", MY_SKILL_IMPACT_GPU_DEF.id);
  else unbindSkillVfx("MY_AEGIS_NAME", "impact");
}
setMySkillRenderMode(mode); // applies on module-load, always

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as any).__mySkillRenderBench = { set: setMySkillRenderMode };
}
```

Import the new `RenderMode.ts` once from `vfx/skillVfxBindings.ts` — that's the only wiring
needed for the skill to reach the Core at all. If you skip this import, the skill silently
falls back to the legacy DOM dispatcher (`vfx/SkillVfx.tsx`) — that dispatcher is being kept
alive only for the toggle mechanism, never add a new skill to it.

## Anchoring

Never write your own per-frame "follow the target" logic. Use `anchor` +
`freezeAnchorAfterMs`:
- `anchor: "entity"` + `freezeAnchorAfterMs: 0` — spawns on the target, freezes immediately
  (no flight phase). This is the default for any impact effect.
- `anchor: "caster-to-target"` + `freezeAnchorAfterMs: <flightMs>` — tracks the target
  during flight, freezes exactly when the projectile arrives (not before, not after). Use
  when the effect visibly travels caster→target (`payload.flightMs`/`arriveY`, read by
  `flightOffset.ts`).
- `anchor: "caster-tip"` — for casts, follows the weapon tip.
- `anchor: "cell"` — for ground-targeted skills, fixed position, never follows anything.

Without `freezeAnchorAfterMs`, an impact VFX keeps re-querying the target's live position
forever — if the target dies/despawns/respawns with a reused gid mid-animation, the effect
teleports to the sentinel position or jumps onto the new entity. This was a real bug, fixed
once, at the Core level — every new impact def needs the field, don't rediscover the bug.

## Multi-hit: use the real count, never invent one

`SkillCast.count` (the `skill:cast` network event) is `dmg.div_` from the server — the real
hit count. Never approximate hits from skill level in new code (`getSkillProjectileCount` in
`vfx/mage/multiHitShared.ts` is a *fallback only*, for when `count` is literally absent).
Classify real hit data through `vfx/core/hitVfxResolver.ts: classifyHit(count, level, crit)`
— it returns `{hits, multiplicity, critical}`, never capping `hits` itself.

To render N hits, call `vfx/mage/multiHitShardImpact.ts: spawnHitImpacts({vfxId, targetGid,
hits, staggerMs, color, critical})` — it fires one `play()` per real hit, capped only
*visually* by `VISUAL_SHARD_CAP` (currently 20). Never let a large `count` translate 1:1
into DOM nodes or uncapped renderer instances — the cap protects the renderer, never the
`hits` value itself (gameplay/audio/damage-number code must keep reading the real `hits`).

## Critical is a dimension, not a hitType

Critical (`net/damageFeed.ts: damageKind(action).crit`) is independent of hit multiplicity —
`MULTI_HIT_CRITICAL` is a real, representable combination, not a special case. Never branch
on "is this skill critical" with a separate composition. Instead scale via
`vfx/core/hitVfxResolver.ts: criticalScaleFor(critical)` passed as `VfxSpawnOptions.scale` —
every renderer (`Sprite`/`Particle`/`Trail`/`Beam`) already multiplies by
`spawnOptions.scale`, so "critical = bigger" is free for any new `VfxDefinition` without
writing scale logic per skill.

## Element/color: read it, don't invent it

If a skill needs a color derived from its element, use `shardColorForElement(skillInfo?.element)`
(`vfx/mage/multiHitShardImpact.ts`) — `skillInfo.element` comes from the real
`skill_db.yml: Element:` field via `net/skillCatalog.ts`. Never hardcode a "color per Aegis
name" table; extend `ELEMENT_PALETTE` if a new element shows up.

## Performance rules (measured, not guessed)

- Don't add a `ring` layer to a short-lived per-hit effect —
  `RingRenderer.onInstanceCreate` samples terrain at 81 points and recomputes the bounding
  sphere on every spawn; paying that once per skill-level composition is fine, paying it
  once per hit in a 5-10-hit cascade is not (this is a real regression that was found and
  fixed — the shard effects are sprite-only because of it).
- Always pass `particleCount` explicitly in the spawn call for any particle layer whose
  count should vary (e.g. 0 for a non-critical hit, a small number for critical) — never
  rely on `ParticleRenderer`'s default (`DEFAULT_PARTICLE_COUNT = 24`), it's sized for
  area/cast decoration, not a cheap per-hit flash.
- Reuse an existing renderer's mechanism before adding a new payload field. `flightMs`/
  `arriveY` (flight), `fallMs`/`fallHeight` (drop), `trailLength` (trail decimation) already
  exist and are read generically — check `vfx/core/renderers/*Offset.ts` before inventing a
  new animation primitive.

## Verification checklist before calling a new skill VFX done

1. `pnpm --filter @ragnarok/game typecheck` and `pnpm --filter @ragnarok/game test`.
2. Headed GPU benchmark, never headless (`VFX_BENCH_HEADED=1 VFX_BENCH_ONLY=A pnpm vfx:benchmark`
   from `apps/game` — headless silently falls back to SwiftShader/software rendering and
   produces fake FPS numbers, this cost a full investigation once).
3. Live `/play` DOM-origin check: cast the skill once against an isolated target, diff
   `document.querySelectorAll('*')` before/after/settled. Every new node must be
   attributable to either the generic damage-number mechanism (category A, expected) or
   nothing at all — if you see a node with no attributable origin, something is on DOM that
   shouldn't be. The technique (before/peak/settle snapshots, grouped by
   `tag|className|parentTag`) is the one used to audit all 11 shipped skills — don't
   re-invent it, reuse the same script shape.
4. Confirm no gameplay/damage/hit-count/cooldown/network logic changed — a VFX change is
   art/rendering only, the server stays the sole source of truth for everything else.

## Explicitly forbidden patterns (each one was a real bug once)

- `document.createElement` + manual `appendChild` before any `root.render()` — a fresh
  `createRoot`'s first commit claims the container and wipes nodes that were attached from
  outside React. Always use JSX with a `ref` (see `DomRenderer.tsx`'s docblock).
- One `<Html>`/DOM node per particle/hit/echo — always route through an `InstancedMesh`
  renderer (`particle`/`trail`) instead.
- Reading a DOM↔GPU render-mode flag from `localStorage`/`sessionStorage`/a URL param as the
  *default* — a dev toggle for A/B comparison is fine (`window.__xRenderBench`), but the
  default must be a hardcoded `"gpu"` module-level constant, never persisted.
- Approximating hit count from skill level anywhere except the documented fallback path —
  the server already sends the real count.
- A new `VfxDefinition`/component per skill for something that's just "the generic shard
  with a different color" — check `MULTI_HIT_SHARD_VFX` / `COMBAT_HIT_VFX_ID` first.
