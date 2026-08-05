import type { Cell } from "./pathfind";

/**
 * Para onde o pedido de caminhada deve REALMENTE ir.
 *
 * O cliente calcula o mesmo caminho que o servidor calcularia (`net/pathfind`,
 * A* portado do rAthena). Quando esse A* devolve `null` não há rota — e pedir
 * assim mesmo era a origem do "dash": o `findPath` já avisa no comentário dele
 * que *"quem chama deve manter o personagem parado em vez de inventar uma linha
 * reta"*, mas `pedirMovimento` emitia `move:to` de qualquer jeito. Com o
 * `map_cache` do servidor mais velho que o mapa editado, o rAthena achava a
 * célula andável, aceitava, respondia o movimento — e o cliente, sem caminho,
 * caía no "passo de rei" e desenhava uma reta POR CIMA da montanha.
 *
 * Aqui a decisão fica isolada e pura, para ser testada como o `pathfind` é.
 */

/** para onde ir e por onde — o caminho vem junto para não recalcular o A* */
export interface Alcance {
  destino: Cell;
  caminho: Cell[];
}

/**
 * Encurta um destino longe demais para a célula mais distante NA MESMA DIREÇÃO.
 *
 * Clicar perto do horizonte cai fora do terreno desenhado e acerta o plano de
 * clique, que cobre o mapa inteiro: o alvo podia sair a 75 células ou mais. Aí o
 * A* varre um pedaço enorme do mapa e, se aquele ponto for parede ou estiver
 * cercado, devolve `null` — e o clique não fazia NADA. Encurtar é melhor que
 * ignorar: o jogador clicou naquela direção, então anda naquela direção até onde
 * dá para ver.
 *
 * A conta é em distância de Chebyshev porque é assim que o rAthena mede passo
 * (diagonal custa um passo, não dois).
 */
export function limitarAlcance(origem: Cell, destino: Cell, maxCelulas: number): Cell {
  const dx = destino.x - origem.x;
  const dy = destino.y - origem.y;
  const passos = Math.max(Math.abs(dx), Math.abs(dy));
  if (passos <= maxCelulas || passos === 0) return destino;
  const k = maxCelulas / passos;
  return { x: Math.round(origem.x + dx * k), y: Math.round(origem.y + dy * k) };
}

/**
 * Célula alcançável mais próxima do destino pedido, ou `null` se não há nenhuma.
 *
 * Devolve o próprio `destino` quando ele já tem rota. Sem rota, varre ANÉIS
 * crescentes em volta dele e devolve a célula alcançável mais próxima do ponto
 * pedido — que é o "andar o mais perto possível" do cliente oficial: clicar no
 * meio de uma montanha leva o personagem até o pé dela, em vez de não fazer
 * nada (ou de atravessá-la).
 *
 * O CAMINHO volta junto de propósito: quem chama precisa dele logo em seguida
 * para quebrar o pedido em trechos de 16 células, e recalcular custaria um
 * segundo A* em TODO clique — o caso comum, em que o destino já era alcançável.
 *
 * Custo: no caso comum é barato porque o `findPath` recusa em O(1) quando a
 * célula de destino não é andável — a busca cara só acontece para um alvo
 * andável mas cercado, e para esse existem o `maxTentativas` e o `orcamentoMs`.
 */
export function destinoAlcancavel(
  origem: Cell,
  destino: Cell,
  rota: (from: Cell, to: Cell) => Cell[] | null,
  opcoes: { aneis?: number; maxTentativas?: number; orcamentoMs?: number } = {},
): Alcance | null {
  const aneis = opcoes.aneis ?? 10;
  const maxTentativas = opcoes.maxTentativas ?? 200;
  /**
   * Orçamento de tempo, não só de tentativas.
   *
   * O `findPath` recusa em O(1) quando a célula pedida não é andável, então o
   * caso comum (clicar numa montanha) custa quase nada por candidata. O caso
   * caro é o oposto — candidata ANDÁVEL mas inalcançável, em que o A* varre até
   * `MAX_NODES` (20.000) antes de desistir. Isso acontece de verdade quando o
   * próprio jogador está cercado, e aí um teto por CONTAGEM não protege: 200
   * varreduras completas travariam o quadro. Meio quadro a 60 fps é o limite.
   */
  const orcamentoMs = opcoes.orcamentoMs ?? 8;

  if (origem.x === destino.x && origem.y === destino.y) return { destino, caminho: [] };
  const direto = rota(origem, destino);
  if (direto) return { destino, caminho: direto };

  const prazo = performance.now() + orcamentoMs;
  // já gastamos uma chamada com a rota direta; o teto conta TODAS
  let tentativas = 1;
  let melhor: Alcance | null = null;
  let melhorDist = Infinity;

  for (let anel = 1; anel <= aneis; anel++) {
    for (let dy = -anel; dy <= anel; dy++) {
      for (let dx = -anel; dx <= anel; dx++) {
        // só a casca do anel: o interior já foi visto na volta anterior
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== anel) continue;
        // distância ao ponto PEDIDO decide o desempate — o jogador clicou ali
        const d = dx * dx + dy * dy;
        if (d >= melhorDist) continue;
        if (tentativas >= maxTentativas || performance.now() > prazo) return melhor;
        tentativas++;
        const c = { x: destino.x + dx, y: destino.y + dy };
        const caminho = rota(origem, c);
        if (!caminho) continue;
        melhor = { destino: c, caminho };
        melhorDist = d;
      }
    }
    // achou neste anel: nenhum anel mais distante pode ter célula mais perto
    if (melhor) return melhor;
  }
  return melhor;
}
