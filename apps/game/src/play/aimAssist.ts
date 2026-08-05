/**
 * Smart Target: o clique perto de um alvo vale como clique NELE.
 *
 * A hitbox do monstro já foi engordada, mas ela é uma caixa no espaço 3D — numa
 * câmera afastada, com o bicho atrás de um prop, ou com ele andando entre o
 * apertar e o soltar do botão, o raio passa raspando e o clique vira "andar até
 * ali". Num jogo de clique isso é o pior resultado possível: em vez de bater, o
 * personagem sai correndo.
 *
 * ## Por que a conta é em PIXEL, e não em célula
 *
 * A primeira versão media a distância em unidades de MUNDO, no plano do chão. O
 * jogador não mira no chão — mira na TELA. Com a câmera inclinada, o mesmo pixel
 * vale muito mais célula longe do que perto, então dois monstros igualmente
 * "colados no cursor" tinham distâncias de mundo completamente diferentes, e a
 * assistência escolhia o que não estava debaixo do ponteiro.
 *
 * Aqui tudo é pixel de tela: é a unidade em que o jogador percebe a mira.
 *
 * ## Onde ela NÃO vale
 *
 * Skill de ÁREA. Ali o alvo é a célula, e mexer no ponto escolhido é mudar onde
 * a magia cai — quem mirou o vão entre dois monstros mirou de propósito.
 */

export interface Candidato {
  gid: number;
  /** posição projetada na TELA, em px de CSS */
  px: number;
  py: number;
  /** está dentro do viewport? fora dele não é candidato (ver `pontuar`) */
  naTela: boolean;
  /** está deste lado da névoa? o que não se vê não se clica */
  visivel: boolean;
  /** distância até o personagem, em células — só desempata */
  distanciaDoJogador: number;
  /** está batendo em você agora (ver `net/ameacas`) */
  atacando: boolean;
}

/**
 * Até onde o clique é puxado, em px de CSS.
 *
 * Px de CSS e não de dispositivo: o canvas tem teto de `dpr` 1,5 e as duas
 * medidas divergem numa tela hi-dpi — um raio em px de dispositivo encolheria
 * pela metade justamente na tela grande, onde a assistência mais ajuda.
 *
 * 48 px cobre a folga entre a silhueta do bicho e a caixa de clique sem virar
 * "escolhe por você": é cerca de um terço do lado de um monstro na distância de
 * câmera padrão.
 */
export const RAIO_ASSIST_PX = 48;

/**
 * Os pesos, TODOS em pixel.
 *
 * Convertendo cada fator para a mesma unidade da distância ao cursor, o peso
 * vira uma frase que se lê: "um monstro que está me atacando ganha de um 14 px
 * mais perto do ponteiro". Com pesos adimensionais isso viraria um número que
 * ninguém sabe justificar.
 */
export const PESO_ATACANDO = 14;
/**
 * Crédito por estar perto do jogador, em px por célula — e com teto.
 *
 * Serve SÓ para desempatar dois monstros sobrepostos na tela (o de trás e o da
 * frente ficam a poucos pixels um do outro, e queremos o da frente). Não pode
 * competir com a distância ao cursor: sem o teto, um bicho colado no personagem
 * ganharia de um que está exatamente sob o ponteiro.
 */
export const PESO_PERTO_DO_JOGADOR = 1.5;
export const TETO_PERTO_DO_JOGADOR = 12;

/**
 * Pontuação de um candidato — maior é melhor. `null` = fora do páreo.
 *
 * "Está na tela" e "está visível" entram como PORTA, não como bônus: um alvo
 * fora do viewport ou atrás da névoa não é candidato, e dar pontos a ele o
 * deixaria ganhar de um candidato de verdade num empate ruim.
 */
export function pontuar(
  ponto: { px: number; py: number },
  c: Candidato,
  raio: number,
): number | null {
  if (!c.naTela || !c.visivel) return null;
  const dx = c.px - ponto.px;
  const dy = c.py - ponto.py;
  const dist = Math.hypot(dx, dy);
  if (dist > raio) return null;

  const perto = Math.min(TETO_PERTO_DO_JOGADOR, c.distanciaDoJogador * PESO_PERTO_DO_JOGADOR);
  return -dist - perto + (c.atacando ? PESO_ATACANDO : 0);
}

/**
 * O melhor candidato para este ponto de tela, ou `null`.
 *
 * Empate resolve pelo PRIMEIRO da lista, que é a ordem de `gids` do mundo — só
 * acontece com dois alvos exatamente no mesmo pixel e com os mesmos fatores, e
 * aí qualquer escolha é tão boa quanto a outra.
 */
export function melhorAlvo(
  ponto: { px: number; py: number },
  candidatos: readonly Candidato[],
  raio: number = RAIO_ASSIST_PX,
): Candidato | null {
  let melhor: Candidato | null = null;
  let melhorScore = -Infinity;
  for (const c of candidatos) {
    const s = pontuar(ponto, c, raio);
    if (s === null || s <= melhorScore) continue;
    melhorScore = s;
    melhor = c;
  }
  return melhor;
}

/**
 * O que este clique deve fazer.
 *
 * A ordem é a que o jogador espera de um jogo de clique, e foi pedida assim:
 * bater no que está perto; **não havendo em quem bater**, pegar o que está no
 * chão; não havendo nada, andar.
 *
 * Pura para poder ser testada — quem faz cada coisa é o chamador.
 */
export type DecisaoDeClique =
  | { tipo: "atacar"; gid: number }
  | { tipo: "pegar"; gid: number }
  | { tipo: "andar" };

export function decidirClique(
  ponto: { px: number; py: number },
  mobs: readonly Candidato[],
  itens: readonly Candidato[],
  raio: number = RAIO_ASSIST_PX,
): DecisaoDeClique {
  const mob = melhorAlvo(ponto, mobs, raio);
  if (mob) return { tipo: "atacar", gid: mob.gid };
  const item = melhorAlvo(ponto, itens, raio);
  if (item) return { tipo: "pegar", gid: item.gid };
  return { tipo: "andar" };
}
