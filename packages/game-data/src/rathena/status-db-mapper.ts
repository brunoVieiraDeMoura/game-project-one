import type { StatusEffectDef } from "../status";
import { type RawStatus } from "./status-db-yaml";

/**
 * Mapper — `StatusEffectDef` (schema da dashboard, `string[]` — mesma
 * convenção de Skills/Items, `TokenListField` no admin) ↔ `RawStatus`
 * (schema oficial, `Record<string,boolean>`). Reusa EXCLUSIVAMENTE a infra
 * compartilhada de `case-insensitive-lookup.ts` (leia1.txt, aprovação
 * Mapper/Validator/Writer de Status, 2026-08-07) — nenhuma tabela nova de
 * resolução fora dela.
 *
 * **Por que `StatusEffectDefSchema` continua `string[]`**: é o mesmo
 * schema que `ItemForm`/`SkillForm`/`JobClassForm` usam com
 * `TokenListField` — mudar pra `Record<string,boolean>` quebraria a tela
 * inteira sem necessidade. "Preservar como Record durante todo o pipeline"
 * (leia1.txt) vale pro que fica DENTRO do Parser/Mapper (nunca passa por um
 * `string[]` intermediário que jogaria `false` fora) — a conversão pra
 * array só acontece na fronteira final com o schema da dashboard, e nesse
 * ponto o `Record` já fez seu trabalho (a lista final que sobra é só o
 * conjunto de `true`s, igual sempre foi).
 *
 * **Grafia canônica dos 7 enums pequenos**: as tabelas `*_READABLE` abaixo
 * saem de UMA varredura de `db/re/status.yml` (a mesma fonte, não um
 * palpite) — pra cada nome CANÔNICO (`STONE`), qual `toSnake` da grafia
 * REAL mais comum nos dados (`stone`). Constantes que NUNCA aparecem nos
 * 1.019 registros (ex. `SCS_NOATTACKCOND`) caem no fallback
 * `canonical.toLowerCase()` — sem separador de palavra pra derivar (mesma
 * limitação documentada em `status-db-yaml.ts`), mas nunca ficam sem valor.
 *
 * **`Status`/`Fail`/`EndOnStart`/`EndReturn`/`EndOnEnd`/`Icon`/
 * `DurationLookup` não têm tabela de resolução**: os catálogos são grandes
 * demais (1.028 `SC_*`, 1.472 `EFST_*` — mesma fronteira que `Jobs` cruzou
 * em Classes) e, ao contrário dos 7 enums pequenos, a GRAFIA não importa
 * pro servidor (`script_get_constant` é case-insensitive — reescrever
 * `"Stone"` como `"STONE"` funciona idêntico). O Writer usa `titleCase()`
 * (mecânico, sempre válido, nunca reivindicado como "a grafia original")
 * pra manter o arquivo legível, não pra fingir precisão que a auditoria não
 * verificou.
 */

const STATE_READABLE: Record<string, string> = {
  NOMOVE: "no_move", NOCAST: "no_cast", NOATTACK: "no_attack", NOMOVECOND: "no_move_cond",
  NOPICKITEM: "no_pick_item", NOCONSUMEITEM: "no_consume_item", NOINTERACT: "no_interact",
  NODROPITEM: "no_drop_item", NOPICKITEMCOND: "no_pick_item_cond", NODROPITEMCOND: "no_drop_item_cond",
  NOCHATCOND: "no_chat_cond", NOCONSUMEITEMCOND: "no_consume_item_cond", NODEATHPENALTY: "no_death_penalty",
  NOCHAT: "no_chat", NOEQUIPITEM: "no_equip_item", NOUNEQUIPITEM: "no_un_equip_item",
  NOCASTCOND: "no_cast_cond", NOWARP: "no_warp",
};

