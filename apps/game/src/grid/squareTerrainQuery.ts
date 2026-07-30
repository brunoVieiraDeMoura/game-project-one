import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { propBlockedCellsCached } from "./propCells";
import { worldToSquare } from "./squareGrid";
import { sampleHeight } from "./heightField";

/**
 * TerrainQuery da grade quadrada: (x,z) de mundo → célula → altura e andabilidade.
 *
 * Mesmo contrato das outras duas queries, então os MovementControllers e o
 * cursor de chão funcionam sem saber qual grade está embaixo.
 *
 * A regra de andabilidade espelha o rAthena, não o mundo hexagonal:
 * `map_cache` tipo 3 é ÁGUA ANDÁVEL (`rathena/src/map/map.cpp:3285`), e o
 * `hexTerrainQuery` bloqueia água de propósito porque lá a água é um lago
 * autorado onde a estrada morre na margem. Discordar do servidor aqui não
 * impede ninguém de andar — quem move é ele —, só pintaria o cursor de vermelho
 * numa célula em que o personagem vai entrar, o que é pior que não pintar.
 *
 * Altura: hoje o heightmap dos mapas migrados vem todo zero (a altura real só
 * existe no .gat do cliente, que não está no repo), então o chão é plano. A
 * conta já está pronta para quando houver relevo — mas relevo INVENTADO não
 * entra: o servidor considera o terreno plano e o personagem subiria morros que
 * o pathfinding dele ignora.
 */
export function createSquareTerrainQuery(
  map: GameMap,
  opts: { includeProps?: boolean } = {},
): TerrainQuery {
  const { width, height } = map.size;
  // Props bloqueiam pela MESMA regra do exportador (célula inteira pelo raio,
  // ver grid/propCells), não pelo polígono do hull: o servidor só conhece
  // célula, e depois do `export:mapcache` é ele quem barra a árvore. Com regras
  // diferentes, o cursor mostraria vermelho onde o servidor deixa passar (e
  // vice-versa).
  const usarProps = opts.includeProps ?? true;
  const bloqueadas = usarProps ? propBlockedCellsCached(map) : null;
  const cellOf = (x: number, z: number) => {
    const { col, row } = worldToSquare(x, z);
    if (col < 0 || col >= width || row < 0 || row >= height) return null;
    return cellIndex(map, col, row);
  };
  return {
    getHeight(x, z) {
      const idx = cellOf(x, z);
      if (idx == null) return 0;
      // MESMA superfície que a malha desenha: bilinear entre as alturas de canto
      // (grid/heightField), não o nível chapado da célula. Com o terreno suave,
      // ler o nível da célula deixava o personagem flutuando meio nível na
      // encosta e afundando na descida — a lição do tile-heightfields.
      return sampleHeight(map, x, z);
    },
    isWalkable(x, z) {
      const idx = cellOf(x, z);
      if (idx == null) return false;
      const cell = map.collision[idx];
      if (cell !== "walkable" && cell !== "water") return false;
      return !bloqueadas?.has(idx);
    },
  };
}
