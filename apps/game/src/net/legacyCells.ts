import type { GameMap } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { gridFor } from "../grid";

/**
 * Tradução entre a célula do rAthena e o mundo 3D.
 *
 * O servidor é a autoridade e só fala em célula do mapa legado (prt_fild08 é
 * 400×400). O mapa 3D é uma JANELA dessa grade — `map.legacy.origin` é a célula
 * do servidor que corresponde à célula 0,0 daqui. Fora da janela não há chão
 * desenhado: quem chama decide (o player é clampado, entidade some).
 */

export interface LegacyMapping {
  mapName: string;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export function legacyMapping(map: GameMap): LegacyMapping | null {
  if (!map.legacy) return null;
  return {
    mapName: map.legacy.mapName,
    originX: map.legacy.originX,
    originY: map.legacy.originY,
    width: map.size.width,
    height: map.size.height,
  };
}

/** célula do servidor → célula local (col,row). Pode cair fora da janela. */
export function serverToLocal(m: LegacyMapping, x: number, y: number): { col: number; row: number } {
  return { col: x - m.originX, row: y - m.originY };
}

/** célula local → célula do servidor. */
export function localToServer(m: LegacyMapping, col: number, row: number): { x: number; y: number } {
  return { x: col + m.originX, y: row + m.originY };
}

export function insideWindow(m: LegacyMapping, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < m.width && row < m.height;
}

/** Traz para dentro da janela (usado no player: melhor grudar na borda que sumir). */
export function clampToWindow(m: LegacyMapping, col: number, row: number): { col: number; row: number } {
  return {
    col: Math.max(0, Math.min(m.width - 1, col)),
    row: Math.max(0, Math.min(m.height - 1, row)),
  };
}

/**
 * Posição de mundo do centro de uma célula do servidor, já na altura do chão.
 *
 * Usa a MESMA grade que o terreno usa pra desenhar — se divergir, o personagem
 * anda flutuando ou enterrado (mesma lição do tile-heightfields). Note que a
 * célula chega FRACIONÁRIA daqui (`worldStore.interpolatedCell` interpola entre
 * dois passos), então a conversão precisa ser contínua: era o termo de paridade
 * do hexágono (`0.5 * (row & 1)`, degrau) que fazia o personagem saltar meia
 * célula de lado ao cruzar uma linha.
 */
export function cellToWorld(
  map: GameMap,
  m: LegacyMapping,
  x: number,
  y: number,
): { x: number; y: number; z: number } {
  const local = serverToLocal(m, x, y);
  const { col, row } = clampToWindow(m, local.col, local.row);
  const flat = gridFor(map).cellToWorld(col, row);
  const terrain = terrainFor(map);
  return { x: flat.x, y: terrain.getHeight(flat.x, flat.z), z: flat.z };
}

/** posição de mundo → célula do servidor (clique no chão). */
export function worldToCell(map: GameMap, m: LegacyMapping, x: number, z: number): { x: number; y: number } {
  const local = gridFor(map).worldToCell(x, z);
  const { col, row } = clampToWindow(m, local.col, local.row);
  return localToServer(m, col, row);
}

/**
 * TerrainQuery por mapa, memorizado: `cellToWorld` é chamada por entidade por
 * evento e recriar a query (que indexa o heightmap inteiro) a cada chamada
 * derruba o frame.
 */
const terrainCache = new WeakMap<GameMap, TerrainQuery>();

function terrainFor(map: GameMap): TerrainQuery {
  let q = terrainCache.get(map);
  if (!q) {
    q = gridFor(map).terrainQuery(map);
    terrainCache.set(map, q);
  }
  return q;
}
