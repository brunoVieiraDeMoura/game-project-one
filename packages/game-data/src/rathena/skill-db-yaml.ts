import { z } from "zod";

/**
 * Formato OFICIAL do `skill_db.yml` do rAthena (SKILL_DB v4), schema-first —
 * lido direto de `rathena/db/re/skill_db.yml` (header) e
 * `rathena/src/map/skill.cpp` (`SkillDatabase::parseBodyNode`,
 * skill.cpp:14778-15749), não inferido.
 *
 * Este é o PARSER (etapa 1 de 4: Parser → Mapper → Validator → Writer, ver
 * o plano da auditoria). Ele NÃO conhece o schema reduzido `Skill` de
 * `./skill.ts` — só o formato cru do rAthena, fielmente. A conversão pro
 * schema do projeto (com perda documentada) é responsabilidade do Mapper,
 * uma camada acima.
 *
 * Gate do projeto (2026-08-07, ver memory workflow-parser-before-writer):
 * nenhum Writer é escrito antes deste Parser fazer ida-e-volta sem perda
 * sobre o catálogo real inteiro — é o que `skill-db-yaml.test.ts` prova.
 *
 * As listas de enum abaixo são EXTRAÍDAS do código-fonte
 * (`export_constant` em `script_constants.hpp`), não digitadas de memória —
 * cada uma tem o comando usado pra gerar/conferir anotado. A grafia
 * TitleCase (com "_" preservado entre segmentos) é a que o próprio
 * `db/re/skill_db.yml` usa; a busca do lado do rAthena é
 * case-insensitive (`script.cpp` `calc_hash`/`strcasecmp`), mas escrever
 * na grafia real evita depender disso.
 */

// ---------------------------------------------------------------------------
// Enums extraídos de rathena/src/map/script_constants.hpp
// ---------------------------------------------------------------------------

/** Type (Header) → BF_NONE..BF_MISC. skill.cpp:14839-14863; script_constants.hpp:3611-3618 */
export const SkillDbTypeSchema = z.enum(["None", "Weapon", "Magic", "Misc"]);

/** TargetType → INF_<v>_SKILL. skill.hpp:78-86 */
export const SkillDbTargetTypeSchema = z.enum(["Passive", "Attack", "Ground", "Self", "Support", "Trap"]);

/**
 * Hit → DMG_. O doc do próprio rAthena documenta 4 valores, mas só 2 são
 * constante de script EXPORTADA (script_constants.hpp:10406-10407);
 * `Normal`/`Critical` fariam `script_get_constant` falhar e a entrada
 * inteira ser descartada (skill.cpp:14948-14954). Confirmado no dado: só
 * `Single`/`Multi_Hit` aparecem nas 1.635 entradas de db/re/skill_db.yml.
 */
export const SkillDbHitSchema = z.enum(["Single", "Multi_Hit"]);

/**
 * DamageFlags → NK_. 11 valores.
 * grep -oE 'export_constant\(NK_[A-Za-z0-9_]+\)' script_constants.hpp
 */
export const SKILL_DB_DAMAGE_FLAGS = [
  "NoDamage",
  "Splash",
  "SplashSplit",
  "IgnoreAtkCard",
  "IgnoreElement",
  "IgnoreDefense",
  "IgnoreFlee",
  "IgnoreDefCard",
  "IgnoreLongCard",
  "Critical",
  "SimpleDefense",
] as const;

/**
 * Flags → INF2_. 42 valores.
 * grep -oE 'export_constant\(INF2_[A-Za-z0-9_]+\)' script_constants.hpp
 */
export const SKILL_DB_FLAGS = [
  "IsQuest",
  "IsNpc",
  "IsWedding",
  "IsSpirit",
  "IsGuild",
  "IsSong",
  "IsEnsemble",
  "IsTrap",
  "TargetSelf",
  "NoTargetSelf",
  "PartyOnly",
  "GuildOnly",
  "NoTargetEnemy",
  "IsAutoShadowSpell",
  "IsChorus",
  "IgnoreBgReduction",
  "IgnoreGvgReduction",
  "DisableNearNpc",
  "TargetTrap",
  "IgnoreLandProtector",
  "AllowWhenHidden",
  "AllowWhenPerforming",
  "TargetEmperium",
  "IgnoreKagehumi",
  "AlterRangeVulture",
  "AlterRangeSnakeEye",
  "AlterRangeShadowJump",
  "AlterRangeRadius",
  "AlterRangeResearchTrap",
  "IgnoreHovering",
  "AllowOnWarg",
  "AllowOnMado",
  "TargetManHole",
  "TargetHidden",
  "IncreaseDanceWithWugDamage",
  "IgnoreWugBite",
  "IgnoreAutoGuard",
  "IgnoreCicada",
  "ShowScale",
  "IgnoreGtb",
  "Toggleable",
  "IgnoreNonCritAtkBonus",
] as const;

