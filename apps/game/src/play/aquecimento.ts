/**
 * Quando a cena já pode ser REVELADA, depois de construída.
 *
 * A tela de carregamento tem duas fases, e esta função manda na segunda:
 *
 *  1. **construir** — chunks do mapa, com `scene.visible = false`. Nada é
 *     desenhado, e é por isso que é rápido;
 *  2. **aquecer** — a cena é desenhada de verdade, mas a cortina continua no ar.
 *
 * A fase 2 existe porque a 1 não aquece nada: com a cena invisível o three nem
 * a percorre, então não compila shader nem sobe textura. Revelar direto no fim
 * da construção só mudaria o engasgo de lugar — o primeiro quadro visível
 * pagaria a compilação de TODOS os materiais de uma vez, no instante exato em
 * que o jogador ganha o controle.
 *
 * O sinal é `gl.info.programs.length`: a lista de programas do renderer só
 * cresce quando um material é desenhado pela primeira vez. Parada, não há mais
 * compilação à vista. Contar TRABALHO (shaders) em vez de TEMPO é o que faz isto
 * valer numa máquina lenta, onde um `setTimeout` fixo revelaria a cena no meio
 * da compilação.
 *
 * O teto existe porque a contagem pode nunca estabilizar — um efeito ou uma
 * entidade entrando compila shader novo a cada quadro. Segurar o jogador para
 * sempre é pior que revelar cedo.
 */

/** quadros seguidos sem shader novo que contam como "aquecida" */
export const QUADROS_SEM_SHADER_NOVO = 8;
/** teto de tempo, para a contagem que nunca estabiliza */
export const TETO_AQUECIMENTO_MS = 2500;

export interface EstadoAquecimento {
  /** quantos programas o renderer tinha no quadro anterior (-1 = ainda nenhum) */
  ultimaContagem: number;
  /** quadros seguidos com a contagem parada */
  quadrosParados: number;
}

export const AQUECIMENTO_INICIAL: EstadoAquecimento = { ultimaContagem: -1, quadrosParados: 0 };

export interface PassoAquecimento {
  estado: EstadoAquecimento;
  pronto: boolean;
  /** true quando quem mandou revelar foi o TETO, não a estabilidade */
  porTeto: boolean;
}

/**
 * Um quadro de aquecimento.
 *
 * Puro de propósito: é a única parte disto que tem regra de verdade, e travar a
 * regra num teste vale mais que travar o componente — o pior defeito possível
 * aqui é a tela de carregamento que nunca sai.
 */
export function passoDeAquecimento(
  anterior: EstadoAquecimento,
  programas: number,
  decorridoMs: number,
): PassoAquecimento {
  const parou = programas === anterior.ultimaContagem;
  const estado: EstadoAquecimento = parou
    ? { ultimaContagem: anterior.ultimaContagem, quadrosParados: anterior.quadrosParados + 1 }
    : { ultimaContagem: programas, quadrosParados: 0 };

  const estavel = estado.quadrosParados >= QUADROS_SEM_SHADER_NOVO;
  const porTeto = !estavel && decorridoMs > TETO_AQUECIMENTO_MS;
  return { estado, pronto: estavel || porTeto, porTeto };
}
