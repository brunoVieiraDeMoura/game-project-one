import { ItemSchema, type Item } from "@ragnarok/game-data";

/**
 * Conversion between the ItemSchema shape (camelCase, nested optionals) and
 * the `items` table row (snake_case scalar columns + jsonb for nested
 * structures) defined in supabase/migrations/20260717000001_initial.sql.
 */

export interface ItemRow {
  id: number;
  aegis_name: string;
  name: string;
  type: string;
  sub_type: string | null;
  buy_price: number;
  sell_price: number;
  weight: number;
  attack: number;
  magic_attack: number;
  defense: number;
  range: number;
  slots: number;
  jobs: string[];
  classes: string[];
  gender: string;
  locations: string[];
  weapon_level: number | null;
  armor_level: number | null;
  equip_level_min: number;
  equip_level_max: number;
  refineable: boolean;
  gradable: boolean;
  view_sprite: number;
  alias_name: string | null;
  flags: unknown | null;
  delay: unknown | null;
  stack: unknown | null;
  no_use: unknown | null;
  trade: unknown | null;
  on_use: unknown | null;
  on_equip: unknown | null;
  on_unequip: unknown | null;
}

export function itemToRow(item: Item): ItemRow {
  return {
    id: item.id,
    aegis_name: item.aegisName,
    name: item.name,
    type: item.type,
    sub_type: item.subType ?? null,
    buy_price: item.buyPrice,
    sell_price: item.sellPrice,
    weight: item.weight,
    attack: item.attack,
    magic_attack: item.magicAttack,
    defense: item.defense,
    range: item.range,
    slots: item.slots,
    jobs: item.jobs,
    classes: item.classes,
    gender: item.gender,
    locations: item.locations,
    weapon_level: item.weaponLevel ?? null,
    armor_level: item.armorLevel ?? null,
    equip_level_min: item.equipLevelMin,
    equip_level_max: item.equipLevelMax,
    refineable: item.refineable,
    gradable: item.gradable,
    view_sprite: item.viewSprite,
    alias_name: item.aliasName ?? null,
    flags: item.flags ?? null,
    delay: item.delay ?? null,
    stack: item.stack ?? null,
    no_use: item.noUse ?? null,
    trade: item.trade ?? null,
    on_use: item.onUse ?? null,
    on_equip: item.onEquip ?? null,
    on_unequip: item.onUnequip ?? null,
  };
}

export function rowToItem(row: ItemRow): Item {
  return ItemSchema.parse({
    id: row.id,
    aegisName: row.aegis_name,
    name: row.name,
    type: row.type,
    subType: row.sub_type ?? undefined,
    buyPrice: row.buy_price,
    sellPrice: row.sell_price,
    weight: row.weight,
    attack: row.attack,
    magicAttack: row.magic_attack,
    defense: row.defense,
    range: row.range,
    slots: row.slots,
    jobs: row.jobs,
    classes: row.classes,
    gender: row.gender,
    locations: row.locations,
    weaponLevel: row.weapon_level ?? undefined,
    armorLevel: row.armor_level ?? undefined,
    equipLevelMin: row.equip_level_min,
    equipLevelMax: row.equip_level_max,
    refineable: row.refineable,
    gradable: row.gradable,
    viewSprite: row.view_sprite,
    aliasName: row.alias_name ?? undefined,
    flags: row.flags ?? undefined,
    delay: row.delay ?? undefined,
    stack: row.stack ?? undefined,
    noUse: row.no_use ?? undefined,
    trade: row.trade ?? undefined,
    onUse: row.on_use ?? undefined,
    onEquip: row.on_equip ?? undefined,
    onUnequip: row.on_unequip ?? undefined,
  });
}
