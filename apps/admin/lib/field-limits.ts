/**
 * Limites numéricos de UI por campo — SÓ estreita o `<input>`, nunca o zod.
 * Fonte da verdade é o loader C++/YAML real do rAthena, não a largura da
 * coluna SQL (que é sempre mais larga) — decisão registrada na auditoria
 * (`docs/audit/*.md`, coluna "Fonte"). Todo campo aqui CITA o arquivo:linha
 * de onde o número saiu; nenhum foi inventado (leia1.txt, regra 4/28).
 *
 * Onde a coluna SQL é mais estreita que a faixa lógica do C++ (ex.
 * `item_db_re.sql price_buy mediumint unsigned` = 16.777.215, contra
 * `MAX_ZENY` = 2.147.483.647 do C++), o teto usado AQUI é o da coluna —
 * é o que realmente falha no INSERT, não o que o parser aceitaria em tese.
 * Achado registrado como divergência em `docs/audit/risk-report.md` (A7),
 * não corrigido em silêncio.
 */
export interface FieldLimit {
  min?: number;
  max?: number;
  step?: number;
  int?: boolean;
  hint?: string;
  /** arquivo:linha do rAthena (ou do schema do projeto, quando o campo não
   * tem contraparte direta no loader — sempre dito explicitamente). */
  source: string;
}

export const ITEM_LIMITS: Record<string, FieldLimit> = {
  buyPrice: {
    min: 0,
    max: 16777215,
    int: true,
    hint: "teto real é a coluna SQL (mediumint), menor que MAX_ZENY do C++",
    source: "itemdb.cpp:201-218; item_db_re.sql (price_buy mediumint unsigned)",
  },
  sellPrice: {
    min: 0,
    max: 16777215,
    int: true,
    hint: "teto real é a coluna SQL (mediumint), menor que MAX_ZENY do C++",
    source: "itemdb.cpp:220-239; item_db_re.sql (price_sell mediumint unsigned)",
  },
  weight: { min: 0, max: 65535, int: true, source: "itemdb.cpp:241; item_db_re.sql (weight smallint unsigned)" },
  attack: {
    min: 0,
    max: 65535,
    int: true,
    source: "itemdb.cpp:253,1166; item_db_re.sql (attack smallint unsigned)",
  },
  magicAttack: {
    min: 0,
    max: 65535,
    int: true,
    source: "itemdb.cpp:266,1173; item_db_re.sql (magic_attack smallint unsigned)",
  },
  defense: {
    min: 0,
    max: 32767,
    int: true,
    source: "itemdb.cpp:279-296; src/config/const.hpp:48-56 (DEFTYPE_MAX renewal=32767)",
  },
  range: { min: 0, max: 255, int: true, source: "itemdb.cpp:296-313; item_db_re.sql (range tinyint(2) unsigned)" },
  slots: { min: 0, max: 4, int: true, source: "itemdb.cpp:313-330; src/common/mmo.hpp:80 (MAX_SLOTS=4)" },
  weaponLevel: {
    min: 0,
    max: 5,
    int: true,
    source: "itemdb.cpp:487-509; src/common/mmo.hpp:132-140 (MAX_WEAPON_LEVEL renewal=5)",
  },
  armorLevel: {
    min: 0,
    max: 2,
    int: true,
    source: "itemdb.cpp:509-533; src/common/mmo.hpp:132-140 (MAX_ARMOR_LEVEL renewal=2)",
  },
  equipLevelMin: { min: 0, max: 275, int: true, source: "itemdb.cpp:533-550; src/map/map.hpp:78 (MAX_LEVEL=275)" },
  equipLevelMax: {
    min: 0,
    max: 275,
    int: true,
    hint: "vazio = 275 (sem teto) — default REAL do servidor, não 0 (doc oficial diz 0 por engano; ver risk-report A6)",
    source: "itemdb.cpp:550-572",
  },
  viewSprite: { min: 0, max: 65535, int: true, source: "itemdb.cpp:596-608; item_db_re.sql (view smallint unsigned)" },
  delayDurationMs: {
    min: 0,
    int: true,
    hint: "unidade real do rAthena é SEGUNDOS, não ms — conferir conversão no writer (risk-report A19)",
    source: "itemdb.cpp:765-777 (Delay.Duration, uint32 segundos)",
  },
  stackAmount: { min: 1, max: 65535, int: true, source: "itemdb.cpp:806-823" },
  noUseOverrideGroupLevel: { min: 0, max: 100, int: true, source: "itemdb.cpp:883-900" },
  tradeOverrideGroupLevel: { min: 0, max: 100, int: true, source: "itemdb.cpp:921-938" },
};

