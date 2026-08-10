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
 * Código de IA do monstro (`Ai` no `mob_db.yml`, `"MONSTER_TYPE_"+s`).
 * Lista fechada real do rAthena (`src/map/mob.hpp:151-182`,
 * `script_constants.hpp:3557-3579`) — qualquer string fora daqui é
 * rejeitada pelo loader (`"Unknown monster AI %s, defaulting to 06."`).
 * Chave é o próprio código (é isso que o schema guarda em `Monster.ai`,
 * `string().default("06")` — não é um enum TS, por isso `Record<string,…>`).
 */
export const MONSTER_AI_CODE_LABELS: Record<string, string> = {
  "01": "01 — agressivo simples",
  "02": "02 — agressivo com perseguição",
  "03": "03 — agressivo, muda de alvo",
  "04": "04 — agressivo, persegue e muda de alvo",
  "05": "05 — passivo com perseguição",
  "06": "06 — passivo (planta, não revida)",
  "07": "07 — passivo, muda de alvo ao ser atacado",
  "08": "08 — passivo, persegue e muda de alvo",
  "09": "09 — agressivo, ignora esquiva",
  "10": "10 — agressivo com perseguição, ignora esquiva",
  "11": "11 — agressivo, muda de alvo, ignora esquiva",
  "12": "12 — agressivo completo, ignora esquiva",
  "13": "13 — passivo com perseguição, ignora esquiva",
  "17": "17 — variante 17",
  "19": "19 — variante 19",
  "20": "20 — variante 20",
  "21": "21 — variante 21",
  "24": "24 — variante 24",
  "25": "25 — variante 25",
  "26": "26 — variante 26",
  "27": "27 — variante 27",
  ABR_PASSIVE: "Abrasgard — passivo",
  ABR_OFFENSIVE: "Abrasgard — ofensivo",
};

/**
 * `DropEffect` do item (`flags.dropEffect`, `"DROPEFFECT_"+s`). Lista
 * fechada real (`src/map/itemdb.hpp:3263-3291`) — o valor é gravado
 * VERBATIM na coluna `flag_dropeffect` (`mysql-item-row.ts:204,337`, sem
 * tradução), então a chave aqui já é a grafia exata que o rAthena espera.
 * `White_Pillar`/`Orange_Pillar` só valem em PACKETVER < 20200304;
 * `Green_Pillar`/`Red_Pillar` só em >= 20200304 — mantidos os 2 pares
 * porque o projeto não amarra um PACKETVER único de cliente aqui.
 */
export const ITEM_DROP_EFFECT_LABELS: Record<string, string> = {
  None: "Nenhum",
  Client: "Padrão do cliente",
  White_Pillar: "Pilar branco",
  Blue_Pillar: "Pilar azul",
  Yellow_Pillar: "Pilar amarelo",
  Purple_Pillar: "Pilar roxo",
  Orange_Pillar: "Pilar laranja",
  Green_Pillar: "Pilar verde",
  Red_Pillar: "Pilar vermelho",
};

/**
 * `Requires.State` da skill (`"ST_"+s`), 20 valores fechados
 * (`skill.hpp:697-718`, espelhados em `SkillDbStateSchema` de
 * `packages/game-data/src/rathena/skill-db-yaml.ts`). Chave aqui é
 * `toSnake(PascalCase)` — o mesmo formato que `Skill.requirements.
 * requiredState` já guarda hoje (ver `skill-db-mapper.ts: REV_STATE`).
 */
export const SKILL_REQUIRED_STATE_LABELS: Record<string, string> = {
  none: "Nenhum",
  hidden: "Escondido",
  riding: "Montado (Peco/Grand Peco)",
  falcon: "Com falcão",
  cart: "Com carrinho",
  shield: "Com escudo",
  recover_weight_rate: "Taxa de recuperação de peso",
  move_enable: "Pode se mover",
  water: "Na água",
  ridingdragon: "Montado em dragão",
  wug: "Com wug",
  ridingwug: "Montado em wug",
  mado: "Em Madogear",
  elementalspirit: "Com espírito elemental",
  elementalspirit2: "Com espírito elemental (nível 2)",
  peco: "Montado em Peco Peco",
  sunstance: "Postura do Sol",
  moonstance: "Postura da Lua",
  starstance: "Postura da Estrela",
  universestance: "Postura do Universo",
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
