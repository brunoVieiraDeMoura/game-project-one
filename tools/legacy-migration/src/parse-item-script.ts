import type { EffectList, GameEffect, StatBonusTarget } from "@ragnarok/game-data";
import { BONUS_KEY_MAP } from "./mappings";

/**
 * Converts rAthena item Script strings into the typed EffectList.
 * Only clearly recognizable statements become typed effects; everything else
 * goes verbatim into unmappedEffects for manual review (skill-legacy-import:
 * never guess, never drop).
 */

const HEAL_RE = /^itemheal\s+rand\((\d+)\s*,\s*(\d+)\)\s*,\s*(\d+)$/;
const HEAL_SIMPLE_RE = /^itemheal\s+(\d+)\s*,\s*(\d+)$/;
const PERCENTHEAL_RE = /^percentheal\s+(-?\d+)\s*,\s*(-?\d+)$/;
const BONUS_RE = /^bonus\s+(b\w+)\s*,\s*(-?\d+)$/;
const SC_START_RE = /^sc_start\s+SC_(\w+)\s*,\s*(\d+)\s*,\s*(-?\d+)$/;

export function parseItemScript(script: string | undefined): EffectList | undefined {
  if (!script) return undefined;

  const effects: GameEffect[] = [];
  const unmapped: string[] = [];

  const statements = script
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    let m = stmt.match(HEAL_RE);
    if (m) {
      const [, min, max, sp] = m;
      effects.push({ kind: "heal", resource: "hp", min: Number(min), max: Number(max) });
      if (Number(sp) > 0) {
        effects.push({ kind: "heal", resource: "sp", min: Number(sp), max: Number(sp) });
      }
      continue;
    }
    m = stmt.match(HEAL_SIMPLE_RE);
    if (m) {
      const [, hp, sp] = m;
      if (Number(hp) !== 0) effects.push({ kind: "heal", resource: "hp", min: Number(hp), max: Number(hp) });
      if (Number(sp) !== 0) effects.push({ kind: "heal", resource: "sp", min: Number(sp), max: Number(sp) });
      continue;
    }
    m = stmt.match(PERCENTHEAL_RE);
    if (m) {
      const [, hp, sp] = m;
      if (Number(hp) !== 0)
        effects.push({ kind: "heal", resource: "hp", min: Number(hp), max: Number(hp), percent: true });
      if (Number(sp) !== 0)
        effects.push({ kind: "heal", resource: "sp", min: Number(sp), max: Number(sp), percent: true });
      continue;
    }
    m = stmt.match(BONUS_RE);
    if (m) {
      const [, key, value] = m;
      const stat = key ? BONUS_KEY_MAP[key] : undefined;
      if (stat) {
        effects.push({ kind: "statBonus", stat: stat as StatBonusTarget, value: Number(value) });
        continue;
      }
    }
    m = stmt.match(SC_START_RE);
    if (m) {
      const [, status, durationMs] = m;
      effects.push({
        kind: "grantStatus",
        statusId: String(status).toLowerCase(),
        durationMs: Number(durationMs),
      });
      continue;
    }
    unmapped.push(stmt);
  }

  if (effects.length === 0 && unmapped.length === 0) return undefined;
  return { effects, unmappedEffects: unmapped };
}
