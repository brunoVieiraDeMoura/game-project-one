import type { StatusEffectDef } from "@ragnarok/game-data";

export interface StatusListQuery {
  page: number;
  pageSize: number;
  /** id/name substring filter */
  search?: string | undefined;
}

export interface StatusListResult {
  statuses: StatusEffectDef[];
  total: number;
  page: number;
  pageSize: number;
}

/** Storage abstraction for the status catalog (soul.txt §5.3 dropdowns). */
export interface StatusRepository {
  list(query: StatusListQuery): Promise<StatusListResult>;
  get(id: string): Promise<StatusEffectDef | undefined>;
  create(status: StatusEffectDef): Promise<StatusEffectDef>;
  update(id: string, status: StatusEffectDef): Promise<StatusEffectDef | undefined>;
  remove(id: string): Promise<boolean>;
}
