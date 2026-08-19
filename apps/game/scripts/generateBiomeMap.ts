/**
 * pnpm --filter @ragnarok/game exec tsx scripts/generateBiomeMap.ts
 *
 * Gera um prt_fild08 novo (400x400, terrainMode "square"): 4 biomas
 * (deserto/gelo/floresta/campo) em blobs orgânicos (Voronoi com domain warp,
 * não quadrantes retos), relevo real por bioma (dunas/montanhas/colinas/rio),
 * uma estrada por bioma e vegetação/pedras do nature-catalog real.
 *
 * `spawns[]` do mapa original é copiado 1:1 (não alterado). `collision` é
 * inteiramente reautorada (o mapa vira um mapa de teste visual do renderer,
 * não um espelho fiel do map_cache.dat original) — ver relatório final sobre
 * a implicação disso pra sincronia com o rAthena real (export:mapcache).
 */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GameMapSchema,
  cellIndex,
  MAP_SCHEMA_VERSION,
  type GameMap,
  type CollisionType,
  type SurfaceType,
  type MapProp,
} from "@ragnarok/map-format";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(HERE, "../../../tools/legacy-migration/output/maps/prt_fild08.json");

const W = 400;
const H = 400;
const N = W * H;

// ---------------------------------------------------------------- noise ---

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function valueNoise(x: number, z: number, period: number, seed: number): number {
  const gx = x / period;
  const gz = z / period;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const sx = smooth(fx);
  const sz = smooth(fz);
  const v00 = hash2(ix, iz, seed);
  const v10 = hash2(ix + 1, iz, seed);
  const v01 = hash2(ix, iz + 1, seed);
  const v11 = hash2(ix + 1, iz + 1, seed);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sz;
}
function fbm(x: number, z: number, octaves: number, period: number, persistence: number, seed: number): number {
  let amp = 1;
  let freq = period;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, z, freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= persistence;
    freq = Math.max(2, freq / 2);
  }
  return norm > 0 ? sum / norm : 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rnd() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260818);

// --------------------------------------------------------------- biomes ---

type Biome = "desert" | "ice" | "forest" | "campo";
const BIOMES: Biome[] = ["desert", "ice", "forest", "campo"];
/** centros em CÉLULA, deslocados dos quadrantes puros de propósito — o warp
 * abaixo já entorta a fronteira, mas um centro perfeitamente no meio do
 * quadrante ainda tende a ficar simétrico demais. */
const CENTERS: Record<Biome, [number, number]> = {
  desert: [92, 108],
  ice: [308, 92],
  forest: [108, 298],
  campo: [302, 308],
};

function warp(x: number, z: number): [number, number] {
  const wx = x + fbm(x, z, 3, 130, 0.5, 11) * 55 + fbm(x, z, 2, 22, 0.5, 17) * 14;
  const wz = z + fbm(x, z, 3, 130, 0.5, 29) * 55 + fbm(x, z, 2, 22, 0.5, 31) * 14;
  return [wx, wz];
}

/** bioma da célula + "edge" (0 no miolo, ->1 perto da fronteira com outro bioma) */
function biomeAt(x: number, z: number): { biome: Biome; edge: number } {
  const [wx, wz] = warp(x, z);
  let best: Biome = "campo";
  let bestD = Infinity;
  let second = Infinity;
  for (const b of BIOMES) {
    const [cx, cz] = CENTERS[b];
    const d = Math.hypot(wx - cx, wz - cz);
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = b;
    } else if (d < second) {
      second = d;
    }
  }
  const edge = Math.max(0, 1 - (second - bestD) / 45);
  return { biome: best, edge };
}

// --------------------------------------------------------------- height ---

