import type { GameMap, SurfaceType } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";

/**
 * ONDE cada categoria de asset pode nascer na geração automática.
 *
 * Antes havia UMA regra para todas (`editorStore.generateScatter`): fora de
 * água/terra/pedra e das vizinhas delas, em célula andável. Não distinguia
 * categoria, não olhava inclinação e não conhecia neve nem areia — então árvore
 * nascia na duna, no gelo e na encosta.
 *
 * A tabela abaixo é a regra pedida em `next-change-editor.txt`, uma linha por
 * grupo. Pura de propósito: é a parte que dá para conferir sem cena, sem GPU e
 * sem clicar em nada.
 *
 * ## O que "montanha" e "pedra" querem dizer aqui
 *
 * Os dois são a MESMA coisa no dado: `surface === "stone"`. É o que o pincel de
 * montanha grava, é como o "Desfazer ⛏" reconhece uma montanha, e é por isso que
 * o promontório deixou de usar pedra na face. Não há um terceiro estado a
 * distinguir.
 *
 * ## O que NÃO está aqui
 *
 * "Em cima de outro asset" — isso já é resolvido por área ocupada
 * (`occupiedCells` + `SOLID_CATEGORIES`), que trabalha em coordenada de MUNDO e
 * com o raio real de cada peça, não por célula. Duplicar a regra aqui só criaria
 * uma segunda verdade.
 */

/** superfícies onde cada grupo aceita nascer */
const PERMITIDO: Record<string, ReadonlySet<SurfaceType>> = {
  /**
   * VEGETAÇÃO VIVA — árvore, grama e arbusto.
   *
   * Sobra grama e terra. Areia, neve e pedra ficam de fora porque nada disso
   * sustenta mata; água, por motivo óbvio.
   */
  tree: new Set<SurfaceType>(["grass", "dirt"]),
  grass: new Set<SurfaceType>(["grass", "dirt"]),
  bush: new Set<SurfaceType>(["grass", "dirt"]),
  /** flor/planta/samambaia/cogumelo — mesmo chão da grama: sub-bosque, não
   * sustenta em pedra/areia/neve nem embaixo d'água */
  flower: new Set<SurfaceType>(["grass", "dirt"]),
  plant: new Set<SurfaceType>(["grass", "dirt"]),

  /**
   * ÁRVORE SECA — o oposto da viva.
   *
   * Ela é proibida na GRAMA justamente porque é o contrário: tronco morto num
   * gramado verde lê como erro de geração. O lugar dela é o solo exposto e a
   * areia, onde ela conta a história do terreno.
   */
  tree_bare: new Set<SurfaceType>(["dirt", "sand"]),

  /**
   * ROCHA e RELEVO — pedra, colina, montanha.
   *
   * Não podem nascer em montanha (seria pedra sobre pedra, e a montanha já tem
   * o scatter próprio de `generateMountainRocks`) nem em água. Neve e areia
   * valem: pedra em duna e em campo de gelo é comum.
   */
  rock: new Set<SurfaceType>(["grass", "dirt", "sand", "snow"]),
  /** pedra pequena/de caminho — mesma regra da rocha grande */
  stone: new Set<SurfaceType>(["grass", "dirt", "sand", "snow"]),
  hill: new Set<SurfaceType>(["grass", "dirt", "sand", "snow"]),
  mountain: new Set<SurfaceType>(["grass", "dirt", "sand", "snow"]),

  /**
   * CONSTRUÇÃO — em qualquer chão seco, inclusive pedra.
   *
   * Casa sobre laje é normal; o que não existe é casa sobre água ou pendurada
   * numa ladeira.
   */
  building: new Set<SurfaceType>(["grass", "dirt", "sand", "snow", "stone"]),
};

/** grupos que não aceitam LADEIRA */
const EXIGE_PLANO = new Set(["tree", "grass", "bush", "tree_bare", "building", "flower", "plant"]);

/**
 * Desnível que já conta como ladeira, em NÍVEIS entre células vizinhas.
 *
 * Meio nível: abaixo disso o chão ainda lê como plano e a árvore assenta; acima,
 * o tronco fica com um lado no ar — o `groundProps` assenta pelo centro da
 * célula, não pela base inteira do modelo.
 *
 * É um número de aparência, não de regra do servidor: nada aqui muda passagem.
 */
export const INCLINACAO_MAX = 0.5;

/**
 * O maior desnível entre esta célula e as OITO vizinhas.
 *
 * Oito e não quatro: uma encosta diagonal passa despercebida na cruz, e é
 * exatamente onde o modelo fica mais torto. Fora do mapa não conta — a borda não
 * é ladeira, é o fim do dado.
 */
export function inclinacao(map: GameMap, col: number, row: number): number {
  const { width: W, height: H } = map.size;
  const aqui = map.heightmap[cellIndex(map, col, row)] ?? 0;
  let maior = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= W || r < 0 || r >= H) continue;
      maior = Math.max(maior, Math.abs((map.heightmap[cellIndex(map, c, r)] ?? 0) - aqui));
    }
  }
  return maior;
}

/**
 * A superfície da célula — DERIVADA quando o mapa ainda não tem uma.
 *
 * Mapa importado do rAthena chega SEM `surface`: o `map_cache` guarda colisão e
 * mais nada, e o array só é materializado na primeira pincelada do editor
 * (`surfaceFromCollision`). Lendo `map.surface[i]` cru, tudo dava `undefined` e
 * a tabela recusava o mapa inteiro — o slider de vegetação gerava zero árvore
 * num mapa recém-importado, que é o estado em que ele mais é usado.
 *
 * A derivação é a MESMA do resto do editor, e é de propósito: se ela divergisse,
 * o que o scatter enxerga e o que o chão desenha seriam superfícies diferentes.
 */
function superficieDe(map: GameMap, i: number): SurfaceType {
  return map.surface[i] ?? (map.collision[i] === "water" ? "water" : "grass");
}

/**
 * Esta célula aceita um asset desta categoria?
 *
 * Três portas, e a ordem delas é a do custo: colisão (uma leitura), superfície
 * (uma leitura) e só então inclinação (nove leituras).
 *
 * A colisão vem primeiro e vale para TODOS: célula bloqueada é mata, penhasco ou
 * montanha do mapa importado, e plantar nela é plantar dentro de uma parede.
 * Água também bloqueia por aqui — `collision === "water"` é o lago raso e o rio
 * raso, que são andáveis no rAthena mas continuam sendo água.
 */
export function podeNascer(map: GameMap, cat: string, col: number, row: number): boolean {
  const i = cellIndex(map, col, row);
  if (map.collision[i] !== "walkable") return false;

  const permitido = PERMITIDO[cat];
  // categoria sem linha na tabela (estrada, rio, ponte) não é espalhável — elas
  // nascem de geração conectada, não do scatter aleatório
  if (!permitido) return false;
  if (!permitido.has(superficieDe(map, i))) return false;

  if (EXIGE_PLANO.has(cat) && inclinacao(map, col, row) > INCLINACAO_MAX) return false;
  return true;
}
