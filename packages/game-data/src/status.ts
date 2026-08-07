import { z } from "zod";
import { EffectListSchema } from "./effects";

/**
 * Status/buff/debuff catalog (rAthena db/status.yml). Skills and items
 * reference these by id via dropdown in the admin (soul.txt §5.3 — never
 * free-text). `id` is the rAthena SC name lowercased (e.g. "stone",
 * "cocktail_warg_blood"), matching the `statusId` already emitted by the
 * item migration.
 *
 * rAthena's flag groups (States/CalcFlags/Flags/Opt1-3/Options) are kept as
 * readable snake_case string arrays — same policy as everywhere else: no
 * bitmasks in the new schema. The status Script field goes through the same
 * typed-effect pipeline as item scripts (recognized → effects, rest →
 * unmappedEffects, never dropped).
 */

export const StatusCategorySchema = z.enum(["buff", "debuff", "neutral"]);
export type StatusCategory = z.infer<typeof StatusCategorySchema>;

/**
 * Grupo FUNCIONAL — o que o status FAZ, eixo ortogonal à categoria
 * (buff/debuff/neutro). Cobre a reorganização pedida pra tela de statuses:
 * Controle, Estados especiais, Velocidade, Defesa, Ataque, Elemento,
 * Visibilidade, Transformação. Regra de derivação determinística documentada
 * em tools/legacy-migration/src/migrate-statuses.ts — "outro" é o resultado
 * HONESTO pra maioria dos registros (a maior parte dos status do rAthena não
 * mexe em calcFlags/states/opt1/options; o efeito real só existe em C++,
 * `status.cpp`), não um bug de classificação. `buff`/`debuff` aqui nunca são
 * derivados automaticamente — existem só pra um admin poder usar este MESMO
 * campo como atalho de categorização manual, se quiser.
 */
export const StatusGroupSchema = z.enum([
  "buff",
  "debuff",
  "transformacao",
  "estado_especial",
  "controle",
  "velocidade",
  "defesa",
  "ataque",
  "elemento",
  "visibilidade",
  "outro",
]);
export type StatusGroup = z.infer<typeof StatusGroupSchema>;

export const StatusEffectDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** debuff = rAthena Flags.Debuff; "neutral" = unclassified (admin can promote to buff) */
  category: StatusCategorySchema.default("neutral"),

  /** player-state locks while active: no_move, no_cast, no_attack, no_pick_item, no_consume_item, no_equip_item, no_interact */
  states: z.array(z.string()).default([]),
  /** which derived stats get recalculated while active: def, mdef, speed, aspd, ... */
  calcFlags: z.array(z.string()).default([]),
  /** exclusive client overlay effect (stone, freeze, stun, sleep, ...) — at most one active */
  opt1: z.string().optional(),
  /** stackable client effects (poison, curse, silence, ...) */
  opt2: z.array(z.string()).default([]),
  opt3: z.array(z.string()).default([]),
  options: z.array(z.string()).default([]),
  /** behavior flags: send_option, boss_resist, no_dispell, no_save, remove_on_damaged, debuff, ... */
  flags: z.array(z.string()).default([]),

  /** aegis name of the skill whose per-level duration this status uses (rAthena DurationLookup) */
  durationLookupSkill: z.string().optional(),
  /** fixed default duration; skills/items can override */
  defaultDurationMs: z.number().int().nonnegative().optional(),
  /** minimum success rate after resistance reduction (10000 = 100%) */
  minRate: z.number().int().optional(),
  /** minimum duration in ms after resistance reduction */
  minDurationMs: z.number().int().optional(),

  /** status ids (this catalog) that block this status from activating */
  failOn: z.array(z.string()).default([]),
  /** status ids ended when this one starts */
  endOnStart: z.array(z.string()).default([]),
  /** status ids ended when this one starts, without applying their effect */
  endReturn: z.array(z.string()).default([]),
  /** status ids ended when this one ends */
  endOnEnd: z.array(z.string()).default([]),

  /** typed effects parsed from the rAthena Script field (unrecognized fragments flagged, never dropped) */
  effects: EffectListSchema.optional(),

  icon: z.string().optional(),
  description: z.string().optional(),
  /** grupo funcional pro filtro/painel de detalhe da dashboard */
  group: StatusGroupSchema.default("outro"),
  /** val1..val4 do rathena/doc/status_change.txt, ex. "1: Skill Level" — índice no texto, val ausente não desloca os outros */
  params: z.array(z.string()).default([]),
});
export type StatusEffectDef = z.infer<typeof StatusEffectDefSchema>;
