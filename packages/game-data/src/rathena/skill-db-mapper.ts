import type { ItemSubType } from "../item";
import type { Skill } from "../skill";
import {
  MAX_SKILL_LEVEL,
  SKILL_DB_AMMO,
  SKILL_DB_CAST_FLAGS,
  SKILL_DB_DAMAGE_FLAGS,
  SKILL_DB_FLAGS,
  SKILL_DB_NONEAR_TYPE,
  SKILL_DB_REMOVE_REQUIREMENT,
  SKILL_DB_UNIT_FLAG,
  SKILL_DB_UNIT_ID_UPPER,
  SKILL_DB_UNIT_TARGET,
  SKILL_DB_WEAPON,
  SkillDbStateSchema,
  type ParsedSkillEntry,
} from "./skill-db-yaml";

/**
 * Mapper (etapa 2 de 4): `Skill` (schema do projeto, editável no admin) ↔
 * `ParsedSkillEntry` (formato oficial resolvido, `./skill-db-yaml.ts`).
 *
 * Esta é a camada de PERDA DOCUMENTADA — a tabela de compatibilidade da
 * auditoria (plano aprovado, §2/§3) já lista campo a campo o que é 1:1,
 * o que precisa tabela reversa e o que não tem representação nenhuma.
 * `skillToParsedEntry` devolve também `warnings`: os campos que o Writer
 * NÃO vai conseguir gravar, pra virar aviso na UI em vez de sumirem calados.
 *
 * `toSnake` é COPIADO de `tools/legacy-migration/src/mappings.ts` de
 * propósito — `packages/game-data` não pode depender de `tools/
 * legacy-migration` (a dependência é na direção contrária), e é a mesma
 * razão que já levou `mysql-item-row.ts` a duplicar suas tabelas de
 * conversão em vez de importar do pacote de migração.
 */

/** Exportado pra `skill-flag-options.ts` gerar os MESMOS tokens que este
 * mapper já usa (`REV_*` abaixo) — uma função só, nunca duas cópias
 * divergindo. */
export function toSnake(token: string): string {
  return token
    .split("_")
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase())
    .join("_");
}

/** {snake: TitleCase}, construído invertendo `toSnake` sobre a lista canônica — nunca digitado à mão. */
function reverseBySnake<T extends readonly string[]>(canonical: T): Map<string, T[number]> {
  const map = new Map<string, T[number]>();
  for (const v of canonical) map.set(toSnake(v), v);
  return map;
}

const REV_DAMAGE_FLAGS = reverseBySnake(SKILL_DB_DAMAGE_FLAGS);
const REV_FLAGS = reverseBySnake(SKILL_DB_FLAGS);
const REV_CAST_FLAGS = reverseBySnake(SKILL_DB_CAST_FLAGS);
const REV_REMOVE_REQUIREMENT = reverseBySnake(SKILL_DB_REMOVE_REQUIREMENT);
const REV_NONEAR_TYPE = reverseBySnake(SKILL_DB_NONEAR_TYPE);
const REV_UNIT_TARGET = reverseBySnake(SKILL_DB_UNIT_TARGET);
const REV_UNIT_FLAG = reverseBySnake(SKILL_DB_UNIT_FLAG);
const REV_STATE = reverseBySnake(SkillDbStateSchema.options);
/**
 * Unit.Id/AlternateId: a grafia real no arquivo NÃO segue regra fixa
 * (`Firepillar_Active` vs `Cane_of_evil_eye` vs `FUUMASHOUAKU` — ver
 * `skill-db-yaml.ts`), mas `toSnake` é CEGO A MAIÚSCULA (termina em
 * `.toLowerCase()`), então `toSnake("FUUMASHOUAKU") === toSnake("Fuumashouaku")`
 * — a chave bate não importa a casing original. O Writer reemite sempre em
 * MAIÚSCULO (`FIREPILLAR_ACTIVE`): a busca do rAthena é case-insensitive
 * (`script.cpp:calc_hash`/`strcasecmp`), então é válido mesmo sem replicar a
 * grafia exata do arquivo original.
 */
const REV_UNIT_ID = reverseBySnake(SKILL_DB_UNIT_ID_UPPER);

