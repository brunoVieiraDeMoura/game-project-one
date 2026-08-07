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
 * Os três grupos de canto: quem se mistura com quem na altura/normal.
 *
 * `"blocked"` e `"land"` já existiam (era um booleano). `"water"` é o
 * terceiro: água RASA (`collision: "water"`) é andável — não é `"blocked"` —
 * mas também não pode se misturar com o chão vizinho, senão erguer um morro
 * do lado de um lago puxa a lâmina/leito para cima do próprio barranco, e
 * visualmente a água "sobe a montanha" junto com o relevo novo (o vértice da
 * borda da água, tingido de azul por `cellColor`, fica na mesma altura
 * média do morro recém-erguido). Água FUNDA já caía no grupo certo antes
 * desta separação — ela grava `collision: "wall"`, então já era `"blocked"`.
 */
export type CellGroup = "land" | "water" | "blocked";

/** grupo de canto da célula — usa `isBlockedCell` pro caso comum (bloqueio) e
 * só então checa água rasa. */
export function cellGroup(map: GameMap, idx: number): CellGroup {
  if (isBlockedCell(map, idx)) return "blocked";
  return map.collision[idx] === "water" ? "water" : "land";
}

/**
 * Altura (em nível, não em unidades de mundo) do canto SUPERIOR-ESQUERDO da
 * célula (col,row) — ou seja, do vértice em `(col*S, row*S)`.
 *
 * Junta as quatro células que tocam esse canto: (col-1,row-1), (col,row-1),
 * (col-1,row) e (col,row). `grupo` escolhe quais contam; se nenhuma vizinha do
 * grupo existir, cai na média de todas (canto na fronteira do mapa).
 */
export function cornerLevel(map: GameMap, col: number, row: number, grupo: CellGroup): number {
  const { width, height } = map.size;
  let soma = 0;
  let n = 0;
  /** land + blocked juntos — só para a exceção "autorada" abaixo, NUNCA inclui água */
  let somaTerra = 0;
  let nTerra = 0;
  let somaTodas = 0;
  let nTodas = 0;
  /**
   * Todas as células deste canto têm altura AUTORADA?
   *
   * É o que decide se BLOQUEIO e CHÃO se misturam aqui — a separação existe por
   * causa do PALPITE por tipo do `visualLevel` (parede +1, buraco −1): sem ela,
   * esse degrau inventado viraria rampa para dentro do campo e o jogador veria
   * ladeira onde o servidor não deixa subir.
   *
   * Mas onde a altura foi PINTADA não há palpite nenhum — quem decidiu a forma
   * foi quem autorou. Ali a separação só rasga a superfície: um morro erguido
   * por cima de mata e campo tem `wall` e `walkable` INTERCALADOS, cada grupo
   * calcula um canto diferente, e o vão entre eles vira aquela prateleira de
   * face vertical no meio da encosta (medido no mapa do usuário: 618 fronteiras
   * assim, degrau de até 3,73 níveis — a referência `craquelado-square.jpg`).
   *
   * ÁGUA NUNCA entra nesta exceção, autorada ou não: o barranco (`escavarBarranco`/
   * `escavarBacia`) também grava altura nas duas pontas da margem, então "toda
   * célula autorada" é justamente o caso COMUM perto de um lago ou rio — se água
   * entrasse aqui, a exceção reabriria exatamente a mistura que este grupo
   * existe para impedir.
   *
   * "Água" aqui é por SUPERFÍCIE (`surface: "river"|"water"`), não por grupo:
   * rio FUNDO tem `collision: "wall"`, então o grupo dele é `"blocked"`, igual
   * montanha — `g !== "water"` sozinho NUNCA pegava esse caso, e um corpo
   * d'água autorado (o barranco grava altura nos dois lados) misturava
   * silenciosamente com a margem autorada, canto sim canto não, dependendo de
   * quantas das 4 células daquele canto específico tinham heightmap ≠ 0. Essa
   * alternância — tier-2 (misturado) num canto, tier-1 (puro) no vizinho — é
   * o serrilhado triangular da saia em `agua-bugada.jpg`: a profundidade do
   * canal balançava de canto a canto ao longo do rio inteiro, não só perto da
   * montanha. `agua-bugada.jpg` mostra rio puro, sem montanha nenhuma no
   * quadro — a contaminação nunca dependeu de montanha existir.
   */
  let todasAutoradas = true;
  let temAgua = false;
  for (let dr = -1; dr <= 0; dr++) {
    for (let dc = -1; dc <= 0; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const idx = cellIndex(map, c, r);
      const g = cellGroup(map, idx);
      const nivel = visualLevel(map, idx);
      if ((map.heightmap[idx] ?? 0) === 0) todasAutoradas = false;
      const s = map.surface[idx];
      if (g === "water" || s === "river" || s === "water") temAgua = true;
      somaTodas += nivel;
      nTodas++;
      if (g !== "water") {
        somaTerra += nivel;
        nTerra++;
      }
      if (g === grupo) {
        soma += nivel;
        n++;
      }
    }
  }
  if (grupo !== "water" && !temAgua && todasAutoradas && nTerra > 0) return somaTerra / nTerra;
  if (n > 0) return soma / n;
  return nTodas > 0 ? somaTodas / nTodas : 0;
}

