import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { editorGrid } from "./activeGrid";

/**
 * Onde as edições valem: no miolo do mapa, na moldura, ou em tudo.
 *
 * Um mapa importado do rAthena tem duas regiões muito diferentes. O MIOLO é o
 * campo jogável. A BORDA é o cinturão bloqueado que fecha o mapa — em
 * `prt_fild08` são 63.982 células numa mancha só, a mata que circunda tudo.
 * Autorar os dois com o mesmo pincel é como pintar a moldura junto com o
 * quadro: um clique errado no zoom afastado derruba trabalho do outro lado.
 *
 * Com um escopo escolhido, TUDO respeita: pincel de terreno, asset colocado à
 * mão, geração procedural, spawn e prefab. O que cai fora do escopo é ignorado
 * em silêncio — não há edição parcial.
 */

/**
 * As três regiões são DISJUNTAS e cobrem o mapa inteiro:
 *
 *  • `hole`   — célula de BURACO (`cliff`, o gap tipo 5 do rAthena), onde quer que
 *               esteja: ravina, penhasco, o vão intransponível do mapa original;
 *  • `border` — o resto do bloqueio ligado à moldura (o cinturão de mata);
 *  • `inside` — o resto, o campo jogável.
 *
 * O TIPO vence a localização, e isso não é detalhe: em `prt_fild08`, **7.306 das
 * 7.899 células de buraco (92,5%) tocam o cinturão da borda** — a mata da beirada
 * cerca as ravinas. Classificando por localização primeiro, o escopo "Buraco"
 * alcançava só 593 células e parecia funcionar "numa parte pequena do buraco".
 *
 * Serem disjuntas é o que conserta o pincel: com "Dentro" escolhido, grama e
 * "subir" não alcançam mais as células de buraco — antes `inside` era "tudo que
 * não é borda", então qualquer pincelada larga no miolo apagava a ravina
 * (superfície pintada zera a colisão `cliff`, e altura autorada ≠ 0 tira o
 * afundamento que o `visualLevel` dá por TIPO).
 */
export type EditScope = "all" | "inside" | "border" | "hole";

/**
 * Máscara de borda: 1 nas células que fazem parte da moldura bloqueada.
 *
 * Borda é o que está bloqueado E conectado ao limite do mapa (flood fill de 4
 * vizinhos a partir da moldura). Ilha bloqueada no meio do campo não é borda —
 * é obstáculo do miolo.
 *
 * O canal fundo de RIO fica de fora, mesmo bloqueado. Um rio atravessa o mapa de
 * ponta a ponta e encosta na moldura: contado como bloqueio comum, o flood fill
 * corria por dentro dele e o rio inteiro — mais o que ele tocasse — virava
 * região "Borda", tirando o miolo do mapa do escopo "Dentro". O rio é cenário
 * autorado no meio do campo, não moldura.
 */
function buildBorderMask(map: GameMap): Uint8Array {
  const { width: W, height: H } = map.size;
  const mask = new Uint8Array(W * H);
  const bloqueada = (col: number, row: number) => {
    const i = cellIndex(map, col, row);
    if (map.surface[i] === "river") return false;
    const c = map.collision[i];
    return c === "wall" || c === "cliff";
  };

  const pilha: Array<[number, number]> = [];
  const empilhar = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= W || row >= H) return;
    const i = cellIndex(map, col, row);
    if (mask[i] || !bloqueada(col, row)) return;
    mask[i] = 1;
    pilha.push([col, row]);
  };

  // começa por toda a moldura do mapa
  for (let col = 0; col < W; col++) {
    empilhar(col, 0);
    empilhar(col, H - 1);
  }
  for (let row = 0; row < H; row++) {
    empilhar(0, row);
    empilhar(W - 1, row);
  }

  while (pilha.length > 0) {
    const [col, row] = pilha.pop()!;
    empilhar(col + 1, row);
    empilhar(col - 1, row);
    empilhar(col, row + 1);
    empilhar(col, row - 1);
  }
  return mask;
}

// A máscara é cara (uma varredura do mapa) e muda quando a COLISÃO muda — e
// também quando a SUPERFÍCIE muda, desde que o rio saiu da moldura. O store é
// imutável e recria os dois arrays a cada edição, então eles servem de chave;
// a superfície entra como valor guardado porque nem toda edição toca os dois.
const cache = new WeakMap<GameMap["collision"], { surface: GameMap["surface"]; mask: Uint8Array }>();

export function borderMask(map: GameMap): Uint8Array {
  const guardado = cache.get(map.collision);
  if (guardado && guardado.surface === map.surface) return guardado.mask;
  const mask = buildBorderMask(map);
  cache.set(map.collision, { surface: map.surface, mask });
  return mask;
}

/** a célula está no escopo escolhido? */
export function cellInScope(map: GameMap, scope: EditScope, col: number, row: number): boolean {
  if (scope === "all") return true;
  const { width: W, height: H } = map.size;
  if (col < 0 || row < 0 || col >= W || row >= H) return false;
  const i = cellIndex(map, col, row);
  // buraco primeiro: `cliff` é buraco mesmo dentro do cinturão da borda
  const buraco = map.collision[i] === "cliff";
  if (scope === "hole") return buraco;
  if (buraco) return false;
  const naBorda = borderMask(map)[i] === 1;
  return scope === "border" ? naBorda : !naBorda;
}

/** idem, para uma posição de mundo (assets são posicionados assim) */
export function worldInScope(map: GameMap, scope: EditScope, x: number, z: number): boolean {
  if (scope === "all") return true;
  const { col, row } = editorGrid().worldToCell(x, z);
  return cellInScope(map, scope, col, row);
}

/** quantas células cada lado tem — o rótulo do seletor na barra */
export function scopeCounts(map: GameMap): { inside: number; border: number; hole: number } {
  const mask = borderMask(map);
  let border = 0;
  let hole = 0;
  for (let i = 0; i < mask.length; i++) {
    // mesma ordem de `cellInScope`: cliff conta como buraco antes de contar como borda
    if (map.collision[i] === "cliff") hole++;
    else if (mask[i]) border++;
  }
  return { inside: mask.length - border - hole, border, hole };
}