export const MONSTER_LIMITS: Record<string, FieldLimit> = {
  level: { min: 0, max: 65535, int: true, source: "mob.cpp:5044-5053" },
  hp: {
    min: 1,
    max: 4294967295,
    int: true,
    hint: "0 é grampeado pra 1 no load real (cap_value)",
    source: "mob.cpp:5053-5062; mob.cpp:5589-5590 (cap_value(...,1,UINT32_MAX))",
  },
  sp: { min: 0, max: 16777215, int: true, source: "mob.cpp:5062; mob_db_re.sql (sp mediumint unsigned)" },
  baseExp: { min: 0, max: 4294967295, int: true, source: "mob.cpp:5071-5096; mob_db_re.sql (base_exp int unsigned)" },
  jobExp: { min: 0, max: 4294967295, int: true, source: "mob.cpp:5071-5096; mob_db_re.sql (job_exp int unsigned)" },
  mvpExp: { min: 0, max: 4294967295, int: true, source: "mob.cpp:5071-5096; mob_db_re.sql (mvp_exp int unsigned)" },
  stat: { min: 0, max: 65535, int: true, source: "mob.cpp:5166-5218; mob_db_re.sql (str/agi/.../luk smallint unsigned)" },
  attack: { min: 0, max: 65535, int: true, source: "mob.cpp:5098-5120" },
  magicAttack: { min: 0, max: 65535, int: true, source: "mob.cpp:5098-5120" },
  defense: { min: -32768, max: 32767, int: true, source: "mob.cpp:5120-5148; src/config/const.hpp:48-56" },
  magicDefense: { min: -32768, max: 32767, int: true, source: "mob.cpp:5120-5148; src/config/const.hpp:48-56" },
  resistance: { min: 0, max: 65535, int: true, source: "mob.cpp:5148-5166" },
  magicResistance: { min: 0, max: 65535, int: true, source: "mob.cpp:5148-5166" },
  attackRange: {
    min: 0,
    max: 255,
    int: true,
    source: "mob.cpp:5220-5245; mob_db_re.sql (attack_range tinyint(4) unsigned)",
  },
  skillRange: { min: 0, max: 255, int: true, source: "mob.cpp:5220-5245; mob_db_re.sql (skill_range tinyint(4) unsigned)" },
  chaseRange: {
    min: 0,
    max: 255,
    int: true,
    hint: "sentinela documentada ≥1000 (persegue o mapa inteiro) é INATINGÍVEL nesta coluna — ver risk-report A15",
    source: "mob.cpp:5220-5245; mob_db_re.sql (chase_range tinyint(4) unsigned)",
  },
  walkSpeed: { min: 20, max: 1000, int: true, source: "mob.cpp:5358-5372; src/common/mmo.hpp:93-96" },
  attackDelayMs: { min: 100, max: 8000, int: true, source: "mob.cpp:5372-5381; src/map/status.hpp:44,55" },
  attackMotionMs: { min: 1, max: 8000, int: true, source: "mob.cpp:5381-5391" },
  damageMotionMs: { min: 0, max: 65535, int: true, source: "mob.cpp:5403-5415" },
  damageTaken: {
    min: 1,
    max: 100,
    int: true,
    hint: "fora de 1..100 derruba o monstro INTEIRO no load do servidor",
    source: "mob.cpp:5415-5424 (asUInt16Rate)",
  },
  groupId: {
    min: 0,
    max: 10000,
    int: true,
    hint: "0 = nenhum grupo — não grave 0 manualmente (asUInt16Rate rejeita 0 explícito), deixe vazio",
    source: "mob.cpp:5424-5433 (asUInt16Rate)",
  },
  elementLevel: { min: 1, max: 4, int: true, source: "mob.cpp:5344-5358; src/map/map.hpp:422 (MAX_ELE_LEVEL=4)" },
  dropRate: {
    min: 0.01,
    max: 100,
    step: 0.01,
    hint: "0 é REJEITADO pelo servidor ('needs to be at least 1' em n/10000) — mínimo real é 0,01%",
    source: "mob.cpp:4844-4929 (parseDropNode, Rate); src/common/database.cpp:315-331 (asUInt16Rate)",
  },
};

