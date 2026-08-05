import { cellIndex, type GameMap, type MapProp } from "@ragnarok/map-format";
import { PROP_IDS } from "../props/registry";
import { gridFor } from "../grid";

/**
 * Espalha props de demonstração em células andáveis quando o mapa ainda não
 * tem props autorados (os mapas migrados vêm com props: []). É só pra o mundo
 * não ficar pelado até o editor 3D existir (Bloco 4) — determinístico, não
 * persistido. Evita a área inicial do player.
 */
export function scatterDemoProps(map: GameMap, center: { x: number; z: number }, count = 90): MapProp[] {
  if (map.props.length > 0) return map.props;
  const { width, height } = map.size;
  const s = map.cellSize;
  const props: MapProp[] = [];
  // LCG determinístico
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const kinds = PROP_IDS.filter((id) => !id.startsWith("grass"));
  // agrupa em anel ao redor do spawn pra ficar visível na hora (é só demo)
  const minR = s * 2.5;
  const maxR = s * 22;
  let tries = 0;
  while (props.length < count && tries < count * 60) {
    tries++;
    const ang = rnd() * Math.PI * 2;
    const r = minR + rnd() * (maxR - minR);
    const wx = center.x + Math.cos(ang) * r;
    const wz = center.z + Math.sin(ang) * r;
    const cx = Math.floor(wx / s);
    const cz = Math.floor(wz / s);
    if (cx < 0 || cx >= width || cz < 0 || cz >= height) continue;
    if (map.collision[cellIndex(map, cx, cz)] !== "walkable") continue;
    const assetId = kinds[Math.floor(rnd() * kinds.length)]!;
    const scale = assetId.startsWith("tree") ? 3 + rnd() * 1.5 : assetId.startsWith("rock") ? 2 + rnd() : 2;
    props.push({
      id: `demo-${props.length}`,
      assetId,
      position: [wx, 0, wz],
      rotation: [0, rnd() * Math.PI * 2, 0],
      scale: [scale, scale, scale],
      colliderType: "none",
    });
  }
  return props;
}

/** primeira célula andável varrendo do centro pra fora (posição inicial do player) */
export function findWalkableStart(map: GameMap): { x: number; z: number } {
  const { width, height } = map.size;
  /**
   * A célula DESENHADA, não o `map.cellSize`.
   *
   * `cellSize` vale 5 no schema e não tem relação com o tamanho do mundo — a
   * mesma armadilha que já tinha feito o WASD mirar 2,5× mais longe que o
   * clique. Num mapa do rAthena (400×400, célula de 2 unidades) o mundo mede
   * 800; multiplicando por 5, este spawn caía em 952 × 1052, ou seja FORA do
   * mapa, e o preview local abria com o personagem boiando sobre o vazio —
   * nenhum chunk é montado onde não há mapa.
   */
  const grid = gridFor(map);
  const cx0 = Math.floor(width / 2);
  const cz0 = Math.floor(height / 2);
  for (let r = 0; r < Math.max(width, height); r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cx >= width || cz < 0 || cz >= height) continue;
        if (map.collision[cellIndex(map, cx, cz)] === "walkable") {
          const p = grid.cellToWorld(cx, cz);
          return { x: p.x, z: p.z };
        }
      }
    }
  }
  const meio = grid.cellToWorld(Math.floor(width / 2), Math.floor(height / 2));
  return { x: meio.x, z: meio.z };
}
