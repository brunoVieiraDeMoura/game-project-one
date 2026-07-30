import type { GameMap } from "@ragnarok/map-format";
import { cellIndex, createBlankMap } from "@ragnarok/map-format";
import { hexToWorld, levelToY, getHexScale } from "./hexGrid";
import { propDefaultScale } from "../props/registry";

/**
 * Mapa hex de demonstração (pré-feito) pra testar o /play sem precisar salvar
 * no banco: chão de grama, uma colina no centro (altura), uma lagoa (água) e
 * algumas decorações (árvores/pedras/montanha) posicionadas nos hexes. Usado
 * por PlayView quando ?map=hexdemo.
 */
export function buildHexDemo(): GameMap {
  const W = 16;
  const H = 16;
  const map = createBlankMap("hexdemo", "Campo (demo)", W, H);
  // props e spawns abaixo saem de hexToWorld, que já usa o hexScale VIVO —
  // então o mapa precisa declarar essa escala. Sem isso ele se diz autorado em
  // escala 1 e quem converte (editor e /play) multiplica tudo de novo.
  map.authoredHexScale = getHexScale();
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);

  const set = (col: number, row: number, level: number) => {
    if (col < 0 || col >= W || row < 0 || row >= H) return;
    map.heightmap[cellIndex(map, col, row)] = level;
  };
  const water = (col: number, row: number) => {
    if (col < 0 || col >= W || row < 0 || row >= H) return;
    const i = cellIndex(map, col, row);
    map.surface[i] = "water";
    map.collision[i] = "water";
  };

  // colina em degraus no centro
  set(cx, cy, 3);
  const ring: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  for (const [dc, dr] of ring) set(cx + dc, cy + dr, 2);
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
    if (Math.abs(c) + Math.abs(r) === 3 || (Math.abs(c) === 2 && Math.abs(r) <= 1) || (Math.abs(r) === 2 && Math.abs(c) <= 1)) {
      const cc = cx + c, rr = cy + r;
      const i = cellIndex(map, cc, rr);
      if (cc >= 0 && cc < W && rr >= 0 && rr < H && (map.heightmap[i] ?? 0) < 1) map.heightmap[i] = 1;
    }
  }

  // lagoa no canto
  for (let r = 3; r <= 6; r++) for (let c = 3; c <= 7; c++) water(c, r);

  // decorações nos hexes (árvores/pedras/montanha)
  const prop = (assetId: string, col: number, row: number) => {
    const { x, z } = hexToWorld(col, row);
    const level = map.heightmap[cellIndex(map, col, row)] ?? 0;
    const sc = propDefaultScale(assetId);
    map.props.push({
      id: `d${col}_${row}`,
      assetId,
      position: [x, levelToY(level), z],
      rotation: [0, Math.random() * Math.PI * 2, 0],
      scale: [sc, sc, sc],
      colliderType: "none",
    });
  };
  prop("hex_tree_single_a", cx + 4, cy + 1);
  prop("hex_tree_single_b", cx - 3, cy + 2);
  prop("hex_trees_a_medium", cx + 2, cy + 4);
  prop("hex_rock_single_a", cx - 4, cy - 2);
  prop("hex_rock_single_c", cx + 5, cy - 3);
  prop("hex_hill_single_a", cx - 2, cy - 4);

  // spawns: player start + 2 grupos de esqueletos
  const spawnAt = (kind: "player_start" | "mob", col: number, row: number, extra: Partial<GameMap["spawns"][number]> = {}) => {
    const { x, z } = hexToWorld(col, row);
    map.spawns.push({ id: `sp_${col}_${row}`, kind, position: [x, levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0), z], ...extra });
  };
  spawnAt("player_start", cx, cy + 3);
  spawnAt("mob", cx + 5, cy + 4, { refId: "skeleton_warrior", count: 4, radius: 8 });
  spawnAt("mob", cx - 5, cy + 3, { refId: "skeleton_minion", count: 3, radius: 6 });

  return map;
}
