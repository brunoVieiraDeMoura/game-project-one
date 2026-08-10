import { z } from "zod";
import { buildCaseInsensitiveLookup, type CaseInsensitiveLookup } from "./case-insensitive-lookup";

/**
 * Formato OFICIAL de `status.yml` do rAthena (STATUS_DB v4) — schema-first,
 * lido de `rathena/db/re/status.yml` (1.019 entradas) +
 * `rathena/src/map/status.cpp` (`StatusDatabase::parseBodyNode`,
 * status.cpp:15882-16376) + `status.hpp` (enums, struct), não inferido.
 *
 * `db/status.yml` (dispatcher) tem UM slot de import só
 * (`db/import/status.yml`, `db/status.yml:47`) — sem a armadilha de Classes
 * (lá eram 4 arquivos-base mesclados num import comum); aqui os dois lados
 * já batem 1:1, igual Skills.
 *
 * **Achado que muda o schema do projeto**: os 6 campos aditivos
 * (`States`/`CalcFlags`/`Opt2`/`Opt3`/`Options`/`Flags`) e os 4 vetores
 * push/erase (`Fail`/`EndOnStart`/`EndReturn`/`EndOnEnd`) são
 * `Record<string,boolean>`, nunca array — a leitura ATUAL do projeto
 * (`tools/legacy-migration/src/mappings.ts: flagArray`) descarta toda
 * chave com valor `false`, que no rAthena significa "desligar" (mesma regra
 * aditiva de `Flags`/`Unit.Flag` em skill_db.yml), não "ausente". Nos dados
 * de `db/re/status.yml` não há NENHUM `false` (grep confirma) — é um buraco
 * LATENTE, mas o gate de round-trip exige captura de 100% do formato,
 * exercitado ou não pelos dados de estoque.
 *
 * **Resolução de nome é CASE-INSENSITIVE** (`script_get_constant` faz
 * `strcasecmp`, script.cpp:690-699 — mesma armadilha de `Unit.Id` em Skills
 * e `BaseASPD` em Classes). Confirmado nos dados: 1.019 valores de
 * `Status:` vêm em grafias inconsistentes (`Stone`, `Twohandquicken`,
 * `Encpoison` — só 9 em ALL-CAPS). Infra compartilhada
 * (`case-insensitive-lookup.ts` + `tools/legacy-migration/src/
 * rathena-enum.ts`, leia1.txt 2026-08-07) substitui o que Skills/Classes
 * fizeram ad-hoc.
 *
 * **Catálogo grande demais pra lista fechada**: `Status`/`Fail`/
 * `EndOnStart`/`EndReturn`/`EndOnEnd` resolvem contra `enum sc_type`
 * (status.hpp:233, **1.028** valores) e `Icon` contra `enum efst_type`
 * (status.hpp:1453, **1.472** valores) — copiar à mão seria "por tentativa
 * e erro". Mesma decisão de `Jobs`/`Inherit` em `job-stats-yaml.ts`: ficam
 * STRING LIVRE no Parser; quem valida contra o catálogo real de status é o
 * Mapper (próxima fase), que tem acesso à lista migrada.
 *
 * Os SEIS enums de flag pequenos (`SCS_`/`SCB_`/`OPT1_`/`OPT2_`/`OPT3_`/
 * `OPTION_`/`SCF_`) são pequenos o bastante pra lista fechada VERIFICADA
 * (extraída via `parseCppEnumSuffixes`, não copiada de memória) — mesmo
 * padrão de `SKILL_DB_UNIT_ID_UPPER` em Skills.
 *
 * `CalcFlags.All: true` é caso especial tratado ANTES do loop normal em
 * `status.cpp:15989-15999` (liga/desliga TODOS os `SCB_*` via
 * `getSCB_ALL()`) — não é membro de `enum e_scb_flag`, mas é usado de
 * verdade em 5 entradas reais (grep confirma); entra na lista de chaves
 * válidas de `CalcFlags` à parte.
 *
 * `Options` exclui as chaves COMPOSTAS (`Cart`/`Dragon`/`Costume` —
 * `OPTION_CART`/`OPTION_DRAGON`/`OPTION_COSTUME` são uniões calculadas em
 * C++, nunca membros que o YAML declara) — confirmado por grep: nenhuma das
 * 1.019 entradas usa essas três chaves.
 *
 * `Script` é preservado LITERALMENTE como string crua — nenhum parsing ou
 * reescrita nesta camada (mesma disciplina de `damageFormula` em Skills:
 * campo tipado é trabalho do Mapper, se algum dia precisar; o Parser nunca
 * perde o texto original).
 *
 * **Onde a canonização (requisito 4 do leia1.txt) se aplica**: só nos SEIS
 * enums pequenos, porque só ali existe uma lista COMPLETA e verificada pra
 * canonizar contra — `.transform()` no Zod já deixa o valor guardado na
 * grafia do enum em C++ (`STONE`, não `Stone`), então o Writer nunca
 * resolve isso de novo. `Status`/`Icon`/`Fail`/`EndOnStart`/`EndReturn`/
 * `EndOnEnd` (catálogos de 1.028/1.472) continuam string livre — canonizar
 * exigiria a lista inteira verificada, que esta auditoria não fez (mesma
 * fronteira que `Jobs`/`Inherit` em Classes já cruzou); a normalização
 * desses cinco fica pro Mapper, que resolve contra o catálogo migrado de
 * verdade, não contra um enum copiado à mão.
 */

