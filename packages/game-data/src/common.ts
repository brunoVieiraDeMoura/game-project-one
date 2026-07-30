import { z } from "zod";

/** Shared enums/primitives across game-data schemas. Values mirror rAthena's
 * readable names (db/re YAML), never raw bitmasks/ids — conversion happens in
 * tools/legacy-migration. */

export const ElementSchema = z.enum([
  "neutral", "water", "earth", "fire", "wind", "poison",
  "holy", "shadow", "ghost", "undead",
]);
export type Element = z.infer<typeof ElementSchema>;

export const RaceSchema = z.enum([
  "formless", "undead", "brute", "plant", "insect",
  "fish", "demon", "demihuman", "angel", "dragon",
  // RC_PLAYER_HUMAN / RC_PLAYER_DORAM (rathena/src/map/map.hpp:336)
  "player_human", "player_doram",
]);
export type Race = z.infer<typeof RaceSchema>;

export const SizeSchema = z.enum(["small", "medium", "large"]);
export type Size = z.infer<typeof SizeSchema>;

export const GenderSchema = z.enum(["male", "female", "both"]);
export type Gender = z.infer<typeof GenderSchema>;

export const BaseStatSchema = z.enum(["str", "agi", "vit", "int", "dex", "luk"]);
export type BaseStat = z.infer<typeof BaseStatSchema>;

export const BaseStatsSchema = z.object({
  str: z.number().int(),
  agi: z.number().int(),
  vit: z.number().int(),
  int: z.number().int(),
  dex: z.number().int(),
  luk: z.number().int(),
});
export type BaseStats = z.infer<typeof BaseStatsSchema>;

/** rAthena upper-class restriction ("Classes" map in item_db). */
export const CharacterVariantSchema = z.enum([
  "normal", "upper", "baby", "third", "third_upper", "third_baby",
  "fourth", "all_upper", "all_baby", "all_third",
]);
export type CharacterVariant = z.infer<typeof CharacterVariantSchema>;

/** Equip slots — readable form of item_db "Locations" flags. */
export const EquipLocationSchema = z.enum([
  "head_top", "head_mid", "head_low",
  "armor", "right_hand", "left_hand", "both_hands", "garment", "shoes",
  "right_accessory", "left_accessory", "both_accessories",
  "costume_head_top", "costume_head_mid", "costume_head_low", "costume_garment",
  "ammo",
  "shadow_armor", "shadow_weapon", "shadow_shield", "shadow_shoes",
  "shadow_right_accessory", "shadow_left_accessory",
]);
export type EquipLocation = z.infer<typeof EquipLocationSchema>;

/** Scalar that may vary per skill/item level: single value or per-level array (index 0 = level 1). */
export const perLevel = <T extends z.ZodTypeAny>(inner: T) => z.union([inner, z.array(inner)]);
