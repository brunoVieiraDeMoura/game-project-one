---
name: skill-map-format
description: >
  Canonical JSON schema for packages/map-format (heightmap, collision, water level, props,
  spawns) used by apps/game, apps/admin's map editor, and tools/legacy-migration. Use
  whenever reading, writing, validating, or migrating map data — creating a new map file,
  writing the map-format TypeScript types/zod schema, building the map loader in apps/game,
  or converting legacy rAthena gat/rsw data. Never invent a field name or collision value
  outside what's defined here; update this file first if the schema changes.
---

Single source of truth for the map JSON shape. If you need a field that isn't listed here,
add it to this schema (and bump `metadata.version`) rather than improvising an ad-hoc key on
one map file.

## Origin of each field (grounded in rathena source)

- **heightmap / collision**: come from `.gat` files. Confirmed in
  `rathena/src/tool/mapcache.cpp` and `rathena/src/map/map.hpp:749-773`:
  - Header: `uint32` width (`xs`) at byte offset 6, `uint32` height (`ys`) at offset 10.
  - Cell array starts at offset 14, **20 bytes per cell**: bytes `[0:4)` = `float` ground
    height (bottom-left corner of the cell quad — the other 3 corner heights the client
    uses for slopes are in bytes `[4:16)`, not needed server-side, not preserved here).
    Bytes `[16:20)` = `uint32` cell type.
  - Cell type → collision enum: `0` = walkable, `1` = wall (non-walkable), `3` = water
    (walkable water), `5` = cliff/gap. rAthena's mapcache reclassifies a raw-`0` cell to `3`
    if its height exceeds the map's water level — do that same reclassification during
    legacy import (see [[skill-legacy-import]]), don't just copy the raw type byte.
- **waterLevel**: from `.rsw`, confirmed in `rathena/src/common/grfio.cpp:459-494`. Only
  the water-level float is read server-side (magic `"GRSW"`, version at bytes 4-5, float
  offset varies by version: byte 171/167/166 depending on version ≥0x205/≥0x202/older).
  Sentinel `1000000` in the original format means "no water" — normalize that to `null` in
  our schema, don't propagate the magic number.
- **gnd (ground mesh/textures)**: rAthena's server never parses `.gnd` — confirmed absent
  from `src/map`. Ground mesh geometry for rendering is **not sourced from legacy data** in
  this project (soul.txt: visual assets are recreated, not migrated) — the new engine
  derives a render mesh from `heightmap` directly. Don't add gnd-derived fields here.
- **props / spawns**: no legacy equivalent parsed by rAthena itself (these come from
  `npc` scripts and mob spawn lines, handled by [[skill-legacy-import]]) — the shape below
  is this project's own design, not a rAthena format.

## Schema (packages/map-format)

```ts
interface GameMap {
  id: string;                // stable slug, e.g. "prontera"
  name: string;               // display name
  size: { width: number; height: number }; // cell counts, from gat xs/ys
  cellSize: number;            // world units per cell (assumption: 5, matching RO's
                                // 5-unit grid convention — NOT verified in source, confirm
                                // before relying on it for physics scale)
  terrainMode: "smooth" | "blocks"; // "smooth" = legacy flat plane (migrated maps);
                                // "blocks" = hex block terrain authored in the 3D editor
                                // (KayKit Hexagon tiles). Default "smooth".
  heightmap: number[];          // flattened row-major, length = width*height. smooth: float
                                // gat height (gat bytes [0:4)); blocks: integer hex level
  collision: CollisionType[];    // flattened row-major, same length as heightmap
  surface: SurfaceType[];        // blocks-only visual tile per cell; [] = derive from
                                // collision. Length 0 or width*height.
  terrainStyle: Partial<Record<SurfaceType, TerrainStyle>>; // how each surface is DRAWN
                                // in this map. Appearance only — never collision,
                                // height or passability. {} = client defaults.
  waterLevel: number | null;      // from rsw; null = no water (was sentinel 1000000)
  props: MapProp[];
  spawns: MapSpawn[];
  triggers: MapTrigger[];        // area triggers (warp/script/damage/heal/save). Default [].
  metadata: {
    sourceLegacyMap?: string;    // original rAthena map name, if imported
    version: number;             // bump on schema change
    generatedAt: string;         // ISO timestamp
  };
}

type CollisionType = "walkable" | "wall" | "water" | "cliff"; // gat type 0/1/3/5
type SurfaceType = "grass" | "dirt" | "stone" | "sand" | "snow" | "water" | "river";

interface TerrainStyle {
  texture?: string;  // id in public/assets/terrain/manifest.json; unknown → default
  scale?: number;    // WORLD units per texture repeat (a rAthena cell is 2 units)
}

interface MapProp {
  id: string;
  assetId: string;            // registry key, see [[skill-r3f-conventions]]
  position: [number, number, number];
  rotation: [number, number, number]; // euler, radians
  scale: [number, number, number];
  colliderType?: "none" | "box" | "trimesh" | "hull";
  tags?: string[];
}

interface MapSpawn {
  id: string;
  kind: "mob" | "npc" | "player_start" | "warp";
  refId?: string;              // mob_db / npc id — required for "mob"/"npc"
  position: [number, number, number];
  count?: number;              // mob only
  respawnTimeMs?: number;       // mob only
  radius?: number;              // mob spawn scatter radius
  direction?: number;           // npc/player facing, 0-7 (8-directional) or degrees
  target?: { mapId: string; position: [number, number, number] }; // warp only
}

interface MapTrigger {
  id: string;
  name?: string;
  kind: "warp" | "script" | "damage" | "heal" | "save"; // typed event, never free string
  area: { col: number; row: number; w: number; h: number }; // rect in CELL coords
  target?: { mapId: string; col: number; row: number }; // required for kind "warp"
  event?: string;              // OnTouch label (kind "script")
  value?: number;              // per-tick damage/heal (kind "damage"/"heal")
}
```

## Rules

- `heightmap` and `collision` are always the same flattened length as
  `size.width * size.height`, row-major (index = `y * width + x`). Never store them as
  nested 2D arrays — keep both flat for consistent indexing across the codebase.
- Never re-derive `collision` from `heightmap` at runtime by guessing a threshold — collision
  must come from the actual gat cell type (imported) or be explicitly authored in the admin
  map editor. Height and walkability are independent fields in the source format.
- `waterLevel: null` means no water plane is rendered/simulated for that map — don't default
  it to `0`, which is a valid real water level.
- `terrainStyle` is **appearance only**. It may never influence collision, height or
  passability — those come from the gat/editor, and a map that renders differently must
  still walk identically. An unknown `texture` id falls back to the client default rather
  than leaving the ground untextured.
- When adding a new field, update this file's schema block and bump `metadata.version` in
  the same change — don't let the TypeScript types and this doc drift apart.
  Current: **v6** (`terrainStyle`).