const STATE_NAMES = [
  "NOMOVECOND", "NOMOVE", "NOPICKITEMCOND", "NOPICKITEM", "NODROPITEMCOND",
  "NODROPITEM", "NOCASTCOND", "NOCAST", "NOCHAT", "NOCHATCOND", "NOEQUIPITEM",
  "NOEQUIPITEMCOND", "NOUNEQUIPITEM", "NOUNEQUIPITEMCOND", "NOCONSUMEITEM",
  "NOCONSUMEITEMCOND", "NOATTACK", "NOATTACKCOND", "NOWARP", "NOWARPCOND",
  "NODEATHPENALTY", "NODEATHPENALTYCOND", "NOINTERACT", "NOINTERACTCOND",
] as const;

const CALC_FLAG_NAMES = [
  "BASE", "MAXHP", "MAXSP", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "BATK",
  "WATK", "MATK", "HIT", "FLEE", "DEF", "DEF2", "MDEF", "MDEF2", "SPEED",
  "ASPD", "DSPD", "CRI", "FLEE2", "ATK_ELE", "DEF_ELE", "MODE", "SIZE",
  "RACE", "RANGE", "REGEN", "MAXAP", "POW", "STA", "WIS", "SPL", "CON",
  "CRT", "PATK", "SMATK", "RES", "MRES", "HPLUS", "CRATE", "DYE",
  "All", // especial (status.cpp:15989), não membro de e_scb_flag — ver comentário do módulo
] as const;

const OPT1_NAMES = ["STONE", "FREEZE", "STUN", "SLEEP", "STONEWAIT", "BURNING", "IMPRISON"] as const;

const OPT2_NAMES = ["POISON", "CURSE", "SILENCE", "CONFUSION", "BLIND", "ANGELUS", "BLEEDING", "DPOISON", "FEAR"] as const;

const OPT3_NAMES = [
  "QUICKEN", "OVERTHRUST", "ENERGYCOAT", "EXPLOSIONSPIRITS", "STEELBODY",
  "BLADESTOP", "AURABLADE", "BERSERK", "LIGHTBLADE", "MOONLIT", "MARIONETTE",
  "ASSUMPTIO", "WARM", "KAITE", "BUNSIN", "SOULLINK", "UNDEAD", "CONTRACT",
] as const;

/** Compostas (`Cart`/`Dragon`/`Costume`) excluídas de propósito — ver comentário do módulo. */
const OPTION_NAMES = [
  "SIGHT", "HIDE", "CLOAK", "CART1", "FALCON", "RIDING", "INVISIBLE", "CART2",
  "CART3", "CART4", "CART5", "ORCISH", "WEDDING", "RUWACH", "CHASEWALK",
  "FLYING", "XMAS", "TRANSFORM", "SUMMER", "DRAGON1", "WUG", "WUGRIDER",
  "MADOGEAR", "DRAGON2", "DRAGON3", "DRAGON4", "DRAGON5", "HANBOK",
  "OKTOBERFEST", "SUMMER2",
] as const;

const FLAG_NAMES = [
  "BLEFFECT", "DISPLAYPC", "NOCLEARBUFF", "NOREMOVEONDEAD", "NODISPELL",
  "NOCLEARANCE", "NOBANISHINGBUSTER", "NOSAVE", "NOSAVEINFINITE",
  "REMOVEONDAMAGED", "REMOVEONREFRESH", "REMOVEONLUXANIMA", "STOPATTACKING",
  "STOPCASTING", "STOPWALKING", "BOSSRESIST", "MVPRESIST", "SETSTAND",
  "FAILEDMADO", "DEBUFF", "REMOVEONCHANGEMAP", "REMOVEONMAPWARP",
  "REMOVECHEMICALPROTECT", "OVERLAPIGNORELEVEL", "SENDOPTION", "ONTOUCH",
  "UNITMOVE", "NONPLAYER", "SENDLOOK", "DISPLAYNPC", "REQUIREWEAPON",
  "REQUIRESHIELD", "MOBLOSETARGET", "REMOVEELEMENTALOPTION",
  "SUPERNOVICEANGEL", "TAEKWONANGEL", "MADOCANCEL", "MADOENDCANCEL",
  "RESTARTONMAPWARP", "SPREADEFFECT", "SENDVAL1", "SENDVAL2", "SENDVAL3",
  "NOFORCEDEND", "NOWARNING", "REMOVEONUNEQUIP", "REMOVEONUNEQUIPWEAPON",
  "REMOVEONUNEQUIPARMOR", "REMOVEONHERMODE", "REQUIRENOWEAPON",
  "REMOVEFROMHOMONWARP", "REMOVEFROMHOMONMAPWARP",
] as const;

