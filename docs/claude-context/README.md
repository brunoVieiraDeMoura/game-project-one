# docs/claude-context — detailed knowledge extracted from CLAUDE.md

This directory holds the full, verbatim "Decisões e estado" body that used
to live inline in the project's `CLAUDE.md` (240,002 chars, over the
150,000-char context limit). It was split on 2026-08-10 into eight
domain files, each prefixed with an authored scope/overview section
followed by the original text unchanged.

Reconstructing the eight files' verbatim sections back into original order
reproduces the source `CLAUDE.md` body byte-for-byte (verified by diff at
split time; only blank-line spacing at file boundaries differs).

| # | File | Primary topics |
|---|---|---|
| 01 | `01-rathena-connection-and-world-sync.md` | WSL2 server setup, ports, PACKETVER, GPL licensing, login→char→map session flow, packet-per-version rules, dual-grid architecture, client-side A* pathfinding, 30-cell walk-path limit, 200ms click window, path chaining, same-map teleport packet, fractional-cell math |
| 02 | `02-terrain-rendering.md` | rAthena map import (dual map_cache), chunked square terrain mesh, terrain texture pipeline, corner color blending, water rendering, height fields, chunk build budget, two-phase loading screen, sky-color fog, per-entity texture leak fix |
| 03 | `03-ui-system-and-hud.md` | Full painted UI skin system (all HUD windows), session gating, hotkeys, server area_size/spawn tuning, gateway state replay |
| 04 | `04-netcode-prediction-reconciliation.md` | Client prediction, server reconciliation, snapshot interpolation, fixpos/highjump, smart target, TAB cycling, casting-blocks-movement, continuous sub-cell position, the "three silent bugs" investigation, StrictMode pathfinder bug |
| 05 | `05-diagnostics-flight-recorder.md` | The flight recorder black-box tool, renderer/scene/asset probes, the Suspense-remount investigation, asset/texture reuse audit, texture deduplication |
| 06 | `06-combat-orders-and-edge-cases.md` | Three multi-frame order systems (attack/pickup/skillwalk), dash-prevention (`moveTarget.ts`), collision mismatch, packet variants, model rotation, class names, `@load` escape hatch |
| 07 | `07-map-editor.md` | Editor dual-grid, culling, blocked-cluster classification, global edit scope, all terrain brushes, procedural layers, `export:mapcache`, legacy hex-terrain system |
| 08 | `08-data-database-config-and-hex-legacy.md` | rAthena MySQL content database, hot-reload queue, Supabase admin DB/auth, ruleset, WASD removal history, legacy-migration data rules, config singleton |

See the curated "Regras e invariantes essenciais" section in the project's
root `CLAUDE.md` for the condensed, always-loaded version of the rules that
matter most; come here for the full reasoning, measured numbers, function
names, and file paths behind each one.