function ridgeBoost(x: number, z: number, edge: number): number {
  return edge * (2.0 + fbm(x, z, 2, 25, 0.5, 501) * 1.0);
}
function desertHeight(x: number, z: number, edge: number): number {
  const dune = Math.sin((x * 0.7 + z * 0.3) * 0.045) * 2.2;
  const detail = fbm(x, z, 4, 26, 0.5, 101) * 1.4;
  return 1.0 + dune + detail + ridgeBoost(x, z, edge);
}
function iceRolling(x: number, z: number): number {
  return fbm(x, z, 4, 42, 0.55, 201) * 3.0;
}
function iceMountainNoise(x: number, z: number): number {
  return fbm(x, z, 3, 60, 0.55, 211);
}
function forestHeight(x: number, z: number, edge: number): number {
  return 1.0 + fbm(x, z, 5, 30, 0.5, 301) * 2.6 + ridgeBoost(x, z, edge);
}
function campoHeight(x: number, z: number, edge: number): number {
  return 0.6 + fbm(x, z, 4, 50, 0.5, 401) * 1.1 + ridgeBoost(x, z, edge) * 0.6;
}

// --------------------------------------------------------------- state ----

const heightmap = new Float32Array(N);
const collision: CollisionType[] = new Array(N).fill("walkable");
const surface: SurfaceType[] = new Array(N).fill("grass");
const biomeId = new Uint8Array(N); // index into BIOMES
const roadMask = new Uint8Array(N);
const riverMask = new Uint8Array(N);
const protectedMask = new Uint8Array(N);

function idx(col: number, row: number): number {
  return row * W + col;
}

// pass 1: biome + base height + base surface -----------------------------

const ICE_PEAK_LEVEL = 6.5;
for (let row = 0; row < H; row++) {
  for (let col = 0; col < W; col++) {
    const i = idx(col, row);
    const { biome, edge } = biomeAt(col, row);
    const bIdx = BIOMES.indexOf(biome);
    biomeId[i] = bIdx;
    let h: number;
    let s: SurfaceType;
    switch (biome) {
      case "desert":
        h = desertHeight(col, row, edge);
        s = "sand";
        break;
      case "ice": {
        const rolling = iceRolling(col, row);
        const north = Math.pow(Math.max(0, (185 - row) / 185), 0.7); // cordilheira mais forte ao norte, faixa larga
        const mNoise = iceMountainNoise(col, row);
        const peak = mNoise > 0.02 ? (mNoise - 0.02) * 26 * north : 0;
        h = 2.0 + rolling + peak + ridgeBoost(col, row, edge) * 1.4;
        s = "snow";
        // bolsões de solo exposto (dirt) onde árvore seca pode nascer, sem
        // depender do pico — regra do podeNascer.ts: tree_bare não fica na neve
        if (fbm(col, row, 3, 28, 0.5, 777) > 0.32 && h < ICE_PEAK_LEVEL) s = "dirt";
        break;
      }
      case "forest":
        h = forestHeight(col, row, edge);
        s = "grass";
        break;
      default:
        h = campoHeight(col, row, edge);
        s = "grass";
    }
    heightmap[i] = h;
    surface[i] = s;
    if (biome === "ice" && h >= ICE_PEAK_LEVEL) {
      collision[i] = "wall";
      surface[i] = "stone";
    }
  }
}

// -------------------------------------------------------- catmull-rom ----

function catmullRom(p: [number, number][], samplesPerSeg: number): [number, number][] {
  const pts = [p[0]!, ...p, p[p.length - 1]!];
  const out: [number, number][] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1]!, pts[i]!, pts[i + 1]!, pts[i + 2]!];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push(p[p.length - 1]!);
  return out;
}

function inMap(col: number, row: number): boolean {
  return col >= 0 && col < W && row >= 0 && row < H;
}

// ------------------------------------------------------------- roads -----

/** carimba uma estrada: pinta dirt, força andável, suaviza o relevo pra não
 * ziguezaguear morro acima (a altura-alvo é a MÉDIA da altura-base já gerada
 * ao longo da própria estrada, não uma constante). */
