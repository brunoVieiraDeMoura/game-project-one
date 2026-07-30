import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";
import { SQUARE_SIZE, squareLevelToY } from "./squareGrid";
import { visualLevel } from "./squareChunks";

/**
 * O relevo do chão como SUPERFÍCIE CONTÍNUA, não como degraus.
 *
 * O heightmap guarda um valor por CÉLULA. Desenhando cada célula como um quad
 * plano na sua própria altura, o resultado é literalmente Minecraft: tudo em
 * degraus de 90°, e uma montanha não parece montanha.
 *
 * Aqui a altura passa a viver nos CANTOS: o canto é a média das (até quatro)
 * células que se encontram nele. Duas células vizinhas compartilham dois cantos,
 * então a superfície fica contínua e a inclinação aparece — é o mesmo dado, lido
 * como campo em vez de como blocos. O heightmap aceita fracionário
 * (`z.array(z.number())`, sem `.int()`), então um pincel suave já cabe no formato.
 *
 * Uma exceção proposital: a média só junta células do MESMO grupo de passagem.
 * Chão com chão, bloqueio com bloqueio. Sem isso, a parede (que `visualLevel`
 * levanta) e o buraco (que ele afunda) virariam rampa para dentro do chão
 * andável — e o jogador veria uma ladeira onde o servidor não deixa subir.
 */

/** a célula é bloqueio (parede/buraco)? define com quem a altura se mistura */
export function isBlockedCell(map: GameMap, idx: number): boolean {
  const c = map.collision[idx];
  return c === "wall" || c === "cliff";
}

/**
 * Altura (em nível, não em unidades de mundo) do canto SUPERIOR-ESQUERDO da
 * célula (col,row) — ou seja, do vértice em `(col*S, row*S)`.
 *
 * Junta as quatro células que tocam esse canto: (col-1,row-1), (col,row-1),
 * (col-1,row) e (col,row). `bloqueada` escolhe o grupo; se nenhuma vizinha do
 * grupo existir, cai na média de todas (canto na fronteira do mapa).
 */
export function cornerLevel(map: GameMap, col: number, row: number, bloqueada: boolean): number {
  const { width, height } = map.size;
  let soma = 0;
  let n = 0;
  let somaTodas = 0;
  let nTodas = 0;
  for (let dr = -1; dr <= 0; dr++) {
    for (let dc = -1; dc <= 0; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const idx = cellIndex(map, c, r);
      const nivel = visualLevel(map, idx);
      somaTodas += nivel;
      nTodas++;
      if (isBlockedCell(map, idx) !== bloqueada) continue;
      soma += nivel;
      n++;
    }
  }
  if (n > 0) return soma / n;
  return nTodas > 0 ? somaTodas / nTodas : 0;
}

/**
 * Altura de mundo em qualquer ponto (x,z) — interpolação bilinear entre os
 * quatro cantos da célula que contém o ponto.
 *
 * É a MESMA conta que a malha usa nos vértices, então o que se vê e o que se
 * pisa não divergem. Foi a lição do `tile-heightfields` no mundo hexagonal:
 * aproximar a altura do chão por outra fórmula fazia o personagem flutuar na
 * estrada e vazar nas pontas da rampa.
 */
export function sampleHeight(map: GameMap, x: number, z: number): number {
  const { width, height } = map.size;
  const fx = x / SQUARE_SIZE;
  const fz = z / SQUARE_SIZE;
  const col = Math.max(0, Math.min(width - 1, Math.floor(fx)));
  const row = Math.max(0, Math.min(height - 1, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - col));
  const tz = Math.max(0, Math.min(1, fz - row));

  // o grupo é o da célula pisada: dentro de uma célula de chão, a altura vem dos
  // cantos "de chão", e o degrau da parede vizinha não puxa o piso para cima
  const bloqueada = isBlockedCell(map, cellIndex(map, col, row));
  const h00 = cornerLevel(map, col, row, bloqueada);
  const h10 = cornerLevel(map, col + 1, row, bloqueada);
  const h01 = cornerLevel(map, col, row + 1, bloqueada);
  const h11 = cornerLevel(map, col + 1, row + 1, bloqueada);
  const nivel = h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  return squareLevelToY(nivel);
}

/**
 * Normal da superfície no canto (col,row), pelo gradiente do campo de altura.
 *
 * Normal por VÉRTICE é o que faz a encosta ler como encosta: com uma normal por
 * face (o que `flatShading` dá), cada célula acende com um tom só e a colina
 * volta a parecer um monte de caixas. O gradiente é a diferença central entre os
 * cantos vizinhos, convertida para unidades de mundo.
 */
export function cornerNormal(
  map: GameMap,
  col: number,
  row: number,
  bloqueada: boolean,
): [number, number, number] {
  const hL = squareLevelToY(cornerLevel(map, col - 1, row, bloqueada));
  const hR = squareLevelToY(cornerLevel(map, col + 1, row, bloqueada));
  const hD = squareLevelToY(cornerLevel(map, col, row - 1, bloqueada));
  const hU = squareLevelToY(cornerLevel(map, col, row + 1, bloqueada));
  // d(altura)/d(mundo): dois cantos de distância = 2 × SQUARE_SIZE
  const dx = (hR - hL) / (2 * SQUARE_SIZE);
  const dz = (hU - hD) / (2 * SQUARE_SIZE);
  const len = Math.hypot(dx, 1, dz);
  return [-dx / len, 1 / len, -dz / len];
}