/** CastTimeFlags / CastDelayFlags → SKILL_CAST_ (mesmo prefixo, campos diferentes: castnodex vs delaynodex). 3 valores. */
export const SKILL_DB_CAST_FLAGS = ["IgnoreDex", "IgnoreStatus", "IgnoreItemBonus"] as const;

/** CopyFlags.RemoveRequirement → SKILL_REQ_. 15 valores. Nunca lê o booleano — só `|=`; não há como limpar (skill.cpp:15089-15101). */
export const SKILL_DB_REMOVE_REQUIREMENT = [
  "HpCost",
  "SpCost",
  "HpRateCost",
  "SpRateCost",
  "MaxHpTrigger",
  "ZenyCost",
  "Weapon",
  "Ammo",
  "State",
  "Status",
  "SpiritSphereCost",
  "ItemCost",
  "Equipment",
  "ApCost",
  "ApRateCost",
] as const;

/** NoNearNPC.Type → SKILL_NONEAR_. 4 valores. */
export const SKILL_DB_NONEAR_TYPE = ["WarpPortal", "Shop", "Npc", "Tomb"] as const;

/** Element → ELE_. 14 valores (10 elementais + All/Weapon/Endowed/Random). map.hpp:390-407 */
export const SKILL_DB_ELEMENT = [
  "Neutral",
  "Water",
  "Earth",
  "Fire",
  "Wind",
  "Poison",
  "Holy",
  "Dark",
  "Ghost",
  "Undead",
  "All",
  "Weapon",
  "Endowed",
  "Random",
] as const;
export const SkillDbElementSchema = z.enum(SKILL_DB_ELEMENT);

/** Requires.Weapon → W_ + "All". pc.hpp:959-993 */
export const SKILL_DB_WEAPON = [
  "All",
  "Fist",
  "Dagger",
  "1hSword",
  "2hSword",
  "1hSpear",
  "2hSpear",
  "1hAxe",
  "2hAxe",
  "Mace",
  "2hMace",
  "Staff",
  "Bow",
  "Knuckle",
  "Musical",
  "Whip",
  "Book",
  "Katar",
  "Revolver",
  "Rifle",
  "Gatling",
  "Shotgun",
  "Grenade",
  "Huuma",
  "2hStaff",
] as const;

/** Requires.Ammo → AMMO_ + "None" (AMMO_NONE não é exportado, script_constants.hpp:3809). pc.hpp:998-1011 */
export const SKILL_DB_AMMO = [
  "None",
  "Arrow",
  "Dagger",
  "Bullet",
  "Shell",
  "Grenade",
  "Shuriken",
  "Kunai",
  "Cannonball",
  "Throwweapon",
] as const;

/** Requires.State → ST_. skill.hpp:697-718 */
export const SkillDbStateSchema = z.enum([
  "None",
  "Hidden",
  "Riding",
  "Falcon",
  "Cart",
  "Shield",
  "Recover_Weight_Rate",
  "Move_Enable",
  "Water",
  "Ridingdragon",
  "Wug",
  "Ridingwug",
  "Mado",
  "Elementalspirit",
  "Elementalspirit2",
  "Peco",
  "Sunstance",
  "Moonstance",
  "Starstance",
  "Universestance",
]);

/** Unit.Target → BCT_. battle.hpp:61-80; script_constants.hpp:10545-10558 (BCT_NOONE/BCT_SLAVE não exportados) */
export const SKILL_DB_UNIT_TARGET = [
  "Self",
  "Enemy",
  "Party",
  "GuildAlly",
  "Neutral",
  "SameGuild",
  "All",
  "Wos",
  "Guild",
  "NoGuild",
  "NoParty",
  "NoEnemy",
  "Ally",
  "Friend",
] as const;

/** Unit.Flag → UF_. skill.hpp:176-197 (UF_NONE não exportado). 18 valores. */
export const SKILL_DB_UNIT_FLAG = [
  "NoEnemy",
  "NoReiteration",
  "NoFootSet",
  "NoOverlap",
  "PathCheck",
  "NoPc",
  "NoMob",
  "Skill",
  "Dance",
  "Ensemble",
  "Song",
  "DualMode",
  "NoKnockback",
  "RangedSingleUnit",
  "CrazyWeedImmune",
  "RemovedByFireRain",
  "KnockbackGroup",
  "HiddenTrap",
] as const;

/**
 * Unit.Id / Unit.AlternateId → UNT_. 174 constantes, extraídas com
 * `grep -oE 'export_constant\(UNT_[A-Za-z0-9_]+\)' script_constants.hpp`
 * (SEM o prefixo `UNT_`, em maiúsculo — a grafia crua da macro).
 *
 * A grafia usada no YAML **não é derivável** da constante por uma regra
 * fixa: a busca do rAthena é case-insensitive
 * (`script.cpp:calc_hash`/`strcasecmp`) e os autores do db/re/skill_db.yml
 * não seguem convenção única — tem `Firepillar_Active` (TitleCase por
 * segmento), `Cane_of_evil_eye` (segmentos minúsculos) e `FUUMASHOUAKU`
 * (tudo maiúsculo) misturados no MESMO arquivo. Uma tentativa anterior de
 * derivar TitleCase automaticamente quebrou no round-trip exatamente nesse
 * segundo caso — por isso a validação abaixo é por comparação
 * case-insensitive contra esta lista, não um `z.enum` de grafia fixa.
 */
