/**
 * As duas regras que decidem QUANDO um pedido de caminhada sai — puras, para
 * poderem ser travadas em teste.
 *
 * Elas moravam soltas dentro do `useFrame` do `NetPlayer`, e foi ali que o
 * defeito da caminhada longa nasceu: quando a predição client-side entrou, as
 * duas passaram a se comportar ao contrário do que os comentários diziam, sem
 * nada que denunciasse.
 *
 * O sintoma era "andando longe, o personagem trava, volta algumas células e
 * segue". O laudo está em `next-change-game2.txt`; aqui ficam as duas regras que
 * o originavam.
 */

/**
 * O trecho novo veio do SERVIDOR — e só ele fecha a janela de resposta.
 *
 * O `movedAt` do `SelfMotion` é reescrito por quatro caminhos (ver
 * `worldStore.causa`), e um deles é a nossa própria `preverMovimento`.
 * Comparando só o `movedAt`, a predição disparada dentro do `emitir` zerava a
 * janela no quadro seguinte ao pedido: **o cliente tomava o próprio palpite por
 * resposta**. Duas coisas quebravam juntas:
 *
 *  • o prazo de resposta nunca vencia, então a recusa SILENCIOSA do rAthena
 *    (`unit.cpp:860`, e o teto de 14 do `OFFICIAL_WALKPATH`) deixava de ser
 *    detectada — com o agravante de que o cliente já tinha previsto e saído
 *    andando para um destino que o servidor descartou;
 *  • a guarda "há pedido no ar" da emenda sumia, e a emenda virava um laço na
 *    cadência da fila: A* e `move:to` a cada 200 ms durante as últimas três
 *    células de TODO trecho. Cada um desses enche a fila de previstos do
 *    `worldStore`, e com ela cheia a reconciliação parava de aplicar pacote.
 */
export function respostaDoServidor(movedAt: number, ultimoVisto: number, predito: boolean): boolean {
  return movedAt !== ultimoVisto && !predito;
}

/**
 * Pedir o trecho SEGUINTE de uma caminhada longa.
 *
 * Três condições, e nenhuma é dispensável:
 *
 *  • `quaseLa` — falta pouco para o fim do trecho (ou ele já acabou). É o que
 *    faz a caminhada não ter costura: o pedido novo chega enquanto o personagem
 *    ainda anda. Sozinha ela é verdadeira em TODO quadro dessa janela.
 *  • `semPedidoNoAr` — enquanto o `move:to` anterior não teve resposta, não sai
 *    outro. É a guarda que a predição havia anulado.
 *  • `trechoNovo` — a emenda sai UMA vez por trecho. A guarda de cima protege
 *    contra a repetição enquanto se espera, mas não contra a repetição DEPOIS
 *    de a resposta chegar: o pacote fecha a janela, o quadro seguinte ainda tem
 *    `quaseLa`, e a emenda pede o mesmo destino final de uma origem uma célula
 *    adiante. Cada repetição é um redirecionamento que o servidor tem de
 *    repathear e uma entrada nova na fila de previstos.
 *
 * A chave é o `movedAt` do trecho, não o destino: o destino FINAL é o mesmo
 * durante a caminhada inteira — é justamente por isso que compará-lo não
 * filtraria nada.
 */
export function deveEmendar(p: {
  quaseLa: boolean;
  temPedidoNoAr: boolean;
  movedAt: number;
  emendadoDe: number | null;
}): boolean {
  return p.quaseLa && !p.temPedidoNoAr && p.emendadoDe !== p.movedAt;
}
