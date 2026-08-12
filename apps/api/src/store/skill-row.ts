import { SkillSchema, type Skill } from "@ragnarok/game-data";

/** SkillSchema ↔ `skills` row (20260719000001_statuses_skills.sql). */

export interface SkillRow {
  id: number;
  aegis_name: string;
  name: string;
  icon: string | null;
  max_level: number;
  type: string;
  damage_nature: string;
  hit_type: string;
  target: string;
  element: unknown;
  damage_flags: unknown;
  flags: unknown;
  range: unknown;
  hits: unknown;
  area_radius: unknown;
  knockback: unknown;
  active_instances: unknown;
  give_ap: unknown;
  sp_cost: unknown;
  cast_time: unknown;
  cooldown: unknown;
  after_cast_delay: unknown;
  after_cast_walk_delay: unknown;
  duration: unknown;
  duration2: unknown;
  interruptible: boolean;
  cast_defense_reduction: number | null;
  cast_time_flags: unknown;
  cast_delay_flags: unknown;
  requirements: unknown | null;
  copy_flags: unknown | null;
  no_near_npc: unknown | null;
  unit: unknown | null;
  damage_formula: unknown | null;
  applied_statuses: unknown;
}

export function skillToRow(s: Skill): SkillRow {
  return {
    id: s.id,
    aegis_name: s.aegisName,
    name: s.name,
    icon: s.icon ?? null,
    max_level: s.maxLevel,
    type: s.type,
    damage_nature: s.damageNature,
    hit_type: s.hitType,
    target: s.target,
    element: s.element,
    damage_flags: s.damageFlags,
    flags: s.flags,
    range: s.range,
    hits: s.hits,
    area_radius: s.areaRadius,
    knockback: s.knockback,
    active_instances: s.activeInstances,
    give_ap: s.giveAp,
    sp_cost: s.spCost,
    cast_time: s.castTimeMs,
    cooldown: s.cooldownMs,
    after_cast_delay: s.afterCastDelayMs,
    after_cast_walk_delay: s.afterCastWalkDelayMs,
    duration: s.durationMs,
    duration2: s.duration2Ms,
    interruptible: s.interruptible,
    cast_defense_reduction: s.castDefenseReduction ?? null,
    cast_time_flags: s.castTimeFlags,
    cast_delay_flags: s.castDelayFlags,
    requirements: s.requirements ?? null,
    copy_flags: s.copyFlags ?? null,
    no_near_npc: s.noNearNpc ?? null,
    unit: s.unit ?? null,
    damage_formula: s.damageFormula ?? null,
    applied_statuses: s.appliedStatuses,
  };
}

export function rowToSkill(row: SkillRow): Skill {
  return SkillSchema.parse({
    id: row.id,
    aegisName: row.aegis_name,
    name: row.name,
    icon: row.icon ?? undefined,
    maxLevel: row.max_level,
    type: row.type,
    damageNature: row.damage_nature,
    hitType: row.hit_type,
    target: row.target,
    element: row.element,
    damageFlags: row.damage_flags,
    flags: row.flags,
    range: row.range,
    hits: row.hits,
    areaRadius: row.area_radius,
    knockback: row.knockback,
    activeInstances: row.active_instances,
    giveAp: row.give_ap,
    spCost: row.sp_cost,
    castTimeMs: row.cast_time,
    cooldownMs: row.cooldown,
    afterCastDelayMs: row.after_cast_delay,
    afterCastWalkDelayMs: row.after_cast_walk_delay,
    durationMs: row.duration,
    duration2Ms: row.duration2,
    interruptible: row.interruptible,
    castDefenseReduction: row.cast_defense_reduction ?? undefined,
    castTimeFlags: row.cast_time_flags,
    castDelayFlags: row.cast_delay_flags,
    requirements: row.requirements ?? undefined,
    copyFlags: row.copy_flags ?? undefined,
    noNearNpc: row.no_near_npc ?? undefined,
    unit: row.unit ?? undefined,
    damageFormula: row.damage_formula ?? undefined,
    appliedStatuses: row.applied_statuses,
  });
}