export const SKILL_DB_UNIT_ID_UPPER = [
  "ABYSS_SQUARE", "ACIDIFIED_ZONE_FIRE", "ACIDIFIED_ZONE_GROUND", "ACIDIFIED_ZONE_WATER",
  "ACIDIFIED_ZONE_WIND", "ALL_BLOOM", "ANKLESNARE", "APPLEIDUN", "ASSASSINCROSS",
  "ASTRAL_STRIKE", "BANDING", "BASILICA", "BLASTMINE", "BLOODYLUST", "B_TRAP",
  "CALLFAMILY", "CANE_OF_EVIL_EYE", "CATNIPPOWDER", "CHAOSPANIC", "CLAYMORETRAP",
  "CLOUD_KILL", "CLUSTERBOMB", "COBALTTRAP", "CONFLAGRATION", "CREATINGSTAR",
  "CROSS_RAIN", "DEEPBLINDTRAP", "DELUGE", "DEMONIC_FIRE", "DEMONSTRATION",
  "DIMENSIONDOOR", "DISSONANCE", "DONTFORGETME", "DRUMBATTLEFIELD", "DUMMYSKILL",
  "EARTHQUAKE", "EARTHSTRAIN", "EARTH_INSIGNIA", "ELECTRICSHOCKER", "ELECTRICWALK",
  "EPICLESIS", "ETERNALCHAOS", "EVILLAND", "FEINTBOMB", "FIREPILLAR_ACTIVE",
  "FIREPILLAR_WAITING", "FIREWALK", "FIREWALL", "FIRE_EXPANSION_SMOKE_POWDER",
  "FIRE_EXPANSION_TEAR_GAS", "FIRE_INSIGNIA", "FIRE_MANTLE", "FIRE_RAIN", "FIRINGTRAP",
  "FLAMECROSS", "FLAMETRAP", "FLASHER", "FLORAL_FLARE_ROAD", "FOGWALL", "FORTUNEKISS",
  "FREEZINGTRAP", "FUUMASHOUAKU", "GD_GLORYWOUNDS", "GD_HAWKEYES", "GD_LEADERSHIP",
  "GD_SOULCOLD", "GLITTERING_GREED", "GOSPEL", "GRAFFITI", "GRAVITATION",
  "GRENADES_DROPPING", "GROUNDDRIFT_DARK", "GROUNDDRIFT_FIRE", "GROUNDDRIFT_NEUTRAL",
  "GROUNDDRIFT_POISON", "GROUNDDRIFT_WATER", "GROUNDDRIFT_WIND", "GROUND_GRAVITATION",
  "HELLBURNING", "HELLS_PLANT", "HERMODE", "HUMMING", "HYUN_ROKS_BREEZE",
  "ICEBOUNDTRAP", "ICEMINE", "ICEWALL", "INTOABYSS", "JACK_FROST_NOVA", "KAEN",
  "KINGS_GRACE", "KUNAIKAITEN", "KUNAIKUSSETSU", "KUNAIWAIKYOKU", "LANDMINE",
  "LANDPROTECTOR", "LAVA_SLIDE", "LIGHTNING_LAND", "LULLABY", "MAELSTROM",
  "MAGENTATRAP", "MAGMA_ERUPTION", "MAGNUS", "MAIZETRAP", "MAKIBISHI", "MANHOLE",
  "MISSION_BOMBARD", "MOONLIT", "MYSTERY_ILLUSION", "NETHERWORLD", "NEUTRALBARRIER",
  "NYANGGRASS", "PNEUMA", "PNEUMATICUS_PROCELLA", "POEMBRAGI", "POISONSMOKE",
  "POISON_MIST", "POWER_OF_GAIA", "PSYCHIC_WAVE", "QUAGMIRE", "RAIN_OF_CRYSTAL",
  "REVERBERATION", "RICHMANKIM", "RINGNIBELUNGEN", "ROKISWEIL", "SAFETYWALL",
  "SANCTUARY", "SANDMAN", "SEEDTRAP", "SEKIENHOU", "SERVICEFORYOU",
  "SEVERE_RAINSTORM", "SHINKIROU", "SHOCKWAVE", "SIEGFRIED", "SKIDTRAP",
  "SOLIDTRAP", "SPIDERWEB", "STAR_BURST", "STAR_CANNON", "STEALTHFIELD",
  "STRANTUM_TREMOR", "SUITON", "SWIFTTRAP", "TALKIEBOX", "TATAMIGAESHI",
  "THORNS_TRAP", "TORNADO_STORM", "TOTEM_OF_TUTELARY", "TWINKLING_GALAXY",
  "UGLYDANCE", "UNKNOWN_2", "USED_TRAPS", "VACUUM_EXTREME", "VENOMDUST",
  "VENOMFOG", "VENOM_SWAMP", "VERDURETRAP", "VIOLENTGALE", "VIOLENT_QUAKE",
  "VOLCANIC_ASH", "VOLCANO", "WALLOFTHORN", "WARMER", "WARP_ACTIVE",
  "WARP_WAITING", "WATER_BARRIER", "WATER_INSIGNIA", "WHISTLE", "WIND_INSIGNIA",
  "ZENKAI_FIRE", "ZENKAI_LAND", "ZENKAI_WATER", "ZENKAI_WIND", "ZEPHYR",
] as const;
const SKILL_DB_UNIT_ID_SET: ReadonlySet<string> = new Set(SKILL_DB_UNIT_ID_UPPER);