export const SKILL_LIMITS: Record<string, FieldLimit> = {
  maxLevel: {
    min: 1,
    max: 13,
    int: true,
    hint: "acima de 13 derruba a skill INTEIRA no load do servidor",
    source: "skill.cpp:14825-14839; src/map/skill.hpp:43 (MAX_SKILL_LEVEL=13)",
  },
  castDefenseReduction: { min: 0, max: 65535, int: true, source: "skill.cpp:15165-15177" },
  itemsConsumedAmount: { min: 0, int: true, source: "skill.cpp:15498-15543" },
  itemsConsumedLevel: {
    min: 1,
    int: true,
    hint: "teto real é o nível máximo da própria skill (dinâmico — não representável aqui, ver risk-report A16)",
    source: "skill.cpp:15498-15543",
  },
  appliedStatusChance: {
    min: 0,
    max: 100,
    int: true,
    source: "packages/game-data/src/skill.ts (appliedStatuses[].chance) — não é campo direto do loader C++, é parâmetro de script; faixa já era do schema, aqui só ganha controle de UI",
  },
};

export const STATUS_LIMITS: Record<string, FieldLimit> = {
  defaultDurationMs: {
    min: 0,
    int: true,
    hint: "campo do projeto, sem contraparte direta no loader (StatusDatabase só valida MinDuration)",
    source: "packages/game-data/src/status.ts (defaultDurationMs)",
  },
  minRate: {
    min: 0,
    max: 65535,
    int: true,
    hint: "unidade n/10000 (0..10000 = 0..100%); C++ não valida faixa no parse além do tipo",
    source: "status.cpp:16202-16214 (uint16)",
  },
  minDurationMs: {
    int: true,
    hint: "aceita negativo no C++ (int64, sem checagem); default REAL se omitido é 1ms, não 0",
    source: "status.cpp:16214-16226",
  },
};

export const JOB_LIMITS: Record<string, FieldLimit> = {
  maxBaseLevel: { min: 1, max: 275, int: true, source: "pc.cpp:14029-14046; src/map/map.hpp:78 (MAX_LEVEL=275)" },
  maxJobLevel: { min: 1, max: 275, int: true, source: "pc.cpp:14072-14089" },
  maxWeight: {
    min: 1,
    int: true,
    hint: "sem teto real no C++ (uint32, sem checagem de faixa no parse)",
    source: "pc.cpp:13855-13867",
  },
  bonusStatsLevel: {
    min: 1,
    max: 275,
    int: true,
    hint: "fora de 1..275 derruba o job INTEIRO no load",
    source: "pc.cpp:14115-14143",
  },
  bonusStat: {
    min: -32768,
    max: 32767,
    int: true,
    hint: "negativo aqui causa OVERFLOW real no servidor (lido int16, guardado em array<uint16>) — evite negativo mesmo estando na faixa",
    source: "pc.cpp:14115-14143; src/map/pc.hpp:1093",
  },
  skillMaxLevel: {
    min: 0,
    max: 13,
    int: true,
    hint: "0 = remove skill herdada (sentinela válido)",
    source: "packages/game-data/src/rathena/skill-tree-yaml.ts:32-44",
  },
  aspdModifierBaseAspd: {
    min: -32768,
    max: 32767,
    int: true,
    hint: "campo real é int16 (sempre inteiro) — zod aceita decimal, servidor nunca usa (ver risk-report A18)",
    source: "pc.cpp:13945-13968",
  },
};
