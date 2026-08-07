import { z } from "zod";
import { ElementSchema, perLevel } from "./common";
import { ItemSubTypeSchema } from "./item";

/**
 * Skill schema (soul.txt §5.3). Sourced from rAthena db/re/skill_db.yml.
 * Per-level values use `perLevel(...)`: scalar applies to all levels, array
 * index 0 = level 1. Damage formulas are structured references, not free
 * script — unmigratable formulas are flagged, never guessed.
 *
 * rAthena flag maps (DamageFlags/Flags/CastTimeFlags/...) become readable
 * snake_case string arrays, same policy as the rest of the schemas.
 */

/** derived from rAthena TargetType: Attack→damage, Support→support, Ground/Trap→area, Self→self_buff, Passive→passive */
export const SkillTypeSchema = z.enum(["damage", "support", "area", "self_buff", "passive"]);
export type SkillType = z.infer<typeof SkillTypeSchema>;
/** damage nature (rAthena Type): weapon/magic/misc; none = no damage component */
export const SkillDamageNatureSchema = z.enum(["none", "weapon", "magic", "misc"]);
export type SkillDamageNature = z.infer<typeof SkillDamageNatureSchema>;
export const SkillHitTypeSchema = z.enum(["normal", "single", "multi_hit", "critical"]);
export type SkillHitType = z.infer<typeof SkillHitTypeSchema>;
export const SkillTargetSchema = z.enum(["enemy", "ally", "ground", "self", "party", "trap"]);
export type SkillTarget = z.infer<typeof SkillTargetSchema>;

/** skill element: fixed element, "weapon" = weapon's element, "endowed" = current endow, "random" */
export const SkillElementSchema = ElementSchema.or(z.enum(["weapon", "endowed", "random"]));