/**
 * Requires.Weapon/Ammo usam nomes de item subtype, não `toSnake` —
 * cópia das tabelas de `tools/legacy-migration/src/mappings.ts`
 * (mesma razão de não poder importar de lá).
 */
// Exportadas pra `skill-flag-options.ts` saber quais ItemSubType são
// válidos como arma/munição de skill (subconjunto de ItemSubTypeSchema,
// que também tem carta/outros que não fazem sentido aqui) — uma tabela só.
export const WEAPON_SUBTYPE_MAP: Record<string, ItemSubType> = {
  Dagger: "dagger", "1hSword": "1h_sword", "2hSword": "2h_sword", "1hSpear": "1h_spear",
  "2hSpear": "2h_spear", "1hAxe": "1h_axe", "2hAxe": "2h_axe", Mace: "mace", "2hMace": "2h_mace",
  Staff: "staff", "2hStaff": "2h_staff", Bow: "bow", Knuckle: "knuckle", Musical: "musical",
  Whip: "whip", Book: "book", Katar: "katar", Revolver: "revolver", Rifle: "rifle",
  Gatling: "gatling", Shotgun: "shotgun", Grenade: "grenade", Huuma: "huuma", Fist: "fist",
};
export const AMMO_SUBTYPE_MAP: Record<string, ItemSubType> = {
  Arrow: "arrow", Dagger: "dagger_ammo", Bullet: "bullet", Shell: "shell",
  Grenade: "grenade_ammo", Shuriken: "shuriken", Kunai: "kunai", Cannonball: "cannonball",
  Throwweapon: "throwable_weapon",
};
function invert<K extends string, V extends string>(map: Record<K, V>): Record<string, K> {
  const out: Record<string, K> = {};
  for (const [k, v] of Object.entries(map) as [K, V][]) if (!(v in out)) out[v] = k;
  return out;
}
const REV_WEAPON = invert(WEAPON_SUBTYPE_MAP);
const REV_AMMO = invert(AMMO_SUBTYPE_MAP);

/** ELE_ → schema (shadow↔Dark), pro Element writer. Mesma tabela de migrate-skills.ts, invertida. */
const REV_ELEMENT: Record<string, string> = {
  neutral: "Neutral", water: "Water", earth: "Earth", fire: "Fire", wind: "Wind",
  poison: "Poison", holy: "Holy", shadow: "Dark", ghost: "Ghost", undead: "Undead",
  weapon: "Weapon", endowed: "Endowed", random: "Random", all: "All",
};

const REV_TARGET_TYPE: Record<string, "Passive" | "Attack" | "Ground" | "Self" | "Support" | "Trap"> = {
  "passive:self": "Passive",
  "damage:enemy": "Attack",
  "area:ground": "Ground",
  "self_buff:self": "Self",
  "support:ally": "Support",
  "support:trap": "Trap",
};

const REV_HIT: Record<string, "Single" | "Multi_Hit"> = { single: "Single", multi_hit: "Multi_Hit" };

/** `flags: string[]` (só os `true`) → `Record<TitleCase, boolean>` completo — as ausentes viram `false` explícito (regra 1 do gate: bitset é aditivo, sem chave completa não dá pra desligar nada na base). */
function toFullFlagMap(active: string[], rev: Map<string, string>): Record<string, boolean> {
  const set = new Set(active);
  const out: Record<string, boolean> = {};
  for (const [snake, title] of rev) out[title] = set.has(snake);
  return out;
}

/** valor `T | T[]` do schema (perLevel, comprimento = maxLevel quando array) → array de 13, preservando a cauda 11-13 da entrada BASE quando o campo não muda o suficiente pra justificar recalculá-la. */
function expandToThirteen(
  value: number | number[] | undefined,
  maxLevel: number,
  baseTail: number[] | undefined,
  fill: number,
): number[] {
  const out = new Array<number>(MAX_SKILL_LEVEL).fill(fill);
  if (value === undefined) return baseTail ? [...baseTail] : out;
  const at = (lv1: number): number => {
    if (typeof value === "number") return value;
    return value[Math.min(lv1, value.length - 1)] ?? fill;
  };
  for (let i = 0; i < maxLevel; i++) out[i] = at(i);
  for (let i = maxLevel; i < MAX_SKILL_LEVEL; i++) {
    out[i] = baseTail ? baseTail[i]! : out[maxLevel - 1]!;
  }
  return out;
}

