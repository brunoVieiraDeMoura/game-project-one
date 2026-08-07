import { StatusEffectDefSchema, type StatusEffectDef } from "@ragnarok/game-data";

/** StatusEffectDefSchema ↔ `statuses` row (20260719000001_statuses_skills.sql). */

export interface StatusRow {
  id: string;
  name: string;
  category: string;
  states: unknown;
  calc_flags: unknown;
  opt1: string | null;
  opt2: unknown;
  opt3: unknown;
  options: unknown;
  flags: unknown;
  duration_lookup_skill: string | null;
  default_duration_ms: number | null;
  min_rate: number | null;
  min_duration_ms: number | null;
  fail_on: unknown;
  end_on_start: unknown;
  end_return: unknown;
  end_on_end: unknown;
  effects: unknown | null;
  icon: string | null;
  description: string | null;
  status_group: string;
  params: unknown;
}

export function statusToRow(s: StatusEffectDef): StatusRow {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    states: s.states,
    calc_flags: s.calcFlags,
    opt1: s.opt1 ?? null,
    opt2: s.opt2,
    opt3: s.opt3,
    options: s.options,
    flags: s.flags,
    duration_lookup_skill: s.durationLookupSkill ?? null,
    default_duration_ms: s.defaultDurationMs ?? null,
    min_rate: s.minRate ?? null,
    min_duration_ms: s.minDurationMs ?? null,
    fail_on: s.failOn,
    end_on_start: s.endOnStart,
    end_return: s.endReturn,
    end_on_end: s.endOnEnd,
    effects: s.effects ?? null,
    icon: s.icon ?? null,
    description: s.description ?? null,
    status_group: s.group,
    params: s.params,
  };
}

export function rowToStatus(row: StatusRow): StatusEffectDef {
  return StatusEffectDefSchema.parse({
    id: row.id,
    name: row.name,
    category: row.category,
    states: row.states,
    calcFlags: row.calc_flags,
    opt1: row.opt1 ?? undefined,
    opt2: row.opt2,
    opt3: row.opt3,
    options: row.options,
    flags: row.flags,
    durationLookupSkill: row.duration_lookup_skill ?? undefined,
    defaultDurationMs: row.default_duration_ms ?? undefined,
    minRate: row.min_rate ?? undefined,
    minDurationMs: row.min_duration_ms ?? undefined,
    failOn: row.fail_on,
    endOnStart: row.end_on_start,
    endReturn: row.end_return,
    endOnEnd: row.end_on_end,
    effects: row.effects ?? undefined,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    group: row.status_group,
    params: row.params,
  });
}