export const STATUS_STATE_LOOKUP = buildCaseInsensitiveLookup(STATE_NAMES);
export const STATUS_CALC_FLAG_LOOKUP = buildCaseInsensitiveLookup(CALC_FLAG_NAMES);
export const STATUS_OPT1_LOOKUP = buildCaseInsensitiveLookup(OPT1_NAMES);
export const STATUS_OPT2_LOOKUP = buildCaseInsensitiveLookup(OPT2_NAMES);
export const STATUS_OPT3_LOOKUP = buildCaseInsensitiveLookup(OPT3_NAMES);
export const STATUS_OPTION_LOOKUP = buildCaseInsensitiveLookup(OPTION_NAMES);
export const STATUS_FLAG_LOOKUP = buildCaseInsensitiveLookup(FLAG_NAMES);

/** `z.record` cujas CHAVES precisam bater (case-insensitive) com uma das
 * `validNames` — é o formato real de `States`/`CalcFlags`/`Opt2`/`Opt3`/
 * `Options`/`Flags` (mapa de flag → liga/desliga), preservando `false`.
 * A validação aceita qualquer grafia reconhecida (case-insensitive, requisito
 * 3 do leia1.txt), mas o valor GUARDADO já sai NORMALIZADO pra grafia
 * canônica (o sufixo do enum em C++, requisito 4) — o Writer nunca precisa
 * resolver isso de novo, só reemitir o que o Parser já canonizou. Se o
 * mesmo YAML (malformado) tiver duas grafias da MESMA flag como chaves
 * distintas, a canonização as funde — cenário que nunca ocorre nos dados
 * reais (toda entrada tem cada flag no máximo uma vez). */
function flagRecord(lookup: CaseInsensitiveLookup) {
  return z
    .record(z.string(), z.boolean())
    .refine(
      (obj) => Object.keys(obj).every((k) => lookup.isValid(k)),
      (obj) => ({
        message: `chave desconhecida: ${Object.keys(obj).find((k) => !lookup.isValid(k))}`,
      }),
    )
    .transform((obj) => {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(obj)) out[lookup.canonicalOf(k) ?? k] = v;
      return out;
    });
}

/** `Fail`/`EndOnStart`/`EndReturn`/`EndOnEnd`: mapa de nome de STATUS
 * (`SC_*`, catálogo com 1.028 valores — grande demais pra lista fechada
 * verificada nesta auditoria, mesma decisão de `Jobs` em Classes) →
 * liga/desliga. Preserva `false` (vetor push/erase, status.cpp:16226-16352). */
const statusIdFlagRecord = z.record(z.string(), z.boolean());

export const RawStatusSchema = z.object({
  Status: z.string().min(1),
  Icon: z.string().optional(),
  DurationLookup: z.string().optional(),
  States: flagRecord(STATUS_STATE_LOOKUP).optional(),
  CalcFlags: flagRecord(STATUS_CALC_FLAG_LOOKUP).optional(),
  Opt1: z
    .string()
    .refine((v) => STATUS_OPT1_LOOKUP.isValid(v), (v) => ({ message: `Opt1 desconhecido: ${v}` }))
    .transform((v) => STATUS_OPT1_LOOKUP.canonicalOf(v)!)
    .optional(),
  Opt2: flagRecord(STATUS_OPT2_LOOKUP).optional(),
  Opt3: flagRecord(STATUS_OPT3_LOOKUP).optional(),
  Options: flagRecord(STATUS_OPTION_LOOKUP).optional(),
  Flags: flagRecord(STATUS_FLAG_LOOKUP).optional(),
  MinRate: z.number().int().min(0).max(65535).optional(),
  MinDuration: z.number().int().optional(),
  Fail: statusIdFlagRecord.optional(),
  EndOnStart: statusIdFlagRecord.optional(),
  EndReturn: statusIdFlagRecord.optional(),
  EndOnEnd: statusIdFlagRecord.optional(),
  /** texto CRU do script RO, nunca parseado/reescrito nesta camada. */
  Script: z.string().optional(),
});
export type RawStatus = z.infer<typeof RawStatusSchema>;

export const StatusDocSchema = z.object({
  Header: z.object({ Type: z.literal("STATUS_DB"), Version: z.number().int() }),
  Body: z.array(RawStatusSchema).default([]),
});
export type StatusDoc = z.infer<typeof StatusDocSchema>;
