---
name: skill-legacy-import
description: >
  How to run/extend tools/legacy-migration, the offline Node scripts that parse original
  rAthena data (item_db, mob_db, skill_db, job db, npc scripts, gat/rsw map files) into the
  new JSON schemas (packages/game-data, packages/map-format). Use whenever writing or
  modifying a legacy-migration parser, importing a new data table from rathena/db or
  rathena/npc, or converting a .gat/.rsw map into the new GameMap format. Grounded directly
  in the rAthena source tree at rathena/ — don't guess a binary layout, read the source.
---

## Map files: gat/rsw/gnd

Reference implementation to imitate: `rathena/src/tool/mapcache.cpp` (this is literally
rAthena's own gat→cache converter — the closest thing to an authoritative parser spec).

**`.gat` parsing** (confirmed in `mapcache.cpp` and `rathena/src/map/map.hpp:749-773`):
- No magic-number check — read positionally.
- Byte offset 6: `uint32` LE = map width in cells (`xs`).
- Byte offset 10: `uint32` LE = map height in cells (`ys`).
- Cell array starts at offset 14. Each cell is **20 bytes**:
  - `[0:4)` `float` LE — ground height (bottom-left corner of the quad; the other 3 corner
    heights used by the client for slope rendering live in `[4:16)` — not needed, don't
    bother parsing them for the new engine's flat heightmap).
  - `[16:20)` `uint32` LE — cell type: `0`=walkable, `1`=wall, `3`=water, `5`=cliff/gap.
- **Reclassification step** (do this — it's what rAthena itself does): if a cell's raw type
  is `0` (walkable) but its height is above the map's water level, reclassify it as `3`
  (water) before writing it to `packages/map-format`'s `collision` array. Don't skip this —
  a copy of the raw type byte alone under-reports water tiles.
- Output straight into the `GameMap.heightmap` / `GameMap.collision` flat arrays defined in
  [[skill-map-format]] — same indexing (`y * width + x`), same enum names.

**`.rsw` parsing** (confirmed in `rathena/src/common/grfio.cpp:459-494`):
- Magic bytes `"GRSW"` at offset 0.
- Version: big-endian `uint16` at bytes 4-5. Only versions `0x104`–`0x205` are handled by
  the reference implementation — reject/flag anything outside that range rather than
  guessing an offset.
- Water-level `float` byte offset depends on version: `171` if version ≥ `0x205`, `167` if
  ≥ `0x202`, else `166`.
- If there's no water file for a map, or you can't find the field, use sentinel
  `1000000` → normalize to `waterLevel: null` in the new schema (never propagate the raw
  sentinel number).

**`.gnd`**: rAthena's server never parses this file — confirmed absent from `src/map`
(only referenced in `grfio.cpp:514` as a file extension needing GRF decryption, never
decoded). This project doesn't migrate visual ground-mesh data at all (soul.txt: visuals
are recreated, not ported) — **do not write a `.gnd` parser**; the new engine derives
render geometry from the imported `heightmap` directly.

## DB table imports (item_db, mob_db, skill_db, job db)

- Source files live under `rathena/db/` (check both `db/pre-re/` and `db/re/` — renewal vs
  pre-renewal tables differ; confirm with the user which ruleset this server uses before
  picking one, per soul.txt's "ask when a formula/rule is unclear" instruction).
- These are structured text/YAML tables, not binary — parse them field-by-field into the
  matching `packages/game-data` schema (see soul.txt section 5 for the exact field list per
  entity: Items, Classes, Skills, Monsters, NPCs). Any bitmask field (class restriction,
  gender restriction, equip location) must be converted into a readable array in the new
  schema, not kept as a raw bitmask.
- **Item "script" fields (on-use/on-equip effects)**: rAthena scripts are a full scripting
  language with no equivalent in the new engine. Do not translate script strings 1:1 or
  store them as opaque strings. Instead, parse only the recognizable effect patterns into
  the typed "effects" structure from soul.txt (bonus stat, heal amount, status effect
  grant, etc.), and for anything unrecognized, **flag it explicitly for manual review**
  (e.g. push into an `unmappedEffects: string[]` field) rather than silently dropping it or
  guessing its meaning.

## NPC scripts

- NPC dialogue/warps/shops in `rathena/npc/` are also free-form script — convert into the
  structured dialogue tree / warp / shop-list shape from soul.txt section 5.5. Same rule as
  item effects: unrecognized script constructs get flagged for manual review, never guessed.

## General workflow for extending the importer

1. Find the source table/file under `rathena/db` or `rathena/npc`, or the binary format in
   `rathena/src` (grep for it there before assuming a layout from general RO-modding
   knowledge — this repo's source is authoritative).
2. Write the parser under `tools/legacy-migration/`, output conforming exactly to the
   target schema in `packages/game-data` or `packages/map-format`.
3. Where a formula, bitmask, or field meaning is ambiguous, stop and ask rather than assume
   (soul.txt's explicit instruction) — don't ship a guessed value silently.
