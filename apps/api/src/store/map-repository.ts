import type { GameMap } from "@ragnarok/map-format";

/** resumo pra listagem — SEM os arrays gigantes (heightmap/collision) */
export interface MapSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  waterLevel: number | null;
  spawnCount: number;
  propCount: number;
  sourceLegacyMap?: string;
}

export interface MapListQuery {
  page: number;
  pageSize: number;
  search?: string | undefined;
}

export interface MapListResult {
  maps: MapSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export function toSummary(m: GameMap): MapSummary {
  return {
    id: m.id,
    name: m.name,
    width: m.size.width,
    height: m.size.height,
    waterLevel: m.waterLevel,
    spawnCount: m.spawns.length,
    propCount: m.props.length,
    ...(m.metadata.sourceLegacyMap ? { sourceLegacyMap: m.metadata.sourceLegacyMap } : {}),
  };
}

/** Storage do Editor de mapas (soul.txt §5.9). list = resumos; get = mapa
 * inteiro (heightmap/collision podem ter centenas de milhares de células). */
export interface MapRepository {
  list(query: MapListQuery): Promise<MapListResult>;
  get(id: string): Promise<GameMap | undefined>;
  create(map: GameMap): Promise<GameMap>;
  update(id: string, map: GameMap): Promise<GameMap | undefined>;
  remove(id: string): Promise<boolean>;
}
