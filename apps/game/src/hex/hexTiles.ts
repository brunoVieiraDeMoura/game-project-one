/**
 * Topologia de borda dos tiles KayKit Medieval Hexagon — a fonte de verdade pra
 * montar estrada/rio/costa/rampa PROCEDURALMENTE com peças conectadas.
 *
 * Como foi extraído (não é chute): cada .gltf tem UMA primitive com UM material
 * (o atlas `hexagons_medieval.png`) — a diferença entre grama, terra e água está
 * só na COR do atlas. O script de extração amostra o atlas pela UV de cada
 * triângulo da superfície de topo e vê qual classe domina perto de cada um dos 6
 * pontos-médios de borda. As bordas são indexadas 0..5 no ângulo k×60° em XZ
 * (mesma convenção que `atan2(dz, dx) / (π/3)` usa pra achar o vizinho hex).
 *
 * Fatos importantes dos modelos:
 *  - TODOS os tiles têm o mesmo bbox: x∈[-1,1], z∈[-1.1547,1.1547], corpo até
 *    y=-1 e topo em y=0 → são nativos do tamanho do hex, escala 1. Por isso o
 *    chão padrão encaixa exatamente com estrada/rio/costa/rampa.
 *  - `hex_water` tem topo em y=-0.20 (afunda um pouco = lâmina de água).
 *  - Os `*_sloped_high` sobem até y=+1 e DESCEM pela borda 3 (o `_low`, até 0.5).
 *    Então a rampa base liga "meu nível" (borda 3) ao "nível+1" (borda 0).
 */

/** rotationY por passo de rotação. A borda local k vira a borda de mundo k+r. */
export const TILE_ROT_STEP = -Math.PI / 3;

/** vizinho por ÍNDICE DE BORDA (0..5 = ângulo k×60° em XZ), offset odd-r
 * pointy-top. Derivado de hexToWorld — é a MESMA convenção que a topologia dos
 * tiles usa, então "borda k do tile" e "vizinho k da célula" batem sempre. */
export const NEIGHBOR_BY_EDGE: readonly (readonly (readonly [number, number])[])[] = [
  [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]], // linha PAR
  [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]], // linha ÍMPAR (meia coluna)
];

/** célula vizinha na borda k */
export function neighborAt(col: number, row: number, k: number): [number, number] {
  const d = NEIGHBOR_BY_EDGE[row & 1]![k]!;
  return [col + d[0], row + d[1]];
}

/** índice da borda que liga (col,row) a (tc,tr) — null se não forem vizinhos */
export function edgeBetween(col: number, row: number, tc: number, tr: number): number | null {
  const ring = NEIGHBOR_BY_EDGE[row & 1]!;
  for (let k = 0; k < 6; k++) if (col + ring[k]![0] === tc && row + ring[k]![1] === tr) return k;
  return null;
}

export interface TileDef {
  /** id do arquivo (sem extensão), relativo a HEX_BASE + pasta */
  file: string;
  /** bordas "com a feature" (estrada/rio/água) na rotação base */
  edges: number[];
}

const HEX_BASE = "/assets/hex";
export const tileUrl = (dir: string, file: string) => `${HEX_BASE}/${dir}/${file}.gltf`;

/** ESTRADA — bordas com terra batida. Extraído do atlas (classe "dirt"). */
export const ROAD_TILES: TileDef[] = [
  { file: "hex_road_A", edges: [0, 3] }, // reta
  { file: "hex_road_C", edges: [3, 4] }, // curva fechada (60°)
  { file: "hex_road_B", edges: [3, 5] }, // curva aberta (120°)
  { file: "hex_road_F", edges: [0, 1, 3] }, // T
  { file: "hex_road_E", edges: [0, 3, 5] }, // T
  { file: "hex_road_D", edges: [1, 3, 5] }, // Y (alternado)
  { file: "hex_road_G", edges: [2, 3, 4] }, // T fechado
  { file: "hex_road_H", edges: [0, 2, 3, 4] }, // cruz 4
  { file: "hex_road_I", edges: [1, 2, 4, 5] }, // cruz 4 (alternada)
  { file: "hex_road_J", edges: [0, 1, 2, 3] }, // cruz 4 (leque)
  { file: "hex_road_K", edges: [1, 2, 3, 4, 5] }, // cruz 5
  { file: "hex_road_L", edges: [0, 1, 2, 3, 4, 5] }, // cruz 6
  { file: "hex_road_M", edges: [3] }, // ponta (dead-end)
];

/** RIO — bordas com canal de água. MESMO esquema de letras da estrada, mas SEM
 * ponta (rio não tem dead-end: sempre entra e sai) e com `A_curvy` como variante
 * visual da reta (leito ondulado, quebra a repetição em trechos longos). */
export const RIVER_TILES: TileDef[] = [
  { file: "hex_river_A", edges: [0, 3] },
  { file: "hex_river_B", edges: [3, 5] },
  { file: "hex_river_C", edges: [3, 4] },
  { file: "hex_river_F", edges: [0, 1, 3] },
  { file: "hex_river_E", edges: [0, 3, 5] },
  { file: "hex_river_D", edges: [1, 3, 5] },
  { file: "hex_river_G", edges: [2, 3, 4] },
  { file: "hex_river_H", edges: [0, 2, 3, 4] },
  { file: "hex_river_I", edges: [1, 2, 4, 5] },
  { file: "hex_river_J", edges: [0, 1, 2, 3] },
  { file: "hex_river_K", edges: [1, 2, 3, 4, 5] },
  { file: "hex_river_L", edges: [0, 1, 2, 3, 4, 5] },
];
/** variante ondulada da reta (mesma topologia [0,3]) */
export const RIVER_STRAIGHT_CURVY = "hex_river_A_curvy";
// As peças `hex_river_crossing_*` (vau) não são mais usadas: estrada nunca
// atravessa água — o traçado morre na margem (regra do usuário).

