import { create } from "zustand";
import type { GameMap, MapProp, MapSpawn, SurfaceType, MapTrigger, TriggerKind, Lighting } from "@ragnarok/map-format";
import { cellIndex, createBlankMap, DEFAULT_LIGHTING } from "@ragnarok/map-format";
import { getHexScale } from "../hex/hexGrid";
import { editorGrid, setEditorGrid } from "./activeGrid";
import { findBlockedClusters } from "./blockedClusters";
import { cellInScope, worldInScope, type EditScope } from "./editScope";
import { surfaceFromCollision } from "../grid/squareChunks";
import { rampCells } from "./rampBrush";
import { cornerNormal } from "../grid/heightField";

export type { EditScope };
import { edgeBetween, neighborAt } from "../hex/hexTiles";
import type { GroundSettings } from "../hex/groundMaterial";
import { propDefaultScale, propCategory, propRadius, propSpread, tileSurfaceFor, SOLID_CATEGORIES, colliderForCategory, colliderForAsset, PROP_BY_CATEGORY, type PropCatalogEntry } from "../props/registry";

/** persistência das configs procedurais (sobrevive ao F5) */
const PROC_KEY = "ragnarok.editor.procedural";
function saveProc(amounts: Record<string, number>, disabled: Record<string, string[]>) {
  try { localStorage.setItem(PROC_KEY, JSON.stringify({ amounts, disabled })); } catch { /* noop */ }
}
function loadProc(): { amounts: Record<string, number>; disabled: Record<string, string[]> } | null {
  try { const r = localStorage.getItem(PROC_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
/** espécies ativas de uma categoria (todas menos as desativadas) */
/**
 * Espécies ativas de uma camada.
 *
 * `key` é a chave da CAMADA (`escopo:categoria`, ver procKey) e `category` diz de
 * qual catálogo sair. Uma camada sem entrada em `disabled` cai na chave da
 * categoria pura — é o formato antigo, de quando a configuração não tinha escopo.
 */
function activeSpecies(key: string, disabled: Record<string, string[]>, category?: string): PropCatalogEntry[] {
  const cat = category ?? key;
  const items = PROP_BY_CATEGORY.find((g) => g.cat === cat)?.items ?? [];
  const off = disabled[key] ?? disabled[cat];
  return off && off.length ? items.filter((it) => !off.includes(it.id)) : items;
}

/** mapa novo começa com TODAS as espécies desmarcadas em TODAS as categorias
 * (usuário ativa as que quiser) — regra do usuário pros geradores. Uma entrada
 * por camada, para cada escopo poder ligar espécies diferentes. */
function allSpeciesDisabled(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const escopos: EditScope[] = ["all", "inside", "border", "hole"];
  for (const g of PROP_BY_CATEGORY) {
    const todos = g.items.map((it) => it.id);
    out[g.cat] = todos;
    for (const e of escopos) out[procKey(e, g.cat)] = todos;
  }
  return out;
}

/** ---- Terreno procedural: relevo (colinas/montanhas) + lagos, gerado do zero
 * a partir de parâmetros + seed. Determinístico (mesmo seed = mesmo relevo). ---- */
function hash2(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** value noise 2D suave (lattice + interpolação) em [0,1] */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
/** fbm 2 oitavas (colinas mais orgânicas) */
function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, seed) * 0.65 + valueNoise(x * 2.1, y * 2.1, seed + 17) * 0.35;
}

export interface TerrainFeatures {
  hill: number; // 0-100: relevo suave (colinas)
  lake: number; // 0-100: lagos (água)
}

/** seed por feature (colina/lago) — cada ♻ re-randomiza só a sua */
type TerrainSeeds = Record<keyof TerrainFeatures, number>;

/** gera heightmap/collision/surface/ramps do zero: base plana + colinas (fbm) +
 * lagos (água em bacias). Cada feature usa o SEU seed → reciclar uma não mexe
 * nas outras. Determinístico.
 *
 * Montanha NÃO esculpe altura aqui — é asset espalhável (categoria "mountain"
 * na Geração procedural, igual árvore/construção): o usuário escolhe QUAIS
 * modelos entram, sem degrau/rampa forçados pelo gerador. */
function generateTerrain(
  map: GameMap,
  f: TerrainFeatures,
  seeds: TerrainSeeds,
  scope: EditScope = "all",
): Pick<GameMap, "heightmap" | "collision" | "surface" | "ramps"> {
  const { width: W, height: H } = map.size;
  const n = W * H;
  /**
   * Mapa importado do rAthena (ou escopo restrito) é EDITADO, não recriado.
   *
   * Este gerador nasceu para mapa novo: partia de arrays zerados
   * (`fill("walkable")`, `fill("grass")`). Rodá-lo num mapa do servidor apagava a
   * colisão inteira — parede, buraco e o cinturão da borda viravam campo aberto
   * de uma vez, e o mapa jogável divergia do que o rAthena barra. Com base
   * preservada, o relevo/lago entra POR CIMA do que já existe e só onde o escopo
   * da barra manda.
   */
  const editar = scope !== "all" || map.terrainMode === "square";
  const heightmap = editar ? map.heightmap.slice() : new Array<number>(n).fill(0);
  const collision = (editar ? map.collision.slice() : new Array(n).fill("walkable")) as GameMap["collision"];
  const surface = (
    editar ? (map.surface.length ? map.surface.slice() : surfaceFromCollision(map)) : new Array(n).fill("grass")
  ) as SurfaceType[];
  const rampAt = new Map<number, number>(); // célula → borda de descida
  const clamp = (v: number) => Math.max(0, Math.min(12, v));
  const noEscopo = (col: number, row: number) => !editar || cellInScope(map, scope, col, row);
  const bloqueada = (i: number) => collision[i] === "wall" || collision[i] === "cliff";
  // mesma regra do pincel: só "Dentro" poupa o bloqueio; nos outros escopos o
  // relevo molda mata e ravina também (a colisão nunca muda)
  const pouparBloqueio = scope === "inside";

  // colinas: fbm suave escalado pela %
  if (f.hill > 0) {
    const amp = (f.hill / 100) * 4; // até ~4 níveis
    const freq = 0.09;
    for (let row = 0; row < H; row++)
      for (let col = 0; col < W; col++) {
        const i = row * W + col;
        if (!noEscopo(col, row) || (editar && pouparBloqueio && bloqueada(i))) continue;
        const nz = fbm(col * freq, row * freq, seeds.hill);
        heightmap[i] = clamp(Math.round(nz * amp));
      }
  }
  // lagos: L bacias de água (sobrescreve p/ água, nível 0)
  if (f.lake > 0) {
    const rnd = rngFrom(seeds.lake);
    const L = Math.max(1, Math.round((f.lake / 100) * (n / 800)));
    for (let k = 0; k < L; k++) {
      const cc = Math.floor(rnd() * W), cr = Math.floor(rnd() * H);
      const R = 3 + Math.floor(rnd() * 5); // raio 3-7
      // bacia: a água vai até R, e a MARGEM (R+1.6) desce pro nível da água —
      // sem isso o lago fica no fundo de um paredão e não sobra onde pôr praia.
      const beach = R + 1.6;
      for (let row = Math.max(0, cr - beach - 1); row <= Math.min(H - 1, cr + beach + 1); row++)
        for (let col = Math.max(0, cc - beach - 1); col <= Math.min(W - 1, cc + beach + 1); col++) {
          const d = Math.hypot(col - cc, row - cr);
          if (d > beach) continue;
          const i = row * W + col;
          // O lago poupa o bloqueio em TODO escopo, inclusive "Tudo": ele grava
          // `collision: "water"`, que no rAthena é ANDÁVEL (tipo 3) — cavar um
          // lago dentro da moldura abriria passagem por ela. Altura é livre nos
          // outros escopos; passagem, nunca.
          if (!noEscopo(col, row) || (editar && bloqueada(i))) continue;
          heightmap[i] = 0;
          rampAt.delete(i); // lago/praia afogou a trilha aqui
          if (d > R) continue; // anel externo = terra rasa (vira costa/praia)
          surface[i] = "water";
          collision[i] = "water";
        }
    }
  }
  sanitizeRamps(rampAt, heightmap, W, H);
  return { heightmap, collision, surface, ramps: flattenRamps(rampAt) };
}

/** Descarta rampas que não encaixam: a peça sobe exatamente 1 nível, então o
 * vizinho do lado ALTO tem que estar em nível+1. Sem essa faxina, uma montanha
 * gerada depois (ou uma edição à mão) deixa rampa flutuando no vão. */
function sanitizeRamps(ramps: Map<number, number>, heightmap: number[], W: number, H: number) {
  for (const [cell, down] of [...ramps]) {
    const row = Math.floor(cell / W), col = cell % W;
    const [nc, nr] = neighborAt(col, row, (down + 3) % 6); // lado alto
    if (nc < 0 || nc >= W || nr < 0 || nr >= H) { ramps.delete(cell); continue; }
    if ((heightmap[nr * W + nc] ?? 0) !== (heightmap[cell] ?? 0) + 1) ramps.delete(cell);
  }
}

/** Map(célula→borda) → array achatado [célula, borda, ...] do GameMap */
function flattenRamps(m: Map<number, number>): number[] {
  const out: number[] = [];
  for (const [cell, edge] of m) out.push(cell, edge);
  return out;
}
/** array achatado → Map (pra editar sem perder as rampas existentes) */
function rampMap(flat: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i + 1 < flat.length; i += 2) m.set(flat[i]!, flat[i + 1]!);
  return m;
}

/** ---- Rios & Estradas conectados: caminhos de células (linha hex serpenteante).
 * O gerador só MARCA a superfície da célula — estrada = "dirt", rio = "river".
 * Quem escolhe a peça KayKit (reta/curva/T/cruz/ponta) e a rotação é o
 * HexTerrain, derivando da conectividade dos vizinhos (ver hex/hexTiles.ts).
 * Assim editar o mapa à mão continua produzindo traçado contínuo. ---- */

/** offset odd-r (pointy-top) ↔ cube, pra traçar linha hex contígua */
function offsetToCube(col: number, row: number) {
  const x = col - (row - (row & 1)) / 2;
  const z = row;
  return { x, y: -x - z, z };
}
function cubeRound(x: number, y: number, z: number) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}
function cubeToOffset(x: number, z: number) {
  return { col: x + (z - (z & 1)) / 2, row: z };
}
/** células ao longo da linha hex de (c0,r0) a (c1,r1), inclusive */
function hexLine(c0: number, r0: number, c1: number, r1: number): { col: number; row: number }[] {
  const a = offsetToCube(c0, r0), b = offsetToCube(c1, r1);
  const N = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
  const out: { col: number; row: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i <= N; i++) {
    const t = N === 0 ? 0 : i / N;
    const c = cubeRound(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    const o = cubeToOffset(c.x, c.z);
    const key = `${o.col},${o.row}`;
    if (!seen.has(key)) { seen.add(key); out.push(o); }
  }
  return out;
}

/** caminho SERPENTEANTE entre 2 células: segue o eixo A→B mas com deslocamento
 * perpendicular por ruído senoidal (várias frequências + fases aleatórias do
 * seed), afunilando pra 0 nas pontas (acerta os extremos). ampFrac = amplitude
 * como fração do comprimento (mapa maior → meandro maior, orgânico). Preenche
 * contíguo com hexLine entre os pontos amostrados. */
function wanderPath(c0: number, r0: number, c1: number, r1: number, ampFrac: number, seed: number): { col: number; row: number }[] {
  const A = editorGrid().cellToWorld(c0, r0), B = editorGrid().cellToWorld(c1, r1);
  const dx = B.x - A.x, dz = B.z - A.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len; // ao longo
  const px = -uz, pz = ux; // perpendicular
  const amp = len * ampFrac;
  const rnd = rngFrom(seed);
  const ph1 = rnd() * Math.PI * 2, ph2 = rnd() * Math.PI * 2, ph3 = rnd() * Math.PI * 2;
  const f1 = 1 + rnd() * 1.2, f2 = 2.3 + rnd() * 1.8, f3 = 4 + rnd() * 2.5;
  const steps = Math.max(2, Math.ceil(len / (editorGrid().cellWidth() * 0.9)));
  const raw: { col: number; row: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const taper = Math.sin(t * Math.PI); // 0 nas pontas → acerta A e B
    const off = amp * taper * (Math.sin(t * Math.PI * 2 * f1 + ph1) * 0.5 + Math.sin(t * Math.PI * 2 * f2 + ph2) * 0.3 + Math.sin(t * Math.PI * 2 * f3 + ph3) * 0.2);
    raw.push(editorGrid().worldToCell(A.x + ux * len * t + px * off, A.z + uz * len * t + pz * off));
  }
  const out: { col: number; row: number }[] = [];
  const seen = new Set<string>();
  const add = (c: { col: number; row: number }) => { const k = `${c.col},${c.row}`; if (!seen.has(k)) { seen.add(k); out.push(c); } };
  for (let i = 0; i < raw.length - 1; i++) for (const c of hexLine(raw[i]!.col, raw[i]!.row, raw[i + 1]!.col, raw[i + 1]!.row)) add(c);
  return out;
}

/** ---- Prefabs: grupos reutilizáveis de props (persistem no localStorage) ----
 * Um prefab guarda os props relativos ao centroide (x,z) do grupo, pra poder
 * ser "carimbado" em qualquer hex. Compartilhado entre mapas (é do editor). */
export interface PrefabItem {
  assetId: string;
  dx: number; // deslocamento X relativo ao centroide do grupo
  dz: number; // deslocamento Z relativo ao centroide
  ry: number; // rotação Y (mundo)
  scale: number;
  colliderType: MapProp["colliderType"];
  tags?: string[];
}
export interface PrefabDef {
  id: string;
  name: string;
  items: PrefabItem[];
}
const PREFAB_KEY = "ragnarok.editor.prefabs";
function loadPrefabs(): PrefabDef[] {
  try { const r = localStorage.getItem(PREFAB_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function savePrefabs(list: PrefabDef[]) {
  try { localStorage.setItem(PREFAB_KEY, JSON.stringify(list)); } catch { /* quota */ }
}

/** seed ESTÁVEL de um trecho de estrada, derivado dos ids dos dois nós que ele
 * liga (ordem-independente). Mover um nó muda as PONTAS do trecho mas não o
 * padrão do meandro, e não mexe em nenhum outro trecho da rede. */
function edgeSeed(idA: string, idB: string): number {
  const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** RNG determinístico (mulberry32) — mesmo seed = mesmo layout */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** espaçamento mínimo (mundo) por categoria — distância entre assets. Assets do
 * KayKit hex saem em scale ~5 (grandes), então precisam de bastante espaço pra
 * não empilhar. Quanto maior o spacing, MENOS assets por área (slider mais suave). */
const GEN_SPACING: Record<string, number> = {
  building: 26, // construções bem espaçadas (poucas por área)
  mountain: 22,
  hill: 14,
  rock: 7,
  tree: 7,
  tree_bare: 7,
  bush: 5,
  grass: 3.5,
};

/** área ocupada por um objeto no mundo: centro + raio já escalado */
export interface OccupiedArea { x: number; z: number; r: number }

/**
 * ÁREA ocupada pelos props SÓLIDOS (construção/árvore/pedra/colina/montanha/
 * árvore seca — ver SOLID_CATEGORIES): nenhum asset AUTO-GERADO pode nascer em
 * cima (regra do usuário: nunca empilhar auto-asset sobre outro, e montanha em
 * especial nunca sobre árvore/rio/estrada/pedra/construção).
 *
 * Círculo com o raio VISUAL do modelo × escala do prop (propSpread, medido do
 * glTF — inclui copa/telhado, ao contrário do raio de COLISÃO) — não mais "o hex onde o prop está": os assets do KayKit saem em escala
 * ~5 e cobrem vários hexágonos, então marcar só a célula do centro deixava
 * montanha nascendo por cima de árvore vizinha. Inclui os spawns (o player não
 * pode nascer preso dentro de um tronco).
 */
function occupiedAreas(props: MapProp[], spawns: MapSpawn[] = []): OccupiedArea[] {
  const out: OccupiedArea[] = [];
  for (const p of props) {
    const cat = propCategory(p.assetId);
    if (!cat || !SOLID_CATEGORIES.has(cat)) continue;
    const r = propSpread(p.assetId, p.scale[0] ?? 1);
    if (r > 0) out.push({ x: p.position[0], z: p.position[2], r });
  }
  for (const sp of spawns) out.push({ x: sp.position[0], z: sp.position[2], r: editorGrid().cellWidth() * 0.75 });
  return out;
}

/** hash grid de áreas ocupadas: `blocks(x,z,r)` em O(1) amortizado (mapas de
 * 500×500 têm dezenas de milhares de props — varrer a lista era O(n²)). */
function areaIndex(areas: OccupiedArea[]) {
  const CELL = 8; // fixo: o índice cresce durante a geração (add), então o
  // tamanho do bucket não pode depender do maior raio inicial
  const grid = new Map<string, OccupiedArea[]>();
  let count = 0;
  let maxR = 0; // maior raio JÁ indexado — define quantos buckets varrer
  const put = (a: OccupiedArea) => {
    const k = `${Math.floor(a.x / CELL)},${Math.floor(a.z / CELL)}`;
    const arr = grid.get(k);
    if (arr) arr.push(a);
    else grid.set(k, [a]);
    if (a.r > maxR) maxR = a.r;
    count++;
  };
  for (const a of areas) put(a);
  return {
    /** o círculo (x,z,r) encosta em alguma área ocupada? */
    blocks(x: number, z: number, r: number): boolean {
      if (count === 0) return false;
      // alcance = maior raio indexado + o raio consultado (uma montanha de raio
      // 4.4 alcança um vizinho a 9 de distância: 1 bucket não bastava)
      const reach = Math.ceil((maxR + r) / CELL);
      const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
      for (let dx = -reach; dx <= reach; dx++)
        for (let dz = -reach; dz <= reach; dz++) {
          const arr = grid.get(`${gx + dx},${gz + dz}`);
          if (!arr) continue;
          for (const a of arr) {
            const ex = a.x - x, ez = a.z - z, rr = a.r + r;
            if (ex * ex + ez * ez < rr * rr) return true;
          }
        }
      return false;
    },
    /** registra uma área nova (o que acabou de ser gerado também ocupa) */
    add: put,
  };
}

/**
 * Chave da camada procedural: uma por CATEGORIA e por ESCOPO.
 *
 * O pedido é ter camada separada por parte do mapa ("dentro | borda | buraco"),
 * então quantidade, seed e espécies ativas são estado de `escopo:categoria`.
 * Com uma chave só por categoria, ajustar a vegetação de dentro reconstruía a
 * camada e apagava a que tinha sido gerada na borda.
 */
export function procKey(scope: EditScope, category: string): string {
  return `${scope}:${category}`;
}

/** todos os escopos, para semear os registros por camada */
const EDIT_SCOPES: EditScope[] = ["all", "inside", "border", "hole"];

/** relevo/lago em zero em TODAS as camadas (nada gera até o usuário pedir) */
function emptyTerrainFeatures(): Record<EditScope, TerrainFeatures> {
  return Object.fromEntries(EDIT_SCOPES.map((e) => [e, { hill: 0, lake: 0 }])) as Record<
    EditScope,
    TerrainFeatures
  >;
}

/** seeds independentes por camada: re-randomizar a borda não mexe no miolo */
function freshTerrainSeeds(): Record<EditScope, TerrainSeeds> {
  return Object.fromEntries(
    EDIT_SCOPES.map((e) => [e, { hill: (Math.random() * 1e9) | 0, lake: (Math.random() * 1e9) | 0 }]),
  ) as Record<EditScope, TerrainSeeds>;
}

/** inverso do procKey; chave sem escopo (formato antigo) volta como "all" */
function splitProcKey(key: string): [EditScope, string] {
  const corte = key.indexOf(":");
  if (corte < 0) return ["all", key];
  return [key.slice(0, corte) as EditScope, key.slice(corte + 1)];
}

/** o prop foi gerado por esta camada (categoria + escopo)? */
function isGenerated(p: MapProp, category: string, scope: EditScope): boolean {
  if (p.tags?.[0] !== "_gen" || p.tags?.[1] !== category) return false;
  // mapas salvos antes de a camada ter escopo não têm a terceira tag; contam
  // como "all" para não ficarem órfãos (nem some, nem duplica)
  return (p.tags?.[2] ?? "all") === scope;
}

interface ScatterOpts {
  category: string;
  species: PropCatalogEntry[]; // espécies ativas (subconjunto da categoria)
  amount: number; // 0-100 (% das células andáveis)
  seed: number;
  jitterScale: boolean;
  jitterRot: boolean;
  /** áreas já ocupadas (props sólidos de QUALQUER categoria + spawns) */
  occupied?: OccupiedArea[];
  /** escopo da barra do editor: a geração só cai nas células daquele lado */
  scope?: EditScope;
}

/**
 * Gera deterministicamente (por seed) o espalhamento de uma categoria nas
 * células andáveis (fora d'água). Ordem estável por seed → aumentar `amount`
 * ADICIONA os próximos da mesma ordem, diminuir REMOVE (slider reativo). Marca
 * os props com tags ["_gen", category] pra poder regenerar só essa camada.
 */
function generateScatter(map: GameMap, o: ScatterOpts): MapProp[] {
  const species = o.species;
  if (species.length === 0 || o.amount <= 0) return [];
  const { width: W, height: H } = map.size;
  const rnd = rngFrom(o.seed);
  // índice das áreas ocupadas: cada asset colocado entra nele, então o teste
  // vale contra props de OUTRAS categorias e contra os desta mesma leva.
  const occupied = areaIndex([...(o.occupied ?? [])]);
  // margem: marca as células de rio/estrada/lago (água/terra/pedra) + as vizinhas
  // como proibidas → deixa uma borda livre de 1 hex ao redor (nada gera colado).
  const nearPath = new Set<string>();
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W; col++) {
      const surf = map.surface[cellIndex(map, col, row)];
      if (surf === "water" || surf === "river" || surf === "dirt" || surf === "stone") {
        nearPath.add(`${col},${row}`);
        for (const [nc, nr] of editorGrid().neighbors(col, row)) nearPath.add(`${nc},${nr}`);
      }
    }
  const candidates: [number, number][] = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = cellIndex(map, col, row);
      // Fora de rio/estrada/lago + margem (o teste de área ocupada é por posição
      // final do asset, mais abaixo — depende do jitter e do raio).
      //
      // Andabilidade depende do ESCOPO: "dentro" e "tudo" povoam o campo, então
      // exigem célula andável. "Borda" e "Buraco" são regiões BLOQUEADAS por
      // definição (o cinturão de mata, a ravina) — exigir andável ali fazia o
      // slider gerar exatamente zero árvore, que era o mesmo que a camada não
      // existir.
      const escopo = o.scope ?? "all";
      const exigeAndavel = escopo === "all" || escopo === "inside";
      if (
        (!exigeAndavel || map.collision[i] === "walkable") &&
        !nearPath.has(`${col},${row}`) &&
        cellInScope(map, escopo, col, row)
      ) {
        candidates.push([col, row]);
      }
    }
  }
  // shuffle determinístico (Fisher-Yates com o rng do seed)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const spacing = GEN_SPACING[o.category] ?? 3;
  // Quantidade proporcional à ÁREA ANDÁVEL do mapa (∝ W×H em células): cada célula
  // hex tem ~CELL_AREA de área de mundo; cada asset ocupa ~spacing² (distância
  // mínima entre eles). maxCount = área andável / área por asset → é o "100%" do
  // slider. Como candidates cresce com o tamanho do mapa, gerar 30% num mapa 500×500
  // dá proporcionalmente MAIS assets que num 32×32 — mesma densidade por área.
  const CELL_AREA = 3.46; // área de 1 hexágono (size 1.1547)
  const FILL = 0.45; // fator de empacotamento no 100% (floresta cheia, sem lotar)
  const walkableArea = candidates.length * CELL_AREA;
  const maxCount = Math.max(1, Math.floor((walkableArea / (spacing * spacing)) * FILL));
  const target = Math.min(candidates.length, Math.round((o.amount / 100) * maxCount));
  const out: MapProp[] = [];
  // tooClose via hash espacial (bucket = spacing): O(1) amortizado por consulta,
  // pra não travar em mapas grandes (500×500 = 250k células). Antes era O(n²).
  const grid = new Map<string, [number, number][]>();
  const gk = (x: number, z: number) => `${Math.floor(x / spacing)},${Math.floor(z / spacing)}`;
  const tooClose = (x: number, z: number) => {
    const gx = Math.floor(x / spacing), gz = Math.floor(z / spacing);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get(`${gx + dx},${gz + dz}`);
        if (arr) for (const [ax, az] of arr) if (Math.hypot(ax - x, az - z) < spacing) return true;
      }
    return false;
  };
  let n = 0;
  for (let k = 0; k < candidates.length && out.length < target; k++) {
    const [col, row] = candidates[k]!;
    const sp = species[Math.floor(rnd() * species.length)]!;
    const { x, z } = editorGrid().cellToWorld(col, row);
    const jx = x + (rnd() - 0.5) * 1.2;
    const jz = z + (rnd() - 0.5) * 1.2;
    if (tooClose(jx, jz)) continue; // espaçamento da categoria (densidade)
    const base = propDefaultScale(sp.id);
    const sc = o.jitterScale ? base * (0.8 + rnd() * 0.4) : base;
    // área REAL deste asset já escalado: se encostar em qualquer coisa sólida
    // (outra categoria, prop manual, spawn ou um irmão desta leva), pula.
    const rad = propSpread(sp.id, sc);
    if (occupied.blocks(jx, jz, rad)) continue;
    occupied.add({ x: jx, z: jz, r: rad });
    const key = gk(jx, jz);
    const bucket = grid.get(key);
    if (bucket) bucket.push([jx, jz]);
    else grid.set(key, [[jx, jz]]);
    out.push({
      id: `g${o.seed.toString(36)}_${o.category}_${n++}`,
      assetId: sp.id,
      position: [jx, editorGrid().levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0), jz],
      rotation: [0, o.jitterRot ? rnd() * Math.PI * 2 : 0, 0],
      scale: [sc, sc, sc],
      colliderType: colliderForCategory(o.category),
      // a terceira tag é a CAMADA (escopo): é ela que deixa regenerar a
      // vegetação de dentro sem apagar a que foi gerada na borda
      tags: ["_gen", o.category, o.scope ?? "all"],
    });
  }
  return out;
}

