import { MonsterSchema, type Monster, type MonsterDrop } from "@ragnarok/game-data";

/**
 * MonsterSchema ↔ `monsters` + tabela filha `monster_drops`
 * (20260720000001_monsters.sql). Drops ficam em tabela filha pra permitir a
 * consulta reversa "quem dropa X" por índice (CLAUDE.md); spawns/skills são
 * jsonb.
 */

export interface MonsterRow {
  id: number;
  aegis_name: string;
  name: string;
  level: number;
  hp: number;
  sp: number;
  base_exp: number;
  job_exp: number;
  mvp_exp: number;
  stats: unknown;
  attack_range: number;
  skill_range: number;
  chase_range: number;
  attack: number;
  magic_attack: number;
  defense: number;
  magic_defense: number;
  resistance: number;
  magic_resistance: number;
  flee_override: number | null;
  hit_override: number | null;
  walk_speed: number;
  attack_delay: number;
  attack_motion: number;
  client_attack_motion: number | null;
  damage_motion: number;
  damage_taken: number;
  ai: string;
  ai_mode: string;
  chases_attacker: boolean;
  class: string;
  modes: unknown;
  race_groups: unknown;
  group_id: number;
  title: string | null;
  race: string;
  element: unknown;
  size: string;
  mvp: boolean;
  skills: unknown;
  spawns: unknown;
}

export interface MonsterDropRow {
  monster_id: number;
  item_id: number;
  rate: number;
  steal_protected: boolean;
  random_option_group: string | null;
  drop_index: number | null;
  is_mvp: boolean;
}

export function monsterToRow(m: Monster): MonsterRow {
  return {
    id: m.id,
    aegis_name: m.aegisName,
    name: m.name,
    level: m.level,
    hp: m.hp,
    sp: m.sp,
    base_exp: m.baseExp,
    job_exp: m.jobExp,
    mvp_exp: m.mvpExp,
    stats: m.stats,
    attack_range: m.attackRange,
    skill_range: m.skillRange,
    chase_range: m.chaseRange,
    attack: m.attack,
    magic_attack: m.magicAttack,
    defense: m.defense,
    magic_defense: m.magicDefense,
    resistance: m.resistance,
    magic_resistance: m.magicResistance,
    flee_override: m.fleeOverride ?? null,
    hit_override: m.hitOverride ?? null,
    walk_speed: m.walkSpeed,
    attack_delay: m.attackDelayMs,
    attack_motion: m.attackMotionMs,
    client_attack_motion: m.clientAttackMotionMs ?? null,
    damage_motion: m.damageMotionMs,
    damage_taken: m.damageTaken,
    ai: m.ai,
    ai_mode: m.aiMode,
    chases_attacker: m.chasesAttacker,
    class: m.class,
    modes: m.modes,
    race_groups: m.raceGroups,
    group_id: m.groupId ?? 0,
    title: m.title ?? null,
    race: m.race,
    element: m.element,
    size: m.size,
    mvp: m.mvp,
    skills: m.skills,
    spawns: m.spawns,
  };
}

export function monsterToDropRows(m: Monster): MonsterDropRow[] {
  const map = (drops: MonsterDrop[], isMvp: boolean): MonsterDropRow[] =>
    drops.map((d) => ({
      monster_id: m.id,
      item_id: d.itemId,
      rate: d.rate,
      steal_protected: d.stealProtected,
      random_option_group: d.randomOptionGroup ?? null,
      drop_index: d.index ?? null,
      is_mvp: isMvp,
    }));
  return [...map(m.drops, false), ...map(m.mvpDrops, true)];
}

function rowToDrop(r: MonsterDropRow): MonsterDrop {
  return {
    itemId: r.item_id,
    rate: r.rate,
    stealProtected: r.steal_protected,
    ...(r.random_option_group !== null ? { randomOptionGroup: r.random_option_group } : {}),
    ...(r.drop_index !== null ? { index: r.drop_index } : {}),
  };
}

export function rowToMonster(row: MonsterRow, dropRows: MonsterDropRow[]): Monster {
  return MonsterSchema.parse({
    id: row.id,
    aegisName: row.aegis_name,
    name: row.name,
    level: row.level,
    hp: row.hp,
    sp: row.sp,
    baseExp: row.base_exp,
    jobExp: row.job_exp,
    mvpExp: row.mvp_exp,
    stats: row.stats,
    attackRange: row.attack_range,
    skillRange: row.skill_range,
    chaseRange: row.chase_range,
    attack: row.attack,
    magicAttack: row.magic_attack,
    defense: row.defense,
    magicDefense: row.magic_defense,
    resistance: row.resistance,
    magicResistance: row.magic_resistance,
    fleeOverride: row.flee_override ?? undefined,
    hitOverride: row.hit_override ?? undefined,
    walkSpeed: row.walk_speed,
    attackDelayMs: row.attack_delay,
    attackMotionMs: row.attack_motion,
    clientAttackMotionMs: row.client_attack_motion ?? undefined,
    damageMotionMs: row.damage_motion,
    damageTaken: row.damage_taken,
    ai: row.ai,
    aiMode: row.ai_mode,
    chasesAttacker: row.chases_attacker,
    class: row.class,
    modes: row.modes,
    raceGroups: row.race_groups,
    groupId: row.group_id,
    title: row.title ?? undefined,
    race: row.race,
    element: row.element,
    size: row.size,
    drops: dropRows.filter((d) => !d.is_mvp).map(rowToDrop),
    mvp: row.mvp,
    mvpDrops: dropRows.filter((d) => d.is_mvp).map(rowToDrop),
    skills: row.skills,
    spawns: row.spawns,
  });
}