const SkillDbUnitIdSchema = z
  .string()
  .refine((v) => SKILL_DB_UNIT_ID_SET.has(v.toUpperCase()), { message: "Unit.Id/AlternateId desconhecido (fora dos 174 UNT_ exportados)" });

// ---------------------------------------------------------------------------
// Forma bruta (o que o parser de YAML devolve, campo a campo do header)
// ---------------------------------------------------------------------------

const flagMap = <T extends readonly [string, ...string[]]>(values: T) => z.record(z.enum(values), z.boolean());

/** `<escalar> | [{Level, <valueKey>}]` — a forma exata que `parseNode` consome (skill.cpp:14708). */
const rawPerLevel = <ValueSchema extends z.ZodTypeAny>(valueKey: string, valueSchema: ValueSchema) =>
  z.union([valueSchema, z.array(z.object({ Level: z.number().int(), [valueKey]: valueSchema }).partial({ [valueKey]: true }))]);

const RawItemCostSchema = z.object({
  Item: z.string(),
  Amount: z.number().int(),
  Level: z.number().int().positive().optional(),
});

const RawRequiresSchema = z.object({
  HpCost: rawPerLevel("Amount", z.number().int()).optional(),
  SpCost: rawPerLevel("Amount", z.number().int()).optional(),
  ApCost: rawPerLevel("Amount", z.number().int()).optional(),
  HpRateCost: rawPerLevel("Amount", z.number().int()).optional(),
  SpRateCost: rawPerLevel("Amount", z.number().int()).optional(),
  ApRateCost: rawPerLevel("Amount", z.number().int()).optional(),
  MaxHpTrigger: rawPerLevel("Amount", z.number().int()).optional(),
  ZenyCost: rawPerLevel("Amount", z.number().int()).optional(),
  Weapon: flagMap(SKILL_DB_WEAPON).optional(),
  Ammo: flagMap(SKILL_DB_AMMO).optional(),
  AmmoAmount: rawPerLevel("Amount", z.number().int()).optional(),
  State: SkillDbStateSchema.optional(),
  /** Status → SC_ names, aberto (não fechamos os ~1000 SC_* — mesmo tratamento de packages/game-data/src/status.ts: id livre, minúsculo no schema do projeto) */
  Status: z.record(z.string(), z.boolean()).optional(),
  SpiritSphereCost: rawPerLevel("Amount", z.number().int()).optional(),
  ItemCost: z.array(RawItemCostSchema).max(10).optional(),
  Equipment: z.record(z.string(), z.boolean()).optional(),
});

const RawUnitSchema = z.object({
  Id: SkillDbUnitIdSchema,
  AlternateId: SkillDbUnitIdSchema.optional(),
  Layout: rawPerLevel("Size", z.number().int()).optional(),
  Range: rawPerLevel("Size", z.number().int()).optional(),
  Interval: z.number().int().min(-32768).max(32767).optional(),
  Target: z.enum(SKILL_DB_UNIT_TARGET).optional(),
  Flag: flagMap(SKILL_DB_UNIT_FLAG).optional(),
});

const RawCopyFlagsSchema = z.object({
  Skill: z.object({ Plagiarism: z.boolean().optional(), Reproduce: z.boolean().optional() }),
  RemoveRequirement: flagMap(SKILL_DB_REMOVE_REQUIREMENT).optional(),
});

const RawNoNearNpcSchema = z.object({
  AdditionalRange: z.number().int().nonnegative().optional(),
  Type: flagMap(SKILL_DB_NONEAR_TYPE).optional(),
});

/**
 * Um `Body[]` de `skill_db.yml`, fiel ao header oficial (§2/§3 da auditoria).
 * `Status` (associado) fica livre pela mesma razão do `Requires.Status`.
 */
