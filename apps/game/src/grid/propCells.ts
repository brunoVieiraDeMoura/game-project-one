import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { isSolidProp, propRadius } from "../props/registry";
import { SQUARE_SIZE } from "./squareGrid";

/**
 * Células que os props do mapa bloqueiam — a MESMA conta do exportador.
 *
 * Quando o mapa é exportado para o `map_cache` do rAthena
 * (tools/legacy-migration/src/export-mapcache.ts), cada prop sólido vira células
 * de parede pelo seu raio. O servidor passa a barrar exatamente essas células, e
 * o cliente precisa enxergá-las igual: senão o A* daqui traça reto por cima da
 * árvore, o servidor desvia, e o personagem aparece atravessando o tronco.
 *
 * Por isso aqui é o RAIO em células, não o polígono do hull que a colisão local
 * usa: o servidor só conhece célula inteira, e quem manda no online é ele.
 */
export function propBlockedCells(map: GameMap): Set<number> {
  const { width: W, height: H } = map.size;
  const out = new Set<number>();

  for (const prop of map.props) {
    const solido = prop.colliderType ? prop.colliderType !== "none" : isSolidProp(prop.assetId);
    if (!solido) continue;
    const escala = prop.scale[0] ?? 1;
    const raioMundo = propRadius(prop.assetId, escala);
    if (raioMundo <= 0) continue;

    const cx = prop.position[0] / SQUARE_SIZE;
    const cz = prop.position[2] / SQUARE_SIZE;
    const raio = raioMundo / SQUARE_SIZE;
    const c0 = Math.floor(cx - raio), c1 = Math.floor(cx + raio);
    const r0 = Math.floor(cz - raio), r1 = Math.floor(cz + raio);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (col < 0 || row < 0 || col >= W || row >= H) continue;
        const dx = col + 0.5 - cx;
        const dz = row + 0.5 - cz;
        if (dx * dx + dz * dz <= raio * raio) out.add(cellIndex(map, col, row));
      }
    }
  }
  return out;
}

/** memoiza por mapa: a lista de props só muda quando o mapa é recarregado */
const cache = new WeakMap<GameMap, Set<number>>();

export function propBlockedCellsCached(map: GameMap): Set<number> {
  let s = cache.get(map);
  if (!s) {
    s = propBlockedCells(map);
    cache.set(map, s);
  }
  return s;
}