function stampRoad(waypoints: [number, number][], halfWidth: number, feather: number) {
  const path = catmullRom(waypoints, 40);
  // suaviza a altura-base ao longo do caminho (janela deslizante)
  const rawH = path.map(([x, z]) => {
    const c = Math.round(x);
    const r = Math.round(z);
    return inMap(c, r) ? heightmap[idx(c, r)]! : 1;
  });
  const win = 6;
  const smoothH = rawH.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -win; k <= win; k++) {
      const v = rawH[i + k];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    return sum / n;
  });
  const maxD = halfWidth + feather;
  for (let s = 0; s < path.length; s++) {
    const [px, pz] = path[s]!;
    const targetH = smoothH[s]!;
    const c0 = Math.max(0, Math.floor(px - maxD));
    const c1 = Math.min(W - 1, Math.ceil(px + maxD));
    const r0 = Math.max(0, Math.floor(pz - maxD));
    const r1 = Math.min(H - 1, Math.ceil(pz + maxD));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const d = Math.hypot(col - px, row - pz);
        if (d > maxD) continue;
        const i = idx(col, row);
        if (riverMask[i]) continue; // rio manda por cima de estrada
        if (d <= halfWidth) {
          roadMask[i] = 1;
          surface[i] = "dirt";
          collision[i] = "walkable";
          heightmap[i] = targetH;
        } else {
          const w = 1 - smooth((d - halfWidth) / feather);
          heightmap[i] = heightmap[i]! * (1 - w) + targetH * w;
        }
      }
    }
  }
}

// bounding boxes reais de cada bioma (pro caminho não sair andando por cima
// de outro bioma sem necessidade)
function biomeBounds(b: Biome): { minC: number; maxC: number; minR: number; maxR: number } {
  const bi = BIOMES.indexOf(b);
  let minC = W;
  let maxC = 0;
  let minR = H;
  let maxR = 0;
  for (let row = 0; row < H; row += 4) {
    for (let col = 0; col < W; col += 4) {
      if (biomeId[idx(col, row)] === bi) {
        if (col < minC) minC = col;
        if (col > maxC) maxC = col;
        if (row < minR) minR = row;
        if (row > maxR) maxR = row;
      }
    }
  }
  return { minC, maxC, minR, maxR };
}

const db = biomeBounds("desert");
stampRoad(
  [
    [db.minC + 8, (db.minR + db.maxR) / 2 - 10],
    [(db.minC + db.maxC) / 2 - 15, (db.minR + db.maxR) / 2 + 12],
    [(db.minC + db.maxC) / 2 + 20, (db.minR + db.maxR) / 2 - 6],
    [db.maxC - 8, (db.minR + db.maxR) / 2 + 8],
  ],
  2.2,
  3,
);

const ib = biomeBounds("ice");
stampRoad(
  [
    [(ib.minC + ib.maxC) / 2 - 5, ib.maxR - 10],
    [(ib.minC + ib.maxC) / 2 + 18, (ib.minR + ib.maxR) / 2 + 10],
    [(ib.minC + ib.maxC) / 2 - 10, (ib.minR + ib.maxR) / 2 - 20],
    [(ib.minC + ib.maxC) / 2 + 8, ib.minR + 12],
  ],
  2.2,
  3,
);

const cb = biomeBounds("campo");
stampRoad(
  [
    [cb.minC + 10, cb.minR + 10],
    [(cb.minC + cb.maxC) / 2 + 10, (cb.minR + cb.maxR) / 2 - 15],
    [(cb.minC + cb.maxC) / 2 - 12, (cb.minR + cb.maxR) / 2 + 18],
    [cb.maxC - 10, cb.maxR - 10],
  ],
  2.4,
  3,
);

// ------------------------------------------------------------- river -----