const CALC_FLAG_READABLE: Record<string, string> = {
  DEF_ELE: "def_ele", DEF: "def", MDEF: "mdef", DEF2: "def2", REGEN: "regen", LUK: "luk", BATK: "batk",
  WATK: "watk", SPEED: "speed", HIT: "hit", FLEE: "flee", DSPD: "dspd", ASPD: "aspd", CRI: "cri",
  AGI: "agi", DEX: "dex", ATK_ELE: "atk_ele", MAXHP: "max_hp", STR: "str", INT: "int", MATK: "matk",
  VIT: "vit", All: "all", FLEE2: "flee2", MODE: "mode", MAXSP: "max_sp", MDEF2: "mdef2", DYE: "dye",
  CRATE: "crate", PATK: "patk", SMATK: "smatk", STA: "sta", WIS: "wis", SPL: "spl", POW: "pow",
  CON: "con", CRT: "crt", RES: "res", MRES: "mres", HPLUS: "hplus",
};

const OPT1_READABLE: Record<string, string> = {
  STONE: "stone", STONEWAIT: "stone_wait", FREEZE: "freeze", STUN: "stun", SLEEP: "sleep",
  BURNING: "burning", IMPRISON: "imprison",
};

const OPT2_READABLE: Record<string, string> = {
  POISON: "poison", CURSE: "curse", SILENCE: "silence", CONFUSION: "confusion", BLIND: "blind",
  BLEEDING: "bleeding", DPOISON: "dpoison", ANGELUS: "angelus", FEAR: "fear",
};

const OPT3_READABLE: Record<string, string> = {
  QUICKEN: "quicken", OVERTHRUST: "over_thrust", ENERGYCOAT: "energy_coat",
  EXPLOSIONSPIRITS: "explosion_spirits", BLADESTOP: "blade_stop", AURABLADE: "aura_blade",
  BERSERK: "berserk", ASSUMPTIO: "assumptio", MARIONETTE: "marionette", UNDEAD: "undead",
  STEELBODY: "steel_body", SOULLINK: "soul_link", WARM: "warm", KAITE: "kaite", BUNSIN: "bunsin",
  LIGHTBLADE: "light_blade", MOONLIT: "moonlit", CONTRACT: "contract",
};

const OPTION_READABLE: Record<string, string> = {
  HIDE: "hide", CLOAK: "cloak", WEDDING: "wedding", SIGHT: "sight", RUWACH: "ruwach",
  CHASEWALK: "chase_walk", ORCISH: "orcish", XMAS: "xmas", FLYING: "flying", SUMMER: "summer",
  HANBOK: "hanbok", OKTOBERFEST: "oktoberfest", INVISIBLE: "invisible", SUMMER2: "summer2",
  CART1: "cart1", CART2: "cart2", CART3: "cart3", CART4: "cart4", CART5: "cart5", FALCON: "falcon",
  RIDING: "riding", TRANSFORM: "transform", DRAGON1: "dragon1", WUG: "wug", WUGRIDER: "wug_rider",
  MADOGEAR: "madogear", DRAGON2: "dragon2", DRAGON3: "dragon3", DRAGON4: "dragon4", DRAGON5: "dragon5",
};

const FLAG_READABLE: Record<string, string> = {
  SENDOPTION: "send_option", BOSSRESIST: "boss_resist", STOPATTACKING: "stop_attacking",
  STOPCASTING: "stop_casting", REMOVEONDAMAGED: "remove_on_damaged", SPREADEFFECT: "spread_effect",
  STOPWALKING: "stop_walking", NOSAVE: "no_save", NOCLEARANCE: "no_clearance",
  REMOVEONHERMODE: "remove_on_hermode", DEBUFF: "debuff", NOSAVEINFINITE: "no_save_infinite",
  NOREMOVEONDEAD: "no_remove_on_dead", REQUIREWEAPON: "require_weapon", FAILEDMADO: "failed_mado",
  ONTOUCH: "on_touch", REMOVEONCHANGEMAP: "remove_on_change_map", NOBANISHINGBUSTER: "no_banishing_buster",
  NODISPELL: "no_dispell", REMOVEONMAPWARP: "remove_on_map_warp",
  REMOVEONUNEQUIPWEAPON: "remove_on_unequip_weapon", TAEKWONANGEL: "taekwon_angel",
  SUPERNOVICEANGEL: "super_novice_angel", MADOCANCEL: "mado_cancel", NOCLEARBUFF: "no_clearbuff",
  NOFORCEDEND: "no_forced_end", OVERLAPIGNORELEVEL: "overlap_ignore_level", SENDLOOK: "send_look",
  REMOVECHEMICALPROTECT: "remove_chemical_protect", REQUIRESHIELD: "require_shield",
  NOWARNING: "no_warning", MOBLOSETARGET: "mob_lose_target", REQUIRENOWEAPON: "require_no_weapon",
  MVPRESIST: "mvp_resist", NONPLAYER: "non_player", RESTARTONMAPWARP: "restart_on_map_warp",
  REMOVEFROMHOMONMAPWARP: "remove_from_hom_on_map_warp", SENDVAL1: "send_val1",
  REMOVEONUNEQUIPARMOR: "remove_on_unequip_armor", BLEFFECT: "bl_effect",
  REMOVEONREFRESH: "remove_on_refresh", REMOVEONLUXANIMA: "remove_on_lux_anima",
  DISPLAYPC: "display_pc", SENDVAL2: "send_val2", SETSTAND: "set_stand",
  MADOENDCANCEL: "mado_end_cancel", SENDVAL3: "send_val3",
  REMOVEELEMENTALOPTION: "remove_elemental_option", REMOVEONUNEQUIP: "remove_on_unequip",
  UNITMOVE: "unit_move", DISPLAYNPC: "display_npc", REMOVEFROMHOMONWARP: "remove_from_homon_warp",
};

