import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

/**
 * Mapa 3D editado → `map_cache.dat` do rAthena.
 *
 * É a volta do caminho de `migrate-maps.ts`. Sem isto, tudo o que se autora no
 * editor — limpar um bloqueio, plantar uma árvore, cavar um buraco — vale só no
 * cliente: quem decide passagem no jogo é o servidor, e ele continua lendo o
 * cache original. Daí "o personagem atravessa a árvore".
 *
 * A saída vai para `rathena-db-import/map_cache.dat`, que no WSL é o symlink de
 * `rathena/db/import/`. O map-server carrega os caches nesta ordem e fica com o
 * PRIMEIRO que contiver cada mapa (map.cpp:3920-3970):
 *
 *   db/import/map_cache.dat   ← este arquivo
 *   db/re/map_cache.dat       ← o original, intocado
 *   db/map_cache.dat
 *
 * Ou seja: só os mapas exportados aqui mudam; o resto do servidor segue igual.
 * Nada dentro de `rathena/` é escrito.
 *
 * Uso:
 *   pnpm --filter @ragnarok/legacy-migration export:mapcache -- --maps prt_fild08
 *   (--from json  lê os JSONs migrados em vez da API)
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** rathena/src/common/mmo.hpp — nome do mapa no cache */
const MAP_NAME_LENGTH = 12;
/** `struct main_header` alinhado: uint32 file_size + uint16 map_count + padding */
const MAIN_HEADER_SIZE = 8;
/** `struct map_info`: name[12] + xs + ys + len */
const MAP_INFO_SIZE = 20;

/**
 * Tipo de célula do `.gat`, como o rAthena os interpreta
 * (`map_gat2cell`, map.cpp:3280).
 */
const GAT = { WALKABLE: 0, WALL: 1, WATER: 3, GAP: 5 } as const;

interface Prop {
  assetId: string;
  position: [number, number, number];
  scale: [number, number, number];
  colliderType?: string;
}

interface GameMapLike {
  id: string;
  size: { width: number; height: number };
  collision: string[];
  props: Prop[];
  terrainMode?: string;
}

interface CatalogEntry {
  id: string;
  cat: string;
  radius?: number;
  defaultScale?: number;
}

/** catálogo de props (raio medido do .gltf por scripts/measure-props.mjs) */
function loadCatalog(): Map<string, CatalogEntry> {
  const dir = join(REPO_ROOT, "apps", "game", "src", "props");
  const out = new Map<string, CatalogEntry>();
  for (const file of ["forest-catalog.json", "hex-decor-catalog.json", "hex-tiles-catalog.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const list = (Array.isArray(raw) ? raw : Object.values(raw as object)[0]) as CatalogEntry[];
    if (!Array.isArray(list)) continue;
    for (const e of list) out.set(e.id, e);
  }
  return out;
}

/**
 * Categorias que BLOQUEIAM.
 *
 * Grama, estrada, rio, costa, rampa e ponte são chão — não podem virar parede,
 * ou o personagem ficaria preso na própria estrada por onde deveria andar.
 */
const SOLIDAS = new Set(["tree", "tree_bare", "rock", "hill", "mountain", "building", "bush"]);

/** lado da célula no mundo 3D (grid/squareGrid.ts) */
const SQUARE_SIZE = 2.0;

/**
 * Células que um prop ocupa.
 *
 * Usa o raio medido do modelo, convertido de unidades de mundo para células.
 * O raio é do TRONCO/base (o hull medido), não da copa — é o que dá o "dar a
 * volta na árvore" sem criar um muro invisível de vários metros.
 */
function cellsOfProp(prop: Prop, entry: CatalogEntry | undefined, W: number, H: number): number[] {
  if (!entry) return [];
  const solido = prop.colliderType ? prop.colliderType !== "none" : SOLIDAS.has(entry.cat);
  if (!solido) return [];
  const escala = prop.scale[0] ?? 1;
  const raioMundo = (entry.radius ?? 0.5) * escala;
  if (raioMundo <= 0) return [];

  const cx = prop.position[0] / SQUARE_SIZE;
  const cz = prop.position[2] / SQUARE_SIZE;
  const raioCelulas = raioMundo / SQUARE_SIZE;
  const out: number[] = [];
  const c0 = Math.floor(cx - raioCelulas), c1 = Math.floor(cx + raioCelulas);
  const r0 = Math.floor(cz - raioCelulas), r1 = Math.floor(cz + raioCelulas);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (col < 0 || row < 0 || col >= W || row >= H) continue;
      // centro da célula dentro do círculo do prop
      const dx = col + 0.5 - cx;
      const dz = row + 0.5 - cz;
      if (dx * dx + dz * dz <= raioCelulas * raioCelulas) out.push(row * W + col);
    }
  }
  return out;
}

