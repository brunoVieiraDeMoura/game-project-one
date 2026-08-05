/**
 * Um pedido de caminhada por janela — e o MAIS NOVO vence.
 *
 * ## O bug que isto resolve
 *
 * Spammar clique (principalmente alternando diagonais) fazia o personagem
 * "voltar" para uma célula clicada segundos antes. A causa está no rAthena, e é
 * o cliente que a dispara: `clif_parse_WalkToXY` chama `unit_walktoxy(..., 4)`,
 * e lá (unit.cpp:876) —
 *
 * ```c
 * if (DIFF_TICK(ud->canmove_tick, gettick()) > 0 && DIFF_TICK(...) < 2000) {
 *     add_timer(ud->canmove_tick+1, unit_delay_walktoxy_timer, bl->id, (x<<16)|(y&0xFFFF));
 *     return 1;   // aceita e AGENDA
 * }
 * ```
 *
 * — quando o personagem não pode mover naquele instante, o servidor **agenda**
 * a caminhada num timer que carrega AQUELE destino, e responde como se tivesse
 * aceitado. Cada clique do spam vira um timer próprio; eles disparam depois, em
 * ordem, e o personagem sai andando para um destino velho. Nenhum pacote está
 * errado: o cliente é que mandou mais pedidos do que o protocolo espera.
 *
 * ## A regra
 *
 * O cliente oficial (e o roBrowser, como o comentário do `NetPlayer` já dizia)
 * limita a um pedido a cada ~200 ms. Aqui a janela é a mesma, com uma diferença
 * que importa: quando ela está fechada o pedido **não é descartado**, fica
 * PENDENTE — e um pedido novo substitui o pendente. Assim o alvo que sai quando
 * a janela abre é sempre o ÚLTIMO clique, nunca um do meio do caminho.
 *
 * Descartar seria pior de outro jeito: o último clique do spam — justamente o
 * que o jogador quis — é o que teria mais chance de cair.
 */

export interface FilaDePedidos<T> {
  /** clique/emenda: manda agora se a janela abriu, senão guarda (o novo vence) */
  pedir(alvo: T, agora: number, emitir: (alvo: T) => void): void;
  /** por quadro: solta o pendente assim que a janela abre */
  tick(agora: number, emitir: (alvo: T) => void): void;
  pendente(): T | null;

  /**
   * `imediato` e `reservar` NÃO existem mais.
   *
   * Eram do WASD: "manda agora ou DESCARTA" (guardar mandaria o personagem para
   * uma direção já largada) e "fecha a janela antes de saber o alvo" (a busca do
   * WASD rodava o A* até quatro vezes e podia não emitir nenhuma). O WASD saiu
   * do jogo e os dois ficaram sem um único chamador de produção — código sem
   * chamador é código que ninguém mantém, e que engana quem lê a interface.
   */
}

export function criarFilaDePedidos<T>(intervaloMs: number): FilaDePedidos<T> {
  let ultimo = Number.NEGATIVE_INFINITY;
  let guardado: T | null = null;

  const abriu = (agora: number) => agora - ultimo >= intervaloMs;

  return {
    pedir(alvo, agora, emitir) {
      if (abriu(agora)) {
        ultimo = agora;
        guardado = null;
        emitir(alvo);
        return;
      }
      guardado = alvo;
    },
    tick(agora, emitir) {
      if (guardado === null || !abriu(agora)) return;
      const alvo = guardado;
      guardado = null;
      ultimo = agora;
      emitir(alvo);
    },
    pendente: () => guardado,
  };
}