export const RawSkillYamlSchema = z.object({
  Id: z.number().int().positive().max(65535),
  Name: z.string().min(1).max(39),
  Description: z.string().min(1).max(39),
  MaxLevel: z.number().int().min(1).max(13),
  Type: SkillDbTypeSchema.optional(),
  TargetType: SkillDbTargetTypeSchema.optional(),
  DamageFlags: flagMap(SKILL_DB_DAMAGE_FLAGS).optional(),
  Flags: flagMap(SKILL_DB_FLAGS).optional(),
  Range: rawPerLevel("Size", z.number().int()).optional(),
  Hit: SkillDbHitSchema.optional(),
  HitCount: rawPerLevel("Count", z.number().int()).optional(),
  Element: rawPerLevel("Element", SkillDbElementSchema).optional(),
  SplashArea: rawPerLevel("Area", z.number().int()).optional(),
  ActiveInstance: rawPerLevel("Max", z.number().int()).optional(),
  Knockback: rawPerLevel("Amount", z.number().int()).optional(),
  GiveAp: rawPerLevel("Amount", z.number().int()).optional(),
  CopyFlags: RawCopyFlagsSchema.optional(),
  NoNearNPC: RawNoNearNpcSchema.optional(),
  CastCancel: z.boolean().optional(),
  CastDefenseReduction: z.number().int().nonnegative().optional(),
  CastTime: rawPerLevel("Time", z.number().int()).optional(),
  AfterCastActDelay: rawPerLevel("Time", z.number().int()).optional(),
  AfterCastWalkDelay: rawPerLevel("Time", z.number().int()).optional(),
  Duration1: rawPerLevel("Time", z.number().int()).optional(),
  Duration2: rawPerLevel("Time", z.number().int()).optional(),
  Cooldown: rawPerLevel("Time", z.number().int()).optional(),
  FixedCastTime: rawPerLevel("Time", z.number().int()).optional(),
  CastTimeFlags: flagMap(SKILL_DB_CAST_FLAGS).optional(),
  CastDelayFlags: flagMap(SKILL_DB_CAST_FLAGS).optional(),
  Requires: RawRequiresSchema.optional(),
  Unit: RawUnitSchema.optional(),
  /** Status change associado (topo) — SC_ livre, mesma razão de Requires.Status */
  Status: z.string().optional(),
});
export type RawSkillYaml = z.infer<typeof RawSkillYamlSchema>;

// ---------------------------------------------------------------------------
// Resolução por nível — porte fiel de SkillDatabase::parseNode (skill.cpp:14708-14771)
// ---------------------------------------------------------------------------

/**
 * `MAX_SKILL_LEVEL` (skill.hpp:43). O array resolvido tem SEMPRE este
 * tamanho — nunca `MaxLevel` — porque mob/NPC pode conjurar acima do teto
 * de jogador (`SM_MAGNUM` tem `SplashArea` no `Level: 11` com `MaxLevel: 10`
 * — cortar em `maxLevel`, como o migrador anterior fazia, descarta isso).
 */
export const MAX_SKILL_LEVEL = 13;

/**
 * Resolve um campo perLevel bruto pro array de 13 posições, com a MESMA
 * extrapolação linear do `parseNode` C++: acha o menor passo cuja diferença
 * é constante no trecho listado e estende; sem tendência, repete o último
 * valor. Escalar preenche as 13 posições igual.
 */
export function resolvePerLevel<T extends number | string>(
  raw: T | Record<string, unknown>[] | undefined,
  valueKey: string,
  fillValue: T,
): T[] {
  const arr = new Array<T>(MAX_SKILL_LEVEL).fill(fillValue);
  if (raw === undefined) return arr;
  if (typeof raw !== "object") {
    return new Array<T>(MAX_SKILL_LEVEL).fill(raw);
  }

  let maxListed = 0;
  for (const entry of raw) {
    const lv = entry.Level as number;
    if (lv >= 1 && lv <= MAX_SKILL_LEVEL) {
      arr[lv - 1] = (entry[valueKey] ?? fillValue) as T;
      maxListed = Math.max(maxListed, lv);
    }
  }
  if (maxListed === 0 || maxListed >= MAX_SKILL_LEVEL) return arr;

  // extrapolação só faz sentido pra número — Element (string) simplesmente repete
  if (typeof arr[0] !== "number") {
    for (let i = maxListed; i < MAX_SKILL_LEVEL; i++) arr[i] = arr[maxListed - 1]!;
    return arr;
  }

  const nums = arr as unknown as number[];
  let extrapolated = false;
  for (let step = 1; step <= Math.floor(maxListed / 2); step++) {
    let diff = nums[maxListed - 1]! - nums[maxListed - step - 1]!;
    let j: number;
    for (j = maxListed - 1; j >= step; j--) {
      if (nums[j]! - nums[j - step]! !== diff) break;
    }
    if (j >= step) continue;
    for (let i = maxListed; i < MAX_SKILL_LEVEL; i++) {
      nums[i] = nums[i - step]! + diff;
      if (nums[i]! < 1 && nums[i - 1]! >= 0) {
        nums[i] = 1;
        diff = 0;
        step = 1;
      }
    }
    extrapolated = true;
    break;
  }
  if (!extrapolated) {
    for (let i = maxListed; i < MAX_SKILL_LEVEL; i++) nums[i] = nums[maxListed - 1]!;
  }
  return arr;
}

