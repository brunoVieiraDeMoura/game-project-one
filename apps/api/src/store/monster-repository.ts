import type { Element, Monster } from "@ragnarok/game-data";

export interface MonsterListQuery {
  page: number;
  pageSize: number;
  /** name/aegisName substring or numeric id */
  search?: string | undefined;
  /** consulta reversa "quem dropa X": filtra monstros que dropam este item (drops ou mvpDrops) */
  dropsItem?: number | undefined;
  levelMin?: number | undefined;
  levelMax?: number | undefined;
  element?: Element | undefined;
}

export interface MonsterListResult {
  monsters: Monster[];
  total: number;
  page: number;
  pageSize: number;
}

/** Storage abstraction for the Monsters module — same pattern as ItemRepository. */
export interface MonsterRepository {
  list(query: MonsterListQuery): Promise<MonsterListResult>;
  get(id: number): Promise<Monster | undefined>;
  create(monster: Monster): Promise<Monster>;
  update(id: number, monster: Monster): Promise<Monster | undefined>;
  remove(id: number): Promise<boolean>;
}