/** COSTA — célula de TERRA na margem de água parada. `edges` = bordas de água
 * (sempre um trecho CONSECUTIVO; a peça já traz a faixa de areia). */
export const COAST_TILES: TileDef[] = [
  { file: "hex_coast_A", edges: [1] },
  { file: "hex_coast_B", edges: [1, 2] },
  { file: "hex_coast_C", edges: [0, 1, 2] },
  { file: "hex_coast_D", edges: [5, 0, 1, 2] },
];

export const BASE_TILES = {
  grass: tileUrl("base", "hex_grass"),
  grassBottom: tileUrl("base", "hex_grass_bottom"),
  water: tileUrl("base", "hex_water"),
  rampGrass: tileUrl("base", "hex_grass_sloped_high"),
  rampGrassLow: tileUrl("base", "hex_grass_sloped_low"),
  rampRoad: tileUrl("roads", "hex_road_A_sloped_high"),
  rampRoadLow: tileUrl("roads", "hex_road_A_sloped_low"),
} as const;

/** borda pra onde as peças `*_sloped_*` descem na rotação base */
export const RAMP_BASE_DOWN_EDGE = 3;

const norm = (edges: number[]) => [...new Set(edges)].sort((a, b) => a - b).join(",");
const rotate = (edges: number[], r: number) => edges.map((e) => (e + r) % 6);

/** índice (chave de bordas → peça+rotação) montado uma vez por conjunto */
function buildIndex(tiles: TileDef[]): Map<string, { file: string; rot: number }> {
  const m = new Map<string, { file: string; rot: number }>();
  for (const t of tiles)
    for (let r = 0; r < 6; r++) {
      const key = norm(rotate(t.edges, r));
      if (!m.has(key)) m.set(key, { file: t.file, rot: r }); // 1ª peça da lista vence
    }
  return m;
}
const ROAD_INDEX = buildIndex(ROAD_TILES);
const RIVER_INDEX = buildIndex(RIVER_TILES);
const COAST_INDEX = buildIndex(COAST_TILES);

export type TilePick = { file: string; rot: number } | null;

/** peça de ESTRADA pras conexões dadas (vizinhos que também são estrada) */
export function pickRoadTile(conns: number[]): TilePick {
  if (conns.length === 0) return { file: "hex_road_M", rot: 0 }; // isolada → ponta
  return ROAD_INDEX.get(norm(conns)) ?? null;
}

/** peça de RIO. `variant` alterna a reta pro leito ondulado (quebra repetição). */
export function pickRiverTile(conns: number[], variant = false): TilePick {
  const hit = RIVER_INDEX.get(norm(conns));
  if (!hit) return null; // 0 ou 1 conexão → o chamador cai pra lâmina de água
  if (variant && hit.file === "hex_river_A") return { file: RIVER_STRAIGHT_CURVY, rot: hit.rot };
  return hit;
}

/** peça de COSTA. Só casa com trecho CONSECUTIVO de 1..4 bordas de água — pra
 * qualquer outro arranjo devolve null (o chamador mantém grama). */
export function pickCoastTile(waterEdges: number[]): TilePick {
  return COAST_INDEX.get(norm(waterEdges)) ?? null;
}

/** maior sequência CIRCULAR consecutiva dentro de um conjunto de bordas.
 * Ex.: [5,0,1] → {start:5, len:3}. Usado pra orientar a costa. */
export function longestRun(edges: number[]): { start: number; len: number } | null {
  const has = new Set(edges);
  if (has.size === 0 || has.size === 6) return has.size === 6 ? { start: 0, len: 6 } : null;
  let best: { start: number; len: number } | null = null;
  for (let s = 0; s < 6; s++) {
    if (!has.has(s) || has.has((s + 5) % 6)) continue; // só começos de trecho
    let len = 0;
    while (len < 6 && has.has((s + len) % 6)) len++;
    if (!best || len > best.len) best = { start: s, len };
  }
  return best;
}

/** rotação pra levar a rampa base (desce pela borda 3) a descer pela borda `down` */
export const rampRot = (down: number) => (down - RAMP_BASE_DOWN_EDGE + 6) % 6;

/** todos os .gltf que o HexTerrain precisa pré-carregar (ordem estável — os
 * hooks do useGLTF iteram esta lista, então ela NUNCA pode mudar de tamanho). */
export const ALL_TILE_URLS: string[] = [
  ...Object.values(BASE_TILES),
  ...ROAD_TILES.map((t) => tileUrl("roads", t.file)),
  ...RIVER_TILES.map((t) => tileUrl("rivers", t.file)),
  tileUrl("rivers", RIVER_STRAIGHT_CURVY),
  ...COAST_TILES.map((t) => tileUrl("coast", t.file)),
];

/** de qual pasta vem cada peça (o `file` sozinho não diz) */
export function urlForFile(file: string): string {
  if (file.startsWith("hex_road")) return tileUrl("roads", file);
  if (file.startsWith("hex_river")) return tileUrl("rivers", file);
  if (file.startsWith("hex_coast")) return tileUrl("coast", file);
  return tileUrl("base", file);
}
