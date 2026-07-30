import { JobClassSchema, type JobClass } from "@ragnarok/game-data";

/** JobClassSchema ↔ `job_classes` row (20260718000001_job_classes.sql). */

export interface JobClassRow {
  id: number;
  name: string;
  parent_class_id: number | null;
  max_base_level: number;
  max_job_level: number;
  max_weight: number;
  base_stats: unknown;
  bonus_stats: unknown;
  base_hp_by_level: unknown;
  base_sp_by_level: unknown;
  base_exp_by_level: unknown;
  job_exp_by_level: unknown;
  hp_growth: unknown | null;
  sp_growth: unknown | null;
  allowed_weapons: unknown;
  allowed_armor_tags: unknown;
  skills: unknown;
  aspd_modifiers: unknown;
}

export function jobClassToRow(jc: JobClass): JobClassRow {
  return {
    id: jc.id,
    name: jc.name,
    parent_class_id: jc.parentClassId,
    max_base_level: jc.maxBaseLevel,
    max_job_level: jc.maxJobLevel,
    max_weight: jc.maxWeight,
    base_stats: jc.baseStats,
    bonus_stats: jc.bonusStatsPerLevel,
    base_hp_by_level: jc.baseHpByLevel,
    base_sp_by_level: jc.baseSpByLevel,
    base_exp_by_level: jc.baseExpByLevel,
    job_exp_by_level: jc.jobExpByLevel,
    hp_growth: jc.hpGrowth ?? null,
    sp_growth: jc.spGrowth ?? null,
    allowed_weapons: jc.allowedWeapons,
    allowed_armor_tags: jc.allowedArmorTags,
    skills: jc.skills,
    aspd_modifiers: jc.aspdModifiers,
  };
}

export function rowToJobClass(row: JobClassRow): JobClass {
  return JobClassSchema.parse({
    id: row.id,
    name: row.name,
    parentClassId: row.parent_class_id,
    maxBaseLevel: row.max_base_level,
    maxJobLevel: row.max_job_level,
    maxWeight: row.max_weight,
    baseStats: row.base_stats,
    bonusStatsPerLevel: row.bonus_stats,
    baseHpByLevel: row.base_hp_by_level,
    baseSpByLevel: row.base_sp_by_level,
    baseExpByLevel: row.base_exp_by_level,
    jobExpByLevel: row.job_exp_by_level,
    hpGrowth: row.hp_growth ?? undefined,
    spGrowth: row.sp_growth ?? undefined,
    allowedWeapons: row.allowed_weapons,
    allowedArmorTags: row.allowed_armor_tags,
    skills: row.skills,
    aspdModifiers: row.aspd_modifiers,
  });
}