export const SkillRequirementSchema = z.object({
  /** items consumed on cast; amount 0 = exigido no inventário mas não consumido (rAthena); `level` restringe ao nível (ItemCost.Level) */
  itemsConsumed: z
    .array(
      z.object({
        itemId: z.number().int(),
        amount: z.number().int().nonnegative(),
        level: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  /** equipment that must be worn (item ids) */
  requiredEquipment: z.array(z.number().int()).default([]),
  /** weapon subtypes allowed to cast; empty = any weapon */
  requiredWeapons: z.array(ItemSubTypeSchema).default([]),
  /** ammo subtypes required to cast */
  requiredAmmo: z.array(z.string()).default([]),
  ammoAmount: perLevel(z.number().int()).optional(),
  /** required character state, e.g. "riding", "hiding", "cart" */
  requiredState: z.string().optional(),
  /** statuses (status catalog ids) that must be active to cast */
  requiredStatuses: z.array(z.string()).default([]),
  hpCost: perLevel(z.number().int()).optional(),
  apCost: perLevel(z.number().int()).optional(),
  /** % of HP; positive = current HP, negative = max HP (rAthena convention) */
  hpRateCost: perLevel(z.number().int()).optional(),
  spRateCost: perLevel(z.number().int()).optional(),
  apRateCost: perLevel(z.number().int()).optional(),
  /** cast only allowed at or below this max-HP threshold */
  maxHpTrigger: perLevel(z.number().int()).optional(),
  spiritSphereCost: perLevel(z.number().int()).optional(),
  zenyCost: perLevel(z.number().int()).optional(),
});

/**
 * Damage formula as structured data. `expression` uses a restricted formula
 * DSL evaluated by engine-core (variables: baseLevel, skillLevel, str..luk,
 * atk, matk). Migrated formulas that couldn't be parsed cleanly set
 * `needsReview: true` with the original rAthena source in `legacySource`.
 */
export const DamageFormulaSchema = z.object({
  expression: z.string(),
  element: SkillElementSchema.default("weapon"),
  needsReview: z.boolean().default(false),
  legacySource: z.string().optional(),
});

/** ground unit placed by the skill (traps, songs, pneuma, ...) — rAthena Unit block */
export const SkillUnitSchema = z.object({
  id: z.string(),
  alternateId: z.string().optional(),
  layout: perLevel(z.number().int()).default(0),
  range: perLevel(z.number().int()).default(0),
  intervalMs: z.number().int().default(0),
  target: z.string().default("all"),
  flags: z.array(z.string()).default([]),
});

export const SkillSchema = z.object({
  id: z.number().int().positive(),
  aegisName: z.string().min(1),
  name: z.string().min(1),
  maxLevel: z.number().int().positive(),

  type: SkillTypeSchema,
  damageNature: SkillDamageNatureSchema.default("none"),
  hitType: SkillHitTypeSchema.default("normal"),
  /** "weapon" = inherits weapon element */
  element: perLevel(SkillElementSchema).default("weapon"),
  /** damage behavior flags: splash, no_damage, ignore_defense, critical, ... (rAthena DamageFlags) */
  damageFlags: z.array(z.string()).default([]),
  /** info flags: is_quest, is_npc, is_trap, ignore_land_protector, ... (rAthena Flags) */
  flags: z.array(z.string()).default([]),

  /** range in cells; negative = melee attack range (rAthena convention) */
  range: perLevel(z.number().int()),
  /** number of hits; negative mirrors rAthena convention of damage-split hits */
  hits: perLevel(z.number().int()).default(1),
  /** area of effect radius in cells; 0 = single target, -1 = special/full screen */
  areaRadius: perLevel(z.number().int()).default(0),
  knockback: perLevel(z.number().int()).default(0),
  /** max simultaneous ground instances (traps etc.) */
  activeInstances: perLevel(z.number().int()).default(0),
  /** AP granted on successful cast */
  giveAp: perLevel(z.number().int()).default(0),

  spCost: perLevel(z.number().int()).default(0),
  castTimeMs: z.object({
    variable: perLevel(z.number().int()).default(0),
    fixed: perLevel(z.number().int()).default(0),
  }),
  cooldownMs: perLevel(z.number().int()).default(0),
  /** global delay after cast (rAthena AfterCastActDelay) */
  afterCastDelayMs: perLevel(z.number().int()).default(0),
  afterCastWalkDelayMs: perLevel(z.number().int()).default(0),
  /** skill effect durations (rAthena Duration1/Duration2) */
  durationMs: perLevel(z.number().int()).default(0),
  duration2Ms: perLevel(z.number().int()).default(0),
  interruptible: z.boolean().default(true),
  /** % defense kept while casting (rAthena CastDefenseReduction) */
  castDefenseReduction: z.number().int().optional(),
  /** what modifies variable cast time / cast delay: ignore_dex, ignore_status, ... */
  castTimeFlags: z.array(z.string()).default([]),
  castDelayFlags: z.array(z.string()).default([]),

  requirements: SkillRequirementSchema.optional(),
  target: SkillTargetSchema,

  /** which copy-skill mechanics can learn this (plagiarism/reproduce) + requirement types removed on copy */
  copyFlags: z
    .object({
      skill: z.array(z.string()).default([]),
      removeRequirement: z.array(z.string()).default([]),
    })
    .optional(),
  /** cast restriction near NPCs (rAthena NoNearNPC) */
  noNearNpc: z
    .object({
      additionalRange: z.number().int().optional(),
      type: z.array(z.string()).default([]),
    })
    .optional(),

  unit: SkillUnitSchema.optional(),

  damageFormula: DamageFormulaSchema.optional(),

  /** applied status effects — reference the status catalog by id (dropdown in admin) */
  appliedStatuses: z
    .array(
      z.object({
        statusId: z.string(),
        chance: z.number().min(0).max(100).default(100),
        durationMs: perLevel(z.number().int()),
        magnitude: perLevel(z.number()).optional(),
        appliesTo: z.enum(["target", "self"]).default("target"),
        /** true when chance/magnitude/duration live in rAthena C++ source and weren't migrated — do not trust defaults */
        needsReview: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type Skill = z.infer<typeof SkillSchema>;
export type SkillRequirement = z.infer<typeof SkillRequirementSchema>;
export type DamageFormula = z.infer<typeof DamageFormulaSchema>;