/** soma/contagem SÓ do tier-1 do `cornerLevel` (mesmo grupo, sem cair para as
 * exceções/fallback) — usada pelo blur de `cornerLevelSaia`, que só pode
 * misturar cantos genuinamente tocados por bloqueio, nunca o "somaTodas" que
 * `cornerLevel` usa de último recurso (esse cai de volta em água/chão, e
 * misturá-lo aqui reabriria a mesma contaminação que a separação de grupos
 * existe para impedir). */
function tier1Blocked(map: GameMap, col: number, row: number): number | null {
  const { width, height } = map.size;
  let soma = 0;
  let n = 0;
  for (let dr = -1; dr <= 0; dr++) {
    for (let dc = -1; dc <= 0; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const idx = cellIndex(map, c, r);
      if (cellGroup(map, idx) === "blocked") {
        soma += visualLevel(map, idx);
        n++;
      }
    }
  }
  return n > 0 ? soma / n : null;
}

/**
 * A mesma altura de canto do `cornerLevel`, borrada ao longo da fronteira SÓ
 * quando o canto está perto de água — e só usada pela SAIA (a face vertical
 * de um bloqueio junto a rio/lago), nunca pelo topo do quad.
 *
 * `cornerLevel("blocked")` já suaviza a montanha por dentro (canto = média das
 * células "blocked" que o tocam), mas ao longo de uma fronteira DIAGONAL esse
 * número varia de canto a canto conforme o zigue-zague da margem cai em 1, 2
 * ou 3 células do grupo — é essa variação, mais que a própria saia em blocos
 * axis-aligned, que lê como serrilhado na `Desktop/ref/agua-bugada.jpg`
 * (item 2). Borrar o valor "blocked" com os cantos "blocked" VIZINHOS (nunca
 * com o canto de água — grupos continuam sem se misturar, e só entram cantos
 * com tier-1 de verdade, nunca o fallback de `cornerLevel`) suaviza o degrau
 * sem tocar em colisão, em passagem, ou no resto do corner-blend — fora do
 * raio de água o valor é IDÊNTICO ao `cornerLevel` de sempre.
 */
export function cornerLevelSaia(map: GameMap, col: number, row: number, grupo: CellGroup): number {
  const bruto = cornerLevel(map, col, row, grupo);
  if (grupo !== "blocked") return bruto;
  const { width, height } = map.size;
  const RAIO_AGUA = 2;
  let pertoDagua = false;
  for (let dr = -RAIO_AGUA; dr <= RAIO_AGUA && !pertoDagua; dr++) {
    for (let dc = -RAIO_AGUA; dc <= RAIO_AGUA; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      const idxViz = cellIndex(map, c, r);
      const sViz = map.surface[idxViz];
      // grupo "water" (rio raso/lago) OU superfície "river"/"water" (pega
      // também rio FUNDO — collision "wall", grupo "blocked", mesma classe
      // da montanha; ver o comentário de `cornerLevel` sobre essa lacuna)
      if (cellGroup(map, idxViz) === "water" || sViz === "river" || sViz === "water") {
        pertoDagua = true;
        break;
      }
    }
  }
  if (!pertoDagua) return bruto;
  let soma = 0;
  let peso = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const cc = col + dc;
      const rr = row + dr;
      if (cc < 0 || rr < 0 || cc > width || rr > height) continue;
      const v = tier1Blocked(map, cc, rr);
      if (v == null) continue;
      const w = 1 / (1 + dc * dc + dr * dr);
      soma += v * w;
      peso += w;
    }
  }
  return peso > 0 ? soma / peso : bruto;
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
  // cantos "de chão" (e dentro d'água, dos cantos "de água") — o degrau da
  // parede ou da margem vizinha não puxa o piso para cima
  const grupo = cellGroup(map, cellIndex(map, col, row));
  const h00 = cornerLevel(map, col, row, grupo);
  const h10 = cornerLevel(map, col + 1, row, grupo);
  const h01 = cornerLevel(map, col, row + 1, grupo);
  const h11 = cornerLevel(map, col + 1, row + 1, grupo);
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
  grupo: CellGroup,
): [number, number, number] {
  const hL = squareLevelToY(cornerLevel(map, col - 1, row, grupo));
  const hR = squareLevelToY(cornerLevel(map, col + 1, row, grupo));
  const hD = squareLevelToY(cornerLevel(map, col, row - 1, grupo));
  const hU = squareLevelToY(cornerLevel(map, col, row + 1, grupo));
  // d(altura)/d(mundo): dois cantos de distância = 2 × SQUARE_SIZE
  const dx = (hR - hL) / (2 * SQUARE_SIZE);
  const dz = (hU - hD) / (2 * SQUARE_SIZE);
  const len = Math.hypot(dx, 1, dz);
  return [-dx / len, 1 / len, -dz / len];
}
