import { quadro, registrarEvento } from "./flightRecorder";

/**
 * Cronômetro pontual para trabalho SÍNCRONO e caro — o que sobra do quadro.
 *
 * Ele nasceu de um buraco: quatro `frameLongo` de 561 a 633 ms
 * (`voo-1785946990938.json`), todos no portal, com `contextoMs`, `descarteMs`,
 * `modeloMs` e `renderMs` **zerados** e `sceneFilhos: 0`. Ou seja: nenhuma das
 * medidas existentes toca o custo, porque ele não é desenho nem GPU — é o
 * commit que desmonta a cena velha e monta a nova, e nele cabem o zod de
 * 160.000 células, a colisão dos props, a query de terreno e o bitmap do
 * minimapa.
 *
 * Adivinhar qual dos quatro seria fácil e provavelmente errado — foi assim que
 * a hipótese do contexto WebGL (que custa 8 ms) sobreviveu duas rodadas. Este
 * módulo existe para NOMEAR, com um dump.
 *
 * ## Duas regras
 *
 * Só o que passa de `LIMIAR_MS` vira evento: envolver uma chamada barata num
 * laço quente encheria o anel de 512 e expulsaria o que interessa. E o
 * acumulador `trocaMs` é POR QUADRO, como os outros três, para a subtração
 * contra o `quadroMs` continuar fechando.
 */

/** abaixo disto não vira evento: é ruído para uma investigação de meio segundo */
export const LIMIAR_MS = 15;

let trocaMsAcumulado = 0;

/**
 * Roda `fn`, cronometra e devolve o que ela devolveu.
 *
 * Transparente de propósito — dá para embrulhar uma chamada existente sem mexer
 * em mais nada, que é o que permite instrumentar cinco suspeitos num commit e
 * tirar quatro depois que o culpado aparecer.
 */
export function medir<T>(rotulo: string, fn: () => T): T {
  if (!import.meta.env.DEV) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - t0;
    trocaMsAcumulado += ms;
    if (ms >= LIMIAR_MS) registrarEvento("cena", "custo", { rotulo, ms: Math.round(ms) });
  }
}

/**
 * A versão de ESPERA, para trabalho que devolve promessa.
 *
 * `medir` cronometra só a parte síncrona, e num `r.json()` isso é quase zero —
 * o `JSON.parse` de 1,73 MB acontece depois, quando a promessa resolve.
 * Embrulhar com o `medir` normal daria "0 ms" e faria descartar o suspeito por
 * uma medição errada, que é o pior resultado possível numa investigação.
 *
 * O número aqui é tempo de PAREDE, não de CPU: ele inclui a espera. Para o
 * `r.json()` os dois quase coincidem (o corpo já chegou), mas quem ler tem de
 * saber a diferença — e por isso o rótulo do evento é outro.
 */
export async function medirEspera<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  if (!import.meta.env.DEV) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - t0;
    if (ms >= LIMIAR_MS) registrarEvento("cena", "custo-espera", { rotulo, ms: Math.round(ms) });
  }
}

/** escreve e zera o acumulado do quadro — chamada pelo `cenaProbe` */
export function escreverColunaDeTroca(): void {
  quadro().trocaMs = trocaMsAcumulado;
  trocaMsAcumulado = 0;
}

/** só para o teste */
export function zerarMedidas(): void {
  trocaMsAcumulado = 0;
}
