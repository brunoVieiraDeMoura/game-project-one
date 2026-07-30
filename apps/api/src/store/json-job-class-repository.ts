import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { JobClassSchema, type JobClass } from "@ragnarok/game-data";
import type { JobClassListQuery, JobClassListResult, JobClassRepository } from "./job-class-repository";

/** Dev-mode store — same shape as JsonItemRepository. */
export class JsonJobClassRepository implements JobClassRepository {
  private jobClasses = new Map<number, JobClass>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataPath: string,
    seedPath?: string,
  ) {
    const source = existsSync(dataPath) ? dataPath : seedPath && existsSync(seedPath) ? seedPath : null;
    if (source) {
      const raw = JSON.parse(readFileSync(source, "utf-8")) as unknown[];
      for (const entry of raw) {
        const parsed = JobClassSchema.safeParse(entry);
        if (parsed.success) this.jobClasses.set(parsed.data.id, parsed.data);
      }
    }
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      void this.persistNow();
    }, 500);
  }

  async persistNow(): Promise<void> {
    mkdirSync(dirname(this.dataPath), { recursive: true });
    await writeFile(this.dataPath, JSON.stringify([...this.jobClasses.values()], null, 1), "utf-8");
  }

  async list({ page, pageSize, search }: JobClassListQuery): Promise<JobClassListResult> {
    let all = [...this.jobClasses.values()];
    if (search) {
      const q = search.toLowerCase();
      all = all.filter((c) => c.name.toLowerCase().includes(q) || String(c.id) === q);
    }
    all.sort((a, b) => a.id - b.id);
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { jobClasses: all.slice(start, start + pageSize), total, page, pageSize };
  }

  async get(id: number): Promise<JobClass | undefined> {
    return this.jobClasses.get(id);
  }

  async create(jobClass: JobClass): Promise<JobClass> {
    if (this.jobClasses.has(jobClass.id)) {
      throw Object.assign(new Error(`job class ${jobClass.id} already exists`), { statusCode: 409 });
    }
    this.jobClasses.set(jobClass.id, jobClass);
    this.schedulePersist();
    return jobClass;
  }

  async update(id: number, jobClass: JobClass): Promise<JobClass | undefined> {
    if (!this.jobClasses.has(id)) return undefined;
    if (jobClass.id !== id && this.jobClasses.has(jobClass.id)) {
      throw Object.assign(new Error(`job class ${jobClass.id} already exists`), { statusCode: 409 });
    }
    this.jobClasses.delete(id);
    this.jobClasses.set(jobClass.id, jobClass);
    this.schedulePersist();
    return jobClass;
  }

  async remove(id: number): Promise<boolean> {
    const existed = this.jobClasses.delete(id);
    if (existed) this.schedulePersist();
    return existed;
  }
}