/** monstros disponíveis pra spawn no editor (refId = characterKey do 3D) */
export const SPAWN_MONSTERS = [
  { key: "skeleton_warrior", label: "Esqueleto Guerreiro" },
  { key: "skeleton_minion", label: "Esqueleto Lacaio" },
] as const;

/** NPCs disponíveis pra spawn (refId = characterKey do 3D) */
export const SPAWN_NPCS = [
  { key: "knight", label: "Aldeão (Knight)" },
] as const;

/** tipos de gatilho de área: rótulo + cor (usada no box translúcido e legenda) */
export const TRIGGER_KINDS: { kind: TriggerKind; label: string; color: string }[] = [
  { kind: "warp", label: "Portal (warp)", color: "#a855f7" },
  { kind: "script", label: "Evento (script)", color: "#f59e0b" },
  { kind: "damage", label: "Dano (armadilha)", color: "#ef4444" },
  { kind: "heal", label: "Cura (área segura)", color: "#22c55e" },
  { kind: "save", label: "Ponto de save", color: "#3b82f6" },
];
export function triggerColor(kind: TriggerKind): string {
  return TRIGGER_KINDS.find((t) => t.kind === kind)?.color ?? "#94a3b8";
}

/** camadas do mapa (visibilidade no editor). Objetos pertencem a uma camada
 * derivada do tipo (terreno/vegetação/rochas/relevo/spawns). */
export const LAYERS = [
  { id: "terrain", label: "Terreno" },
  { id: "vegetation", label: "Vegetação" },
  { id: "rocks", label: "Rochas/Relevo" },
  { id: "spawns", label: "Spawns/NPCs" },
] as const;
export type LayerId = (typeof LAYERS)[number]["id"];

/** camada de um prop pelo assetId/categoria */
export function layerOfProp(assetId: string, tagCat?: string): LayerId {
  const cat = tagCat ?? (/tree|bush|grass/.test(assetId) ? "tree" : /rock|resource/.test(assetId) ? "rock" : /mountain|hill/.test(assetId) ? "mountain" : "");
  if (cat === "rock" || cat === "mountain" || cat === "hill") return "rocks";
  return "vegetation";
}

/**
 * Estado do editor de mapas 3D (hex + props). Guarda o GameMap inteiro sendo
 * editado: terreno hexagonal (heightmap = nível, surface = grama/água) via
 * pincéis, e decorações (árvores/pedras) como props com gizmo. Transform de
 * prop é mutado ao vivo no three e comitado no fim do arraste; pincel de
 * terreno muta a célula clicada. Histórico Undo/Redo por snapshot do mapa
 * (mutações produzem mapas novos → o objeto anterior é um snapshot imutável).
 */

export type Tool = "select" | "place" | "brush" | "spawn" | "measure" | "prefab" | "area" | "path";
/**
 * Pincéis de terreno.
 *
 * `cliffUp`/`cliffDown` são os do BURACO: agem só onde já está bloqueado e
 * decidem se aquele pedaço aparece como elevação (encosta, montanha) ou como
 * depressão (buraco, ravina). No Ragnarok o mesmo tipo de célula — o "gap" do
 * `map_cache` — é desenhado das duas formas conforme o mapa, e o cliente não
 * tem como adivinhar qual: quem escolhe é quem edita. O bloqueio NÃO muda.
 *
 * `ramp` é o único que não age por célula solta: ele ARRASTA. A altura vai
 * interpolada do nível de onde o traçado começou até o nível de onde ele está
 * agora, então uma encosta lisa entre o chão e o topo sai num gesto. `smooth`
 * não faz isso — ele tira média com os vizinhos, o que arredonda o degrau mas
 * nunca cria uma subida contínua de N níveis.
 *
 * `grab`, `inflate` e `scrape` são os de ESCULTURA, no espírito do Sculpt Mode:
 *
 *  • `grab`   — puxa a região inteira: a altura acompanha a distância arrastada
 *               desde a âncora, então dá para levantar um morro num gesto só e
 *               ajustar sem soltar o botão (a base é o relevo de antes do gesto);
 *  • `inflate` — dá volume ponderado pela normal: chão plano infla o total, a
 *               encosta íngreme quase nada. É o que arredonda em vez de erguer
 *               pilar, porque o topo (plano) sobe mais que as laterais;
 *  • `scrape`  — raspa SÓ o que está acima do plano do centro, deixando mesa. O
 *               `flatten` puxa dos dois lados; este nunca preenche um buraco.
 */
