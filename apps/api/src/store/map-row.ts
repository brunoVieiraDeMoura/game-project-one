import { GameMapSchema, type GameMap } from "@ragnarok/map-format";

/** GameMap ↔ `maps` row (20260724000001_maps.sql). heightmap/collision e
 * props/spawns são jsonb; size vira colunas width/height pra listagem barata.
 *
 * terrainMode/surface (terreno em blocos do editor hex) e triggers (gatilhos de
 * área) NÃO têm coluna própria — ficam guardados dentro do `metadata` jsonb
 * (chave `_blocks`), pra não exigir migração de SQL. Sem isso, salvar um mapa hex
 * descartava esses campos e o /play voltava a renderizar plano ("smooth"). */

const BLOCKS_KEY = "_blocks";

export interface MapRow {
  id: string;
  name: string;
  width: number;
  height: number;
  cell_size: number;
  heightmap: unknown;
  collision: unknown;
  water_level: number | null;
  props: unknown;
  spawns: unknown;
  metadata: unknown;
}

export function mapToRow(m: GameMap): MapRow {
  return {
    id: m.id,
    name: m.name,
    width: m.size.width,
    height: m.size.height,
    cell_size: m.cellSize,
    heightmap: m.heightmap,
    collision: m.collision,
    water_level: m.waterLevel,
    props: m.props,
    spawns: m.spawns,
    // guarda terrainMode + surface + triggers junto do metadata (sem coluna nova)
    metadata: {
      ...m.metadata,
      [BLOCKS_KEY]: {
        terrainMode: m.terrainMode,
        surface: m.surface,
        // textura/escala por superfície: sem isto aqui, escolher a grama no
        // editor e salvar devolvia o padrão no /play — o campo é novo (schema
        // v6) e esta lista é FIXA, então todo campo sem coluna própria precisa
        // ser acrescentado nos DOIS sentidos ou se perde calado no round-trip
        terrainStyle: m.terrainStyle,
        triggers: m.triggers,
        ramps: m.ramps,
        lighting: m.lighting,
        authoredHexScale: m.authoredHexScale,
        legacy: m.legacy,
      },
    },
  };
}

export function rowToMap(row: MapRow): GameMap {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const blocks = (meta[BLOCKS_KEY] ?? {}) as {
    terrainMode?: string;
    surface?: unknown;
    terrainStyle?: unknown;
    triggers?: unknown;
    ramps?: unknown;
    lighting?: unknown;
    authoredHexScale?: number;
    legacy?: unknown;
  };
  // metadata "limpo" (sem a chave interna) pro schema
  const { [BLOCKS_KEY]: _drop, ...cleanMeta } = meta;
  return GameMapSchema.parse({
    id: row.id,
    name: row.name,
    size: { width: row.width, height: row.height },
    cellSize: row.cell_size,
    terrainMode: blocks.terrainMode ?? "smooth",
    heightmap: row.heightmap,
    collision: row.collision,
    surface: blocks.surface ?? [],
    terrainStyle: blocks.terrainStyle ?? {},
    waterLevel: row.water_level,
    props: row.props,
    spawns: row.spawns,
    triggers: blocks.triggers ?? [],
    ramps: blocks.ramps ?? [],
    lighting: blocks.lighting,
    // authoredHexScale também não tinha coluna e vinha se perdendo no round-trip
    // (voltava sempre 1, reescalando props/spawns errado na carga).
    authoredHexScale: blocks.authoredHexScale ?? 1,
    legacy: blocks.legacy,
    metadata: cleanMeta,
  });
}