export interface SkillMapResult {
  entry: ParsedSkillEntry;
  /** campos do Skill que não têm representação em skill_db.yml — não foram gravados, precisam de aviso na UI (nunca descartados em silêncio). */
  warnings: string[];
}

/** id numérico do catálogo → aegis name (`item_db_re.name_aegis`). Mesmo formato de `ItemNameResolver` em `apps/api/src/store/mysql-monster-row.ts` — não importado de lá porque `game-data` não pode depender de `apps/api` (direção contrária da dependência). */
export type ItemNameResolver = (itemId: number) => string | undefined;

/**
 * `Skill` → `ParsedSkillEntry`, pronto pro Writer reemitir. Quando `base`
 * existe (skill já tinha entrada no catálogo rAthena), a cauda 11-13 de
 * cada campo perLevel e os campos que o `Skill` schema não representa
 * (ex.: `Unit.Interval` já vem do próprio schema, mas metadados de
 * `appliedStatuses` não) preservam o valor da base em vez de zerar.
 */
export function skillToParsedEntry(
  skill: Skill,
  base: ParsedSkillEntry | undefined,
  resolveItemName: ItemNameResolver,
): SkillMapResult {
  const warnings: string[] = [];
  const max = skill.maxLevel;
  const tail = (key: keyof ParsedSkillEntry): number[] | undefined => (base ? (base[key] as number[]) : undefined);
  const reqTail = (key: string): number[] | undefined =>
    base?.requires ? ((base.requires as unknown as Record<string, number[]>)[key]) : undefined;
  const unitTail = (key: string): number[] | undefined =>
    base?.unit ? ((base.unit as unknown as Record<string, number[]>)[key]) : undefined;

  const targetKey = `${skill.type}:${skill.target}`;
  const targetType = REV_TARGET_TYPE[targetKey];
  if (!targetType) {
    warnings.push(
      `combinação type="${skill.type}"/target="${skill.target}" não corresponde a nenhum TargetType do rAthena — Type/TargetType não foram atualizados`,
    );
  }

  const hit = REV_HIT[skill.hitType];
  if (skill.hitType === "critical") {
    warnings.push(`hitType "critical" não existe como constante exportada no rAthena (DMG_CRITICAL) — Hit não foi alterado`);
  }

  // mesma regra de `expandToThirteen`: níveis 1..max vêm do Skill, 11-13
  // seguram a cauda da BASE quando existe, senão repetem o último nível
  // real (nunca ficam órfãos num "Neutral" que ninguém pediu — foi
  // exatamente esse bug que o teste funcional com @reloadskilldb pegou:
  // NV_BASIC saía com Weapon nos níveis 1-9 e Neutral do 10 em diante).
  const elementArr = Array.isArray(skill.element) ? skill.element : undefined;
  const elementScalar = typeof skill.element === "string" ? skill.element : undefined;
  const elementOut = new Array<string>(MAX_SKILL_LEVEL).fill("Neutral");
  for (let i = 0; i < max; i++) {
    const v = elementScalar ?? elementArr?.[Math.min(i, (elementArr?.length ?? 1) - 1)];
    if (!v) continue;
    const mapped = REV_ELEMENT[v];
    if (mapped) elementOut[i] = mapped;
    else warnings.push(`elemento "${v}" sem correspondência em rAthena — nível ${i + 1} manteve o valor anterior`);
  }
  for (let i = max; i < MAX_SKILL_LEVEL; i++) {
    elementOut[i] = base ? base.element[i]! : elementOut[max - 1]!;
  }

  const perLevelField = (
    value: number | number[] | undefined,
    baseKey: keyof ParsedSkillEntry,
    fill = 0,
  ): number[] => expandToThirteen(value, max, tail(baseKey), fill);

  const requires = skill.requirements;
  // `Requires` sempre é emitido: `spCost` é campo de TOPO no `Skill` (não faz
  // parte de `requirements`), mas mora dentro de `Requires.SpCost` no
  // formato oficial — praticamente toda skill com custo de SP precisa dele,
  // então gatear a emissão por `requirements` presente perderia o SpCost de
  // qualquer skill que só usasse esse campo (achado no round-trip test).
  const requiresOut: ParsedSkillEntry["requires"] =
    {
          hpCost: expandToThirteen(requires?.hpCost, max, reqTail("hpCost"), 0),
          spCost: expandToThirteen(skill.spCost, max, reqTail("spCost"), 0),
          apCost: expandToThirteen(requires?.apCost, max, reqTail("apCost"), 0),
          hpRateCost: expandToThirteen(requires?.hpRateCost, max, reqTail("hpRateCost"), 0),
          spRateCost: expandToThirteen(requires?.spRateCost, max, reqTail("spRateCost"), 0),
          apRateCost: expandToThirteen(requires?.apRateCost, max, reqTail("apRateCost"), 0),
          maxHpTrigger: expandToThirteen(requires?.maxHpTrigger, max, reqTail("maxHpTrigger"), 0),
          zenyCost: expandToThirteen(requires?.zenyCost, max, reqTail("zenyCost"), 0),
          weapon: (() => {
            const out: Record<string, boolean> = {};
            for (const w of SKILL_DB_WEAPON) out[w] = false;
            if (requires && requires.requiredWeapons.length === 0) out.All = true;
            for (const w of requires?.requiredWeapons ?? []) {
              const title = REV_WEAPON[w];
              if (title) out[title] = true;
              else warnings.push(`arma requerida "${w}" sem correspondência em rAthena — não gravada`);
            }
            return out;
          })(),
          ammo: (() => {
            const out: Record<string, boolean> = {};
            for (const a of SKILL_DB_AMMO) out[a] = false;
            if (requires && requires.requiredAmmo.length === 0) out.None = true;
            for (const a of requires?.requiredAmmo ?? []) {
              const title = REV_AMMO[a];
              if (title) out[title] = true;
              else warnings.push(`munição requerida "${a}" sem correspondência em rAthena — não gravada`);
            }
            return out;
          })(),
          ammoAmount: expandToThirteen(requires?.ammoAmount, max, reqTail("ammoAmount"), 0),
          state: requires?.requiredState ? (REV_STATE.get(requires.requiredState) ?? undefined) : base?.requires?.state,
          status: (() => {
            const out: Record<string, boolean> = {};
            for (const s of requires?.requiredStatuses ?? []) out[s.toUpperCase()] = true;
            return out;
          })(),
          spiritSphereCost: expandToThirteen(requires?.spiritSphereCost, max, reqTail("spiritSphereCost"), 0),
          itemCost: (requires?.itemsConsumed ?? []).flatMap((c) => {
            const aegisName = resolveItemName(c.itemId);
            if (!aegisName) {
              warnings.push(`ItemCost: item id ${c.itemId} não encontrado no catálogo — omitido do skill_db.yml`);
              return [];
            }
            return [{ item: aegisName, amount: c.amount, level: c.level }];
          }),
          equipment: (() => {
            const out: Record<string, boolean> = {};
            for (const id of requires?.requiredEquipment ?? []) {
              const aegisName = resolveItemName(id);
              if (!aegisName) {
                warnings.push(`Equipment: item id ${id} não encontrado no catálogo — omitido do skill_db.yml`);
                continue;
              }
              out[aegisName] = true;
            }
            return out;
          })(),
    };
  if (requires?.requiredState && !REV_STATE.get(requires.requiredState)) {
    warnings.push(`requiredState "${requires.requiredState}" sem correspondência em rAthena — State não foi alterado`);
  }

  const unit = skill.unit;
  const unitOut: ParsedSkillEntry["unit"] | undefined = unit
    ? {
        id: REV_UNIT_ID.get(unit.id) ?? (warnings.push(`Unit.Id "${unit.id}" sem correspondência em rAthena — Unit não foi gravado`), base?.unit?.id ?? "DUMMYSKILL"),
        alternateId: unit.alternateId ? REV_UNIT_ID.get(unit.alternateId) : undefined,
        layout: expandToThirteen(unit.layout, max, unitTail("layout"), 0),
        range: expandToThirteen(unit.range, max, unitTail("range"), 0),
        interval: unit.intervalMs,
        target: unit.target && unit.target !== "all" ? REV_UNIT_TARGET.get(unit.target) : undefined,
        flag: toFullFlagMap(unit.flags, REV_UNIT_FLAG),
      }
    : base?.unit;

  const entry: ParsedSkillEntry = {
    id: skill.id,
    name: skill.aegisName,
    description: skill.name,
    maxLevel: skill.maxLevel,
    type: targetType ? "None" : (base?.type ?? "None"), // placeholder abaixo, corrigido já já
    targetType: targetType ?? base?.targetType ?? "Passive",
    damageFlags: toFullFlagMap(skill.damageFlags, REV_DAMAGE_FLAGS),
    flags: toFullFlagMap(skill.flags, REV_FLAGS),
    range: perLevelField(skill.range, "range"),
    hit,
    hitCount: perLevelField(skill.hits, "hitCount", 1),
    element: elementOut,
    splashArea: perLevelField(skill.areaRadius, "splashArea"),
    activeInstance: perLevelField(skill.activeInstances, "activeInstance"),
    knockback: perLevelField(skill.knockback, "knockback"),
    giveAp: perLevelField(skill.giveAp, "giveAp"),
    copyFlags: skill.copyFlags
      ? {
          skill: { Plagiarism: skill.copyFlags.skill.includes("plagiarism"), Reproduce: skill.copyFlags.skill.includes("reproduce") },
          removeRequirement: toFullFlagMap(skill.copyFlags.removeRequirement, REV_REMOVE_REQUIREMENT),
        }
      : base?.copyFlags,
    noNearNpc: skill.noNearNpc
      ? { additionalRange: skill.noNearNpc.additionalRange ?? 0, type: toFullFlagMap(skill.noNearNpc.type, REV_NONEAR_TYPE) }
      : base?.noNearNpc,
    castCancel: skill.interruptible,
    castDefenseReduction: skill.castDefenseReduction ?? 0,
    castTime: perLevelField(skill.castTimeMs.variable, "castTime"),
    afterCastActDelay: perLevelField(skill.afterCastDelayMs, "afterCastActDelay"),
    afterCastWalkDelay: perLevelField(skill.afterCastWalkDelayMs, "afterCastWalkDelay"),
    duration1: perLevelField(skill.durationMs, "duration1"),
    duration2: perLevelField(skill.duration2Ms, "duration2"),
    cooldown: perLevelField(skill.cooldownMs, "cooldown"),
    fixedCastTime: perLevelField(skill.castTimeMs.fixed, "fixedCastTime"),
    castTimeFlags: toFullFlagMap(skill.castTimeFlags, REV_CAST_FLAGS),
    castDelayFlags: toFullFlagMap(skill.castDelayFlags, REV_CAST_FLAGS),
    requires: requiresOut,
    unit: unitOut,
    status: skill.appliedStatuses[0]?.statusId.toUpperCase() ?? base?.status,
  };
  // Type: derivado junto de TargetType a partir de damageNature (BF_), não tem mapa reverso próprio de type/target
  entry.type = skill.damageNature === "none" ? "None" : skill.damageNature === "weapon" ? "Weapon" : skill.damageNature === "magic" ? "Magic" : "Misc";

  if (skill.damageFormula) {
    warnings.push("damageFormula não tem representação em skill_db.yml (fórmula de dano é C++ em battle.cpp) — não gravado");
  }
  if (skill.appliedStatuses.length > 1) {
    warnings.push(`appliedStatuses tem ${skill.appliedStatuses.length} entradas, mas skill_db.yml só representa UMA (Status) — só a primeira foi gravada`);
  }
  if (skill.appliedStatuses[0] && (skill.appliedStatuses[0].chance !== 100 || skill.appliedStatuses[0].magnitude !== undefined)) {
    warnings.push("chance/magnitude do status aplicado não têm campo em skill_db.yml (vivem em battle.cpp) — não gravados");
  }

  return { entry, warnings };
}
