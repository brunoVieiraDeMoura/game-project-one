import type { JobClass } from "@ragnarok/game-data";

export interface JobClassListQuery {
  page: number;
  pageSize: number;
  /** name substring filter */
  search?: string | undefined;
}

export interface JobClassListResult {
  jobClasses: JobClass[];
  total: number;
  page: number;
  pageSize: number;
}

/** Storage abstraction for the Classes module — same pattern as ItemRepository. */
export interface JobClassRepository {
  list(query: JobClassListQuery): Promise<JobClassListResult>;
  get(id: number): Promise<JobClass | undefined>;
  create(jobClass: JobClass): Promise<JobClass>;
  update(id: number, jobClass: JobClass): Promise<JobClass | undefined>;
  remove(id: number): Promise<boolean>;
}
