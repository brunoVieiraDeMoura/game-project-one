import { z } from "zod";
import { BaseStatSchema } from "./common";
import { StatBonusTargetSchema } from "./effects";

/**
 * Balancing schema (soul.txt §5.6): editable derivation-rule table
 * (base stat → derived sub-stat → multiplier/formula), NOT constants in code.
 * Each rule is individually editable (e.g. change only STR→ATK multiplier
 * without touching STR→maxWeight).
 *
 * UNCLEAR-FORMULA markers: default expressions below must be validated
 * against rathena/src/map/status.cpp before engine-core relies on them —
 * flagged per soul.txt §3 instead of assumed.
 */

export const DerivationRuleSchema = z.object({
  id: z.string(), // e.g. "str-atk"
  source: BaseStatSchema,
  derived: StatBonusTargetSchema,
  /**
   * Formula DSL evaluated by engine-core. Variables: value (source stat),
   * baseLevel. E.g. "value * 1" for STR→ATK flat, "floor(value / 10) ** 2".
   */
  expression: z.string(),
  /** simple multiplier fast-path; when set, expression is "value * multiplier" */
  multiplier: z.number().optional(),
  enabled: z.boolean().default(true),
  needsReview: z.boolean().default(false),
  note: z.string().optional(),
});
export type DerivationRule = z.infer<typeof DerivationRuleSchema>;

export const CombatFormulasSchema = z.object({
  /** each is a formula-DSL expression; needsReview = not yet validated against rAthena source */
  hardDefReduction: z.object({ expression: z.string(), needsReview: z.boolean().default(true) }),
  softDef: z.object({ expression: z.string(), needsReview: z.boolean().default(true) }),
  magicDef: z.object({ expression: z.string(), needsReview: z.boolean().default(true) }),
  flee: z.object({ expression: z.string(), needsReview: z.boolean().default(true) }),
  hit: z.object({ expression: z.string(), needsReview: z.boolean().default(true) }),
  critical: z.object({ expression: z.string(), needsReview: z.boolean().default(true) }),
  aspd: z.object({ expression: z.string(), needsReview: z.boolean().default(true) }),
});
export type CombatFormulas = z.infer<typeof CombatFormulasSchema>;

export const BalancingConfigSchema = z.object({
  derivationRules: z.array(DerivationRuleSchema),
  combatFormulas: CombatFormulasSchema,
  version: z.number().int(),
  updatedAt: z.string(),
});
export type BalancingConfig = z.infer<typeof BalancingConfigSchema>;