/** `Record<enum,boolean>` bruto → devolvido como veio (o Parser preserva `false` explícito; nunca colapsa em string[] — isso é trabalho do Mapper). */
function resolveFlagMap(raw: Record<string, boolean> | undefined): Record<string, boolean> {
  return raw ? { ...raw } : {};
}

/** Um `Body[]` inteiro, com todo campo perLevel resolvido pras 13 posições e todo flag map explícito. É a forma "canônica" usada no teste de ida-e-volta. */
export interface ParsedSkillEntry {
  id: number;
  name: string;
  description: string;
  maxLevel: number;
  type: z.infer<typeof SkillDbTypeSchema>;
  targetType: z.infer<typeof SkillDbTargetTypeSchema>;
  damageFlags: Record<string, boolean>;
  flags: Record<string, boolean>;
  range: number[];
  hit: z.infer<typeof SkillDbHitSchema> | undefined;
  hitCount: number[];
  element: string[];
  splashArea: number[];
  activeInstance: number[];
  knockback: number[];
  giveAp: number[];
  copyFlags: { skill: Record<string, boolean>; removeRequirement: Record<string, boolean> } | undefined;
  noNearNpc: { additionalRange: number; type: Record<string, boolean> } | undefined;
  castCancel: boolean;
  castDefenseReduction: number;
  castTime: number[];
  afterCastActDelay: number[];
  afterCastWalkDelay: number[];
  duration1: number[];
  duration2: number[];
  cooldown: number[];
  fixedCastTime: number[];
  castTimeFlags: Record<string, boolean>;
  castDelayFlags: Record<string, boolean>;
  requires:
    | {
        hpCost: number[];
        spCost: number[];
        apCost: number[];
        hpRateCost: number[];
        spRateCost: number[];
        apRateCost: number[];
        maxHpTrigger: number[];
        zenyCost: number[];
        weapon: Record<string, boolean>;
        ammo: Record<string, boolean>;
        ammoAmount: number[];
        state: string | undefined;
        status: Record<string, boolean>;
        spiritSphereCost: number[];
        itemCost: { item: string; amount: number; level: number | undefined }[];
        equipment: Record<string, boolean>;
      }
    | undefined;
  unit:
    | {
        id: string;
        alternateId: string | undefined;
        layout: number[];
        range: number[];
        interval: number;
        target: string | undefined;
        flag: Record<string, boolean>;
      }
    | undefined;
  status: string | undefined;
}

/** rAthena default de `TargetType` ausente = `Passive` (skill.hpp / skill.cpp:14865-14880, o `inf` fica 0). */
const DEFAULT_TARGET_TYPE: z.infer<typeof SkillDbTargetTypeSchema> = "Passive";
/** default de `Type` ausente = `None` (skill.cpp:14839-14863). */
const DEFAULT_TYPE: z.infer<typeof SkillDbTypeSchema> = "None";

/**
 * Parser: `RawSkillYaml` (o que o `yaml` devolve, cru) → `ParsedSkillEntry`
 * (canônico, resolvido). Entrada assumida já validada por
 * `RawSkillYamlSchema.parse`.
 */
