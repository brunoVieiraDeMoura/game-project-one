/**
 * Tradução do relógio do SERVIDOR para o relógio local.
 *
 * Todo pacote de movimento do rAthena carrega `moveStartTime`: o `gettick()` do
 * map-server no instante em que aquele trecho COMEÇOU. É o dado que faltava — e
 * ele já vinha no fio, sendo descartado.
 *
 * ## Por que ele importa
 *
 * Sem ele, o cliente ancora o trecho na hora de CHEGADA do pacote (`movedAt =
 * performance.now()`). Com 100 ms de rede, o mob recomeça o caminho 100 ms
 * atrasado — e como o rAthena manda um pacote por trecho, o atraso não se
 * dissolve: ele se soma, trecho após trecho. Com o tick, o cliente sabe que
 * aquele trecho já está a 100 ms do começo e desenha o bicho no ponto certo.
 *
 * ## Por que MEDIANA e não média
 *
 * `gettick()` conta ms desde o boot do map-server, não epoch — o desvio para o
 * `performance.now()` do navegador é um número arbitrário que só dá para
 * ESTIMAR: `desvio = chegada − tick`. Cada amostra carrega junto a latência
 * daquele pacote, então a estimativa é sempre um pouco alta.
 *
 * A mediana resolve os dois problemas: um pacote que demorou 300 ms envenena a
 * média e não move a mediana, e como a latência mínima é o que mais se repete,
 * a mediana converge para perto dela. É a mesma regra que `perf/orcamento.ts`
 * usa para medir custo, e pelo mesmo motivo.
 *
 * ## O que este módulo NÃO faz
 *
 * Não corrige deriva de relógio (drift de cristal) nem trata o `gettick()`
 * dando a volta em 2³² ms (~49 dias de uptime do map-server). Os dois são reais
 * e nenhum dos dois importa aqui: a janela de amostras é curta e se re-estima
 * sozinha, e uma volta de contador aparece como um desvio absurdo que o
 * `PLAUSIVEL_MS` descarta.
 */

/** quantas amostras entram na mediana */
const AMOSTRAS = 32;

/**
 * Desvio absurdo = amostra descartada.
 *
 * Protege contra o pacote sem `startTime` (0), contra a volta do contador de
 * `gettick()` e contra um relógio que deu salto. Meio minuto é folgado o
 * bastante para qualquer latência real e apertado o bastante para pegar lixo.
 */
const PLAUSIVEL_MS = 30_000;

const amostras: number[] = [];
/** desvio em vigor; `null` = ainda não há amostra confiável */
let desvio: number | null = null;

/**
 * Registra uma amostra: um tick do servidor e a hora local em que ele chegou.
 *
 * Devolve o desvio em vigor depois de considerar esta amostra.
 */
export function amostrarRelogio(tickServidor: number, chegadaLocal: number): number | null {
  if (!Number.isFinite(tickServidor) || tickServidor <= 0) return desvio;
  const bruto = chegadaLocal - tickServidor;
  if (!Number.isFinite(bruto) || Math.abs(bruto) > Number.MAX_SAFE_INTEGER) return desvio;

  // primeira amostra define a vizinhança; as seguintes têm de ficar perto dela,
  // senão são de outro servidor (reconexão) e a janela recomeça
  if (desvio !== null && Math.abs(bruto - desvio) > PLAUSIVEL_MS) {
    amostras.length = 0;
    desvio = null;
  }

  amostras.push(bruto);
  if (amostras.length > AMOSTRAS) amostras.shift();

  const ordenadas = [...amostras].sort((a, b) => a - b);
  desvio = ordenadas[Math.floor(ordenadas.length / 2)]!;
  return desvio;
}

/**
 * Converte um tick do servidor para o relógio local.
 *
 * Sem desvio estimado (primeiro pacote da sessão, ou `startTime` ausente),
 * devolve `chegadaLocal` — que é exatamente o comportamento de antes deste
 * módulo existir. Degradar para o que já funcionava é melhor que degradar para
 * um palpite.
 */
export function paraRelogioLocal(tickServidor: number, chegadaLocal: number): number {
  if (desvio === null || !Number.isFinite(tickServidor) || tickServidor <= 0) return chegadaLocal;
  const local = tickServidor + desvio;
  /**
   * Nunca devolver um instante FUTURO.
   *
   * Um trecho que ainda não começou faria `interpolatedCell` calcular
   * `decorrido < 0` e desenhar a entidade ANTES da origem do movimento — para
   * trás. Se a estimativa está adiantada, o certo é tratar o trecho como
   * começando agora, não como começando no futuro.
   */
  return Math.min(local, chegadaLocal);
}

/** o desvio em vigor, para depuração (`__mov()`) */
export function desvioDoRelogio(): number | null {
  return desvio;
}

export function zerarRelogioDoServidor(): void {
  amostras.length = 0;
  desvio = null;
}