function readableOf(table: Record<string, string>, canonical: string): string {
  return table[canonical] ?? canonical.toLowerCase();
}

function reverseLookup(table: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [canonical, readable] of Object.entries(table)) out.set(readable.toLowerCase(), canonical);
  return out;
}
const REV_STATE = reverseLookup(STATE_READABLE);
const REV_CALC_FLAG = reverseLookup(CALC_FLAG_READABLE);
const REV_OPT1 = reverseLookup(OPT1_READABLE);
const REV_OPT2 = reverseLookup(OPT2_READABLE);
const REV_OPT3 = reverseLookup(OPT3_READABLE);
const REV_OPTION = reverseLookup(OPTION_READABLE);
const REV_FLAG = reverseLookup(FLAG_READABLE);

/** admin → id de catálogo (`no_move`) pra grafia canônica (`NOMOVE`); nomes
 * fora da tabela reversa (o admin digitou algo não reconhecido) são
 * descartados com aviso — nunca gravados como lixo no YAML. */
function toCanonicalSet(reverse: Map<string, string>, values: string[], warnings: string[], field: string): Set<string> {
  const out = new Set<string>();
  for (const v of values) {
    const canonical = reverse.get(v.toLowerCase());
    if (!canonical) {
      warnings.push(`${field}: "${v}" não reconhecido, ignorado`);
      continue;
    }
    out.add(canonical);
  }
  return out;
}

/** Emite o CONJUNTO FECHADO inteiro do enum pequeno como true/false — campo
 * aditivo é autoritativo (mesma regra de Skills `Flags`/`Unit.Flag`), e
 * como a lista é FINITA e conhecida, não precisa de `base` pra preservar
 * nada (o admin já vê e edita o conjunto completo no `TokenListField`). */
function fullSmallEnumRecord(readableTable: Record<string, string>, reverse: Map<string, string>, values: string[], warnings: string[], field: string): Record<string, boolean> {
  const wanted = toCanonicalSet(reverse, values, warnings, field);
  const out: Record<string, boolean> = {};
  for (const canonical of Object.keys(readableTable)) out[canonical] = wanted.has(canonical);
  return out;
}

/** `Fail`/`EndOnStart`/`EndReturn`/`EndOnEnd`: catálogo de status
 * ILIMITADO (não dá pra emitir "false" pra todo `SC_*` que não está na
 * lista, como faz `fullSmallEnumRecord`) — por isso usa `base` pra saber o
 * que JÁ estava `true` e precisa virar `false` se o admin removeu. */
function fullStatusRefRecord(values: string[], base: Record<string, boolean> | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const wantedLower = new Set(values.map((v) => v.toLowerCase()));
  for (const id of values) out[titleCase(id)] = true;
  for (const [key, was] of Object.entries(base ?? {})) {
    if (was && !wantedLower.has(key.toLowerCase())) out[key] = false;
  }
  return out;
}

/** Grafia SEMPRE válida (case-insensitive pro servidor), nunca reivindicada
 * como "a grafia original" — ver nota do módulo. */
function titleCase(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("_");
}

