import { z } from "zod";
import {
  CharacterVariantSchema,
  EquipLocationSchema,
  GenderSchema,
} from "./common";
import { EffectListSchema } from "./effects";

/**
 * Item schema — mirrors rathena/db/re/item_db*.yml (ITEM_DB v3 header) with
 * every restriction map converted to readable arrays (soul.txt §5.1).
 * Script/EquipScript/UnEquipScript become typed EffectList structures.
 */

export const ItemTypeSchema = z.enum([
  "healing", "usable", "etc", "armor", "weapon", "card",
  "pet_egg", "pet_armor", "ammo", "delay_consume", "shadow_gear", "cash",
]);
export type ItemType = z.infer<typeof ItemTypeSchema>;

/** Weapon/ammo/card subtype ("SubType" in item_db). */
export const ItemSubTypeSchema = z.enum([
  // weapons
  "dagger", "1h_sword", "2h_sword", "1h_spear", "2h_spear", "1h_axe", "2h_axe",
  "mace", "2h_mace", "staff", "2h_staff", "bow", "knuckle", "musical",
  "whip", "book", "katar", "revolver", "rifle", "gatling", "shotgun",
  "grenade", "huuma", "fist",
  // ammo
  "arrow", "dagger_ammo", "bullet", "shell", "grenade_ammo", "shuriken",
  "kunai", "cannonball", "throwable_weapon",
  // card
  "normal_card", "enchant_card",
]);
export type ItemSubType = z.infer<typeof ItemSubTypeSchema>;

/** Jobs map → readable array of job names allowed to equip. Empty array = none; ["all"] = todos. */
export const JobRestrictionSchema = z.array(z.string());

export const ItemFlagsSchema = z.object({
  buyingStore: z.boolean().default(false),
  deadBranch: z.boolean().default(false),
  container: z.boolean().default(false),
  uniqueId: z.boolean().default(false),
  bindOnEquip: z.boolean().default(false),
  dropAnnounce: z.boolean().default(false),
  noConsume: z.boolean().default(false),
  dropEffect: z.string().optional(),
});

export const ItemDelaySchema = z.object({
  durationMs: z.number().int().nonnegative(),
  statusId: z.string().optional(),
});

export const ItemStackSchema = z.object({
  amount: z.number().int().positive(),
  inventory: z.boolean().default(true),
  cart: z.boolean().default(false),
  storage: z.boolean().default(false),
  guildStorage: z.boolean().default(false),
});

export const ItemTradeSchema = z.object({
  overrideGroupLevel: z.number().int().default(100),
  noDrop: z.boolean().default(false),
  noTrade: z.boolean().default(false),
  tradePartnerOnly: z.boolean().default(false),
  noSell: z.boolean().default(false),
  noCart: z.boolean().default(false),
  noStorage: z.boolean().default(false),
  noGuildStorage: z.boolean().default(false),
  noMail: z.boolean().default(false),
  noAuction: z.boolean().default(false),
});

export const ItemNoUseSchema = z.object({
  overrideGroupLevel: z.number().int().default(100),
  sitting: z.boolean().default(false),
});

export const ItemSchema = z.object({
  id: z.number().int().positive(),
  aegisName: z.string().min(1),
  name: z.string().min(1),
  type: ItemTypeSchema,
  subType: ItemSubTypeSchema.optional(),

  buyPrice: z.number().int().nonnegative().default(0),
  sellPrice: z.number().int().nonnegative().default(0),
  weight: z.number().int().nonnegative().default(0),

  attack: z.number().int().default(0),
  magicAttack: z.number().int().default(0),
  defense: z.number().int().default(0),
  range: z.number().int().nonnegative().default(0),
  slots: z.number().int().min(0).max(4).default(0),

  /** Jobs bitmask/map → readable array (["all"] or explicit job list). */
  jobs: JobRestrictionSchema.default(["all"]),
  /** Upper-class restriction (normal/baby/trans/third...) → readable array. */
  classes: z.array(CharacterVariantSchema).default([]),
  gender: GenderSchema.default("both"),
  /** Equip placement flags → readable array. */
  locations: z.array(EquipLocationSchema).default([]),

  weaponLevel: z.number().int().min(0).max(5).optional(),
  armorLevel: z.number().int().min(0).max(2).optional(),
  equipLevelMin: z.number().int().nonnegative().default(0),
  equipLevelMax: z.number().int().nonnegative().default(0),
  refineable: z.boolean().default(false),
  gradable: z.boolean().default(false),

  /** View/sprite id for the client. */
  viewSprite: z.number().int().nonnegative().default(0),
  aliasName: z.string().optional(),

  flags: ItemFlagsSchema.optional(),
  delay: ItemDelaySchema.optional(),
  stack: ItemStackSchema.optional(),
  noUse: ItemNoUseSchema.optional(),
  trade: ItemTradeSchema.optional(),

  /** Typed replacements for Script / EquipScript / UnEquipScript. */
  onUse: EffectListSchema.optional(),
  onEquip: EffectListSchema.optional(),
  onUnequip: EffectListSchema.optional(),
});
export type Item = z.infer<typeof ItemSchema>;

/** Input for create/update (id required — item ids are stable, chosen by the admin). */
export const ItemInputSchema = ItemSchema;
