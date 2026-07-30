import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ItemSchema, type Item } from "@ragnarok/game-data";
import type { ItemListQuery, ItemListResult, ItemRepository } from "./item-repository";

/**
 * Dev-mode store: items held in memory, persisted to a JSON file after
 * mutations. Seeds from tools/legacy-migration output when the data file
 * doesn't exist yet.
 */
export class JsonItemRepository implements ItemRepository {
  private items = new Map<number, Item>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataPath: string,
    seedPath?: string,
  ) {
    const source = existsSync(dataPath) ? dataPath : seedPath && existsSync(seedPath) ? seedPath : null;
    if (source) {
      const raw = JSON.parse(readFileSync(source, "utf-8")) as unknown[];
      for (const entry of raw) {
        const parsed = ItemSchema.safeParse(entry);
        if (parsed.success) this.items.set(parsed.data.id, parsed.data);
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
    await writeFile(this.dataPath, JSON.stringify([...this.items.values()], null, 1), "utf-8");
  }

  async list({ page, pageSize, search }: ItemListQuery): Promise<ItemListResult> {
    let all = [...this.items.values()];
    if (search) {
      const q = search.toLowerCase();
      all = all.filter(
        (i) => i.name.toLowerCase().includes(q) || i.aegisName.toLowerCase().includes(q) || String(i.id) === q,
      );
    }
    all.sort((a, b) => a.id - b.id);
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total, page, pageSize };
  }

  async get(id: number): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async create(item: Item): Promise<Item> {
    if (this.items.has(item.id)) {
      throw Object.assign(new Error(`item ${item.id} already exists`), { statusCode: 409 });
    }
    this.items.set(item.id, item);
    this.schedulePersist();
    return item;
  }

  async update(id: number, item: Item): Promise<Item | undefined> {
    if (!this.items.has(id)) return undefined;
    if (item.id !== id && this.items.has(item.id)) {
      throw Object.assign(new Error(`item ${item.id} already exists`), { statusCode: 409 });
    }
    this.items.delete(id);
    this.items.set(item.id, item);
    this.schedulePersist();
    return item;
  }

  async remove(id: number): Promise<boolean> {
    const existed = this.items.delete(id);
    if (existed) this.schedulePersist();
    return existed;
  }
}