export interface StatusMapResult {
  entry: RawStatus;
  warnings: string[];
}

/** `base`: entrada existente do MESMO status no override atual (preserva
 * `Script` — requisito "texto bruto preservado" — e qualquer coisa que os
 * campos tipados não sabem reescrever). */
export function statusToRawEntry(status: StatusEffectDef, base?: RawStatus): StatusMapResult {
  const warnings: string[] = [];

  const states = fullSmallEnumRecord(STATE_READABLE, REV_STATE, status.states, warnings, "states");
  const calcFlags = fullSmallEnumRecord(CALC_FLAG_READABLE, REV_CALC_FLAG, status.calcFlags, warnings, "calcFlags");
  const opt2 = fullSmallEnumRecord(OPT2_READABLE, REV_OPT2, status.opt2, warnings, "opt2");
  const opt3 = fullSmallEnumRecord(OPT3_READABLE, REV_OPT3, status.opt3, warnings, "opt3");
  const options = fullSmallEnumRecord(OPTION_READABLE, REV_OPTION, status.options, warnings, "options");
  const flags = fullSmallEnumRecord(FLAG_READABLE, REV_FLAG, status.flags, warnings, "flags");

  let opt1: string | undefined;
  if (status.opt1) {
    const canonical = REV_OPT1.get(status.opt1.toLowerCase());
    if (!canonical) warnings.push(`opt1: "${status.opt1}" não reconhecido, ignorado`);
    opt1 = canonical;
  }

  const hasTypedEffects = !!status.effects && (status.effects.effects.length > 0 || status.effects.unmappedEffects.length > 0);
  if (hasTypedEffects && base?.Script) {
    warnings.push("effects tipado não é reescrito em Script — texto bruto do override existente preservado");
  } else if (hasTypedEffects && !base?.Script) {
    // achado real (não escondido): sem um override PRÉVIO que já carregasse
    // o texto cru do Script, não há de onde tirá-lo — `StatusEffectDefSchema`
    // só guarda `effects` TIPADO, nunca o texto original (mesma limitação
    // que item/skill já tinham pra Script/damageFormula não representável;
    // não é regressão nova). Na primeira gravação, Script sai AUSENTE.
    warnings.push(
      "status tem efeitos de Script mas nenhum override prévio guarda o texto bruto — Script sai ausente nesta gravação (limitação conhecida, não escondida)",
    );
  }

  const entry: RawStatus = {
    Status: titleCase(status.id),
    Icon: status.icon,
    DurationLookup: status.durationLookupSkill,
    States: states,
    CalcFlags: calcFlags,
    Opt1: opt1,
    Opt2: opt2,
    Opt3: opt3,
    Options: options,
    Flags: flags,
    MinRate: status.minRate,
    MinDuration: status.minDurationMs,
    Fail: fullStatusRefRecord(status.failOn, base?.Fail),
    EndOnStart: fullStatusRefRecord(status.endOnStart, base?.EndOnStart),
    EndReturn: fullStatusRefRecord(status.endReturn, base?.EndReturn),
    EndOnEnd: fullStatusRefRecord(status.endOnEnd, base?.EndOnEnd),
    // Script NUNCA é reescrito a partir de `effects` — preservado do override
    // anterior verbatim (requisito "texto bruto", igual damageFormula em Skills).
    Script: base?.Script,
  };

  return { entry, warnings };
}

/** Reflexo MÍNIMO do override sobre o catálogo (mesmo escopo modesto de
 * `YamlSkillRepository.applyOverride` — a lista/leitura continua vindo do
 * catálogo migrado; isto só mostra o que foi editado por cima). */
export function applyStatusOverride(status: StatusEffectDef, entry: RawStatus | undefined): StatusEffectDef {
  if (!entry) return status;
  return {
    ...status,
    icon: entry.Icon ?? status.icon,
    durationLookupSkill: entry.DurationLookup ?? status.durationLookupSkill,
    minRate: entry.MinRate ?? status.minRate,
    minDurationMs: entry.MinDuration ?? status.minDurationMs,
  };
}

export {
  STATE_READABLE, CALC_FLAG_READABLE, OPT1_READABLE, OPT2_READABLE, OPT3_READABLE, OPTION_READABLE, FLAG_READABLE,
  readableOf, titleCase,
};
