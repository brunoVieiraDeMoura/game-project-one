import { z } from "zod";
import { BaseStatsSchema } from "./common";
import { ItemSubTypeSchema } from "./item";

/**
 * Character class/job schema (soul.txt §5.2). Sourced from rAthena
 * db/re/job_stats.yml + skill_tree.yml. Growth is stored as explicit
 * per-level tables where rAthena uses tables, plus formula params where it
 * uses formulas — migration fills whichever the source provides.
 */

export const AspdModifierSchema = z.object({
  /** "shield" = ASPD penalty applied when a shield is equipped (rAthena BaseASPD Shield entry). */
  weaponType: ItemSubTypeSchema.or(z.enum(["bare_hand", "shield"])),
  /** Base ASPD value for this class with this weapon type (rAthena BaseASPD). */
  baseAspd: z.number(),
});

export const JobClassSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  /** e.g. "novice" → "swordman" → "knight" progression reference */
  parentClassId: z.number().int().nullable().default(null),
  maxBaseLevel: z.number().int().positive(),
  maxJobLevel: z.number().int().positive(),

  /** Starting attributes. */
  baseStats: BaseStatsSchema,
  /** Stat points gained per JOB level (rAthena BonusStats). `traits` carries
   * 4th-job trait stats (pow/sta/wis/spl/con/crt) — kept verbatim, never dropped. */
  bonusStatsPerLevel: z
    .array(
      z.object({
        level: z.number().int().positive(),
        stats: BaseStatsSchema.partial(),
        traits: z.record(z.string(), z.number().int()).optional(),
      }),
    )
    .default([]),

  /** HP/SP: rAthena job_stats uses per-level tables (BaseHp/BaseSp). */
  baseHpByLevel: z.array(z.number().int()).default([]),
  baseSpByLevel: z.array(z.number().int()).default([]),
  /** Fallback growth formula params when no explicit table exists.
   * UNCLEAR-FORMULA: exact fallback growth must be validated against
   * rathena/src/map/status.cpp before use in engine-core. */
  hpGrowth: z.object({ base: z.number(), perLevel: z.number(), factor: z.number() }).optional(),
  spGrowth: z.object({ base: z.number(), perLevel: z.number(), factor: z.number() }).optional(),

  maxWeight: z.number().int().positive(),

  /** Exp necessário por nível (índice 0 = nível 1→2), de job_exp.yml. */
  baseExpByLevel: z.array(z.number()).default([]),
  jobExpByLevel: z.array(z.number()).default([]),

  allowedWeapons: z.array(ItemSubTypeSchema).default([]),
  /** Armor restriction is job-bitmask driven on the item side in rAthena;
   * kept here as an explicit allowlist for the new engine's admin editing. */
  allowedArmorTags: z.array(z.string()).default([]),

  skills: z
    .array(
      z.object({
        skillId: z.number().int().positive(),
        maxLevel: z.number().int().positive(),
        /** prerequisite skills within the tree */
        requires: z
          .array(z.object({ skillId: z.number().int(), level: z.number().int() }))
          .default([]),
      }),
    )
    .default([]),

  aspdModifiers: z.array(AspdModifierSchema).default([]),
});
export type JobClass = z.infer<typeof JobClassSchema>;
