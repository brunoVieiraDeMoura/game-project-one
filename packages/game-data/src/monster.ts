import { z } from "zod";
import { BaseStatsSchema, ElementSchema, RaceSchema, SizeSchema } from "./common";

/**
 * Monster schema (soul.txt §5.4). Sourced from rAthena db/re/mob_db.yml +
 * spawn lines listed in rathena/npc/re/scripts_monsters.conf.
 *
 * Renewal semantics: `attack` = base ATK (yml Attack), `magicAttack` = base
 * MATK (yml Attack2). Drop rates stored as % floats (0-100) — original
 * rAthena rate is n/10000. Modes/RaceGroups become snake_case string arrays
 * (no bitmasks). `ai` keeps the raw Aegis code; `aiMode`/`chasesAttacker`
 * are derived from rathena/doc/mob_db_mode_list.txt's code table.
 */

export const MonsterAiModeSchema = z.enum(["passive", "aggressive", "assist", "looter", "plant"]);
export const MonsterClassSchema = z.enum(["normal", "boss", "guardian", "battlefield", "event"]);

export const MonsterDropSchema = z.object({
  itemId: z.number().int().positive(),
  /** chance in % (0-100). rAthena stores n/10000 — converted at migration. */
  rate: z.number().min(0).max(100),
  stealProtected: z.boolean().default(false),
  randomOptionGroup: z.string().optional(),
  /** rAthena drop slot index (used by scripts to overwrite specific slots) */
  index: z.number().int().optional(),
});

export const MonsterSkillUseSchema = z.object({
  skillId: z.number().int().positive(),
  level: z.number().int().positive(),
  /** rAthena mob_skill_db condition, e.g. "myhpltmaxrate 30" — kept structured */
  condition: z.object({
    kind: z.string(), // e.g. "hp_below_percent", "always", "on_attack"
    value: z.number().optional(),
    needsReview: z.boolean().default(false),
    legacySource: z.string().optional(),
  }),
  chance: z.number().min(0).max(100).default(100),
  castTimeMs: z.number().int().nonnegative().default(0),
  cooldownMs: z.number().int().nonnegative().default(0),
});

export const MonsterSpawnSchema = z.object({
  mapId: z.string(),
  amount: z.number().int().positive(),
  respawnTimeMs: z.number().int().nonnegative(),
  /** random extra respawn delay (rAthena delay2) */
  respawnVarianceMs: z.number().int().nonnegative().default(0),
  /** fixed spawn rect within the map; absent = whole map (rAthena x,y,xs,ys = 0) */
  area: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      xs: z.number().int().default(0),
      ys: z.number().int().default(0),
    })
    .optional(),
  /** spawned via boss_monster (MVP-style announce + tomb) */
  boss: z.boolean().default(false),
});

export const MonsterSchema = z.object({
  id: z.number().int().positive(),
  aegisName: z.string().min(1),
  name: z.string().min(1),
  /** 0 é legítimo (baús de tesouro, mobs de evento) */
  level: z.number().int().nonnegative(),
  hp: z.number().int().nonnegative(),
  sp: z.number().int().nonnegative().default(0),
  baseExp: z.number().int().nonnegative(),
  jobExp: z.number().int().nonnegative(),
  mvpExp: z.number().int().nonnegative().default(0),

  stats: BaseStatsSchema,
  attackRange: z.number().int().positive().default(1),
  skillRange: z.number().int().nonnegative().default(0),
  chaseRange: z.number().int().nonnegative().default(0),
  /** renewal base ATK (yml Attack) */
  attack: z.number().int().nonnegative(),
  /** renewal base MATK (yml Attack2) */
  magicAttack: z.number().int().nonnegative().default(0),
  defense: z.number().int().default(0),
  magicDefense: z.number().int().default(0),
  /** renewal RES/MRES */
  resistance: z.number().int().default(0),
  magicResistance: z.number().int().default(0),
  /** rAthena derives flee/hit from level+agi/dex; explicit override fields here */
  fleeOverride: z.number().int().optional(),
  hitOverride: z.number().int().optional(),

  /** movement speed: ms per cell (rAthena Speed convention, lower = faster) */
  walkSpeed: z.number().int().positive().default(200),
  attackDelayMs: z.number().int().nonnegative().default(0),
  attackMotionMs: z.number().int().nonnegative().default(0),
  clientAttackMotionMs: z.number().int().nonnegative().optional(),
  damageMotionMs: z.number().int().nonnegative().default(0),
  /** % of incoming damage actually taken (rAthena DamageTaken, default 100) */
  damageTaken: z.number().int().default(100),

  /** raw Aegis AI code from mob_db ("01".."27") — source of truth */
  ai: z.string().default("06"),
  /** readable derivation of `ai` (doc/mob_db_mode_list.txt) */
  aiMode: MonsterAiModeSchema.default("passive"),
  /** chase even when attacker leaves range — change-target chase bit of `ai` */
  chasesAttacker: z.boolean().default(false),
  class: MonsterClassSchema.default("normal"),
  /** extra behavior flags: detector, fixed_item_drop, teleport_block, ignore_melee, ... */
  modes: z.array(z.string()).default([]),
  /** secondary groups: goblin, kobold, treasure, biolab, ... */
  raceGroups: z.array(z.string()).default([]),
  groupId: z.number().int().default(0),
  title: z.string().optional(),

  race: RaceSchema,
  element: z.object({ type: ElementSchema, level: z.number().int().min(1).max(4) }),
  size: SizeSchema,

  drops: z.array(MonsterDropSchema).default([]),
  /** MVP = Modes.Mvp no rAthena (dá recompensa de MVP, imune a coma/morte instantânea) */
  mvp: z.boolean().default(false),
  mvpDrops: z.array(MonsterDropSchema).default([]),

  skills: z.array(MonsterSkillUseSchema).default([]),
  spawns: z.array(MonsterSpawnSchema).default([]),
});
export type Monster = z.infer<typeof MonsterSchema>;
export type MonsterDrop = z.infer<typeof MonsterDropSchema>;
export type MonsterSpawn = z.infer<typeof MonsterSpawnSchema>;
