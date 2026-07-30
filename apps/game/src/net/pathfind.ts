import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";

/**
 * O MESMO caminho que o rAthena anda — A* portado de `rathena/src/map/path.cpp`.
 *
 * O servidor manda só a origem e o destino de cada trecho (`ZC_NOTIFY_MOVE` /
 * `NOTIFY_PLAYERMOVE`); o caminho entre eles fica implícito. O cliente vinha
 * interpolando em "passo de rei" (diagonal enquanto os dois eixos têm folga),
 * que é a rota do terreno LIVRE — e, com obstáculo no meio, atravessava a
 * parede: o personagem subia no bloco vermelho e reaparecia do outro lado.
 *
 * O próprio rAthena avisa por que precisa ser A* (path.cpp:337):
 *   "We always use A* for finding walkpaths because it is what game client
 *    uses. Easy pathfinding cuts corners of non-walkable cells, but client
 *    always walks around it."
 *
 * Portado fielmente:
 *  • custo 10 reto / 14 diagonal (`MOVE_COST`, `MOVE_DIAGONAL_COST`, path.hpp);
 *  • heurística Manhattan × 10 — a mesma superestimativa do cliente oficial;
 *  • oito direções, e a diagonal SÓ quando os dois ortogonais estão livres
 *    (`chk_dir`), que é o que impede cortar a quina de uma parede.
 */

/** path.hpp:11-12 */
export const MOVE_COST = 10;
export const MOVE_DIAGONAL_COST = 14;
/** path.hpp:14 — teto absoluto do rAthena para um caminho */
export const MAX_WALKPATH = 32;

/**
 * Quantas células o servidor aceita por PEDIDO de caminhada.
 *
 * Não é o `MAX_WALKPATH`: quem manda é `battle_config.max_walk_path`, que vale
 * **17** por padrão (`conf/battle/client.conf:42`) e é conferido em
 * `unit_walktoxy` (unit.cpp:860) — acima disso o servidor devolve 0 e não
 * responde nada. É por isso que clicar longe parecia "não ter alcance": o
 * cliente pedia, o servidor descartava em silêncio.
 *
 * Medido no servidor deste projeto: 16 células andam, 20 não.
 */
export const MAX_WALK_PATH_DEFAULT = 17;

export interface Cell {
  x: number;
  y: number;
}

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

/**
 * Célula andável para o CAMINHO (a mesma regra do map_cache: água anda).
 *
 * `blocked` traz as células que os props ocupam depois de exportados para o
 * servidor (ver grid/propCells). Sem elas, o cliente traçava caminho reto por
 * cima de uma árvore que o servidor barra — e o personagem aparecia
 * atravessando o tronco enquanto o servidor o fazia dar a volta.
 */
function walkable(map: GameMap, x: number, y: number, blocked?: Set<number>): boolean {
  const { width, height } = map.size;
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const idx = cellIndex(map, x, y);
  if (blocked?.has(idx)) return false;
  const cell = map.collision[idx];
  return cell === "walkable" || cell === "water";
}

function heuristic(x0: number, y0: number, x1: number, y1: number): number {
  return MOVE_COST * (Math.abs(x1 - x0) + Math.abs(y1 - y0));
}

/**
 * Caminho de `from` até `to`, célula a célula (sem incluir a origem).
 *
 * Devolve `null` quando não há rota — o mesmo que o servidor faria; nesse caso
 * quem chama deve manter o personagem parado em vez de inventar uma linha reta.
 */
export function findPath(map: GameMap, from: Cell, to: Cell, blocked?: Set<number>): Cell[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!walkable(map, to.x, to.y, blocked)) return null;

  const open: Node[] = [];
  const best = new Map<number, Node>();
  const key = (x: number, y: number) => y * map.size.width + x;

  const start: Node = { x: from.x, y: from.y, g: 0, f: heuristic(from.x, from.y, to.x, to.y), parent: null };
  open.push(start);
  best.set(key(from.x, from.y), start);
  const closed = new Set<number>();

  // Teto de nós: um A* sem limite num mapa de 160.000 células pode varrer o
  // mapa inteiro quando o destino está cercado. O servidor tem o mesmo teto por
  // outro caminho (MAX_WALKPATH), então parar aqui não inventa comportamento.
  const MAX_NODES = 20000;
  let visitados = 0;

  while (open.length > 0) {
    // menor f — lista pequena o bastante para não valer um heap
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const current = open.splice(bi, 1)[0]!;
    const ck = key(current.x, current.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (current.x === to.x && current.y === to.y) {
      const path: Cell[] = [];
      for (let n: Node | null = current; n && n.parent; n = n.parent) path.push({ x: n.x, y: n.y });
      return path.reverse();
    }

    if (++visitados > MAX_NODES) return null;

    const { x, y } = current;
    // Direções permitidas a partir DESTA célula. A diagonal só entra se os dois
    // ortogonais ao redor dela estiverem livres — senão o personagem cortaria a
    // quina da parede (path.cpp:360-364).
    const norte = walkable(map, x, y + 1, blocked);
    const sul = walkable(map, x, y - 1, blocked);
    const leste = walkable(map, x + 1, y, blocked);
    const oeste = walkable(map, x - 1, y, blocked);

    const vizinhos: Array<[number, number, number]> = [];
    if (leste) vizinhos.push([x + 1, y, MOVE_COST]);
    if (oeste) vizinhos.push([x - 1, y, MOVE_COST]);
    if (norte) vizinhos.push([x, y + 1, MOVE_COST]);
    if (sul) vizinhos.push([x, y - 1, MOVE_COST]);
    if (norte && leste && walkable(map, x + 1, y + 1, blocked)) vizinhos.push([x + 1, y + 1, MOVE_DIAGONAL_COST]);
    if (norte && oeste && walkable(map, x - 1, y + 1, blocked)) vizinhos.push([x - 1, y + 1, MOVE_DIAGONAL_COST]);
    if (sul && leste && walkable(map, x + 1, y - 1, blocked)) vizinhos.push([x + 1, y - 1, MOVE_DIAGONAL_COST]);
    if (sul && oeste && walkable(map, x - 1, y - 1, blocked)) vizinhos.push([x - 1, y - 1, MOVE_DIAGONAL_COST]);

    for (const [nx, ny, custo] of vizinhos) {
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const g = current.g + custo;
      const anterior = best.get(nk);
      if (anterior && anterior.g <= g) continue;
      const node: Node = { x: nx, y: ny, g, f: g + heuristic(nx, ny, to.x, to.y), parent: current };
      best.set(nk, node);
      open.push(node);
    }
  }
  return null;
}

/**
 * Quanto tempo o servidor leva para andar um caminho.
 *
 * O passo diagonal custa 40% a mais que o reto (`speed * MOVE_DIAGONAL_COST /
 * MOVE_COST`, unit.cpp:229) — tratar tudo como um passo só (distância de
 * Chebyshev) fazia o cliente chegar antes e ficar esperando o servidor.
 */
export function pathDurationMs(path: Cell[], from: Cell, speed: number): number {
  let total = 0;
  let anterior = from;
  for (const c of path) {
    const diagonal = c.x !== anterior.x && c.y !== anterior.y;
    total += diagonal ? (speed * MOVE_DIAGONAL_COST) / MOVE_COST : speed;
    anterior = c;
  }
  return total;
}