export type Brush =
  | "grass"
  | "water"
  | "raise"
  | "lower"
  | "smooth"
  | "flatten"
  | "noise"
  | "cliffUp"
  | "cliffDown"
  | "ramp"
  | "grab"
  | "inflate"
  | "scrape";
export type GizmoMode = "translate" | "rotate" | "scale";
export type SpawnKind = "player" | "mob" | "npc" | "road";

const HISTORY_LIMIT = 60;

/** células dentro de um raio (em células) do centro, por distância de mundo */
function cellsInRadius(w: number, h: number, col: number, row: number, size: number): [number, number][] {
  if (size <= 0) return [[col, row]];
  const c0 = editorGrid().cellToWorld(col, row);
  const R = size * editorGrid().cellWidth() + 0.6;
  const out: [number, number][] = [];
  for (let r = row - size - 1; r <= row + size + 1; r++) {
    for (let c = col - size - 1; c <= col + size + 1; c++) {
      if (c < 0 || c >= w || r < 0 || r >= h) continue;
      const wp = editorGrid().cellToWorld(c, r);
      if (Math.hypot(wp.x - c0.x, wp.z - c0.z) <= R) out.push([c, r]);
    }
  }
  return out;
}

/**
 * Peso do pincel numa célula, pela distância ao centro (0 na borda, 1 no meio).
 *
 * É o "Proportional Editing" do Blender: puxar um ponto arrasta a vizinhança com
 * força decrescente, como um tecido. Sem isso, `raise` somava +1 nível em todas
 * as células do disco por igual e o terreno subia como um pilar de topo chato —
 * era o degrau que fazia o mapa parecer feito de caixas.
 *
 * A curva é `smoothstep` (3t²−2t³): chega na borda com derivada zero, então não
 * há aresta visível no limite do pincel.
 */
export function brushFalloff(dist: number, raio: number): number {
  if (raio <= 0) return dist <= 0.001 ? 1 : 0;
  const t = 1 - Math.min(1, Math.max(0, dist / raio));
  return t * t * (3 - 2 * t);
}

/** células do disco com o PESO de cada uma (centro pesa 1, borda pesa 0) */
function cellsWithFalloff(
  w: number,
  h: number,
  col: number,
  row: number,
  size: number,
): Array<[number, number, number]> {
  const c0 = editorGrid().cellToWorld(col, row);
  const R = Math.max(size, 0.5) * editorGrid().cellWidth() + 0.6;
  const out: Array<[number, number, number]> = [];
  const alcance = Math.max(1, size + 1);
  for (let r = row - alcance; r <= row + alcance; r++) {
    for (let c = col - alcance; c <= col + alcance; c++) {
      if (c < 0 || c >= w || r < 0 || r >= h) continue;
      const wp = editorGrid().cellToWorld(c, r);
      const d = Math.hypot(wp.x - c0.x, wp.z - c0.z);
      if (d > R) continue;
      const peso = brushFalloff(d, R);
      if (peso <= 0.001) continue;
      out.push([c, r, peso]);
    }
  }
  return out;
}

let seq = 1;
export function nextPropId(): string {
  return `p${Date.now().toString(36)}_${seq++}`;
}

interface EditorState {
  map: GameMap | null;
  selected: number | null; // índice em map.props (primário, p/ Inspector)
  multi: number[]; // seleção múltipla de props (Shift+clique) — lote
  selectedSpawn: number | null; // índice em map.spawns
  tool: Tool;
  brush: Brush;
  brushSize: number; // raio do pincel em células (0 = 1 hex)
  /**
   * Força do pincel de relevo, em níveis por aplicação no CENTRO do disco.
   *
   * Fracionária de propósito: com 0,25 dá para modelar uma encosta arrastando,
   * como quem passa a mão na argila. Antes o passo era 1 nível cravado, o que só
   * sabia fazer degrau.
   */
  brushStrength: number;
  spawnKind: SpawnKind; // player | mob
  monsterKey: string; // refId do monstro (mob)
  spawnCount: number;
  spawnRadius: number;
  hover: { col: number; row: number; level: number } | null; // p/ readout de coords/altura
  currentAsset: string | null;
  propPaint: boolean; // place em modo pincel: espalha vários ao arrastar
  propDensity: number; // 1-10, chance de preencher cada célula do pincel
  camMove: boolean; // espaço pressionado → modo mover câmera (desliga ferramentas)
  dragging: { kind: "prop" | "spawn"; index: number } | null; // arrastar objeto no chão
  clipboard: { kind: "prop"; data: MapProp } | { kind: "spawn"; data: MapSpawn } | null;
  focusTick: number; // incrementa p/ pedir "focar no selecionado" (F)
  viewTick: number; // incrementa p/ pedir uma visão de câmera
  viewKind: "top" | "front" | "side" | "reset";
  snap: boolean; // snap na grade hex (colocar/mover encaixa no centro do hex)
  lighting: Lighting; // iluminação do editor (sol + ambiente)
  measure: { a: [number, number, number] | null; b: [number, number, number] | null };
  hiddenLayers: LayerId[]; // camadas ocultas no editor
  dirty: boolean;
  past: GameMap[];
  future: GameMap[];

  init: (map: GameMap) => void;
  newMap: () => void;
  resizeMap: (width: number, height: number) => void; // redimensiona a grade (preserva sobreposição)
  addProp: (p: MapProp) => void;
  /** peça de chão (estrada/rio/costa/rampa) → pinta a superfície da célula */
  placeTileAsset: (col: number, row: number, assetId: string) => void;
  paintProps: (col: number, row: number) => void; // espalha o asset atual no raio
  setPropPaint: (on: boolean) => void;
  setPropDensity: (n: number) => void;
  updateProp: (i: number, patch: Partial<MapProp>) => void;
  rotateSelected: (deltaRad: number) => void; // gira o prop no eixo Y (horizontal)
  scaleSelected: (delta: number) => void; // aumenta/diminui escala em passos
  selectTool: () => void; // entra na ferramenta de seleção (mover)
  duplicateSelected: () => void; // clona o selecionado com pequeno deslocamento
  copySelected: () => void; // copia o selecionado pro clipboard
  paste: () => void; // cola do clipboard (com deslocamento)
  requestFocus: () => void; // pede pra câmera enquadrar o selecionado (F)
  requestView: (kind: "top" | "front" | "side" | "reset") => void; // visão de câmera
  toggleSnap: () => void;
  showScene: boolean; // painel Cena (luz + camadas)
  toggleScene: () => void;
  /** PREVIEW do visual do chão: sobrescreve o server_config só nesta sessão do
   * editor, pra comparar atlas/cor/textura ao vivo antes de salvar em
   * /game-editor. null = usa o que está salvo na config. */
  groundPreview: Partial<GroundSettings> | null;
  setGroundPreview: (patch: Partial<GroundSettings> | null) => void;
  /** prévia do filtro retrô no editor. Off por padrão: pixelizar atrapalha
   * posicionar asset com precisão — é só pra conferir o visual final. */
  retroPreview: boolean;
  toggleRetroPreview: () => void;
  setLighting: (patch: Partial<Lighting>) => void;
  measurePoint: (p: [number, number, number]) => void; // clica pontos da medição
  clearMeasure: () => void;
  toggleLayer: (id: LayerId) => void; // mostra/oculta uma camada
  // geração procedural REATIVA por CATEGORIA (1 slider + ♻ por tipo)
  procAmounts: Record<string, number>; // % por categoria
  procSeeds: Record<string, number>; // seed por categoria
  procDisabled: Record<string, string[]>; // assetIds DESATIVADOS por categoria
  procJitterScale: boolean;
  procJitterRot: boolean;
  setCategoryAmount: (category: string, amount: number) => void; // slider ao vivo do tipo
  reseedCategory: (category: string) => void; // ♻ só desse tipo
  toggleSpecies: (category: string, assetId: string) => void; // liga/desliga 1 asset
  restoreProcedural: () => void; // restaura configs salvas (F5) e regenera
  setProcJitter: (patch: { scale?: boolean; rot?: boolean }) => void;
  // Terreno procedural (relevo/lagos) — separado do scatter, começa desmarcado.
  // Uma entrada POR ESCOPO: relevo do miolo e relevo da borda são camadas
  // diferentes, com quantidade e seed próprios (o gerador escreve só no escopo).
  terrainFeatures: Record<EditScope, TerrainFeatures>;
  terrainSeeds: Record<EditScope, TerrainSeeds>;
  setTerrainFeature: (feature: keyof TerrainFeatures, amount: number) => void;
  reseedFeature: (feature: keyof TerrainFeatures) => void; // ♻ re-randomiza SÓ essa feature
  reseedTerrain: () => void; // ♻ re-randomiza todas
  // rios & estradas conectados (tiles retos orientados ao longo de caminhos hex)
  /** liga os nós com estradas. `reroll` = sortear um traçado NOVO (botão ♻);
   * sem ele o resultado é estável (arrastar um nó só religa o que mudou). */
  generateRoads: (reroll?: boolean) => void;
  /** tempero do seed dos traçados — só o ♻ muda, e é isso que dá rede nova */
  roadSalt: number;
  generateRiver: () => void; // traça um rio (água) de borda a borda
  roadCells: number[]; // células viradas terra pela estrada (p/ reverter no limpar)
  riverCells: number[]; // células viradas água pelo rio (p/ reverter no limpar)
  /** legado: vaus de mapas gerados antes de a estrada passar a parar no rio.
   * Sempre vazio hoje — mantido pra "limpar" reverter mapas antigos. */
  fordCells: number[];
  clearPaths: () => void; // reverte estradas + rio
  clearProps: () => void; // remove todas as decorações
  /**
   * Escopo das edições num mapa importado (change.txt): o mapa do rAthena tem
   * um cinturão bloqueado enorme em volta (em prt_fild08 são 63.982 células
   * numa mancha só) e o miolo jogável. Editar os dois com o mesmo pincel é
   * receita para estragar um enquanto se arruma o outro.
   */
  editScope: EditScope;
  setEditScope: (scope: EditScope) => void;
  /** limpa os bloqueios miúdos, deixando chão andável */
  clearSmallBlocked: () => void;
  showProcedural: boolean;
  toggleProcedural: () => void;
  addSpawn: (col: number, row: number) => void;
  updateSpawn: (i: number, patch: Partial<MapSpawn>) => void;
  selectSpawn: (i: number | null) => void;
  setSpawnKind: (k: SpawnKind) => void;
  setMonsterKey: (k: string) => void;
  setSpawnCount: (n: number) => void;
  setSpawnRadius: (n: number) => void;
  deleteSelected: () => void;
  select: (i: number | null) => void;
  toggleMulti: (i: number) => void; // Shift+clique: adiciona/remove da seleção múltipla
  /** Shift+clique na Hierarquia: marca a FAIXA do último selecionado até `i` */
  selectRange: (i: number) => void;
  /** seleção múltipla de spawns (mesma ideia do `multi` dos props) */
  multiSpawn: number[];
  toggleMultiSpawn: (i: number) => void;
  selectSpawnRange: (i: number) => void;
  /**
   * Apaga TUDO de uma camada, respeitando o escopo da barra.
   *
   * "Dentro" apaga só o que está no miolo, "Borda" só o da moldura — a mesma
   * regra que vale para criar vale para limpar, senão o botão de apagar seria a
   * única ferramenta capaz de atravessar o escopo.
   */
  deleteLayer: (layer: "props" | "spawns" | "triggers") => void;
  // ---- prefabs (grupos reutilizáveis) ----
  prefabs: PrefabDef[]; // catálogo persistido (localStorage, compartilhado)
  currentPrefab: string | null; // prefab armado p/ carimbar (tool = "prefab")
  savePrefab: (name: string) => void; // cria prefab da seleção (lote ou 1)
  deletePrefab: (id: string) => void;
  armPrefab: (id: string | null) => void; // seleciona prefab p/ colocar
  placePrefab: (col: number, row: number) => void; // carimba o prefab armado no hex
  showPrefabs: boolean; // painel Prefabs
  togglePrefabs: () => void;
  // ---- triggers (gatilhos de área retangular) ----
  selectedTrigger: number | null; // índice em map.triggers
  triggerKind: TriggerKind; // tipo a criar ao desenhar área
  areaAnchor: { col: number; row: number } | null; // canto inicial do arraste
  areaDraft: { col: number; row: number; w: number; h: number } | null; // retângulo ao vivo
  setTriggerKind: (k: TriggerKind) => void;
  beginArea: (col: number, row: number) => void; // inicia desenho da área
  dragArea: (col: number, row: number) => void; // estende o retângulo até o cursor
  commitArea: () => void; // grava o trigger do rascunho
  selectTrigger: (i: number | null) => void;
  updateTrigger: (i: number, patch: Partial<MapTrigger>) => void;
  // ---- paths (rota de patrulha do NPC selecionado) ----
  editPath: () => void; // entra no modo "path" (exige NPC selecionado)
  addWaypoint: (col: number, row: number) => void; // adiciona ponto à rota do NPC
  clearPath: () => void; // limpa a rota do NPC selecionado
  setPathMode: (mode: "loop" | "pingpong" | "once") => void;
  setPathSpeed: (speed: number) => void;
  startDrag: (kind: "prop" | "spawn", index: number) => void; // começa arrastar (1 snapshot)
  dragTo: (col: number, row: number) => void; // move o objeto arrastado p/ o hex
  endDrag: () => void;
  beginStroke: () => void; // 1 snapshot de histórico por traçado de pincel
  paintCell: (col: number, row: number) => void;
  /** ponta de BAIXO da rampa em construção (pincel `ramp`) */
  rampAnchor: { col: number; row: number; level: number } | null;
  /** heightmap de antes do gesto: a rampa interpola sempre a partir dele */
  rampBase: number[] | null;
  beginRamp: (col: number, row: number) => void;
  endRamp: () => void;
  setHover: (h: { col: number; row: number; level: number } | null) => void;
  undo: () => void;
  redo: () => void;
  setTool: (t: Tool) => void;
  setBrush: (b: Brush) => void;
  setBrushSize: (n: number) => void;
  setBrushStrength: (n: number) => void;
  setAsset: (id: string | null) => void;
  setCamMove: (on: boolean) => void;
  markSaved: () => void;
  camForward: { x: number; z: number }; // direção "pra frente" da câmera no plano XZ (setinhas do teclado)
  setCamForward: (f: { x: number; z: number }) => void;
  // move o selecionado (prop OU spawn) 1 célula hex na direção pedida,
  // relativa à câmera — segurar a tecla repete via keydown nativo do browser.
  nudgeSelected: (dir: "up" | "down" | "left" | "right") => void;
}

const SURFACE_COLLISION: Record<SurfaceType, "walkable" | "water"> = {
  grass: "walkable",
  dirt: "walkable",
  stone: "walkable",
  sand: "walkable",
  snow: "walkable",
  river: "water",
  water: "water",
};

/** empilha o mapa atual no histórico (chamar ANTES de trocar o map) */
function histPush(s: EditorState): { past: GameMap[]; future: GameMap[] } {
  return { past: s.map ? [...s.past, s.map].slice(-HISTORY_LIMIT) : s.past, future: [] };
}

