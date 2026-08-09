/**
 * Rótulos em PT-BR para os enums do `ItemSchema` (`packages/game-data`) que
 * chegam da API — usados só na janela de INFORMAÇÃO do item
 * (`hud/ItemInfoWindow`). Vocabulário fechado (12 tipos, ~25 subtipos, ~10
 * locais), então traduzir é seguro; `jobs`/`classes` ficam de FORA de
 * propósito — o mesmo motivo do `net/equipmentStore`: são dezenas de nomes
 * de classe e uma tradução errada aqui só confundiria, sem checar equip
 * nenhum (é só texto).
 */

export const ITEM_TYPE_LABELS: Record<string, string> = {
  healing: "Cura",
  usable: "Uso Geral",
  etc: "Diversos",
  armor: "Armadura",
  weapon: "Arma",
  card: "Carta",
  pet_egg: "Ovo de Mascote",
  pet_armor: "Equipamento de Mascote",
  ammo: "Munição",
  delay_consume: "Uso com Espera",
  shadow_gear: "Equipamento Sombrio",
  cash: "Item da Loja",
};

export const ITEM_SUBTYPE_LABELS: Record<string, string> = {
  dagger: "Adaga",
  "1h_sword": "Espada de Uma Mão",
  "2h_sword": "Espada de Duas Mãos",
  "1h_spear": "Lança de Uma Mão",
  "2h_spear": "Lança de Duas Mãos",
  "1h_axe": "Machado de Uma Mão",
  "2h_axe": "Machado de Duas Mãos",
  mace: "Maça",
  "2h_mace": "Maça de Duas Mãos",
  staff: "Cajado",
  "2h_staff": "Cajado de Duas Mãos",
  bow: "Arco",
  knuckle: "Soqueira",
  musical: "Instrumento Musical",
  whip: "Chicote",
  book: "Livro",
  katar: "Katar",
  revolver: "Revólver",
  rifle: "Rifle",
  gatling: "Gatling",
  shotgun: "Espingarda",
  grenade: "Lançador de Granadas",
  huuma: "Shuriken Huuma",
  fist: "Punho",
  arrow: "Flecha",
  dagger_ammo: "Munição de Adaga",
  bullet: "Bala",
  shell: "Cartucho",
  grenade_ammo: "Granada",
  shuriken: "Shuriken",
  kunai: "Kunai",
  cannonball: "Bala de Canhão",
  throwable_weapon: "Arma de Arremesso",
  normal_card: "Carta Comum",
  enchant_card: "Carta de Encantamento",
};

export const ITEM_LOCATION_LABELS: Record<string, string> = {
  head_top: "Elmo",
  head_mid: "Rosto (meio)",
  head_low: "Rosto (baixo)",
  armor: "Corpo",
  right_hand: "Mão Direita",
  left_hand: "Mão Esquerda",
  garment: "Manto",
  shoes: "Calçado",
  right_accessory: "Acessório Direito",
  left_accessory: "Acessório Esquerdo",
  costume_head_top: "Fantasia — Elmo",
  costume_head_mid: "Fantasia — Rosto (meio)",
  costume_head_low: "Fantasia — Rosto (baixo)",
  costume_garment: "Fantasia — Manto",
  ammo: "Munição",
  shadow_armor: "Sombrio — Corpo",
  shadow_weapon: "Sombrio — Arma",
  shadow_shield: "Sombrio — Escudo",
  shadow_shoes: "Sombrio — Calçado",
  shadow_right_accessory: "Sombrio — Acessório Direito",
  shadow_left_accessory: "Sombrio — Acessório Esquerdo",
};

export const ITEM_GENDER_LABELS: Record<string, string> = {
  male: "Masculino",
  female: "Feminino",
  both: "Ambos",
};

export function itemTypeLabel(type: string): string {
  return ITEM_TYPE_LABELS[type] ?? type;
}

export function itemSubTypeLabel(subType: string | undefined): string | undefined {
  return subType ? (ITEM_SUBTYPE_LABELS[subType] ?? subType) : undefined;
}

export function itemLocationLabel(location: string): string {
  return ITEM_LOCATION_LABELS[location] ?? location;
}

export function itemGenderLabel(gender: string): string {
  return ITEM_GENDER_LABELS[gender] ?? gender;
}
