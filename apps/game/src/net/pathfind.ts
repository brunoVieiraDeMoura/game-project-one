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
 * Não é o `MAX_WALKPATH`: quem manda é `battle_config.max_walk_path`, conferido
 * em `unit_walktoxy` (unit.cpp:860) — acima disso o servidor devolve 0 e não
 * responde NADA. É por isso que clicar longe parecia "não ter alcance": o
 * cliente pedia, o servidor descartava em silêncio (medido: 16 células andavam,
 * 20 não).
 *
 * **Este número é uma CÓPIA do servidor e tem de bater com ele.** O valor do
 * projeto está em `rathena-conf/battle_conf.txt` (`max_walk_path: 30`); o
 * padrão do rAthena é 17 e o teto absoluto é `MAX_WALKPATH` (32,
 * `battle.cpp:8684` valida o intervalo). Se um lado mudar sozinho, o cliente
 * volta a pedir trecho que o servidor joga fora — e a falha é silenciosa.
 */
export const MAX_WALK_PATH_DEFAULT = 30;

/**
 * O SEGUNDO teto, o que quase ninguém lembra: 14 células quando há obstáculo.
 *
 * `OFFICIAL_WALKPATH` está LIGADO nesta árvore (`rathena/src/config/core.hpp:26`)
 * e acrescenta esta regra ao `unit_walktoxy` (unit.cpp:865), logo depois do
 * `max_walk_path`:
 *
 * ```c
 * // Official number of walkable cells is 14 if and only if there is an
 * // obstacle between.
 * if( wpd.path_len > 14 && !path_search_long(...) ) return 0;
 * ```
 *
 * Ou seja: um caminho de mais de 14 células só é aceito se a LINHA RETA entre
 * as duas pontas estiver livre. Como toda recusa do `unit_walktoxy` é SILENCIOSA
 * — devolve 0 e não responde nada —, ignorar isto no cliente é uma falha muda,
 * exatamente do tipo que o projeto já pagou caro com o `max_walk_path`.
 *
 * Hoje não morde porque o `prt_fild08` está 100% andável e a reta nunca cruza
 * bloqueio. Morde no primeiro relevo autorado.
 */
export const MAX_WALK_PATH_COM_OBSTACULO = 14;

/**
 * A reta entre duas células está livre? (`path_search_long`, path.cpp:132)
 *
 * O rAthena caminha a linha de Bresenham conferindo `CELL_CHKNOPASS` em cada
 * célula. É esta a pergunta que decide qual dos dois tetos vale.
 */
export function retaLivre(map: GameMap, from: Cell, to: Cell, blocked?: Set<number>): boolean {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let err = dx - dy;
  // teto de segurança: a reta nunca é maior que a soma dos catetos
  for (let guarda = dx + dy + 2; guarda > 0; guarda--) {
    if (!walkable(map, x, y, blocked)) return false;
    if (x === to.x && y === to.y) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return false;
}

/**
 * Maior trecho que se pode PEDIR de uma vez, já com margem.
 *
 * A margem existe porque quem refaz a conta é o SERVIDOR, a partir da célula
 * onde ELE acha que o personagem está — que pode não ser a que o cliente
 * desenha. Era de UMA célula e foi dimensionada para um desvio de uma célula;
 * com o desvio acumulado de 2-3 que o cliente chegava a ter, o trecho pedido
 * estourava o teto na conta do servidor e sumia calado. Três é o mesmo número
 * que o `DERIVA_MAX` do worldStore admite, arredondado para cima.
 */
export const MARGEM_TRECHO = 3;

export function tetoDeTrecho(map: GameMap, from: Cell, to: Cell, blocked?: Set<number>): number {
  const teto = retaLivre(map, from, to, blocked) ? MAX_WALK_PATH_DEFAULT : MAX_WALK_PATH_COM_OBSTACULO;
  return Math.max(4, teto - MARGEM_TRECHO);
}

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
