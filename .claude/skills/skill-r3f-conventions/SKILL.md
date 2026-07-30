---
name: skill-r3f-conventions
description: >
  Project conventions for apps/game (React Three Fiber + Three.js + @react-three/rapier
  + Zustand + zundo). Use whenever writing or editing any component under apps/game/src —
  adding a new renderable prop/entity, wiring a collider, writing animation/movement logic,
  registering something in the prop/entity registry, or touching the MovementController
  (grid vs free). Also use when reviewing R3F code for perf mistakes (state-driven mutation
  in the render loop, missing memoization, recreated objects per frame).
---

Conventions for apps/game. Don't invent a different pattern than what's below — grep
apps/game/src for the nearest existing example first; this file is the fallback spec when
no example exists yet.

## Component = entity

Each game entity (prop, mob, npc, player) is one self-contained component: owns its own
mesh/geometry refs, its own collider, its own local state. No god-component that switches
on entity type internally — use a registry (below) instead.

## Registering a new prop type

Props (static world decoration/resources placed via map JSON, see [[skill-map-format]])
are resolved through a registry, not a switch statement:

```ts
// packages/game-data or apps/game/src/props/registry.ts
export const propRegistry: Record<string, PropComponent> = {
  tree_01: TreeProp,
  rock_01: RockProp,
};
```

To add a new prop type:
1. Create the component under `apps/game/src/props/<PropName>.tsx`.
2. Register it in `propRegistry` under the same `assetId` string used in map JSON
   (`packages/map-format`).
3. Never hardcode a prop's asset id as a magic string outside the registry file — import
   the registry key.

If the registry file doesn't exist yet at these paths, create it there rather than
inventing a different location — keep prop resolution in one place.

## Adding a collider

Physics goes through `@react-three/rapier`. Rules:
- Wrap the mesh in `<RigidBody>` (`type="fixed"` for static props/terrain, `type="dynamic"`
  for movable entities, `type="kinematicPosition"` for the player-controlled body under
  `FreeMovementController`).
- Prefer `colliders="trimesh"` for static terrain/heightfield geometry and `colliders="cuboid"`
  or `colliders="hull"` for simple props — don't hand-roll collider geometry unless the
  auto-generated one is visibly wrong.
- The world heightfield collider is shared: both `GridMovementController` and
  `FreeMovementController` must query the *same* Rapier heightfield collider instance for
  ground height/walkability — never duplicate terrain collision logic per controller. See
  `packages/engine-core/movement/`.
- Give colliders that need scripted logic (triggers, warps, spawn zones) `sensor: true` and
  handle overlap in `onIntersectionEnter`, not by polling distance every frame.

## Render-loop / animation rules

- Use `useFrame` for anything that must update every frame (position, rotation, shader
  uniforms). Never drive a per-frame value through React state/`setState` — that re-renders
  the component tree at 60fps. Mutate the Three.js object directly via a `ref`.
- Memoize geometries and materials that don't change per-render with `useMemo`
  (or hoist them as module-level singletons if truly static/shared). A parent re-render
  without memoization recreates expensive `BufferGeometry`/`Material` instances from scratch.
- Zustand + zundo hold app/game state (inventory, target, undo-able admin edits) — not
  per-frame transform data. If a value changes every frame, it does not belong in the store.

## Dual movement controllers

`MovementController` is an interface in `packages/engine-core` with two implementations
(`GridMovementController`, `FreeMovementController`). When touching movement code:
- Don't duplicate collision/heightfield logic between the two — both consume the same
  collider (see above). Only the *input handling and snapping behavior* differs (grid:
  snap-to-tile, 8-directional; free: continuous input + physics velocity).
- The active controller is chosen by a runtime config value (character/server setting), not
  a hardcoded branch — check `packages/engine-core/movement/index.ts` (or wherever the
  factory/selector lives) before adding a new call site that picks a controller directly.

## File placement

- Reusable primitives (colliders, prop wrappers, camera rigs): `apps/game/src/components/`.
- Entities resolved via registry (props, mobs, npcs): `apps/game/src/entities/` or
  `apps/game/src/props/` — match whatever already exists rather than creating a third
  location.
- Movement/physics logic that isn't React-specific belongs in `packages/engine-core`, not
  in an R3F component — components should call into engine-core, not reimplement game logic.
