import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { StatusEffectDefSchema, type StatusEffectDef } from "@ragnarok/game-data";
import type { StatusListQuery, StatusListResult, StatusRepository } from "./status-repository";

/** Dev-mode store — same shape as JsonItemRepository. */
export class JsonStatusRepository implements StatusRepository {
  private statuses = new Map<string, StatusEffectDef>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataPath: string,
    seedPath?: string,
  ) {
    const source = existsSync(dataPath) ? dataPath : seedPath && existsSync(seedPath) ? seedPath : null;
    if (source) {
      const raw = JSON.parse(readFileSync(source, "utf-8")) as unknown[];
      for (const entry of raw) {
        const parsed = StatusEffectDefSchema.safeParse(entry);
        if (parsed.success) this.statuses.set(parsed.data.id, parsed.data);
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
    await writeFile(this.dataPath, JSON.stringify([...this.statuses.values()], null, 1), "utf-8");
  }

  async list({ page, pageSize, search, category, group }: StatusListQuery): Promise<StatusListResult> {
    let all = [...this.statuses.values()];
    if (category) all = all.filter((s) => s.category === category);
    if (group) all = all.filter((s) => s.group === group);
    if (search) {
      const q = search.toLowerCase();
      all = all.filter((s) => s.id.includes(q) || s.name.toLowerCase().includes(q));
    }
    all.sort((a, b) => a.id.localeCompare(b.id));
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { statuses: all.slice(start, start + pageSize), total, page, pageSize };
  }

  async get(id: string): Promise<StatusEffectDef | undefined> {
    return this.statuses.get(id);
  }

  async create(status: StatusEffectDef): Promise<StatusEffectDef> {
    if (this.statuses.has(status.id)) {
      throw Object.assign(new Error(`status ${status.id} already exists`), { statusCode: 409 });
    }
    this.statuses.set(status.id, status);
    this.schedulePersist();
    return status;
  }

  async update(id: string, status: StatusEffectDef): Promise<StatusEffectDef | undefined> {
    if (!this.statuses.has(id)) return undefined;
    if (status.id !== id && this.statuses.has(status.id)) {
      throw Object.assign(new Error(`status ${status.id} already exists`), { statusCode: 409 });
    }
    this.statuses.delete(id);
    this.statuses.set(status.id, status);
    this.schedulePersist();
    return status;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.statuses.delete(id);
    if (existed) this.schedulePersist();
    return existed;
  }
}