const fb = biomeBounds("forest");
function stampRiver(waypoints: [number, number][]) {
  const path = catmullRom(waypoints, 50);
  const rawH = path.map(([x, z]) => {
    const c = Math.round(x);
    const r = Math.round(z);
    return inMap(c, r) ? heightmap[idx(c, r)]! : 1;
  });
  const win = 8;
  const smoothH = rawH.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = -win; k <= win; k++) {
      const v = rawH[i + k];
      if (v !== undefined) {
        sum += v;
        n++;
      }
    }
    return sum / n;
  });
  for (let s = 0; s < path.length; s++) {
    const [px, pz] = path[s]!;
    const bedRef = smoothH[s]!;
    const halfWidth = 1.6 + fbm(px, pz, 2, 30, 0.5, 999) * 0.9; // largura variando (meandro)
    const bankFeather = 3.5;
    const maxD = halfWidth + bankFeather;
    const c0 = Math.max(0, Math.floor(px - maxD));
    const c1 = Math.min(W - 1, Math.ceil(px + maxD));
    const r0 = Math.max(0, Math.floor(pz - maxD));
    const r1 = Math.min(H - 1, Math.ceil(pz + maxD));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const d = Math.hypot(col - px, row - pz);
        if (d > maxD) continue;
        const i = idx(col, row);
        if (d <= halfWidth) {
          riverMask[i] = 1;
          roadMask[i] = 0;
          collision[i] = "water";
          surface[i] = "river";
          heightmap[i] = bedRef - 1.6;
        } else {
          const w = 1 - smooth((d - halfWidth) / bankFeather);
          if (!riverMask[i]) {
            heightmap[i] = heightmap[i]! * (1 - w) + (bedRef - 0.3) * w;
          }
        }
      }
    }
  }
}
stampRiver([
  [(fb.minC + fb.maxC) / 2 - 25, fb.minR + 6],
  [(fb.minC + fb.maxC) / 2 + 10, fb.minR + 35],
  [(fb.minC + fb.maxC) / 2 - 15, (fb.minR + fb.maxR) / 2],
  [(fb.minC + fb.maxC) / 2 + 20, (fb.minR + fb.maxR) / 2 + 35],
  [(fb.minC + fb.maxC) / 2 - 5, fb.maxR - 8],
]);

// -------------------------------------------------- estrada fechada -----
// floresta: caminho estreito (meia-largura menor), deixa vegetação crescer
// quase até a borda — stampRoad já cuida disso via halfWidth pequeno; o que
// muda é o SCATTER não ganhar buffer extra ao redor dela (ver mais abaixo).
stampRoad(
  [
    [fb.maxC - 10, fb.minR + 15],
    [(fb.minC + fb.maxC) / 2 + 15, (fb.minR + fb.maxR) / 2 - 10],
    [(fb.minC + fb.maxC) / 2 - 8, (fb.minR + fb.maxR) / 2 + 22],
    [fb.minC + 12, fb.maxR - 12],
  ],
  0.9,
  1.4,
);

// --------------------------------------------------------- protegidas ----

function markProtected(col: number, row: number, radius: number) {
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (!inMap(c, r)) continue;
      const i = idx(c, r);
      protectedMask[i] = 1;
      collision[i] = "walkable";
      roadMask[i] = 0;
      riverMask[i] = 0;
    }
  }
}

const original: GameMap = JSON.parse(readFileSync(MAP_PATH, "utf8"));
for (const s of original.spawns) {
  const [x, , z] = s.position;
  if (x === 0 && z === 0) continue; // sentinela "em qualquer lugar" do rAthena
  const col = Math.round(x / 2 - 0.5);
  const row = Math.round(z / 2 - 0.5);
  if (!inMap(col, row)) continue;
  markProtected(col, row, s.kind === "warp" ? 3 : 2);
}

// -------------------------------------------------------- sem zero -------

for (let i = 0; i < N; i++) if (heightmap[i] === 0) heightmap[i] = 0.001;

// ------------------------------------------------------------ scatter ----

interface ScatterRule {
  cat: "tree" | "bush" | "flower" | "plant" | "tree_bare" | "rock" | "stone";
  assetIds: string[];
  spacing: number;
  scaleRange: [number, number];
  collider: "hull" | "none";
}
const SURFACE_ALLOWED: Record<string, Set<SurfaceType>> = {
  tree: new Set(["grass", "dirt"]),
  bush: new Set(["grass", "dirt"]),
  flower: new Set(["grass", "dirt"]),
  plant: new Set(["grass", "dirt"]),
  tree_bare: new Set(["dirt", "sand"]),
  rock: new Set(["grass", "dirt", "sand", "snow"]),
  stone: new Set(["grass", "dirt", "sand", "snow"]),
};
const FLAT_REQUIRED = new Set(["tree", "bush", "flower", "plant", "tree_bare"]);
const INCLINACAO_MAX = 0.5;

function inclinacao(col: number, row: number): number {
  const aqui = heightmap[idx(col, row)]!;
  let maior = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const c = col + dc;
      const r = row + dr;
      if (!inMap(c, r)) continue;
      maior = Math.max(maior, Math.abs(heightmap[idx(c, r)]! - aqui));
    }
  }
  return maior;
}
function podeNascer(rule: ScatterRule, col: number, row: number): boolean {
  const i = idx(col, row);
  if (protectedMask[i]) return false;
  if (collision[i] !== "walkable") return false;
  if (roadMask[i] || riverMask[i]) return false;
  const allowed = SURFACE_ALLOWED[rule.cat]!;
  if (!allowed.has(surface[i]!)) return false;
  if (FLAT_REQUIRED.has(rule.cat) && inclinacao(col, row) > INCLINACAO_MAX) return false;
  return true;
}

