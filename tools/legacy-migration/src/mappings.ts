import type { EquipLocation, ItemSubType, ItemType, CharacterVariant } from "@ragnarok/game-data";

/** rAthena item_db YAML enum names → new schema values. Grounded in
 * rathena/db/re/item_db_*.yml headers + rathena/src/map/itemdb.hpp. */

export const ITEM_TYPE_MAP: Record<string, ItemType> = {
  Healing: "healing",
  Usable: "usable",
  Etc: "etc",
  Armor: "armor",
  Weapon: "weapon",
  Card: "card",
  PetEgg: "pet_egg",
  PetArmor: "pet_armor",
  Ammo: "ammo",
  DelayConsume: "delay_consume",
  ShadowGear: "shadow_gear",
  Cash: "cash",
};

export const WEAPON_SUBTYPE_MAP: Record<string, ItemSubType> = {
  Dagger: "dagger",
  "1hSword": "1h_sword",
  "2hSword": "2h_sword",
  "1hSpear": "1h_spear",
  "2hSpear": "2h_spear",
  "1hAxe": "1h_axe",
  "2hAxe": "2h_axe",
  Mace: "mace",
  "2hMace": "2h_mace",
  Staff: "staff",
  "2hStaff": "2h_staff",
  Bow: "bow",
  Knuckle: "knuckle",
  Musical: "musical",
  Whip: "whip",
  Book: "book",
  Katar: "katar",
  Revolver: "revolver",
  Rifle: "rifle",
  Gatling: "gatling",
  Shotgun: "shotgun",
  Grenade: "grenade",
  Huuma: "huuma",
  Fist: "fist",
};

export const AMMO_SUBTYPE_MAP: Record<string, ItemSubType> = {
  Arrow: "arrow",
  Dagger: "dagger_ammo",
  Bullet: "bullet",
  Shell: "shell",
  Grenade: "grenade_ammo",
  Shuriken: "shuriken",
  Kunai: "kunai",
  CannonBall: "cannonball",
  Cannonball: "cannonball",
  ThrowableWeapon: "throwable_weapon",
  Throwweapon: "throwable_weapon",
};

export const CARD_SUBTYPE_MAP: Record<string, ItemSubType> = {
  Normal: "normal_card",
  Enchant: "enchant_card",
};

export const LOCATION_MAP: Record<string, EquipLocation | EquipLocation[]> = {
  Head_Top: "head_top",
  Head_Mid: "head_mid",
  Head_Low: "head_low",
  Armor: "armor",
  Right_Hand: "right_hand",
  Left_Hand: "left_hand",
  Both_Hand: "both_hands",
  Garment: "garment",
  Shoes: "shoes",
  Right_Accessory: "right_accessory",
  Left_Accessory: "left_accessory",
  Both_Accessory: "both_accessories",
  Costume_Head_Top: "costume_head_top",
  Costume_Head_Mid: "costume_head_mid",
  Costume_Head_Low: "costume_head_low",
  Costume_Garment: "costume_garment",
  Ammo: "ammo",
  Shadow_Armor: "shadow_armor",
  Shadow_Weapon: "shadow_weapon",
  Shadow_Shield: "shadow_shield",
  Shadow_Shoes: "shadow_shoes",
  Shadow_Right_Accessory: "shadow_right_accessory",
  Shadow_Left_Accessory: "shadow_left_accessory",
};

export const CLASS_MAP: Record<string, CharacterVariant | CharacterVariant[]> = {
  Normal: "normal",
  Upper: "upper",
  Baby: "baby",
  Third: "third",
  Third_Upper: "third_upper",
  Third_Baby: "third_baby",
  Fourth: "fourth",
  All_Upper: "all_upper",
  All_Baby: "all_baby",
  All_Third: "all_third",
};

/** rAthena PascalCase / Mixed_Case token → snake_case ("NoBanishingBuster" → "no_banishing_buster") */
export function toSnake(token: string): string {
  return token
    .split("_")
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase())
    .join("_");
}

/** {"NoMove": true, "NoCast": false} → ["no_move"] */
export function flagArray(raw: Record<string, boolean> | undefined): string[] {
  if (!raw) return [];
  return Object.entries(raw)
    .filter(([, v]) => v === true)
    .map(([k]) => toSnake(k));
}

/** bonus bXxx → StatBonusTarget (subset; unrecognized keys stay unmapped). */
export const BONUS_KEY_MAP: Record<string, string> = {
  bStr: "str",
  bAgi: "agi",
  bVit: "vit",
  bInt: "int",
  bDex: "dex",
  bLuk: "luk",
  bBaseAtk: "atk",
  bMatk: "matk",
  bDef: "def",
  bMdef: "mdef",
  bHit: "hit",
  bFlee: "flee",
  bCritical: "crit",
  bMaxHP: "maxHp",
  bMaxSP: "maxSp",
  bAspdRate: "aspdRate",
  bCastrate: "castRate",
  bMaxWeight: "maxWeight",
};
