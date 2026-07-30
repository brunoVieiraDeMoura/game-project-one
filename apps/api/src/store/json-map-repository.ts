import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GameMapSchema, type GameMap } from "@ragnarok/map-format";
import { toSummary, type MapListQuery, type MapListResult, type MapRepository } from "./map-repository";

/**
 * Dev-mode store: um arquivo JSON por mapa num diretório. Semeia do output da
 * migração (tools/legacy-migration/output/maps) na primeira carga.
 */
export class JsonMapRepository implements MapRepository {
  private maps = new Map<string, GameMap>();

  constructor(
    private readonly dataDir: string,
    seedDir?: string,
  ) {
    const source = existsSync(dataDir) ? dataDir : seedDir && existsSync(seedDir) ? seedDir : null;
    if (source) {
      for (const file of readdirSync(source)) {
        if (!file.endsWith(".json")) continue;
        const parsed = GameMapSchema.safeParse(JSON.parse(readFileSync(join(source, file), "utf-8")));
        if (parsed.success) this.maps.set(parsed.data.id, parsed.data);
      }
    }
  }

  private async persist(map: GameMap): Promise<void> {
    mkdirSync(this.dataDir, { recursive: true });
    await writeFile(join(this.dataDir, `${map.id}.json`), JSON.stringify(map), "utf-8");
  }

  async list({ page, pageSize, search }: MapListQuery): Promise<MapListResult> {
    let all = [...this.maps.values()];
    if (search) {
      const q = search.toLowerCase();
      all = all.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    }
    all.sort((a, b) => a.id.localeCompare(b.id));
    const total = all.length;
    const start = (page - 1) * pageSize;
    return { maps: all.slice(start, start + pageSize).map(toSummary), total, page, pageSize };
  }

  async get(id: string): Promise<GameMap | undefined> {
    return this.maps.get(id);
  }

  async create(map: GameMap): Promise<GameMap> {
    if (this.maps.has(map.id)) {
      throw Object.assign(new Error(`map ${map.id} already exists`), { statusCode: 409 });
    }
    this.maps.set(map.id, map);
    await this.persist(map);
    return map;
  }

  async update(id: string, map: GameMap): Promise<GameMap | undefined> {
    if (!this.maps.has(id)) return undefined;
    if (map.id !== id && this.maps.has(map.id)) {
      throw Object.assign(new Error(`map ${map.id} already exists`), { statusCode: 409 });
    }
    this.maps.delete(id);
    this.maps.set(map.id, map);
    await this.persist(map);
    return map;
  }

  async remove(id: string): Promise<boolean> {
    return this.maps.delete(id);
  }
}