export function parseSkillEntry(raw: RawSkillYaml): ParsedSkillEntry {
  return {
    id: raw.Id,
    name: raw.Name,
    description: raw.Description,
    maxLevel: raw.MaxLevel,
    type: raw.Type ?? DEFAULT_TYPE,
    targetType: raw.TargetType ?? DEFAULT_TARGET_TYPE,
    damageFlags: resolveFlagMap(raw.DamageFlags),
    flags: resolveFlagMap(raw.Flags),
    range: resolvePerLevel(raw.Range, "Size", 0),
    hit: raw.Hit,
    hitCount: resolvePerLevel(raw.HitCount, "Count", 0),
    element: resolvePerLevel(raw.Element, "Element", "Neutral"),
    splashArea: resolvePerLevel(raw.SplashArea, "Area", 0),
    activeInstance: resolvePerLevel(raw.ActiveInstance, "Max", 0),
    knockback: resolvePerLevel(raw.Knockback, "Amount", 0),
    giveAp: resolvePerLevel(raw.GiveAp, "Amount", 0),
    copyFlags: raw.CopyFlags
      ? {
          skill: { Plagiarism: raw.CopyFlags.Skill.Plagiarism ?? false, Reproduce: raw.CopyFlags.Skill.Reproduce ?? false },
          removeRequirement: resolveFlagMap(raw.CopyFlags.RemoveRequirement),
        }
      : undefined,
    noNearNpc: raw.NoNearNPC
      ? { additionalRange: raw.NoNearNPC.AdditionalRange ?? 0, type: resolveFlagMap(raw.NoNearNPC.Type) }
      : undefined,
    castCancel: raw.CastCancel ?? true,
    castDefenseReduction: raw.CastDefenseReduction ?? 0,
    castTime: resolvePerLevel(raw.CastTime, "Time", 0),
    afterCastActDelay: resolvePerLevel(raw.AfterCastActDelay, "Time", 0),
    afterCastWalkDelay: resolvePerLevel(raw.AfterCastWalkDelay, "Time", 0),
    duration1: resolvePerLevel(raw.Duration1, "Time", 0),
    duration2: resolvePerLevel(raw.Duration2, "Time", 0),
    cooldown: resolvePerLevel(raw.Cooldown, "Time", 0),
    fixedCastTime: resolvePerLevel(raw.FixedCastTime, "Time", 0),
    castTimeFlags: resolveFlagMap(raw.CastTimeFlags),
    castDelayFlags: resolveFlagMap(raw.CastDelayFlags),
    requires: raw.Requires
      ? {
          hpCost: resolvePerLevel(raw.Requires.HpCost, "Amount", 0),
          spCost: resolvePerLevel(raw.Requires.SpCost, "Amount", 0),
          apCost: resolvePerLevel(raw.Requires.ApCost, "Amount", 0),
          hpRateCost: resolvePerLevel(raw.Requires.HpRateCost, "Amount", 0),
          spRateCost: resolvePerLevel(raw.Requires.SpRateCost, "Amount", 0),
          apRateCost: resolvePerLevel(raw.Requires.ApRateCost, "Amount", 0),
          maxHpTrigger: resolvePerLevel(raw.Requires.MaxHpTrigger, "Amount", 0),
          zenyCost: resolvePerLevel(raw.Requires.ZenyCost, "Amount", 0),
          weapon: resolveFlagMap(raw.Requires.Weapon),
          ammo: resolveFlagMap(raw.Requires.Ammo),
          ammoAmount: resolvePerLevel(raw.Requires.AmmoAmount, "Amount", 0),
          state: raw.Requires.State,
          status: resolveFlagMap(raw.Requires.Status),
          spiritSphereCost: resolvePerLevel(raw.Requires.SpiritSphereCost, "Amount", 0),
          itemCost: (raw.Requires.ItemCost ?? []).map((c) => ({ item: c.Item, amount: c.Amount, level: c.Level })),
          equipment: resolveFlagMap(raw.Requires.Equipment),
        }
      : undefined,
    unit: raw.Unit
      ? {
          id: raw.Unit.Id,
          alternateId: raw.Unit.AlternateId,
          layout: resolvePerLevel(raw.Unit.Layout, "Size", 0),
          range: resolvePerLevel(raw.Unit.Range, "Size", 0),
          interval: raw.Unit.Interval ?? 0,
          target: raw.Unit.Target,
          flag: resolveFlagMap(raw.Unit.Flag),
        }
      : undefined,
    status: raw.Status,
  };
}

/**
 * Writer AINDA NÃO EXISTE (gate: Parser tem que estar 100% antes). Esta
 * função serve só ao teste de ida-e-volta do PRÓPRIO Parser — reemite
 * `ParsedSkillEntry` pra forma bruta (sempre lista completa de 13 níveis,
 * nunca escalar) e reparseia pra provar que `parseSkillEntry` não perde
 * informação. Não é o Writer de override esparso (esse é o item 5 da
 * arquitetura, e some por trás do gate até o round-trip abaixo fechar).
 */
