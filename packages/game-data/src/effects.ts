import { z } from "zod";

/**
 * Typed replacement for rAthena's free-form item/skill Script fields
 * (soul.txt §5.1 + skill-legacy-import): recognizable patterns become typed
 * effects; anything the migration parser can't map goes into
 * `unmappedEffects` for manual review — never silently dropped or guessed.
 */

export const StatBonusTargetSchema = z.enum([
  "str", "agi", "vit", "int", "dex", "luk",
  "atk", "matk", "def", "mdef", "hit", "flee", "crit",
  "maxHp", "maxSp", "aspdRate", "castRate", "maxWeight",
]);
export type StatBonusTarget = z.infer<typeof StatBonusTargetSchema>;

export const GameEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("heal"),
    resource: z.enum(["hp", "sp"]),
    min: z.number(),
    max: z.number(),
    /** true = min/max are % of max resource instead of flat amounts */
    percent: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("statBonus"),
    stat: StatBonusTargetSchema,
    value: z.number(),
    /** value applied per refine level instead of flat (bonus ... getrefine()) */
    perRefine: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("grantStatus"),
    /** references status/buff catalog id (admin dropdown selects from it, soul.txt §5.3) */
    statusId: z.string(),
    durationMs: z.number().int().nonnegative(),
    chance: z.number().min(0).max(100).optional(),
    magnitude: z.number().optional(),
  }),
  z.object({
    kind: z.literal("castSkill"),
    skillId: z.number().int(),
    level: z.number().int().positive(),
  }),
]);
export type GameEffect = z.infer<typeof GameEffectSchema>;

export const EffectListSchema = z.object({
  effects: z.array(GameEffectSchema).default([]),
  /** raw script fragments the migration couldn't map — needs manual review */
  unmappedEffects: z.array(z.string()).default([]),
});
export type EffectList = z.infer<typeof EffectListSchema>;