const COLLIDER_BY_CAT: Record<string, "hull" | "none"> = {
  tree: "hull",
  tree_bare: "hull",
  rock: "hull",
  bush: "none",
  flower: "none",
  plant: "none",
  stone: "none",
};

function rulesFor(biome: Biome): ScatterRule[] {
  const trees = ["commontree_1", "commontree_2", "commontree_3", "commontree_4", "commontree_5", "pine_1", "pine_2", "pine_3", "pine_4", "pine_5", "twistedtree_1", "twistedtree_2", "twistedtree_3", "twistedtree_4", "twistedtree_5"];
  const deadTrees = ["deadtree_1", "deadtree_2", "deadtree_3", "deadtree_4", "deadtree_5"];
  const bush = ["bush_common", "bush_common_flowers"];
  const flowers = ["flower_3_group", "flower_3_single", "flower_4_group", "flower_4_single", "petal_1", "petal_2", "petal_3", "petal_4", "petal_5", "clover_1", "clover_2"];
  const plants = ["fern_1", "mushroom_common", "mushroom_laetiporus", "plant_1", "plant_1_big", "plant_7", "plant_7_big"];
  const rocks = ["rock_medium_1", "rock_medium_2", "rock_medium_3"];
  const pebblesRound = ["pebble_round_1", "pebble_round_2", "pebble_round_3", "pebble_round_4", "pebble_round_5", "rockpath_round_small_1", "rockpath_round_small_2", "rockpath_round_small_3", "rockpath_round_thin", "rockpath_round_wide"];
  const pebblesSquare = ["pebble_square_1", "pebble_square_2", "pebble_square_3", "pebble_square_4", "pebble_square_5", "pebble_square_6", "rockpath_square_small_1", "rockpath_square_small_2", "rockpath_square_small_3", "rockpath_square_thin", "rockpath_square_wide"];

  switch (biome) {
    case "forest":
      return [
        { cat: "tree", assetIds: trees, spacing: 4, scaleRange: [0.85, 1.3], collider: "hull" },
        { cat: "bush", assetIds: bush, spacing: 4, scaleRange: [0.8, 1.2], collider: "none" },
        { cat: "flower", assetIds: flowers, spacing: 4, scaleRange: [0.8, 1.3], collider: "none" },
        { cat: "plant", assetIds: plants, spacing: 6, scaleRange: [0.8, 1.3], collider: "none" },
        { cat: "rock", assetIds: rocks, spacing: 13, scaleRange: [0.8, 1.4], collider: "hull" },
        { cat: "stone", assetIds: pebblesRound, spacing: 9, scaleRange: [0.8, 1.3], collider: "none" },
      ];
    case "campo":
      return [
        { cat: "flower", assetIds: flowers, spacing: 5, scaleRange: [0.8, 1.3], collider: "none" },
        { cat: "bush", assetIds: bush, spacing: 10, scaleRange: [0.8, 1.2], collider: "none" },
        { cat: "tree", assetIds: trees, spacing: 22, scaleRange: [0.85, 1.2], collider: "hull" },
        { cat: "rock", assetIds: rocks, spacing: 20, scaleRange: [0.8, 1.3], collider: "hull" },
        { cat: "stone", assetIds: pebblesRound, spacing: 12, scaleRange: [0.8, 1.2], collider: "none" },
      ];
    case "desert":
      return [
        { cat: "tree_bare", assetIds: deadTrees, spacing: 11, scaleRange: [0.85, 1.25], collider: "hull" },
        { cat: "rock", assetIds: rocks, spacing: 10, scaleRange: [0.9, 1.5], collider: "hull" },
        { cat: "stone", assetIds: pebblesSquare, spacing: 8, scaleRange: [0.8, 1.3], collider: "none" },
      ];
    case "ice":
      return [
        { cat: "tree_bare", assetIds: deadTrees, spacing: 9, scaleRange: [0.8, 1.15], collider: "hull" },
        { cat: "rock", assetIds: rocks, spacing: 8, scaleRange: [0.9, 1.5], collider: "hull" },
        { cat: "stone", assetIds: pebblesRound, spacing: 8, scaleRange: [0.8, 1.2], collider: "none" },
      ];
  }
}

