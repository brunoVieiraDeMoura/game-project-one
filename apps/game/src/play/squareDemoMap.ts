import type { GameMap } from "@ragnarok/map-format";
import { cellIndex, createBlankMap } from "@ragnarok/map-format";
import { squareToWorld, squareLevelToY } from "../grid/squareGrid";
import { propDefaultScale } from "../props/registry";

/**
 * Mapa de demonstração pra testar o /play sem precisar salvar no banco —
 * chão de grama, lagoa, decorações e 2 grupos de esqueletos. Usado por
 * `PlayView` quando `?map=hexdemo` (nome da rota mantido por compatibilidade;
 * o CONTEÚDO deixou de ser hex — era `hex/hexPrefab.ts:buildHexDemo`,
 * `terrainMode:"blocks"`, o único mapa de teste do jogo ainda em hexágono. O
 * jogo real não usa mais hex nenhum (só rAthena real, `terrainMode:"square"`)
 * e este demo é o que o jogador vê primeiro — não fazia sentido ser a única
 * exceção. `hex/hexPrefab.ts` continua existindo só pro editor, que ainda
 * tem os pincéis de terreno hex).
 */
export function buildSquareDemo(): GameMap {
  const W = 40;
  const H = 40;
  const map = createBlankMap("hexdemo", "Campo (demo)", W, H);
  map.terrainMode = "square";
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);

  const set = (col: number, row: number, level: number) => {
    if (col < 0 || col >= W || row < 0 || row >= H) return;
    map.heightmap[cellIndex(map, col, row)] = level;
  };
  const water = (col: number, row: number) => {
    if (col < 0 || col >= W || row < 0 || row >= H) return;
    map.collision[cellIndex(map, col, row)] = "water";
  };

  // colina em degraus no centro
  set(cx, cy, 3);
  const ring: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1], [1, 1], [-1, -1]];
  for (const [dc, dr] of ring) set(cx + dc, cy + dr, 2);
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
    const cc = cx + c, rr = cy + r;
    if (cc < 0 || cc >= W || rr < 0 || rr >= H) continue;
    const i = cellIndex(map, cc, rr);
    if (Math.abs(c) + Math.abs(r) >= 2 && (map.heightmap[i] ?? 0) < 1) map.heightmap[i] = 1;
  }

  // lagoa no canto
  for (let r = 3; r <= 6; r++) for (let c = 3; c <= 7; c++) water(c, r);

  // decorações
  const prop = (assetId: string, col: number, row: number) => {
    const { x, z } = squareToWorld(col, row);
    const level = map.heightmap[cellIndex(map, col, row)] ?? 0;
    const sc = propDefaultScale(assetId);
    map.props.push({
      id: `d${col}_${row}`,
      assetId,
      position: [x, squareLevelToY(level), z],
      rotation: [0, Math.random() * Math.PI * 2, 0],
      scale: [sc, sc, sc],
      colliderType: "none",
    });
  };
  prop("tree_1_a", cx + 4, cy + 1);
  prop("tree_1_b", cx - 3, cy + 2);
  prop("tree_2_a", cx + 2, cy + 4);
  prop("rock_1_a", cx - 4, cy - 2);
  prop("rock_1_c", cx + 5, cy - 3);
  prop("bush_1_a", cx - 2, cy - 4);
  prop("bush_1_b", cx + 6, cy - 1);

  // spawns: player start + 2 grupos de esqueletos
  const spawnAt = (kind: "player_start" | "mob", col: number, row: number, extra: Partial<GameMap["spawns"][number]> = {}) => {
    const { x, z } = squareToWorld(col, row);
    map.spawns.push({ id: `sp_${col}_${row}`, kind, position: [x, squareLevelToY(map.heightmap[cellIndex(map, col, row)] ?? 0), z], ...extra });
  };
  spawnAt("player_start", cx, cy + 3);
  spawnAt("mob", cx + 5, cy + 4, { refId: "skeleton_warrior", count: 4, radius: 8 });
  spawnAt("mob", cx - 5, cy + 3, { refId: "skeleton_minion", count: 3, radius: 6 });

  return map;
}
