import type { Element, Race, Size } from "./common";
import type { ItemSubType, ItemType } from "./item";
import type { MonsterAiMode, MonsterClass } from "./monster";
import type { NpcKind, NpcOrigin } from "./npc";
import type { SkillDamageNature, SkillHitType, SkillTarget, SkillType } from "./skill";
import type { StatusCategory, StatusGroup } from "./status";

/**
 * Rótulos pt-BR dos enums. O SCHEMA continua em inglês (é o vocabulário do
 * rAthena e o que vai pro banco); estes mapas são só a camada de exibição,
 * compartilhada entre apps/admin e apps/game para não divergirem.
 *
 * Tipados como `Record<Enum, string>` de propósito: se o enum ganhar um
 * valor novo, falta a chave aqui e o build quebra (TS2741) em vez de a
 * dashboard mostrar o valor cru silenciosamente.
 */

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  healing: "Cura",
  usable: "Consumível",
  etc: "Diversos",
  armor: "Armadura",
  weapon: "Arma",
  card: "Carta",
  pet_egg: "Ovo de pet",
  pet_armor: "Acessório de pet",
  ammo: "Munição",
  delay_consume: "Consumível Especial",
  shadow_gear: "Equipamento sombrio",
  cash: "Cash",
};

export const ITEM_SUBTYPE_LABELS: Record<ItemSubType, string> = {
  dagger: "Adaga",
  "1h_sword": "Espada (1M)",
  "2h_sword": "Espada (2M)",
  "1h_spear": "Lança (1M)",
  "2h_spear": "Lança (2M)",
  "1h_axe": "Machado (1M)",
  "2h_axe": "Machado (2M)",
  mace: "Maça",
  "2h_mace": "Maça (2M)",
  staff: "Cajado",
  "2h_staff": "Cajado (2M)",
  bow: "Arco",
  knuckle: "Soqueira",
  musical: "Instrumento musical",
  whip: "Chicote",
  book: "Livro",
  katar: "Katar",
  revolver: "Revólver",
  rifle: "Rifle",
  gatling: "Metralhadora",
  shotgun: "Espingarda",
  grenade: "Lançador de granadas",
  huuma: "Shuriken Huuma",
  fist: "Punho",
  arrow: "Flecha",
  dagger_ammo: "Munição de adaga",
  bullet: "Bala",
  shell: "Cartucho",
  grenade_ammo: "Granada",
  shuriken: "Shuriken",
  kunai: "Kunai",
  cannonball: "Bala de canhão",
  throwable_weapon: "Arma de arremesso",
  normal_card: "Carta normal",
  enchant_card: "Carta de encantamento",
};

export const ELEMENT_LABELS: Record<Element, string> = {
  neutral: "Neutro",
  water: "Água",
  earth: "Terra",
  fire: "Fogo",
  wind: "Vento",
  poison: "Veneno",
  holy: "Sagrado",
  shadow: "Sombrio",
  ghost: "Fantasma",
  undead: "Maldito",
};

/** elemento de skill: ELEMENT_LABELS + os 3 valores especiais de SkillElementSchema */
export const SKILL_ELEMENT_LABELS: Record<string, string> = {
  ...ELEMENT_LABELS,
  weapon: "Da arma",
  endowed: "Do encantamento",
  random: "Aleatório",
};

export const SKILL_TYPE_LABELS: Record<SkillType, string> = {
  damage: "Ativa",
  support: "Suporte",
  area: "Área",
  self_buff: "Fortalecimento",
  passive: "Passiva",
};

export const SKILL_DAMAGE_NATURE_LABELS: Record<SkillDamageNature, string> = {
  none: "Nenhuma",
  weapon: "Física (arma)",
  magic: "Mágica",
  misc: "Outra",
};

export const SKILL_HIT_TYPE_LABELS: Record<SkillHitType, string> = {
  normal: "Normal",
  single: "Golpe único",
  multi_hit: "Múltiplos golpes",
  critical: "Crítico",
};