/** GameMap → bytes de célula do rAthena */
function toCells(map: GameMapLike, catalog: Map<string, CatalogEntry>): { cells: Buffer; bloqueadasPorProp: number } {
  const { width: W, height: H } = map.size;
  const cells = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) {
    switch (map.collision[i]) {
      case "wall": cells[i] = GAT.WALL; break;
      case "cliff": cells[i] = GAT.GAP; break;
      case "water": cells[i] = GAT.WATER; break;
      default: cells[i] = GAT.WALKABLE;
    }
  }
  let bloqueadasPorProp = 0;
  for (const prop of map.props) {
    for (const idx of cellsOfProp(prop, catalog.get(prop.assetId), W, H)) {
      if (cells[idx] === GAT.WALKABLE) {
        cells[idx] = GAT.WALL;
        bloqueadasPorProp++;
      }
    }
  }
  return { cells, bloqueadasPorProp };
}

async function loadMap(id: string, from: "api" | "json"): Promise<GameMapLike> {
  if (from === "json") {
    const path = join(__dirname, "..", "output", "maps", `${id}.json`);
    return JSON.parse(readFileSync(path, "utf8")) as GameMapLike;
  }
  const res = await fetch(`${API_URL}/maps/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`GET /maps/${id} → ${res.status}`);
  return (await res.json()) as GameMapLike;
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--maps");
  const ids = idx >= 0 && args[idx + 1] ? args[idx + 1]!.split(",") : [];
  const fromIdx = args.indexOf("--from");
  const from = (fromIdx >= 0 && args[fromIdx + 1] === "json" ? "json" : "api") as "api" | "json";
  const outIdx = args.indexOf("--out");
  const outPath =
    outIdx >= 0 && args[outIdx + 1]
      ? args[outIdx + 1]!
      : join(REPO_ROOT, "rathena-db-import", "map_cache.dat");

  if (ids.length === 0) {
    console.error("uso: export:mapcache -- --maps prt_fild08[,outro] [--from api|json]");
    process.exit(1);
  }

  const catalog = loadCatalog();
  const blocos: Buffer[] = [];
  const resumo: Array<Record<string, unknown>> = [];

  for (const id of ids) {
    const map = await loadMap(id, from);
    const { width: W, height: H } = map.size;
    const { cells, bloqueadasPorProp } = toCells(map, catalog);
    const comprimido = deflateSync(cells);

    const info = Buffer.alloc(MAP_INFO_SIZE);
    info.write(id.slice(0, MAP_NAME_LENGTH), 0, "ascii");
    info.writeInt16LE(W, 12);
    info.writeInt16LE(H, 14);
    info.writeInt32LE(comprimido.length, 16);
    blocos.push(info, comprimido);

    const andaveis = [...cells].filter((c) => c === GAT.WALKABLE || c === GAT.WATER).length;
    resumo.push({
      mapa: id,
      grade: `${W}x${H}`,
      andaveis,
      bloqueadas: W * H - andaveis,
      bloqueadasPorProp,
      bytes: comprimido.length,
    });
  }

  const corpo = Buffer.concat(blocos);
  const header = Buffer.alloc(MAIN_HEADER_SIZE);
  header.writeUInt32LE(MAIN_HEADER_SIZE + corpo.length, 0);
  header.writeUInt16LE(ids.length, 4);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.concat([header, corpo]));

  console.table(resumo);
  console.log(`map_cache com ${ids.length} mapa(s) → ${outPath}`);
  console.log("reinicie o rAthena para valer: scripts/wsl-stop.sh && scripts/wsl-run.sh");
}

void main();
