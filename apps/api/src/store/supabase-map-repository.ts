import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameMap } from "@ragnarok/map-format";
import { type MapListQuery, type MapListResult, type MapRepository, type MapSummary } from "./map-repository";
import { mapToRow, rowToMap, type MapRow } from "./map-row";

const PG_UNIQUE_VIOLATION = "23505";

function sanitizeSearch(search: string): string {
  return search.replace(/[,()%\\]/g, " ").trim();
}

/** MapRepository backed by hosted Supabase. list() só puxa colunas de resumo
 * (nunca heightmap/collision — podem ter centenas de milhares de células). */
export class SupabaseMapRepository implements MapRepository {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async list({ page, pageSize, search }: MapListQuery): Promise<MapListResult> {
    let query = this.client
      .from("maps")
      .select("id, name, width, height, water_level, spawns, props, metadata", { count: "exact" });
    if (search) {
      const q = sanitizeSearch(search);
      if (q) query = query.or([`id.ilike.*${q}*`, `name.ilike.*${q}*`].join(","));
    }
    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.order("id").range(start, start + pageSize - 1);
    if (error && error.code === "PGRST103") return { maps: [], total: count ?? 0, page, pageSize };
    if (error) throw new Error(`supabase list maps failed: ${error.message}`);
    const maps: MapSummary[] = (
      data as {
        id: string;
        name: string;
        width: number;
        height: number;
        water_level: number | null;
        spawns: unknown[];
        props: unknown[];
        metadata: { sourceLegacyMap?: string };
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      width: r.width,
      height: r.height,
      waterLevel: r.water_level,
      spawnCount: Array.isArray(r.spawns) ? r.spawns.length : 0,
      propCount: Array.isArray(r.props) ? r.props.length : 0,
      ...(r.metadata?.sourceLegacyMap ? { sourceLegacyMap: r.metadata.sourceLegacyMap } : {}),
    }));
    return { maps, total: count ?? 0, page, pageSize };
  }

  async get(id: string): Promise<GameMap | undefined> {
    const { data, error } = await this.client.from("maps").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase get map failed: ${error.message}`);
    return data ? rowToMap(data as MapRow) : undefined;
  }

  async create(map: GameMap): Promise<GameMap> {
    const { error } = await this.client.from("maps").insert(mapToRow(map));
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`map ${map.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase create map failed: ${error.message}`);
    return map;
  }

  async update(id: string, map: GameMap): Promise<GameMap | undefined> {
    const row = { ...mapToRow(map), updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("maps").update(row).eq("id", id).select("id");
    if (error?.code === PG_UNIQUE_VIOLATION) {
      throw Object.assign(new Error(`map ${map.id} already exists`), { statusCode: 409 });
    }
    if (error) throw new Error(`supabase update map failed: ${error.message}`);
    return data && data.length > 0 ? map : undefined;
  }

  async remove(id: string): Promise<boolean> {
    const { data, error } = await this.client.from("maps").delete().eq("id", id).select("id");
    if (error) throw new Error(`supabase remove map failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
