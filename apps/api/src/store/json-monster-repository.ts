import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MonsterSchema, type Monster } from "@ragnarok/game-data";
import type { MonsterListQuery, MonsterListResult, MonsterRepository } from "./monster-repository";

/** Dev-mode store — same shape as JsonItemRepository. */
export class JsonMonsterRepository implements MonsterRepository {
  private monsters = new Map<number, Monster>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataPath: string,
    seedPath?: string,
  ) {
    const source = existsSync(dataPath) ? dataPath : seedPath && existsSync(seedPath) ? seedPath : null;
    if (source) {
      const raw = JSON.parse(readFileSync(source, "utf-8")) as unknown[];
      for (const entry of raw) {
        const parsed = MonsterSchema.safeParse(entry);
        if (parsed.success) this.monsters.set(parsed.data.id, parsed.data);
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
    await writeFile(this.dataPath, JSON.stringify([...this.monsters.values()], null, 1), "utf-8");
  }

  async list({ page, pageSize, search, dropsItem }: MonsterListQuery): Promise<MonsterListResult> {
    let all = [...this.monsters.values()];
    if (search) {
      const q = search.toLowerCase();
      all = all.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.aegisName.toLowerCase().includes(q) ||
          String(m.id) === q,
      );
    }
    if (dropsItem !== undefined) {
      all = all.filter(
        (m) => m.drops.some((d) => d.itemId === dropsItem) || m.mvpDrops.some((d) => d.itemId === dropsItem),
      );
    }
    all.sort((a, b) => a.id - b.id);
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { monsters: all.slice(start, start + pageSize), total, page, pageSize };
  }

  async get(id: number): Promise<Monster | undefined> {
    return this.monsters.get(id);
  }

  async create(monster: Monster): Promise<Monster> {
    if (this.monsters.has(monster.id)) {
      throw Object.assign(new Error(`monster ${monster.id} already exists`), { statusCode: 409 });
    }
    this.monsters.set(monster.id, monster);
    this.schedulePersist();
    return monster;
  }

  async update(id: number, monster: Monster): Promise<Monster | undefined> {
    if (!this.monsters.has(id)) return undefined;
    if (monster.id !== id && this.monsters.has(monster.id)) {
      throw Object.assign(new Error(`monster ${monster.id} already exists`), { statusCode: 409 });
    }
    this.monsters.delete(id);
    this.monsters.set(monster.id, monster);
    this.schedulePersist();
    return monster;
  }

  async remove(id: number): Promise<boolean> {
    const existed = this.monsters.delete(id);
    if (existed) this.schedulePersist();
    return existed;
  }
}
