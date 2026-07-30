import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { NpcSchema, type Npc } from "@ragnarok/game-data";
import { npcKind, type NpcListQuery, type NpcListResult, type NpcRepository } from "./npc-repository";

/** Dev-mode store — same shape as JsonItemRepository. */
export class JsonNpcRepository implements NpcRepository {
  private npcs = new Map<string, Npc>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataPath: string,
    seedPath?: string,
  ) {
    const source = existsSync(dataPath) ? dataPath : seedPath && existsSync(seedPath) ? seedPath : null;
    if (source) {
      const raw = JSON.parse(readFileSync(source, "utf-8")) as unknown[];
      for (const entry of raw) {
        const parsed = NpcSchema.safeParse(entry);
        if (parsed.success) this.npcs.set(parsed.data.id, parsed.data);
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
    await writeFile(this.dataPath, JSON.stringify([...this.npcs.values()], null, 1), "utf-8");
  }

  async list({ page, pageSize, search, kind, mapId }: NpcListQuery): Promise<NpcListResult> {
    let all = [...this.npcs.values()];
    if (search) {
      const q = search.toLowerCase();
      all = all.filter((n) => n.name.toLowerCase().includes(q) || n.id.includes(q));
    }
    if (kind) all = all.filter((n) => npcKind(n) === kind);
    if (mapId) all = all.filter((n) => n.mapId === mapId);
    all.sort((a, b) => a.id.localeCompare(b.id));
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { npcs: all.slice(start, start + pageSize), total, page, pageSize };
  }

  async get(id: string): Promise<Npc | undefined> {
    return this.npcs.get(id);
  }

  async create(npc: Npc): Promise<Npc> {
    if (this.npcs.has(npc.id)) {
      throw Object.assign(new Error(`npc ${npc.id} already exists`), { statusCode: 409 });
    }
    this.npcs.set(npc.id, npc);
    this.schedulePersist();
    return npc;
  }

  async update(id: string, npc: Npc): Promise<Npc | undefined> {
    if (!this.npcs.has(id)) return undefined;
    if (npc.id !== id && this.npcs.has(npc.id)) {
      throw Object.assign(new Error(`npc ${npc.id} already exists`), { statusCode: 409 });
    }
    this.npcs.delete(id);
    this.npcs.set(npc.id, npc);
    this.schedulePersist();
    return npc;
  }

  async remove(id: string): Promise<boolean> {
    const existed = this.npcs.delete(id);
    if (existed) this.schedulePersist();
    return existed;
  }
}