export const SKILL_TARGET_LABELS: Record<SkillTarget, string> = {
  enemy: "Inimigo",
  ally: "Aliado",
  ground: "Chão",
  self: "Próprio personagem",
  party: "Grupo",
  trap: "Armadilha",
};

export const RACE_LABELS: Record<Race, string> = {
  formless: "Amorfo",
  undead: "Morto-vivo",
  brute: "Bruto",
  plant: "Planta",
  insect: "Inseto",
  fish: "Peixe",
  demon: "Demônio",
  demihuman: "Semi-humano",
  angel: "Anjo",
  dragon: "Dragão",
  player_human: "Jogador (humano)",
  player_doram: "Jogador (doram)",
};

export const SIZE_LABELS: Record<Size, string> = {
  small: "Pequeno",
  medium: "Médio",
  large: "Grande",
};

export const MONSTER_AI_MODE_LABELS: Record<MonsterAiMode, string> = {
  passive: "Passivo",
  aggressive: "Agressivo",
  assist: "Auxiliar",
  looter: "Coletor",
  plant: "Planta (não revida)",
};

export const MONSTER_CLASS_LABELS: Record<MonsterClass, string> = {
  normal: "Normal",
  boss: "Chefe",
  guardian: "Guardião",
  battlefield: "Campo de batalha",
  event: "Evento",
};

export const NPC_KIND_LABELS: Record<NpcKind, string> = {
  warp: "Portal",
  shop: "Loja",
  dialogue: "Diálogo",
  duplicate: "Duplicata",
  other: "Outro",
};

export const NPC_ORIGIN_LABELS: Record<NpcOrigin, string> = {
  quest: "Quest",
  guild: "Guilda",
  instance: "Instância",
  battleground: "Arena",
  event: "Evento",
  merchant: "Loja (mercador)",
  kafra: "Loja (kafra)",
  job: "Troca de classe",
  city: "Cidade",
  airport: "Aeroporto",
  warp: "Teleporte",
  other: "Outro",
};

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  buff: "Fortalecimento",
  debuff: "Penalidade",
  neutral: "Neutro",
};

export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  buff: "Buff",
  debuff: "Debuff",
  transformacao: "Transformação",
  estado_especial: "Estado especial",
  controle: "Controle",
  velocidade: "Velocidade",
  defesa: "Defesa",
  ataque: "Ataque",
  elemento: "Elemento",
  visibilidade: "Visibilidade",
  outro: "Outro",
};

/** rótulos dos valores mais comuns de `states` (rAthena StateEffect) — o resto cai no fallback (labelOf devolve a chave crua) */
export const STATUS_STATE_LABELS: Record<string, string> = {
  no_move: "Não move",
  no_attack: "Não ataca",
  no_cast: "Não conjura",
  no_consume_item: "Não consome item",
  no_pick_item: "Não pega item",
  no_interact: "Não interage",
  no_move_cond: "Não move (condicional)",
  no_un_equip_item: "Não desequipa",
  no_chat: "Não fala",
  no_equip_item: "Não equipa",
  no_cast_cond: "Não conjura (condicional)",
  no_drop_item: "Não descarta item",
  no_death_penalty: "Sem penalidade de morte",
  no_pick_item_cond: "Não pega item (condicional)",
  no_drop_item_cond: "Não descarta item (condicional)",
  no_chat_cond: "Não fala (condicional)",
  no_consume_item_cond: "Não consome item (condicional)",
  no_warp: "Não teleporta",
  nomove: "Não move",
};

/**
 * Rótulo de um valor de enum. Valor desconhecido volta como veio — nunca
 * adivinhado (mesma regra de `classeDaSkill`).
 */
export function labelOf<T extends string>(dict: Record<T, string>, value: string): string {
  return (dict as Record<string, string>)[value] ?? value;
}

/** Monta as `<option>` de um Select de filtro com a sentinela "todos". */
export function selectOptions<T extends string>(
  dict: Record<T, string>,
  allLabel: string,
): { value: "" | T; label: string }[] {
  return [
    { value: "" as const, label: allLabel },
    ...(Object.entries(dict) as [T, string][]).map(([value, label]) => ({ value, label })),
  ];
}
