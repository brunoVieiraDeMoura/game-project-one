/**
 * TAB — vai para o inimigo mais próximo; TAB de novo, para o seguinte.
 *
 * A regra de ORDENAÇÃO mora aqui, pura, e a leitura do mundo fica com quem tem
 * câmera (`play/AlvoPorTab`). Duas razões: é a parte que dá para testar sem DOM
 * nem WebGL, e é a parte que se ajusta no uso — "para onde a câmera aponta pesa
 * mais" é um número, e número que ninguém consegue medir vira chute.
 *
 * ## Por que não reusar a assistência de mira
 *
 * `play/aimAssist` responde a outra pergunta: "em quem o clique cairia se
 * saísse deste pixel". Ela é um FILTRO em volta do ponteiro — tem raio, e
 * descarta tudo fora dele. O Tab não filtra: ele ORDENA o campo inteiro e
 * percorre. Fatores parecidos, perguntas diferentes.
 */

export interface AlvoCandidato {
  gid: number;
  /** distância até o personagem, em células */
  distancia: number;
  /**
   * Quanto o alvo está alinhado com a direção da câmera: 1 = bem à frente,
   * 0 = de lado, −1 = atrás.
   *
   * É o cosseno do ângulo entre "para onde a câmera olha" e "onde o alvo está",
   * os dois no plano do chão — ou seja, um produto escalar de vetores
   * normalizados. Quem calcula é o chamador, que é quem tem a câmera.
   */
  alinhamento: number;
  /** está deste lado da névoa e dentro da tela */
  visivel: boolean;
}

/**
 * Peso do alinhamento, em CÉLULAS.
 *
 * Convertido para a unidade da distância, ele vira uma frase que se lê: "um
 * monstro bem à frente da câmera vale como se estivesse 12 células mais perto
 * que um que está às costas". É o pedido de "a direção da câmera tem mais peso"
 * com um número que dá para justificar — e para mexer.
 *
 * Alto o bastante para mandar entre alvos de distância parecida (o caso comum:
 * três mobs em volta), baixo o bastante para não fazer o Tab escolher um bicho
 * do outro lado do mapa só porque está centralizado.
 */
export const PESO_CAMERA = 12;

/**
 * Custo de um candidato — MENOR é melhor.
 *
 * `alinhamento` vem em −1..1; converte-se para 0..2 ("quanto está fora da
 * frente") antes de multiplicar, senão um alvo perfeitamente à frente ganharia
 * um desconto e um às costas, um acréscimo — o dobro do efeito pretendido.
 */
export function custoDeAlvo(c: AlvoCandidato): number {
  return c.distancia + (1 - c.alinhamento) * PESO_CAMERA;
}

/**
 * A ordem em que o Tab percorre os inimigos.
 *
 * Estável e determinística: o `gid` desempata, senão dois mobs à mesma distância
 * e mesmo ângulo poderiam trocar de lugar entre uma tecla e outra, e o ciclo
 * saltaria de um para o outro para sempre.
 */
export function ordenarAlvos(candidatos: readonly AlvoCandidato[]): AlvoCandidato[] {
  return candidatos
    .filter((c) => c.visivel)
    .slice()
    .sort((a, b) => {
      const d = custoDeAlvo(a) - custoDeAlvo(b);
      return d !== 0 ? d : a.gid - b.gid;
    });
}

/**
 * O próximo alvo do ciclo, dado o que está selecionado agora.
 *
 * - sem alvo (ou com um que saiu de vista): o PRIMEIRO da ordem, que é o mais
 *   próximo pesado pela câmera — é o que o jogador espera do primeiro Tab;
 * - com alvo: o seguinte na ordem, dando a volta no fim.
 *
 * `null` quando não há ninguém — e aí o alvo atual é mantido pelo chamador, não
 * limpo: apertar Tab num campo vazio não é motivo para largar o mob que já
 * estava mirado.
 */
export function proximoAlvo(
  candidatos: readonly AlvoCandidato[],
  atual: number | null,
): number | null {
  const ordem = ordenarAlvos(candidatos);
  if (ordem.length === 0) return null;
  const i = atual === null ? -1 : ordem.findIndex((c) => c.gid === atual);
  return ordem[(i + 1) % ordem.length]!.gid;
}