export const useEditorStore = create<EditorState>((set) => ({
  map: null,
  selected: null,
  multi: [],
  multiSpawn: [],
  rampAnchor: null,
  rampBase: null,
  selectedSpawn: null,
  tool: "select",
  brush: "grass",
  brushSize: 3,
  // 0,3 nível no centro: modela encosta arrastando, sem cravar degrau
  brushStrength: 0.3,
  spawnKind: "mob",
  monsterKey: "skeleton_warrior",
  spawnCount: 3,
  spawnRadius: 8,
  hover: null,
  currentAsset: null,
  propPaint: false,
  propDensity: 5,
  camMove: false,
  dragging: null,
  clipboard: null,
  focusTick: 0,
  viewTick: 0,
  viewKind: "reset",
  snap: true,
  showScene: false,
  groundPreview: null,
  retroPreview: false,
  lighting: { ...DEFAULT_LIGHTING },
  camForward: { x: 0, z: 1 },
  measure: { a: null, b: null },
  hiddenLayers: [],
  showProcedural: false,
  editScope: "inside",
  procAmounts: {},
  procSeeds: {},
  procDisabled: {},
  procJitterScale: true,
  procJitterRot: true,
  terrainFeatures: emptyTerrainFeatures(),
  terrainSeeds: freshTerrainSeeds(),
  roadCells: [],
  riverCells: [],
  fordCells: [],
  roadSalt: 0,
  prefabs: loadPrefabs(),
  currentPrefab: null,
  showPrefabs: false,
  selectedTrigger: null,
  triggerKind: "warp",
  areaAnchor: null,
  areaDraft: null,
  dirty: false,
  past: [],
  future: [],

  // Mapas salvos antes da estrada virar TILE de terreno guardam props "_gen road"
  // (as peças antigas). Hoje o HexTerrain desenha a estrada pela superfície, então
  // esses props ficariam por cima, duplicados — descarta no load.
  init: (map) => {
    // a forma da grade vem do mapa: hexágonos nos autorados, quadrados nos
    // importados do rAthena. Fixada ANTES de qualquer conta de célula.
    setEditorGrid(map);
    set({
      map: { ...map, props: map.props.filter((p) => !(p.tags?.[0] === "_gen" && p.tags?.[1] === "road")) },
      selected: null,
      multi: [],
      selectedSpawn: null,
      dirty: false,
      past: [],
      future: [],
      lighting: { ...(map.lighting ?? DEFAULT_LIGHTING) }, // mapa salvo já traz seu sol/ambiente
    });
  },
  newMap: () => {
    const novo = createBlankMap(`novo_${Date.now().toString(36)}`, "Novo mapa");
    setEditorGrid(novo);
    set({
      map: novo,
      selected: null,
      dirty: true,
      past: [],
      future: [],
      lighting: { ...DEFAULT_LIGHTING },
      // projeto novo: geradores começam TUDO desmarcado (nada gera até o usuário
      // ativar). amounts vazios (sliders em 0) + todas as espécies desativadas.
      procAmounts: {},
      procSeeds: {},
      procDisabled: allSpeciesDisabled(),
      terrainFeatures: emptyTerrainFeatures(),
      terrainSeeds: freshTerrainSeeds(),
      roadCells: [],
      riverCells: [],
      fordCells: [],
    });
  },
  // redimensiona a grade do mapa preservando o que couber (remapeia heightmap/
  // collision/surface row-major; células novas = grama plana andável). Props e
  // spawns mantêm posição de mundo (podem ficar fora da nova borda).
  resizeMap: (width, height) =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      const W = Math.max(4, Math.min(500, Math.round(width)));
      const H = Math.max(4, Math.min(500, Math.round(height)));
      if (W === map.size.width && H === map.size.height) return s;
      const n = W * H;
      const heightmap = new Array<number>(n).fill(0);
      const collision = new Array(n).fill("walkable") as GameMap["collision"];
      const surface = new Array(n).fill("grass") as SurfaceType[];
      const oldSurface = map.surface.length ? map.surface : new Array(map.heightmap.length).fill("grass");
      const oldRamps = rampMap(map.ramps);
      const ramps = new Map<number, number>();
      for (let row = 0; row < Math.min(H, map.size.height); row++) {
        for (let col = 0; col < Math.min(W, map.size.width); col++) {
          const oi = row * map.size.width + col;
          const ni = row * W + col;
          heightmap[ni] = map.heightmap[oi] ?? 0;
          collision[ni] = map.collision[oi] ?? "walkable";
          surface[ni] = (oldSurface[oi] as SurfaceType) ?? "grass";
          const r = oldRamps.get(oi);
          if (r != null) ramps.set(ni, r); // índice muda com a largura: remapeia
        }
      }
      return { ...histPush(s), map: { ...map, size: { width: W, height: H }, heightmap, collision, surface, ramps: flattenRamps(ramps) }, dirty: true };
    }),

  addProp: (p) =>
    set((s) => {
      if (!s.map) return s;
      // asset colocado à mão também respeita o escopo da barra
      if (!worldInScope(s.map, s.editScope, p.position[0], p.position[2])) return s;
      return { ...histPush(s), map: { ...s.map, props: [...s.map.props, p] }, selected: s.map.props.length, dirty: true };
    }),
  // Peça de CHÃO colocada à mão (estrada/rio/costa/rampa da paleta): vira
  // SUPERFÍCIE da célula, não um objeto solto. Como prop, o tile de grama que já
  // existe na célula continuava desenhado e atravessava a peça — e o traçado
  // também não conectava com os vizinhos. Pintando a superfície, o HexTerrain
  // escolhe a peça certa (reta/curva/T/cruz) pela conectividade, igual ao
  // gerador procedural. A rampa ainda precisa da borda de descida: usa o
  // vizinho mais alto (a peça sobe exatamente 1 nível).
  placeTileAsset: (col, row, assetId) =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      // escopo escolhido na barra: fora dele, a edição simplesmente não acontece
      if (!cellInScope(map, s.editScope, col, row)) return s;
      const { width: W, height: H } = map.size;
      if (col < 0 || col >= W || row < 0 || row >= H) return s;
      const surf = tileSurfaceFor(assetId);
      if (!surf) return s;
      const i = cellIndex(map, col, row);
      // sem superfície (mapa do map_cache), materializa DERIVANDO da colisão —
      // "grass" para tudo apagava o azul da água andável do mapa original
      const surface = (map.surface.length ? map.surface.slice() : surfaceFromCollision(map)) as SurfaceType[];
      const collision = map.collision.slice();
      const ramps = rampMap(map.ramps);
      surface[i] = surf;
      // peça de chão pinta a superfície; em célula bloqueada a colisão fica de
      // pé (mesma regra do pincel — borda e buraco não viram passagem)
      if (collision[i] !== "wall" && collision[i] !== "cliff") collision[i] = SURFACE_COLLISION[surf];
      const isRamp = propCategory(assetId) === "ramp";
      ramps.delete(i);
      if (isRamp) {
        const my = map.heightmap[i] ?? 0;
        for (let k = 0; k < 6; k++) {
          const [nc, nr] = neighborAt(col, row, k);
          if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
          if ((map.heightmap[cellIndex(map, nc, nr)] ?? 0) === my + 1) { ramps.set(i, (k + 3) % 6); break; }
        }
      }
      // a peça ocupa a célula inteira: props que estavam ali saem junto com a grama
      const props = map.props.filter((p) => {
        const c = editorGrid().worldToCell(p.position[0], p.position[2]);
        return !(c.col === col && c.row === row);
      });
      return {
        ...histPush(s),
        map: { ...map, surface, collision, props, ramps: flattenRamps(ramps) },
        // estrada/rio pintados à mão entram na lista de reversão do "limpar"
        roadCells: surf === "dirt" && !s.roadCells.includes(i) ? [...s.roadCells, i] : s.roadCells,
        riverCells: surf === "river" && !s.riverCells.includes(i) ? [...s.riverCells, i] : s.riverCells,
        dirty: true,
      };
    }),
  // pincel de vegetação: espalha o asset atual nas células do raio (densidade),
  // com jitter de posição, rotação aleatória e escala variando ±20%. Respeita um
  // espaçamento mínimo pra não empilhar. NÃO empilha histórico (beginStroke faz 1×).
  paintProps: (col, row) =>
    set((s) => {
      const map = s.map;
      if (!map || !s.currentAsset) return s;
      // escopo escolhido na barra: fora dele, a edição simplesmente não acontece
      if (!cellInScope(map, s.editScope, col, row)) return s;
      const { width: W, height: H } = map.size;
      const baseScale = propDefaultScale(s.currentAsset);
      const spacing = Math.max(2, baseScale * 0.5); // props grandes → mais espaçados
      const cells = cellsInRadius(W, H, col, row, s.brushSize);
      const added: MapProp[] = [];
      const existing = map.props.map((p) => p.position);
      const tooClose = (x: number, z: number) => {
        for (const e of existing) if (Math.hypot(e[0] - x, e[2] - z) < spacing) return true;
        for (const a of added) if (Math.hypot(a.position[0] - x, a.position[2] - z) < spacing) return true;
        return false;
      };
      for (const [c, r] of cells) {
        if (Math.random() > s.propDensity / 10) continue;
        const { x, z } = editorGrid().cellToWorld(c, r);
        const jx = x + (Math.random() - 0.5) * 1.2;
        const jz = z + (Math.random() - 0.5) * 1.2;
        if (tooClose(jx, jz)) continue;
        const y = editorGrid().levelToY(map.heightmap[cellIndex(map, c, r)] ?? 0);
        const sc = baseScale * (0.8 + Math.random() * 0.4);
        added.push({
          id: nextPropId(),
          assetId: s.currentAsset,
          position: [jx, y, jz],
          rotation: [0, Math.random() * Math.PI * 2, 0],
          scale: [sc, sc, sc],
          colliderType: colliderForAsset(s.currentAsset),
        });
      }
      if (added.length === 0) return s;
      return { map: { ...map, props: [...map.props, ...added] }, dirty: true };
    }),
  setPropPaint: (propPaint) => set({ propPaint }),
  setPropDensity: (n) => set({ propDensity: Math.max(1, Math.min(10, Math.round(n))) }),
  // gira SÓ nos 6 lados do hexágono: primeiro encaixa a rotação atual (podia
  // vir torta do scatter aleatório) no múltiplo de 60° mais próximo, depois
  // soma o passo — nunca fica num ângulo fora dos 6 alinhamentos possíveis.
  rotateSelected: (deltaRad) =>
    set((s) => {
      if (!s.map || s.selected == null) return s;
      const p = s.map.props[s.selected];
      if (!p) return s;
      const STEP = Math.PI / 3;
      const snapped = Math.round(p.rotation[1] / STEP) * STEP;
      const rotation: [number, number, number] = [p.rotation[0], snapped + deltaRad, p.rotation[2]];
      return { ...histPush(s), map: { ...s.map, props: s.map.props.map((pp, j) => (j === s.selected ? { ...pp, rotation } : pp)) }, dirty: true };
    }),
  scaleSelected: (delta) =>
    set((s) => {
      if (!s.map || s.selected == null) return s;
      const p = s.map.props[s.selected];
      if (!p) return s;
      const ns = Math.max(1, Math.min(30, (p.scale[0] ?? 1) + delta));
      return { ...histPush(s), map: { ...s.map, props: s.map.props.map((pp, j) => (j === s.selected ? { ...pp, scale: [ns, ns, ns] as [number, number, number] } : pp)) }, dirty: true };
    }),
  setCamForward: (f) => set({ camForward: f }),
  // move o selecionado 1 célula hex na direção da seta, relativa à câmera:
  // "para cima" = pra longe da câmera (dentro da tela), "esquerda/direita" =
  // perpendicular. Escolhe, dos 6 vizinhos hex, o que mais casa com essa
  // direção (maior produto escalar do delta de mundo real vs a direção pedida)
  // — não usa índice de borda abstrato, então funciona igual em qualquer
  // orientação de câmera. SEM histPush aqui: o chamador (tecla) já fez
  // beginStroke() na 1ª pressionada — segurar a tecla não empilha 1 undo por tick.
  nudgeSelected: (dir) =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      const { width: W, height: H } = map.size;
      const { x: fx, z: fz } = s.camForward;
      const rx = fz, rz = -fx; // "direita" da câmera = frente rotacionado -90°
      const wanted =
        dir === "up" ? { x: fx, z: fz } : dir === "down" ? { x: -fx, z: -fz } : dir === "left" ? { x: -rx, z: -rz } : { x: rx, z: rz };
      const bestEdge = (col: number, row: number): number => {
        const here = editorGrid().cellToWorld(col, row);
        let best = 0, bestDot = -Infinity;
        for (let k = 0; k < 6; k++) {
          const [nc, nr] = neighborAt(col, row, k);
          const nb = editorGrid().cellToWorld(nc, nr);
          const dx = nb.x - here.x, dz = nb.z - here.z;
          const len = Math.hypot(dx, dz) || 1;
          const dot = (dx / len) * wanted.x + (dz / len) * wanted.z;
          if (dot > bestDot) { bestDot = dot; best = k; }
        }
        return best;
      };
      const moveTo = (col: number, row: number) => {
        const k = bestEdge(col, row);
        const [nc, nr] = neighborAt(col, row, k);
        if (nc < 0 || nc >= W || nr < 0 || nr >= H) return null;
        return { col: nc, row: nr };
      };
      if (s.selectedSpawn != null) {
        const sp = map.spawns[s.selectedSpawn];
        if (!sp) return s;
        const c0 = editorGrid().worldToCell(sp.position[0], sp.position[2]);
        const next = moveTo(c0.col, c0.row);
        if (!next) return s;
        const w = editorGrid().cellToWorld(next.col, next.row);
        const y = editorGrid().levelToY(map.heightmap[cellIndex(map, next.col, next.row)] ?? 0);
        const spawns = map.spawns.map((p, j) => (j === s.selectedSpawn ? { ...p, position: [w.x, y, w.z] as [number, number, number] } : p));
        return { map: { ...map, spawns }, dirty: true };
      }
      if (s.selected == null) return s;
      const anchor = map.props[s.selected];
      if (!anchor) return s;
      const c0 = editorGrid().worldToCell(anchor.position[0], anchor.position[2]);
      const next = moveTo(c0.col, c0.row);
      if (!next) return s;
      const anchorNext = editorGrid().cellToWorld(next.col, next.row);
      const dx = anchorNext.x - anchor.position[0];
      const dz = anchorNext.z - anchor.position[2];
      // lote: se fizer parte da seleção múltipla, move TODOS pelo mesmo delta
      const batch = s.multi.length > 1 && s.multi.includes(s.selected);
      const ids = batch ? new Set(s.multi) : new Set([s.selected]);
      const props = map.props.map((p, j) => {
        if (!ids.has(j)) return p;
        const nx = p.position[0] + dx, nz = p.position[2] + dz;
        const nc = editorGrid().worldToCell(nx, nz);
        const ny = nc.col >= 0 && nc.col < W && nc.row >= 0 && nc.row < H ? editorGrid().levelToY(map.heightmap[cellIndex(map, nc.col, nc.row)] ?? 0) : p.position[1];
        return { ...p, position: [nx, ny, nz] as [number, number, number] };
      });
      return { map: { ...map, props }, dirty: true };
    }),
  selectTool: () => set({ tool: "select", currentAsset: null, propPaint: false }),

  duplicateSelected: () =>
    set((s) => {
      if (!s.map) return s;
      const off = 3;
      // lote: duplica todos os props da seleção múltipla
      if (s.multi.length > 1) {
        const clones = s.multi
          .map((i) => s.map!.props[i])
          .filter((p): p is MapProp => !!p)
          .map((p) => ({ ...p, id: nextPropId(), position: [p.position[0] + off, p.position[1], p.position[2] + off] as [number, number, number] }));
        const props = [...s.map.props, ...clones];
        const newMulti = clones.map((_, k) => s.map!.props.length + k);
        return { ...histPush(s), map: { ...s.map, props }, multi: newMulti, selected: newMulti[0]!, tool: "select", dirty: true };
      }
      if (s.selected != null) {
        const p = s.map.props[s.selected];
        if (!p) return s;
        const clone: MapProp = { ...p, id: nextPropId(), position: [p.position[0] + off, p.position[1], p.position[2] + off] };
        const props = [...s.map.props, clone];
        return { ...histPush(s), map: { ...s.map, props }, selected: props.length - 1, tool: "select", dirty: true };
      }
      if (s.selectedSpawn != null) {
        const sp = s.map.spawns[s.selectedSpawn];
        if (!sp || sp.kind === "player_start") return s; // player_start é único
        const clone: MapSpawn = { ...sp, id: `sp${Date.now().toString(36)}_${seq++}`, position: [sp.position[0] + off, sp.position[1], sp.position[2] + off] };
        const spawns = [...s.map.spawns, clone];
        return { ...histPush(s), map: { ...s.map, spawns }, selectedSpawn: spawns.length - 1, tool: "select", dirty: true };
      }
      return s;
    }),
  copySelected: () =>
    set((s) => {
      if (!s.map) return s;
      if (s.selected != null && s.map.props[s.selected]) return { clipboard: { kind: "prop", data: s.map.props[s.selected]! } };
      if (s.selectedSpawn != null && s.map.spawns[s.selectedSpawn]) return { clipboard: { kind: "spawn", data: s.map.spawns[s.selectedSpawn]! } };
      return s;
    }),
  paste: () =>
    set((s) => {
      const cb = s.clipboard;
      if (!s.map || !cb) return s;
      const off = 3;
      if (cb.kind === "prop") {
        const clone: MapProp = { ...cb.data, id: nextPropId(), position: [cb.data.position[0] + off, cb.data.position[1], cb.data.position[2] + off] };
        const props = [...s.map.props, clone];
        return { ...histPush(s), map: { ...s.map, props }, selected: props.length - 1, selectedSpawn: null, tool: "select", dirty: true };
      }
      if (cb.data.kind === "player_start") return s;
      const clone: MapSpawn = { ...cb.data, id: `sp${Date.now().toString(36)}_${seq++}`, position: [cb.data.position[0] + off, cb.data.position[1], cb.data.position[2] + off] };
      const spawns = [...s.map.spawns, clone];
      return { ...histPush(s), map: { ...s.map, spawns }, selectedSpawn: spawns.length - 1, selected: null, tool: "select", dirty: true };
    }),
  requestFocus: () => set((s) => ({ focusTick: s.focusTick + 1 })),
  requestView: (kind) => set((s) => ({ viewKind: kind, viewTick: s.viewTick + 1 })),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  toggleScene: () => set((s) => ({ showScene: !s.showScene })),
  // preview do chão: mescla patches (mudar só a cor mantém o modo escolhido);
  // null limpa e volta pro que está salvo no server_config
  setGroundPreview: (patch) =>
    set((s) => ({ groundPreview: patch === null ? null : { ...(s.groundPreview ?? {}), ...patch } })),
  toggleRetroPreview: () => set((s) => ({ retroPreview: !s.retroPreview })),
  // sincroniza com map.lighting também (não só o estado solto do editor) —
  // sem isso, o sol/ambiente ajustado no painel nunca ia pro save/o /play.
  setLighting: (patch) =>
    set((s) => {
      const lighting = { ...s.lighting, ...patch };
      return { lighting, map: s.map ? { ...s.map, lighting } : s.map, dirty: s.map ? true : s.dirty };
    }),
  measurePoint: (p) =>
    set((s) => {
      // 1º clique = A, 2º = B, 3º recomeça em A
      if (!s.measure.a || s.measure.b) return { measure: { a: p, b: null } };
      return { measure: { a: s.measure.a, b: p } };
    }),
  clearMeasure: () => set({ measure: { a: null, b: null } }),
  toggleLayer: (id) => set((s) => ({ hiddenLayers: s.hiddenLayers.includes(id) ? s.hiddenLayers.filter((l) => l !== id) : [...s.hiddenLayers, id] })),
  toggleProcedural: () => set((s) => ({ showProcedural: !s.showProcedural })),
  // regenera SÓ a camada procedural de UMA categoria (preserva props manuais e
  // as outras categorias). Sem histórico por tick — o painel dá 1 snapshot no
  // início da interação (undo volta o ajuste inteiro).
  setCategoryAmount: (category, amount) =>
    set((s) => {
      if (!s.map) return s;
      const scope = s.editScope;
      const chave = procKey(scope, category);
      const seed = s.procSeeds[chave] ?? (Math.random() * 1e9) | 0;
      const species = activeSpecies(chave, s.procDisabled, category);
      const kept = s.map.props.filter((p) => !isGenerated(p, category, scope));
      const gen = generateScatter(s.map, { category, species, amount, seed, jitterScale: s.procJitterScale, jitterRot: s.procJitterRot, occupied: occupiedAreas(kept, s.map.spawns), scope });
      const procAmounts = { ...s.procAmounts, [chave]: amount };
      const procSeeds = { ...s.procSeeds, [chave]: seed };
      saveProc(procAmounts, s.procDisabled);
      return { procAmounts, procSeeds, map: { ...s.map, props: [...kept, ...gen] }, dirty: true };
    }),
  reseedCategory: (category) =>
    set((s) => {
      if (!s.map) return s;
      const scope = s.editScope;
      const chave = procKey(scope, category);
      const seed = (Math.random() * 1e9) | 0;
      const amount = s.procAmounts[chave] ?? 0;
      const species = activeSpecies(chave, s.procDisabled, category);
      const kept = s.map.props.filter((p) => !isGenerated(p, category, scope));
      const gen = generateScatter(s.map, { category, species, amount, seed, jitterScale: s.procJitterScale, jitterRot: s.procJitterRot, occupied: occupiedAreas(kept, s.map.spawns), scope });
      return { procSeeds: { ...s.procSeeds, [chave]: seed }, map: { ...s.map, props: [...kept, ...gen] }, dirty: true };
    }),
  toggleSpecies: (category, assetId) =>
    set((s) => {
      if (!s.map) return s;
      const scope = s.editScope;
      const chave = procKey(scope, category);
      const cur = s.procDisabled[chave] ?? [];
      const off = cur.includes(assetId) ? cur.filter((id) => id !== assetId) : [...cur, assetId];
      const procDisabled = { ...s.procDisabled, [chave]: off };
      // regenera a categoria com as espécies ativas atualizadas
      const amount = s.procAmounts[chave] ?? 0;
      const seed = s.procSeeds[chave] ?? (Math.random() * 1e9) | 0;
      const species = activeSpecies(chave, procDisabled, category);
      const kept = s.map.props.filter((p) => !isGenerated(p, category, scope));
      const gen = generateScatter(s.map, { category, species, amount, seed, jitterScale: s.procJitterScale, jitterRot: s.procJitterRot, occupied: occupiedAreas(kept, s.map.spawns), scope });
      saveProc(s.procAmounts, procDisabled);
      return { procDisabled, procSeeds: { ...s.procSeeds, [chave]: seed }, map: { ...s.map, props: [...kept, ...gen] }, dirty: true };
    }),
  restoreProcedural: () =>
    set((s) => {
      if (!s.map) return s;
      const saved = loadProc();
      if (!saved) return s;
      const procAmounts = saved.amounts ?? {};
      const procDisabled = saved.disabled ?? {};
      const procSeeds = { ...s.procSeeds };
      let props = s.map.props;
      // as chaves salvas são "escopo:categoria" (camada); as antigas, só a
      // categoria — essas restauram como camada "all", que é o que eram
      for (const chave of Object.keys(procAmounts)) {
        const amount = procAmounts[chave] ?? 0;
        if (amount <= 0) continue;
        const [scope, cat] = splitProcKey(chave);
        const seed = procSeeds[chave] ?? (Math.random() * 1e9) | 0;
        procSeeds[chave] = seed;
        const species = activeSpecies(chave, procDisabled, cat);
        const kept = props.filter((p) => !isGenerated(p, cat, scope));
        props = [...kept, ...generateScatter(s.map, { category: cat, species, amount, seed, jitterScale: s.procJitterScale, jitterRot: s.procJitterRot, occupied: occupiedAreas(kept, s.map.spawns), scope })];
      }
      return { procAmounts, procDisabled, procSeeds, map: { ...s.map, props } };
    }),
  setProcJitter: (patch) =>
    set((s) => {
      if (!s.map) return s;
      const jitterScale = patch.scale ?? s.procJitterScale;
      const jitterRot = patch.rot ?? s.procJitterRot;
      // regenera TODAS as camadas com quantidade > 0, cada uma no seu escopo
      // (jitter é global: vale para o mapa inteiro)
      let props = s.map.props;
      for (const chave of Object.keys(s.procAmounts)) {
        const amount = s.procAmounts[chave] ?? 0;
        if (amount <= 0) continue;
        const [scope, cat] = splitProcKey(chave);
        const species = activeSpecies(chave, s.procDisabled, cat);
        const kept = props.filter((p) => !isGenerated(p, cat, scope));
        const gen = generateScatter(s.map, { category: cat, species, amount, seed: s.procSeeds[chave] ?? 0, jitterScale, jitterRot, occupied: occupiedAreas(kept, s.map.spawns), scope });
        props = [...kept, ...gen];
      }
      return { procJitterScale: jitterScale, procJitterRot: jitterRot, map: { ...s.map, props }, dirty: true };
    }),
  // Terreno procedural do ESCOPO ativo: relevo e lagos entram só nas células
  // daquela parte do mapa (ver generateTerrain), sobre o que já existe. Em mapa
  // novo autorado no editor, com escopo "Tudo", ainda gera a base do zero.
  // Sem histórico por tick — o painel dá 1 snapshot no início da interação.
  setTerrainFeature: (feature, amount) =>
    set((s) => {
      if (!s.map) return s;
      const scope = s.editScope;
      const daCamada = { ...s.terrainFeatures[scope], [feature]: Math.max(0, Math.min(100, amount)) };
      const terrainFeatures = { ...s.terrainFeatures, [scope]: daCamada };
      const t = generateTerrain(s.map, daCamada, s.terrainSeeds[scope], scope);
      return { terrainFeatures, map: { ...s.map, ...t }, dirty: true };
    }),
  reseedFeature: (feature) =>
    set((s) => {
      if (!s.map) return s;
      const scope = s.editScope;
      const seeds = { ...s.terrainSeeds[scope], [feature]: (Math.random() * 1e9) | 0 };
      const terrainSeeds = { ...s.terrainSeeds, [scope]: seeds };
      const t = generateTerrain(s.map, s.terrainFeatures[scope], seeds, scope);
      return { ...histPush(s), terrainSeeds, map: { ...s.map, ...t }, dirty: true };
    }),
  reseedTerrain: () =>
    set((s) => {
      if (!s.map) return s;
      const scope = s.editScope;
      const seeds = { hill: (Math.random() * 1e9) | 0, lake: (Math.random() * 1e9) | 0 };
      const terrainSeeds = { ...s.terrainSeeds, [scope]: seeds };
      const t = generateTerrain(s.map, s.terrainFeatures[scope], seeds, scope);
      return { ...histPush(s), terrainSeeds, map: { ...s.map, ...t }, dirty: true };
    }),
  // estradas = REDE (MST): liga os nós de estrada pelo vizinho mais próximo.
  // Cada trecho SERPENTEIA (wanderPath), com SEED DERIVADO DOS IDS DOS DOIS NÓS
  // — não de Math.random(). Assim regerar a rede é IDEMPOTENTE: mover um nó
  // muda só os trechos que saem dele (que passam a ligar na posição nova); todo
  // o resto sai idêntico, em vez da rede inteira ser re-sorteada.
  // Se houver <2 nós MANUAIS, completa com nós AUTOMÁTICOS (id "autoroad_"),
  // que a partir daí PERSISTEM — arrastar um nó não redesenha o mapa todo.
  generateRoads: (reroll = false) =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      // ♻: tempero novo + nós automáticos descartados = rede diferente
      const roadSalt = reroll ? ((Math.random() * 1e9) | 0) : s.roadSalt;
      const { width: W, height: H } = map.size;
      // nós manuais (colocados pelo usuário) sempre preservados
      const manual = map.spawns.filter((sp) => sp.kind === "road_node" && !sp.id.startsWith("autoroad_"));
      // nós auto já existentes: reaproveitados (posição inclusive — arrastar um
      // deles tem que RELIGAR o traçado, não sortear outro lugar pra ele)
      // no ♻ eles são descartados e sorteados de novo — é o que faz sair uma
      // rede DIFERENTE em vez de repetir a mesma (o traçado é determinístico)
      const keptAuto = reroll
        ? []
        : map.spawns.filter((sp) => sp.kind === "road_node" && sp.id.startsWith("autoroad_"));
      const autoNodes: MapSpawn[] = [];
      if (manual.length + keptAuto.length < 2) {
        const need = Math.max(2, 5 - manual.length - keptAuto.length);
        const cand: [number, number][] = [];
        for (let row = 0; row < H; row++)
          for (let col = 0; col < W; col++) {
            const i = cellIndex(map, col, row);
            if (map.collision[i] === "walkable" && map.surface[i] !== "water") cand.push([col, row]);
          }
        for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j]!, cand[i]!]; }
        const minSep = Math.max(6, Math.min(W, H) * 0.25); // espaçar os nós
        const picked: [number, number][] = [...manual, ...keptAuto].map((sp) => { const c = editorGrid().worldToCell(sp.position[0], sp.position[2]); return [c.col, c.row] as [number, number]; });
        for (const [col, row] of cand) {
          if (autoNodes.length >= need) break;
          if (picked.some(([pc, pr]) => Math.hypot(pc - col, pr - row) < minSep)) continue;
          picked.push([col, row]);
          const w = editorGrid().cellToWorld(col, row);
          const y = editorGrid().levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0);
          autoNodes.push({ id: `autoroad_${Date.now().toString(36)}_${seq++}`, kind: "road_node", position: [w.x, y, w.z] });
        }
      }
      const nodeSpawns = [...manual, ...keptAuto, ...autoNodes];
      const nodes = nodeSpawns.map((sp) => editorGrid().worldToCell(sp.position[0], sp.position[2]));
      if (nodes.length < 2) return s;
      // Prim: começa no nó 0, adiciona sempre o mais próximo
      const inTree = new Set<number>([0]);
      const edges: [number, number][] = [];
      const dist = (a: number, b: number) => Math.hypot(nodes[a]!.col - nodes[b]!.col, nodes[a]!.row - nodes[b]!.row);
      while (inTree.size < nodes.length) {
        let best: { a: number; b: number; d: number } | null = null;
        for (let b = 0; b < nodes.length; b++) {
          if (inTree.has(b)) continue;
          for (const a of inTree) { const d = dist(a, b); if (!best || d < best.d) best = { a, b, d }; }
        }
        if (!best) break;
        edges.push([best.a, best.b]);
        inTree.add(best.b);
      }
      // guarda os traçados SEPARADOS (não achata ainda) — a ordem de cada um é o
      // que resolve a rampa sem ambiguidade (ver comentário mais abaixo). O seed
      // de cada trecho vem do PAR DE IDS (estável), então re-gerar depois de
      // arrastar um nó preserva o desenho dos outros trechos.
      const paths: { col: number; row: number }[][] = edges.map(([a, b]) =>
        wanderPath(
          nodes[a]!.col,
          nodes[a]!.row,
          nodes[b]!.col,
          nodes[b]!.row,
          0.07,
          edgeSeed(nodeSpawns[a]!.id, nodeSpawns[b]!.id) ^ roadSalt,
        ),
      );
      const cells: { col: number; row: number }[] = paths.flat();
      // sem superfície (mapa do map_cache), materializa DERIVANDO da colisão —
      // "grass" para tudo apagava o azul da água andável do mapa original
      const surface = (map.surface.length ? map.surface.slice() : surfaceFromCollision(map)) as SurfaceType[];
      const collision = map.collision.slice();
      const heightmap = map.heightmap.slice();
      const ramps = rampMap(map.ramps);
      // reverte a estrada anterior — só onde AINDA é estrada: se um rio passou
      // por cima depois, apagar pra grama destruiria o rio recém-traçado.
      for (const i of s.roadCells) if (surface[i] === "dirt") { surface[i] = "grass"; collision[i] = "walkable"; }
      for (const i of s.fordCells) collision[i] = "water"; // desfaz vaus de mapas antigos
      // marca as células de estrada. Quem monta o traçado com as peças KayKit é o
      // HexTerrain, pela conectividade dessas células.
      // ÁGUA NUNCA É ATRAVESSADA (regra do usuário): rio e lago cortam o traçado —
      // a estrada morre numa margem e recomeça na outra. Sem vau, sem ponte.
      const roadCells: number[] = [];
      const onRoad: [number, number][] = [];
      for (const c of cells) {
        if (c.col < 0 || c.col >= W || c.row < 0 || c.row >= H) continue;
        const i = cellIndex(map, c.col, c.row);
        if (surface[i] === "water" || surface[i] === "river") continue;
        // Estrada não abre caminho em terreno bloqueado: passar por cima de
        // parede ou buraco tornaria a célula andável e furaria a moldura do mapa
        // (regra do projeto: borda e buraco nunca ficam acessíveis a pé).
        if (collision[i] === "wall" || collision[i] === "cliff") continue;
        surface[i] = "dirt";
        collision[i] = "walkable";
        roadCells.push(i);
        onRoad.push([c.col, c.row]);
      }
      // A estrada ACOMPANHA o relevo em vez de picotar em degrau seco:
      //  1) erode ao longo da ORDEM DO CAMINHO (não de todo vizinho hex genérico
      //     — usar vizinhança genérica foi o bug: perto de bifurcação/morro, um
      //     hex podia ter DOIS vizinhos de estrada em níveis diferentes por puro
      //     acaso de proximidade, sem ligação real no traçado, e a rampa saía
      //     apontando pro lado errado) até nenhum PAR CONSECUTIVO DO TRAÇADO
      //     diferir mais que 1 nível (declive máx. de 1 por hex);
      //  2) a célula BAIXA de cada degrau vira rampa (hex_road_A_sloped_high)
      //     apontando pro lado oposto ao PRÓXIMO PASSO do caminho que é mais
      //     alto — a peça sobe exatamente 1 nível, encosta no topo sem vão.
      const roadSet = new Set(onRoad.map(([c, r]) => cellIndex(map, c, r)));
      // vizinhos-no-CAMINHO (não hex genérico): só os pares consecutivos de
      // cada wanderPath, ambos sobreviventes (fora d'água). Um nó de junção
      // acumula vizinhos de vários traçados — comportamento esperado.
      const pathNb = new Map<number, [number, number][]>(); // célula → [borda, célula vizinha no traçado]
      const addPathNb = (i: number, k: number, j: number) => {
        const arr = pathNb.get(i);
        if (arr) arr.push([k, j]); else pathNb.set(i, [[k, j]]);
      };
      for (const path of paths) {
        for (let t = 1; t < path.length; t++) {
          const a = path[t - 1]!, b = path[t]!;
          const ai = cellIndex(map, a.col, a.row), bi = cellIndex(map, b.col, b.row);
          if (!roadSet.has(ai) || !roadSet.has(bi)) continue; // um dos dois virou vau/contorno
          const kAB = edgeBetween(a.col, a.row, b.col, b.row);
          const kBA = edgeBetween(b.col, b.row, a.col, a.row);
          if (kAB != null) addPathNb(ai, kAB, bi);
          if (kBA != null) addPathNb(bi, kBA, ai);
        }
      }
      const corridor = new Map<number, number>();
      for (const [col, row] of onRoad) corridor.set(cellIndex(map, col, row), heightmap[cellIndex(map, col, row)] ?? 0);
      for (let pass = 0; pass < 16; pass++) {
        let changed = false;
        for (const i of roadSet) {
          let cur = corridor.get(i)!;
          for (const [, j] of pathNb.get(i) ?? []) {
            const nl = corridor.get(j)!;
            if (cur > nl + 1) { cur = nl + 1; changed = true; }
          }
          corridor.set(i, cur);
        }
        if (!changed) break;
      }
      // 3) O DEGRAU TEM QUE CAIR NUM TRECHO RETO. A peça de rampa
      //    (hex_road_A_sloped_high) é uma estrada RETA: sobe pela borda k e
      //    desce pela oposta k+3. Se o degrau calha numa célula onde o traçado
      //    CURVA (entra pela borda 4 e sobe pela 0, por ex.), a faixa de estrada
      //    da peça aponta pro lado errado e a estrada visualmente quebra — era
      //    esse o "direcionamento da rampa sai errado" em morro.
      //    Solução: onde não dá pra encaixar, a célula sobe pro nível de cima —
      //    o degrau anda um passo pra trás no traçado, até achar um trecho reto
      //    (ou sumir na ponta). Só sobe, então o laço converge.
      const idxOf = (i: number) => ({ col: i % W, row: Math.floor(i / W) });
      const edgeOf = (a: number, b: number) => {
        const A = idxOf(a), B = idxOf(b);
        return edgeBetween(A.col, A.row, B.col, B.row);
      };
      // sequências ORDENADAS de cada traçado (vau/contorno d'água quebram em pedaços)
      const seqs: number[][] = [];
      for (const path of paths) {
        let run: number[] = [];
        for (const c of path) {
          const i = cellIndex(map, c.col, c.row);
          if (!roadSet.has(i)) { if (run.length) seqs.push(run); run = []; continue; }
          run.push(i);
        }
        if (run.length) seqs.push(run);
      }
      /** a célula t da sequência é uma rampa VÁLIDA? devolve a borda de descida */
      const rampEdgeAt = (seq: number[], t: number): number | null => {
        const c = seq[t]!;
        const my = corridor.get(c)!;
        const prev = t > 0 ? seq[t - 1]! : null;
        const next = t + 1 < seq.length ? seq[t + 1]! : null;
        const upIsNext = next != null && corridor.get(next) === my + 1;
        const upIsPrev = prev != null && corridor.get(prev) === my + 1;
        if (!upIsNext && !upIsPrev) return null; // trecho plano: sem rampa
        const up = upIsNext ? next! : prev!;
        const other = upIsNext ? prev : next;
        // o outro lado tem que existir, estar no MESMO nível e ser a borda oposta
        if (other == null || corridor.get(other) !== my) return null;
        const kUp = edgeOf(c, up);
        const kOther = edgeOf(c, other);
        if (kUp == null || kOther == null || kOther !== (kUp + 3) % 6) return null;
        return kOther; // desce pelo lado oposto ao degrau
      };
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (const seq of seqs)
          for (let t = 0; t < seq.length; t++) {
            const c = seq[t]!;
            const my = corridor.get(c)!;
            const prev = t > 0 ? seq[t - 1]! : null;
            const next = t + 1 < seq.length ? seq[t + 1]! : null;
            const isStep = (prev != null && corridor.get(prev) === my + 1) || (next != null && corridor.get(next) === my + 1);
            if (!isStep || rampEdgeAt(seq, t) != null) continue;
            corridor.set(c, my + 1); // não encaixa aqui: nivela e empurra o degrau
            changed = true;
          }
        if (!changed) break;
      }
      for (const [i, v] of corridor) heightmap[i] = v;
      for (const i of roadSet) ramps.delete(i);
      for (const seq of seqs)
        for (let t = 0; t < seq.length; t++) {
          const down = rampEdgeAt(seq, t);
          if (down != null) ramps.set(seq[t]!, down);
        }
      sanitizeRamps(ramps, heightmap, W, H); // o corredor mexeu no relevo
      // spawns intactos (inclusive os nós auto já existentes, que agora
      // persistem) + só os nós auto criados nesta chamada
      // limpa tiles-prop legados e as pontes de mapas gerados antes de a estrada
      // passar a PARAR no rio (não existe mais travessia auto-gerada)
      const propsKept = map.props.filter((p) => !(p.tags?.[0] === "_gen" && (p.tags?.[1] === "road" || p.tags?.[1] === "bridge")));
      return {
        ...histPush(s),
        map: {
          ...map,
          spawns: [...(reroll ? map.spawns.filter((sp) => !(sp.kind === "road_node" && sp.id.startsWith("autoroad_"))) : map.spawns), ...autoNodes],
          props: propsKept,
          surface,
          collision,
          heightmap,
          ramps: flattenRamps(ramps),
        },
        roadCells,
        roadSalt,
        fordCells: [],
        dirty: true,
      };
    }),
  // rio = superfície de ÁGUA ao longo de um caminho SERPENTEANTE (azul contínuo
  // crisp via os tiles de água do HexTerrain; bloqueia + a vegetação evita).
  // Guarda as células p/ o "limpar" reverter só o rio (sem tocar nos lagos).
  // Regenerar o TERRENO reconstrói a superfície do zero → gere o rio DEPOIS.
  generateRiver: () =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      const { width: W, height: H } = map.size;
      const r0 = Math.floor(Math.random() * H), r1 = Math.floor(Math.random() * H);
      const cells = wanderPath(0, r0, W - 1, r1, 0.16, (Math.random() * 1e9) | 0);
      // sem superfície (mapa do map_cache), materializa DERIVANDO da colisão —
      // "grass" para tudo apagava o azul da água andável do mapa original
      const surface = (map.surface.length ? map.surface.slice() : surfaceFromCollision(map)) as SurfaceType[];
      const collision = map.collision.slice();
      const heightmap = map.heightmap.slice();
      const ramps = rampMap(map.ramps);
      // reverte o rio ANTERIOR (re-roll não acumula água)
      for (const i of s.riverCells) { surface[i] = "grass"; collision[i] = "walkable"; }
      const riverCells: number[] = [];
      for (const c of cells) {
        if (c.col < 0 || c.col >= W || c.row < 0 || c.row >= H) continue;
        const i = cellIndex(map, c.col, c.row);
        // já é lagoa: NÃO sobrescreve — o rio se funde na água parada (mesma
        // massa, borda contínua) em vez de virar um tile de canal solto dentro
        // do lago. Não entra em riverCells (senão "limpar" apagaria o lago).
        if (surface[i] === "water") continue;
        // idem estrada: água do rAthena é ANDÁVEL (tipo 3), então deixar o rio
        // cortar parede/buraco abriria uma passagem no bloqueio
        if (collision[i] === "wall" || collision[i] === "cliff") continue;
        surface[i] = "river"; // ≠ "water": vira canal com peça orientada + margem
        collision[i] = "water";
        heightmap[i] = 0;
        ramps.delete(i);
        riverCells.push(i);
      }
      // VALE: rebaixa a margem (1 anel) pra no máx. 1 nível — sem isso o rio
      // corta o relevo e fica um paredão de 6 níveis colado na água.
      for (const c of cells) {
        for (const [nc, nr] of editorGrid().neighbors(c.col, c.row)) {
          if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
          const j = cellIndex(map, nc, nr);
          if (surface[j] === "river" || surface[j] === "water") continue;
          if ((heightmap[j] ?? 0) > 1) { heightmap[j] = 1; ramps.delete(j); }
        }
      }
      sanitizeRamps(ramps, heightmap, W, H); // o vale mexeu no relevo
      // rio traçado DEPOIS da estrada deixaria asfalto debaixo d'água: refaz a
      // rede (determinística — mesmo desenho, só recalcula onde cruza a água),
      // pro traçado voltar a morrer na margem nova.
      if (s.roadCells.length > 0) queueMicrotask(() => useEditorStore.getState().generateRoads());
      return { ...histPush(s), map: { ...map, surface, collision, heightmap, ramps: flattenRamps(ramps) }, riverCells, fordCells: [], dirty: true };
    }),
  clearPaths: () =>
    set((s) => {
      if (!s.map) return s;
      // reverte as células de estrada (terra) e de rio (água) → grama/andável
      const surface = (s.map.surface.length ? s.map.surface.slice() : []) as SurfaceType[];
      const collision = s.map.collision.slice();
      const ramps = rampMap(s.map.ramps);
      // cada um reverte só o que ainda é seu (estrada e rio podem ter se
      // sobreposto entre uma geração e outra)
      for (const i of s.roadCells) if (surface[i] === "dirt") { surface[i] = "grass"; collision[i] = "walkable"; ramps.delete(i); }
      for (const i of s.riverCells) if (surface[i] === "river") { surface[i] = "grass"; collision[i] = "walkable"; }
      for (const i of s.fordCells) collision[i] = "water"; // desfaz o vau (volta a bloquear)
      const props = s.map.props.filter((p) => !(p.tags?.[0] === "_gen" && (p.tags?.[1] === "road" || p.tags?.[1] === "bridge")));
      return { ...histPush(s), map: { ...s.map, surface, collision, props, ramps: flattenRamps(ramps) }, roadCells: [], riverCells: [], fordCells: [], dirty: true };
    }),
  clearProps: () =>
    set((s) => {
      if (!s.map) return s;
      saveProc({}, s.procDisabled);
      return { ...histPush(s), map: { ...s.map, props: [] }, selected: null, procAmounts: {}, dirty: true };
    }),
  updateProp: (i, patch) =>
    set((s) =>
      s.map
        ? { ...histPush(s), map: { ...s.map, props: s.map.props.map((p, j) => (j === i ? { ...p, ...patch } : p)) }, dirty: true }
        : s,
    ),
  /**
   * Apaga do mapa os bloqueios MIÚDOS (1 célula, 2–4 em linha/L, quadrado 2×2)
   * e deixa chão andável no lugar.
   *
   * São as árvores e pedras avulsas que o mapa original tinha; limpá-las
   * devolve o campo aberto para autorar por cima com os assets do projeto. As
   * manchas grandes (encosta, construção, o cinturão da borda) não entram.
   *
   * Mexe na COLISÃO do mapa 3D — que é a do servidor. Enquanto o `map_cache`
   * do rAthena não for regerado, o servidor continua barrando essas células:
   * o chão fica visualmente livre e o personagem para nele.
   */
  clearSmallBlocked: () =>
    set((s) => {
      if (!s.map) return s;
      const escopo = s.editScope;
      const collision = [...s.map.collision];
      const surface = s.map.surface.length ? [...s.map.surface] : [];
      const heightmap = [...s.map.heightmap];
      let limpas = 0;
      for (const cluster of findBlockedClusters(s.map)) {
        if (cluster.kind === "structure") continue;
        if (escopo === "border" && !cluster.onBorder) continue;
        if (escopo === "inside" && cluster.onBorder) continue;
        for (const [col, row] of cluster.cells) {
          const i = cellIndex(s.map, col, row);
          // BURACO nunca é limpo. O painel existe para varrer arbusto e pedra
          // avulsa (`wall`), que não viram nada em 3D; um `cliff` é ravina, e
          // regra do projeto é que borda e buraco NÃO ficam andáveis.
          if (collision[i] === "cliff") continue;
          collision[i] = "walkable";
          if (surface.length) surface[i] = "grass";
          heightmap[i] = 0;
          limpas++;
        }
      }
      if (limpas === 0) return s;
      return {
        ...histPush(s),
        map: { ...s.map, collision, surface, heightmap },
        dirty: true,
      };
    }),
  setEditScope: (scope) => set({ editScope: scope }),
  addSpawn: (col, row) =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      // escopo escolhido na barra: fora dele, a edição simplesmente não acontece
      if (!cellInScope(map, s.editScope, col, row)) return s;
      const { x, z } = editorGrid().cellToWorld(col, row);
      const y = editorGrid().levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0);
      const id = `sp${Date.now().toString(36)}_${seq++}`;
      let spawn: MapSpawn;
      if (s.spawnKind === "player") {
        spawn = { id, kind: "player_start", position: [x, y, z] };
        // só 1 player_start: remove os anteriores
        const spawns = map.spawns.filter((sp) => sp.kind !== "player_start").concat(spawn);
        return { ...histPush(s), map: { ...map, spawns }, selectedSpawn: spawns.length - 1, selected: null, dirty: true };
      }
      if (s.spawnKind === "road") {
        spawn = { id, kind: "road_node", position: [x, y, z] }; // nó exclusivo de estrada
      } else if (s.spawnKind === "npc") {
        spawn = { id, kind: "npc", refId: s.monsterKey, position: [x, y, z] };
      } else {
        spawn = { id, kind: "mob", refId: s.monsterKey, position: [x, y, z], count: s.spawnCount, radius: s.spawnRadius };
      }
      const spawns = [...map.spawns, spawn];
      return { ...histPush(s), map: { ...map, spawns }, selectedSpawn: spawns.length - 1, selected: null, dirty: true };
    }),
  updateSpawn: (i, patch) =>
    set((s) =>
      s.map
        ? { ...histPush(s), map: { ...s.map, spawns: s.map.spawns.map((sp, j) => (j === i ? { ...sp, ...patch } : sp)) }, dirty: true }
        : s,
    ),
  // selecionar um spawn sai do modo colocar/pincel → ferramenta de seleção
  selectSpawn: (i) => set({ selectedSpawn: i, selected: null, tool: "select", currentAsset: null, propPaint: false }),

  // arrastar objeto no chão: 1 snapshot no início, move sem empilhar durante
  startDrag: (kind, index) => set((s) => (s.map ? { ...histPush(s), dragging: { kind, index } } : s)),
  dragTo: (col, row) =>
    set((s) => {
      const map = s.map;
      const d = s.dragging;
      if (!map || !d) return s;
      if (col < 0 || col >= map.size.width || row < 0 || row >= map.size.height) return s;
      // Arrastar também obedece ao escopo: colocar respeitava a parte escolhida,
      // mas arrastar depois levava o mesmo asset para fora dela — o escopo virava
      // uma regra que valia só no primeiro clique.
      if (!cellInScope(map, s.editScope, col, row)) return s;
      const { x, z } = editorGrid().cellToWorld(col, row);
      const y = editorGrid().levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0);
      const { width: W, height: H } = map.size;
      if (d.kind === "prop") {
        const anchor = map.props[d.index];
        if (!anchor) return s;
        // lote: se o prop arrastado faz parte da seleção múltipla, move TODOS
        // pelo mesmo delta (mantém o arranjo); senão só ele.
        const batch = s.multi.length > 1 && s.multi.includes(d.index);
        const ids = batch ? new Set(s.multi) : new Set([d.index]);
        const dx = x - anchor.position[0];
        const dz = z - anchor.position[2];
        const props = map.props.map((p, j) => {
          if (!ids.has(j)) return p;
          const nx = p.position[0] + dx;
          const nz = p.position[2] + dz;
          const nc = editorGrid().worldToCell(nx, nz);
          const ny = nc.col >= 0 && nc.col < W && nc.row >= 0 && nc.row < H ? editorGrid().levelToY(map.heightmap[cellIndex(map, nc.col, nc.row)] ?? 0) : p.position[1];
          return { ...p, position: [nx, ny, nz] as [number, number, number] };
        });
        return { map: { ...map, props }, dirty: true };
      }
      const spawns = map.spawns.map((sp, j) => (j === d.index ? { ...sp, position: [x, y, z] as [number, number, number] } : sp));
      return { map: { ...map, spawns }, dirty: true };
    }),
  // ao soltar um NÓ DE ESTRADA, a rede tem que refletir a nova posição —
  // sem isso o traçado ficava desatualizado até clicar "Estradas" de novo.
  endDrag: () =>
    set((s) => {
      const d = s.dragging;
      if (d?.kind === "spawn" && s.map?.spawns[d.index]?.kind === "road_node") {
        queueMicrotask(() => useEditorStore.getState().generateRoads());
      }
      return { dragging: null };
    }),
  setSpawnKind: (spawnKind) =>
    set((s) => ({
      spawnKind,
      tool: "spawn",
      currentAsset: null,
      // default de refId por tipo (monstro vs npc)
      monsterKey: spawnKind === "npc" ? (SPAWN_NPCS[0]?.key ?? "knight") : spawnKind === "mob" && !SPAWN_MONSTERS.some((m) => m.key === s.monsterKey) ? "skeleton_warrior" : s.monsterKey,
    })),
  setMonsterKey: (monsterKey) => set({ monsterKey }),
  setSpawnCount: (n) => set({ spawnCount: Math.max(1, Math.min(20, Math.round(n))) }),
  setSpawnRadius: (n) => set({ spawnRadius: Math.max(0, Math.min(30, Math.round(n))) }),
  deleteSelected: () =>
    set((s) => {
      if (!s.map) return s;
      // lote: deleta todos da seleção múltipla
      if (s.multi.length > 1) {
        const rm = new Set(s.multi);
        return { ...histPush(s), map: { ...s.map, props: s.map.props.filter((_, j) => !rm.has(j)) }, multi: [], selected: null, dirty: true };
      }
      if (s.multiSpawn.length > 1) {
        const rm = new Set(s.multiSpawn);
        return { ...histPush(s), map: { ...s.map, spawns: s.map.spawns.filter((_, j) => !rm.has(j)) }, multiSpawn: [], selectedSpawn: null, dirty: true };
      }
      if (s.selectedTrigger != null) {
        return { ...histPush(s), map: { ...s.map, triggers: (s.map.triggers ?? []).filter((_, j) => j !== s.selectedTrigger) }, selectedTrigger: null, dirty: true };
      }
      if (s.selectedSpawn != null) {
        return { ...histPush(s), map: { ...s.map, spawns: s.map.spawns.filter((_, j) => j !== s.selectedSpawn) }, selectedSpawn: null, dirty: true };
      }
      if (s.selected != null) {
        return { ...histPush(s), map: { ...s.map, props: s.map.props.filter((_, j) => j !== s.selected) }, selected: null, dirty: true };
      }
      return s;
    }),
  // selecionar um objeto sai do modo colocar/pincel → ferramenta de seleção
  // (evita ficar colocando asset sem querer ao interagir depois de escolher algo)
  select: (i) => set({ selected: i, multi: [], selectedSpawn: null, selectedTrigger: null, tool: "select", currentAsset: null, propPaint: false }),
  toggleMulti: (i) =>
    set((s) => {
      const has = s.multi.includes(i);
      const multi = has ? s.multi.filter((x) => x !== i) : [...s.multi, i];
      return { multi, selected: i, selectedSpawn: null, tool: "select", currentAsset: null, propPaint: false };
    }),
  selectRange: (i) =>
    set((s) => {
      // âncora = o que estava selecionado (ou o primeiro da seleção em lote)
      const de = s.selected ?? s.multi[0] ?? i;
      const [a, b] = de <= i ? [de, i] : [i, de];
      const multi: number[] = [];
      for (let k = a; k <= b; k++) multi.push(k);
      return { multi, selected: i, selectedSpawn: null, multiSpawn: [], tool: "select", currentAsset: null, propPaint: false };
    }),
  toggleMultiSpawn: (i) =>
    set((s) => {
      const has = s.multiSpawn.includes(i);
      const multiSpawn = has ? s.multiSpawn.filter((x) => x !== i) : [...s.multiSpawn, i];
      return { multiSpawn, selectedSpawn: i, selected: null, multi: [], tool: "select", currentAsset: null };
    }),
  selectSpawnRange: (i) =>
    set((s) => {
      const de = s.selectedSpawn ?? s.multiSpawn[0] ?? i;
      const [a, b] = de <= i ? [de, i] : [i, de];
      const multiSpawn: number[] = [];
      for (let k = a; k <= b; k++) multiSpawn.push(k);
      return { multiSpawn, selectedSpawn: i, selected: null, multi: [], tool: "select", currentAsset: null };
    }),
  deleteLayer: (layer) =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      const escopo = s.editScope;
      const dentro = (x: number, z: number) => worldInScope(map, escopo, x, z);
      if (layer === "props") {
        const restam = map.props.filter((p) => !dentro(p.position[0], p.position[2]));
        if (restam.length === map.props.length) return s;
        // zera os sliders das camadas do escopo: sem isso o painel continuaria
        // marcando 40% de uma vegetação que não existe mais
        const procAmounts = { ...s.procAmounts };
        for (const chave of Object.keys(procAmounts)) {
          if (splitProcKey(chave)[0] === escopo) delete procAmounts[chave];
        }
        saveProc(procAmounts, s.procDisabled);
        return { ...histPush(s), map: { ...map, props: restam }, selected: null, multi: [], procAmounts, dirty: true };
      }
      if (layer === "spawns") {
        const restam = map.spawns.filter((sp) => !dentro(sp.position[0], sp.position[2]));
        if (restam.length === map.spawns.length) return s;
        return { ...histPush(s), map: { ...map, spawns: restam }, selectedSpawn: null, multiSpawn: [], dirty: true };
      }
      const triggers = map.triggers ?? [];
      const restam = triggers.filter((t) => !cellInScope(map, escopo, t.area.col, t.area.row));
      if (restam.length === triggers.length) return s;
      return { ...histPush(s), map: { ...map, triggers: restam }, selectedTrigger: null, dirty: true };
    }),

  // cria um prefab da seleção atual (lote > 1, senão o selecionado). Guarda os
  // props relativos ao centroide (x,z) do grupo → carimbável em qualquer hex.
  savePrefab: (name) =>
    set((s) => {
      if (!s.map) return s;
      const idxs = s.multi.length > 1 ? s.multi : s.selected != null ? [s.selected] : [];
      const chosen = idxs.map((i) => s.map!.props[i]).filter((p): p is MapProp => !!p);
      if (chosen.length === 0) return s;
      const cx = chosen.reduce((a, p) => a + p.position[0], 0) / chosen.length;
      const cz = chosen.reduce((a, p) => a + p.position[2], 0) / chosen.length;
      const items: PrefabItem[] = chosen.map((p) => ({
        assetId: p.assetId,
        dx: p.position[0] - cx,
        dz: p.position[2] - cz,
        ry: p.rotation[1],
        scale: p.scale[0] ?? 1,
        colliderType: p.colliderType,
        tags: p.tags,
      }));
      const def: PrefabDef = { id: `pf${Date.now().toString(36)}_${seq++}`, name: name.trim() || `Prefab ${s.prefabs.length + 1}`, items };
      const prefabs = [...s.prefabs, def];
      savePrefabs(prefabs);
      return { prefabs };
    }),
  deletePrefab: (id) =>
    set((s) => {
      const prefabs = s.prefabs.filter((p) => p.id !== id);
      savePrefabs(prefabs);
      return { prefabs, currentPrefab: s.currentPrefab === id ? null : s.currentPrefab };
    }),
  // arma/desarma um prefab pra colocar; armado → ferramenta "prefab" (clique carimba)
  armPrefab: (id) =>
    set(() => (id ? { currentPrefab: id, tool: "prefab", currentAsset: null, propPaint: false, selected: null, multi: [], selectedSpawn: null } : { currentPrefab: null, tool: "select" })),
  // carimba o prefab armado no hex clicado (centroide no centro do hex; cada item
  // assenta na altura do hex correspondente). Deixa o grupo colado como seleção
  // múltipla e mantém o prefab armado (carimba vários seguidos).
  placePrefab: (col, row) =>
    set((s) => {
      const map = s.map;
      if (!map || !s.currentPrefab) return s;
      // escopo escolhido na barra: fora dele, a edição simplesmente não acontece
      if (!cellInScope(map, s.editScope, col, row)) return s;
      const def = s.prefabs.find((p) => p.id === s.currentPrefab);
      if (!def) return s;
      const { width: W, height: H } = map.size;
      if (col < 0 || col >= W || row < 0 || row >= H) return s;
      const { x: x0, z: z0 } = editorGrid().cellToWorld(col, row);
      const added: MapProp[] = def.items.map((it) => {
        const nx = x0 + it.dx;
        const nz = z0 + it.dz;
        const nc = editorGrid().worldToCell(nx, nz);
        const ny = nc.col >= 0 && nc.col < W && nc.row >= 0 && nc.row < H ? editorGrid().levelToY(map.heightmap[cellIndex(map, nc.col, nc.row)] ?? 0) : editorGrid().levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0);
        return {
          id: nextPropId(),
          assetId: it.assetId,
          position: [nx, ny, nz] as [number, number, number],
          rotation: [0, it.ry, 0] as [number, number, number],
          scale: [it.scale, it.scale, it.scale] as [number, number, number],
          colliderType: it.colliderType,
          ...(it.tags ? { tags: it.tags } : {}),
        };
      });
      const base = map.props.length;
      const newMulti = added.map((_, k) => base + k);
      return { ...histPush(s), map: { ...map, props: [...map.props, ...added] }, multi: newMulti, selected: newMulti[0]!, dirty: true };
    }),
  togglePrefabs: () => set((s) => ({ showPrefabs: !s.showPrefabs })),

  // ---- triggers ----
  setTriggerKind: (triggerKind) => set({ triggerKind, tool: "area", currentAsset: null, propPaint: false }),
  beginArea: (col, row) => set({ areaAnchor: { col, row }, areaDraft: { col, row, w: 1, h: 1 } }),
  dragArea: (col, row) =>
    set((s) => {
      const a = s.areaAnchor;
      if (!a) return s;
      const c0 = Math.min(a.col, col), r0 = Math.min(a.row, row);
      const w = Math.abs(col - a.col) + 1, h = Math.abs(row - a.row) + 1;
      return { areaDraft: { col: c0, row: r0, w, h } };
    }),
  commitArea: () =>
    set((s) => {
      const map = s.map;
      const d = s.areaDraft;
      if (!map || !d) return { areaAnchor: null, areaDraft: null };
      const kind = s.triggerKind;
      const trigger: MapTrigger = {
        id: `tr${Date.now().toString(36)}_${seq++}`,
        kind,
        area: d,
        ...(kind === "warp" ? { target: { mapId: map.id, col: d.col, row: d.row } } : {}),
        ...(kind === "script" ? { event: "OnTouch" } : {}),
        ...(kind === "damage" || kind === "heal" ? { value: 10 } : {}),
      };
      const triggers = [...(map.triggers ?? []), trigger];
      return { ...histPush(s), map: { ...map, triggers }, areaAnchor: null, areaDraft: null, selectedTrigger: triggers.length - 1, selected: null, selectedSpawn: null, dirty: true };
    }),
  selectTrigger: (i) => set({ selectedTrigger: i, selected: null, selectedSpawn: null, multi: [], tool: "select", currentAsset: null, propPaint: false }),
  editPath: () =>
    set((s) => {
      if (s.selectedSpawn == null || s.map?.spawns[s.selectedSpawn]?.kind !== "npc") return s;
      return { tool: "path", currentAsset: null, propPaint: false };
    }),
  addWaypoint: (col, row) =>
    set((s) => {
      const map = s.map;
      const i = s.selectedSpawn;
      if (!map || i == null) return s;
      const sp = map.spawns[i];
      if (!sp || sp.kind !== "npc") return s;
      const { x, z } = editorGrid().cellToWorld(col, row);
      const y = editorGrid().levelToY(map.heightmap[cellIndex(map, col, row)] ?? 0);
      const prev = sp.path ?? { points: [], mode: "loop" as const, speed: 3 };
      const path = { ...prev, points: [...prev.points, [x, y, z] as [number, number, number]] };
      return { ...histPush(s), map: { ...map, spawns: map.spawns.map((p, j) => (j === i ? { ...p, path } : p)) }, dirty: true };
    }),
  clearPath: () =>
    set((s) => {
      const map = s.map;
      const i = s.selectedSpawn;
      if (!map || i == null) return s;
      const sp = map.spawns[i];
      if (!sp || sp.kind !== "npc" || !sp.path) return s;
      const { path: _drop, ...rest } = sp;
      return { ...histPush(s), map: { ...map, spawns: map.spawns.map((p, j) => (j === i ? (rest as MapSpawn) : p)) }, dirty: true };
    }),
  setPathMode: (mode) =>
    set((s) => {
      const map = s.map;
      const i = s.selectedSpawn;
      if (!map || i == null) return s;
      const sp = map.spawns[i];
      if (!sp || sp.kind !== "npc" || !sp.path) return s;
      return { ...histPush(s), map: { ...map, spawns: map.spawns.map((p, j) => (j === i && p.path ? { ...p, path: { ...p.path, mode } } : p)) }, dirty: true };
    }),
  setPathSpeed: (speed) =>
    set((s) => {
      const map = s.map;
      const i = s.selectedSpawn;
      if (!map || i == null) return s;
      const sp = map.spawns[i];
      if (!sp || sp.kind !== "npc" || !sp.path) return s;
      const sp2 = Math.max(0.5, Math.min(12, speed));
      return { map: { ...map, spawns: map.spawns.map((p, j) => (j === i && p.path ? { ...p, path: { ...p.path, speed: sp2 } } : p)) }, dirty: true };
    }),
  updateTrigger: (i, patch) =>
    set((s) =>
      s.map
        ? { ...histPush(s), map: { ...s.map, triggers: (s.map.triggers ?? []).map((t, j) => (j === i ? { ...t, ...patch } : t)) }, dirty: true }
        : s,
    ),

  // início de um traçado: 1 único snapshot de histórico pra toda a área pintada
  // enquanto o mouse fica pressionado (undo volta o traçado inteiro de uma vez)
  beginStroke: () =>
    set((s) => {
      if (!s.map) return s;
      // A rampa é o único pincel que precisa das DUAS PONTAS, então guarda aqui
      // de onde o gesto saiu — e junto o heightmap original, senão cada
      // movimento do mouse interpolaria sobre o resultado do movimento anterior
      // e a ladeira ia "escorregando" enquanto se arrasta.
      return { ...histPush(s), rampAnchor: null, rampBase: s.map.heightmap };
    }),
  /** começa uma rampa (ou um grab) na célula: guarda a âncora do gesto */
  beginRamp: (col, row) =>
    set((s) => {
      if (!s.map) return s;
      const base = s.rampBase ?? s.map.heightmap;
      return { rampAnchor: { col, row, level: base[cellIndex(s.map, col, row)] ?? 0 }, rampBase: base };
    }),
  endRamp: () => set({ rampAnchor: null, rampBase: null }),
  paintCell: (col, row) =>
    set((s) => {
      const map = s.map;
      if (!map) return s;
      const { width: W, height: H } = map.size;
      if (col < 0 || col >= W || row < 0 || row >= H) return s;
      // O escopo é conferido CÉLULA A CÉLULA no laço abaixo, não só no centro do
      // pincel: com "Buraco" escolhido e uma ravina de duas células, o centro do
      // disco cai fora dela quase sempre — barrar pelo centro tornava o pincel
      // inútil justamente no escopo mais estreito.
      const heightmap = map.heightmap.slice();
      const surface = (map.surface.length ? map.surface.slice() : surfaceFromCollision(map)) as SurfaceType[];
      const collision = map.collision.slice();
      const orig = map.heightmap; // fonte imutável (smooth usa alturas originais)
      const b = s.brush;
      // com PESO por célula: o pincel de relevo é proporcional (ver brushFalloff);
      // superfície e colisão ignoram o peso — pintar é tudo-ou-nada
      const cells = cellsWithFalloff(W, H, col, row, s.brushSize);
      /**
       * O relevo pode entrar em célula BLOQUEADA?
       *
       * Só "Dentro" protege. Antes a permissão era exclusiva de "Borda"/"Buraco",
       * e "Tudo" acabava se comportando igual a "Dentro" — suavizar com "Tudo"
       * escolhido pegava o miolo e ignorava mata e ravina, que é o oposto do que
       * o nome promete. "Dentro" continua sendo o escopo seguro: lá o pincel de
       * relevo não encosta em bloqueio, o que protege a ravina de uma pincelada
       * larga no campo.
       *
       * A COLISÃO segue intocada em qualquer escopo: mexer na altura de uma
       * parede não abre passagem nela.
       */
      const escopoBloqueio = s.editScope !== "inside";
      const target = orig[cellIndex(map, col, row)] ?? 0; // p/ flatten
      // o piso vai abaixo de zero por causa do BURACO: uma ravina é terreno
      // negativo, e travar em 0 não deixaria desenhá-la
      const clamp = (v: number) => Math.max(-6, Math.min(12, v));

      /**
       * Rampa: interpola do nível da ÂNCORA (onde o gesto começou) até o nível da
       * célula atual, ao longo da faixa entre as duas.
       *
       * Sai do laço comum porque não é um disco em volta do cursor: é uma faixa
       * com duas pontas. A base é o `rampBase` — o heightmap de antes do gesto —,
       * então arrastar de volta desfaz em vez de acumular.
       */
      if (b === "ramp") {
        const a = s.rampAnchor;
        if (!a) return s;
        const base = s.rampBase ?? orig;
        const h1 = base[cellIndex(map, col, row)] ?? 0;
        let mudou = false;
        for (const cel of rampCells(a, { col, row }, a.level, h1, s.brushSize, { width: W, height: H })) {
          const i = cellIndex(map, cel.col, cel.row);
          if (!cellInScope(map, s.editScope, cel.col, cel.row)) continue;
          const bloq = collision[i] === "wall" || collision[i] === "cliff";
          // mesma regra dos outros pincéis de relevo: bloqueio só nos escopos
          // que são bloqueio, e a colisão nunca muda
          if (bloq && !escopoBloqueio) continue;
          const nivel = clamp(cel.level);
          if (heightmap[i] !== nivel) {
            heightmap[i] = nivel;
            mudou = true;
          }
        }
        if (!mudou) return s;
        return { map: { ...map, heightmap }, dirty: true };
      }

      /**
       * Grab: puxa a região inteira, e o quanto ela sobe vem do TAMANHO do gesto.
       *
       * O mouse arrasta no plano do chão, então não existe "para cima" na tela
       * para usar como no Blender — o que existe é a distância até a âncora, e é
       * ela que vira altura. Arrastar mais longe levanta mais; voltar por cima do
       * ponto de partida desfaz, porque a base é o relevo de ANTES do gesto
       * (`rampBase`, o mesmo mecanismo da rampa). Sem essa base, cada movimento
       * do mouse somaria sobre o anterior e o morro fugiria da mão.
       */
      if (b === "grab") {
        const a = s.rampAnchor;
        if (!a) return s;
        const base = s.rampBase ?? orig;
        const dist = Math.hypot(col - a.col, row - a.row);
        const alturaDoGesto = dist * s.brushStrength;
        const doDisco = cellsWithFalloff(W, H, a.col, a.row, s.brushSize);
        let mudou = false;
        for (const [c, r, peso] of doDisco) {
          const i = cellIndex(map, c, r);
          if (!cellInScope(map, s.editScope, c, r)) continue;
          const bloq = collision[i] === "wall" || collision[i] === "cliff";
          if (bloq && !escopoBloqueio) continue;
          const alvoH = clamp((base[i] ?? 0) + alturaDoGesto * peso);
          if (heightmap[i] !== alvoH) {
            heightmap[i] = alvoH;
            mudou = true;
          }
        }
        if (!mudou) return s;
        return { map: { ...map, heightmap }, dirty: true };
      }
      for (const [c, r, peso] of cells) {
        const i = cellIndex(map, c, r);
        // O pincel de raio > 0 pega um disco de células, e cada uma tem que
        // passar pelo escopo — senão pintar "dentro" perto de uma ravina cobria
        // a ravina junto (era um dos jeitos de o buraco sumir).
        if (!cellInScope(map, s.editScope, c, r)) continue;
        const bloqueada = collision[i] === "wall" || collision[i] === "cliff";
        // Buraco: só onde já é bloqueado, e o bloqueio permanece — o pincel
        // decide a APARÊNCIA (elevação ou depressão), nunca a passagem.
        if (b === "cliffUp" || b === "cliffDown") {
          if (!bloqueada) continue;
          heightmap[i] = clamp(b === "cliffUp" ? Math.max(1, (heightmap[i] ?? 0) + 1) : Math.min(-1, (heightmap[i] ?? 0) - 1));
          continue;
        }
        /**
         * Relevo em célula bloqueada: só nos escopos que SÃO bloqueio.
         *
         * "Borda" e "Buraco" são terreno inacessível que se molda de propósito —
         * é onde subir um paredão bem acima do chão faz sentido. Já em "Dentro" e
         * "Tudo" o pincel de altura fica no chão andável: `visualLevel` deixa a
         * altura autorada vencer o palpite por tipo, então um "subir" de raio 3
         * encostando numa ravina gravava nível nela e a ravina virava chão — era
         * o "some o buraco".
         *
         * A colisão nunca muda aqui: borda e buraco continuam intransponíveis
         * por mais alto ou fundo que fiquem.
         */
        const relevo =
          b === "raise" ||
          b === "lower" ||
          b === "flatten" ||
          b === "noise" ||
          b === "smooth" ||
          b === "inflate" ||
          b === "scrape";
        if (bloqueada && relevo && !escopoBloqueio) continue;
        /**
         * Relevo é PROPORCIONAL: o peso do falloff entra na conta.
         *
         * O centro do pincel se move `força` níveis; a vizinhança acompanha cada
         * vez menos, e a borda do disco quase não sai do lugar. É o que
         * transforma o antigo "+1 em todo o disco" (pilar de topo chato, o
         * aspecto Roblox) numa colina. A altura é fracionária de propósito: o
         * schema aceita (`z.array(z.number())`) e a malha lê a altura como campo
         * contínuo (grid/heightField).
         */
        const passo = s.brushStrength * peso;
        if (b === "raise") heightmap[i] = clamp((heightmap[i] ?? 0) + passo);
        else if (b === "lower") heightmap[i] = clamp((heightmap[i] ?? 0) - passo);
        else if (b === "flatten") {
          // vai na direção do alvo proporcionalmente: a borda mal se move
          const atual = heightmap[i] ?? 0;
          heightmap[i] = clamp(atual + (target - atual) * Math.min(1, passo));
        } else if (b === "noise") heightmap[i] = clamp((heightmap[i] ?? 0) + (Math.random() * 2 - 1) * passo);
        else if (b === "inflate") {
          /**
           * Inflate: empurra a superfície ao longo da NORMAL dela.
           *
           * Num heightmap só existe o eixo vertical, então o "ao longo da normal"
           * aparece como peso: a componente Y da normal vale ~1 no plano e cai na
           * encosta. O topo (plano) sobe o passo inteiro e as laterais (inclinadas)
           * sobem pouco — é isso que arredonda a forma em vez de erguer um pilar
           * de lados retos, que é o que `raise` faz.
           */
          const [, ny] = cornerNormal(map, c, r, bloqueada);
          heightmap[i] = clamp((heightmap[i] ?? 0) + passo * ny);
        } else if (b === "scrape") {
          // Scrape: raspa só o que está ACIMA do plano do centro. Nunca preenche
          // — é a diferença em relação ao `flatten`, que puxa dos dois lados e
          // por isso "sobe" o fundo de uma depressão junto.
          const atual = heightmap[i] ?? 0;
          if (atual > target) heightmap[i] = clamp(atual + (target - atual) * Math.min(1, passo));
        } else if (b === "smooth") {
          let sum = orig[i] ?? 0;
          let n = 1;
          for (const [nc, nr] of editorGrid().neighbors(c, r)) {
            if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
            sum += orig[cellIndex(map, nc, nr)] ?? 0;
            n++;
          }
          // média dos vizinhos, aplicada em fração (sem arredondar: arredondar
          // devolvia o degrau que o suavizar deveria tirar)
          const media = sum / n;
          const atual = heightmap[i] ?? 0;
          heightmap[i] = clamp(atual + (media - atual) * Math.min(1, passo));
        } else {
          surface[i] = b as SurfaceType; // grass | water
          // Superfície pinta APARÊNCIA. Em célula bloqueada a colisão fica como
          // está: `SURFACE_COLLISION.grass` é "walkable", então uma pincelada de
          // grama abria passagem no meio da mata e apagava o buraco sem pedir.
          // Quem abre passagem é o painel "Limpar terreno bloqueado", de
          // propósito e com contagem na tela.
          if (!bloqueada) collision[i] = SURFACE_COLLISION[b as SurfaceType];
        }
      }
      // NÃO empilha histórico aqui — beginStroke() já fez 1× no início do traçado
      return { map: { ...map, heightmap, surface, collision }, dirty: true };
    }),
  setHover: (hover) => set({ hover }),

  undo: () =>
    set((s) => {
      if (s.past.length === 0 || !s.map) return s;
      const prev = s.past[s.past.length - 1]!;
      return { map: prev, past: s.past.slice(0, -1), future: [s.map, ...s.future], selected: null, dirty: true };
    }),
  redo: () =>
    set((s) => {
      if (s.future.length === 0 || !s.map) return s;
      const next = s.future[0]!;
      return { map: next, future: s.future.slice(1), past: [...s.past, s.map], selected: null, dirty: true };
    }),

  setTool: (tool) => set({ tool }),
  // trocar de ferramenta é EXCLUSIVO: pincel desliga transform/decoração e vice-versa
  setBrush: (brush) => set({ brush, tool: "brush", currentAsset: null }),
  setBrushSize: (n) => set({ brushSize: Math.max(0, Math.min(12, Math.round(n))) }),
  setBrushStrength: (n) => set({ brushStrength: Math.max(0.05, Math.min(3, n)) }),
  setAsset: (currentAsset) => set({ currentAsset, tool: currentAsset ? "place" : "select", propPaint: false }),
  setCamMove: (camMove) => set({ camMove }),
  markSaved: () => set({ dirty: false }),
}));

// aux de dev: inspecionar/dirigir o editor no console (testes de comportamento)
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __editor?: unknown }).__editor = useEditorStore;
