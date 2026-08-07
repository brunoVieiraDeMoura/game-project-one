import { z } from "zod";
import { BaseStatsSchema } from "./common";
import { ItemSubTypeSchema } from "./item";

/**
 * Character class/job schema (soul.txt §5.2). Sourced from rAthena
 * db/re/job_stats.yml + skill_tree.yml. Growth is stored as explicit
 * per-level tables where rAthena uses tables, plus formula params where it
 * uses formulas — migration fills whichever the source provides.
 */

export const AspdModifierSchema = z.object({
  /** "shield" = ASPD penalty applied when a shield is equipped (rAthena BaseASPD Shield entry). */
  weaponType: ItemSubTypeSchema.or(z.enum(["bare_hand", "shield"])),
  /** Base ASPD value for this class with this weapon type (rAthena BaseASPD). */
  baseAspd: z.number(),
});

export const JobClassSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  /** e.g. "novice" → "swordman" → "knight" progression reference */
  parentClassId: z.number().int().nullable().default(null),
  maxBaseLevel: z.number().int().positive(),
  maxJobLevel: z.number().int().positive(),

  /** Starting attributes. */
  baseStats: BaseStatsSchema,
  /** Stat points gained per JOB level (rAthena BonusStats). `traits` carries
   * 4th-job trait stats (pow/sta/wis/spl/con/crt) — kept verbatim, never dropped. */
  bonusStatsPerLevel: z
    .array(
      z.object({
        level: z.number().int().positive(),
        stats: BaseStatsSchema.partial(),
        traits: z.record(z.string(), z.number().int()).optional(),
      }),
    )
    .default([]),

  /** HP/SP: rAthena job_stats uses per-level tables (BaseHp/BaseSp). */
  baseHpByLevel: z.array(z.number().int()).default([]),
  baseSpByLevel: z.array(z.number().int()).default([]),
  /** Fallback growth formula params when no explicit table exists.
   * UNCLEAR-FORMULA: exact fallback growth must be validated against
   * rathena/src/map/status.cpp before use in engine-core. */
  hpGrowth: z.object({ base: z.number(), perLevel: z.number(), factor: z.number() }).optional(),
  spGrowth: z.object({ base: z.number(), perLevel: z.number(), factor: z.number() }).optional(),

  maxWeight: z.number().int().positive(),

  /** Exp necessário por nível (índice 0 = nível 1→2), de job_exp.yml. */
  baseExpByLevel: z.array(z.number()).default([]),
  jobExpByLevel: z.array(z.number()).default([]),

  allowedWeapons: z.array(ItemSubTypeSchema).default([]),
  /** Armor restriction is job-bitmask driven on the item side in rAthena;
   * kept here as an explicit allowlist for the new engine's admin editing. */
  allowedArmorTags: z.array(z.string()).default([]),

  /**
   * Esta classe's PRÓPRIA `Tree` de `skill_tree.yml` — não a lista
   * resolvida/herdada (achado da auditoria de Classes, leia1.txt
   * 2026-08-07: skill_tree-yaml.ts documenta que `Inherit` NÃO é resolvido
   * transitivamente pelo motor rAthena; quem lista os ancestrais inteiros é
   * o PRÓPRIO dado). Guardar aqui a lista já achatada (como o migrador
   * antigo fazia) tornaria o Writer incapaz de reconstruir o `Tree:` original
   * — perderia a distinção entre "esta classe ensina" e "esta classe herda
   * de X". `skillTreeInherit` é a contraparte (`Inherit:` do YAML) que falta
   * pra fechar o par. A view "efetiva" (com herdados) é um cálculo derivado
   * (helper do Mapper), nunca armazenado.
   */
  skills: z
    .array(
      z.object({
        skillId: z.number().int().positive(),
        /** 0 é um valor REAL no formato oficial (`Tree[].MaxLevel: 0`) — não
         * "aprendível no nível 0", e sim "esta classe REMOVE este skill que
         * herdaria de um ancestral" (achado ao rodar o round-trip: `Baby_Summoner`
         * usa isso de verdade). `.positive()` descartava a entrada inteira. */
        maxLevel: z.number().int().nonnegative(),
        /** prerequisite skills within the tree */
        requires: z
          .array(z.object({ skillId: z.number().int(), level: z.number().int() }))
          .default([]),
        /** `Tree[].BaseLevel`/`JobLevel` — achado da auditoria: existiam no
         * formato oficial e eram descartados em silêncio pelo schema antigo. */
        baseLevel: z.number().int().min(0).max(275).optional(),
        jobLevel: z.number().int().min(0).max(275).optional(),
        /** `Tree[].Exclude` — skill listado mas NÃO passado a subclasses via Inherit. */
        exclude: z.boolean().optional(),
      }),
    )
    .default([]),

  /** `Inherit:` de `skill_tree.yml` — ids de job de quem esta classe herda a
   * árvore (não-transitivo no motor; os dados de estoque já vêm achatados).
   * Separado de `parentClassId` (progressão de UI, um pai só) porque
   * `Inherit` aceita múltiplos (ex.: Rune_Knight herda Novice+Swordman+Knight). */
  skillTreeInherit: z.array(z.number().int().nonnegative()).default([]),

  aspdModifiers: z.array(AspdModifierSchema).default([]),
});
export type JobClass = z.infer<typeof JobClassSchema>;