export function reemitRawSkillYaml(p: ParsedSkillEntry): RawSkillYaml {
  const perLevel = <T,>(arr: T[], key: string) => arr.map((v, i) => ({ Level: i + 1, [key]: v }));

  return RawSkillYamlSchema.parse({
    Id: p.id,
    Name: p.name,
    Description: p.description,
    MaxLevel: p.maxLevel,
    Type: p.type,
    TargetType: p.targetType,
    ...(Object.keys(p.damageFlags).length ? { DamageFlags: p.damageFlags } : {}),
    ...(Object.keys(p.flags).length ? { Flags: p.flags } : {}),
    Range: perLevel(p.range, "Size"),
    ...(p.hit ? { Hit: p.hit } : {}),
    HitCount: perLevel(p.hitCount, "Count"),
    Element: perLevel(p.element, "Element"),
    SplashArea: perLevel(p.splashArea, "Area"),
    ActiveInstance: perLevel(p.activeInstance, "Max"),
    Knockback: perLevel(p.knockback, "Amount"),
    GiveAp: perLevel(p.giveAp, "Amount"),
    ...(p.copyFlags
      ? {
          CopyFlags: {
            Skill: { Plagiarism: p.copyFlags.skill.Plagiarism ?? false, Reproduce: p.copyFlags.skill.Reproduce ?? false },
            ...(Object.keys(p.copyFlags.removeRequirement).length ? { RemoveRequirement: p.copyFlags.removeRequirement } : {}),
          },
        }
      : {}),
    ...(p.noNearNpc
      ? {
          NoNearNPC: {
            AdditionalRange: p.noNearNpc.additionalRange,
            ...(Object.keys(p.noNearNpc.type).length ? { Type: p.noNearNpc.type } : {}),
          },
        }
      : {}),
    CastCancel: p.castCancel,
    CastDefenseReduction: p.castDefenseReduction,
    CastTime: perLevel(p.castTime, "Time"),
    AfterCastActDelay: perLevel(p.afterCastActDelay, "Time"),
    AfterCastWalkDelay: perLevel(p.afterCastWalkDelay, "Time"),
    Duration1: perLevel(p.duration1, "Time"),
    Duration2: perLevel(p.duration2, "Time"),
    Cooldown: perLevel(p.cooldown, "Time"),
    FixedCastTime: perLevel(p.fixedCastTime, "Time"),
    ...(Object.keys(p.castTimeFlags).length ? { CastTimeFlags: p.castTimeFlags } : {}),
    ...(Object.keys(p.castDelayFlags).length ? { CastDelayFlags: p.castDelayFlags } : {}),
    ...(p.requires
      ? {
          Requires: {
            HpCost: perLevel(p.requires.hpCost, "Amount"),
            SpCost: perLevel(p.requires.spCost, "Amount"),
            ApCost: perLevel(p.requires.apCost, "Amount"),
            HpRateCost: perLevel(p.requires.hpRateCost, "Amount"),
            SpRateCost: perLevel(p.requires.spRateCost, "Amount"),
            ApRateCost: perLevel(p.requires.apRateCost, "Amount"),
            MaxHpTrigger: perLevel(p.requires.maxHpTrigger, "Amount"),
            ZenyCost: perLevel(p.requires.zenyCost, "Amount"),
            ...(Object.keys(p.requires.weapon).length ? { Weapon: p.requires.weapon } : {}),
            ...(Object.keys(p.requires.ammo).length ? { Ammo: p.requires.ammo } : {}),
            // Nunca emitir sem pelo menos 1 tipo de munição REAL marcado
            // (`true`) — o loader real rejeita ("An ammo type is required
            // before specifying ammo amount.", skill.cpp:15432-15434) se
            // `AmmoAmount` existir no YAML e `require.ammo` for 0.
            // `Object.keys(...).length` não basta de gate: o formulário do
            // admin (MultiSelectField) manda o mapa de munição com TODAS as
            // chaves presentes e `false` (não omite as desmarcadas), então
            // `.length` nunca é 0 depois de uma skill passar pelo admin —
            // precisa checar se ALGUM valor é `true`. Antes disto
            // `AmmoAmount` era emitido incondicional, e QUALQUER skill nova
            // (sem munição) recém-criada pelo admin derrubava a linha
            // inteira no reload/boot — reproduzido ao vivo na Fase 3
            // (docs/audit/fase3-testes/skills.md). O gate ainda tinha um
            // furo: `None` é o sentinel de "sem munição nenhuma" (linha
            // acima) e É `true` nesse caso — `.some(Boolean)` contava ele
            // como "tem munição marcada" e emitia `AmmoAmount` mesmo assim,
            // derrubando toda skill sem munição real (achado ao vivo na
            // auditoria Safety Wall 2026-08-13, skill travava no reload e
            // NENHUM campo do override — nem o ItemCost corrigido acima —
            // chegava a valer). `None` precisa ficar de fora da checagem.
            ...(Object.entries(p.requires.ammo).some(([k, v]) => k !== "None" && v)
              ? { AmmoAmount: perLevel(p.requires.ammoAmount, "Amount") }
              : {}),
            ...(p.requires.state ? { State: p.requires.state } : {}),
            ...(Object.keys(p.requires.status).length ? { Status: p.requires.status } : {}),
            SpiritSphereCost: perLevel(p.requires.spiritSphereCost, "Amount"),
            // Emitido sempre, mesmo vazio — igual aos outros campos deste
            // objeto (regra do arquivo: "todo campo que o Mapper sabe
            // representar é reescrito por INTEIRO"). Omitir a chave quando
            // vazia fazia `nodeExists(requireNode, "ItemCost")` (skill.cpp)
            // dar falso e o loader nunca aplicar o reset que o override
            // pretendia — a remoção do custo do item nunca chegava ao
            // runtime (auditoria Safety Wall 2026-08-13).
            ItemCost: p.requires.itemCost.map((c) => ({ Item: c.item, Amount: c.amount, ...(c.level ? { Level: c.level } : {}) })),
            ...(Object.keys(p.requires.equipment).length ? { Equipment: p.requires.equipment } : {}),
          },
        }
      : {}),
    ...(p.unit
      ? {
          Unit: {
            Id: p.unit.id,
            ...(p.unit.alternateId ? { AlternateId: p.unit.alternateId } : {}),
            Layout: perLevel(p.unit.layout, "Size"),
            Range: perLevel(p.unit.range, "Size"),
            Interval: p.unit.interval,
            ...(p.unit.target ? { Target: p.unit.target } : {}),
            ...(Object.keys(p.unit.flag).length ? { Flag: p.unit.flag } : {}),
          },
        }
      : {}),
    ...(p.status ? { Status: p.status } : {}),
  });
}