const props: MapProp[] = [];
let propSeq = 0;
for (const biome of BIOMES) {
  const bi = BIOMES.indexOf(biome);
  for (const rule of rulesFor(biome)) {
    for (let row = 0; row < H; row += rule.spacing) {
      for (let col = 0; col < W; col += rule.spacing) {
        const jc = col + (rnd() - 0.5) * rule.spacing * 0.8;
        const jr = row + (rnd() - 0.5) * rule.spacing * 0.8;
        const c = Math.round(jc);
        const r = Math.round(jr);
        if (!inMap(c, r)) continue;
        const i = idx(c, r);
        if (biomeId[i] !== bi) continue;
        if (!podeNascer(rule, c, r)) continue;
        const assetId = rule.assetIds[Math.floor(rnd() * rule.assetIds.length)]!;
        const scale = rule.scaleRange[0] + rnd() * (rule.scaleRange[1] - rule.scaleRange[0]);
        const x = (jc + 0.5) * 2;
        const z = (jr + 0.5) * 2;
        const y = heightmap[i]! * 1.0;
        props.push({
          id: `gen-${propSeq++}`,
          assetId,
          position: [x, y, z],
          rotation: [0, rnd() * Math.PI * 2, 0],
          scale: [scale, scale, scale],
          colliderType: rule.collider,
        });
      }
    }
  }
}

// ------------------------------------------------------------- montagem --

const newMap: GameMap = GameMapSchema.parse({
  id: original.id,
  name: original.name,
  size: { width: W, height: H },
  cellSize: original.cellSize,
  terrainMode: "square",
  heightmap: Array.from(heightmap),
  collision,
  surface,
  terrainStyle: {
    sand: { texture: "sand", scale: 20 },
    snow: { texture: "snow-snow_covered_ground-4K", scale: 24 },
    stone: { texture: "stone-rock_boulder_cracked", scale: 26 },
    dirt: { texture: "dirt-brown_mud_dry", scale: 20 },
    grass: { texture: "grass-aerial_rocks_04", scale: 24 },
    water: { texture: "water-Water_02", scale: 12 },
    river: { texture: "water-Water_03", scale: 12 },
  },
  waterLevel: null,
  props,
  spawns: original.spawns,
  triggers: original.triggers ?? [],
  ramps: [],
  grass: original.grass,
  legacy: original.legacy,
  metadata: {
    sourceLegacyMap: "prt_fild08",
    version: MAP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
  },
});

writeFileSync(MAP_PATH, JSON.stringify(newMap));

// -------------------------------------------------------------- report ---

const collCount: Record<string, number> = {};
for (const c of newMap.collision) collCount[c] = (collCount[c] ?? 0) + 1;
const surfCount: Record<string, number> = {};
for (const s of newMap.surface) surfCount[s] = (surfCount[s] ?? 0) + 1;
const biomeCellCount: Record<string, number> = { desert: 0, ice: 0, forest: 0, campo: 0 };
for (let i = 0; i < N; i++) biomeCellCount[BIOMES[biomeId[i]!]!]! += 1;
const propCount: Record<string, number> = {};
for (const p of newMap.props) propCount[p.assetId] = (propCount[p.assetId] ?? 0) + 1;

console.log("size", newMap.size);
console.log("collision", collCount);
console.log("surface", surfCount);
console.log("biome cells", biomeCellCount);
console.log("props total", newMap.props.length, "distinct assets", Object.keys(propCount).length);
console.log("spawns preserved", newMap.spawns.length, "(original had", original.spawns.length, ")");
let hmin = Infinity;
let hmax = -Infinity;
for (const h of newMap.heightmap) {
  if (h < hmin) hmin = h;
  if (h > hmax) hmax = h;
}
console.log("heightmap min/max", hmin, hmax);
console.log("wrote", MAP_PATH);
