/**
 * Medição de custo NORMALIZADA — a base dos testes de orçamento.
 *
 * O problema de medir desempenho em teste é que milissegundo é propriedade da
 * MÁQUINA, não do código: o mesmo limite que passa no PC de desenvolvimento
 * falha num notebook de bateria fraca, e um teste que falha sem motivo é um
 * teste que alguém apaga. Aqui todo custo é dividido pela CALIBRAÇÃO — um
 * trabalho fixo, medido na mesma rodada, na mesma máquina, no mesmo estado
 * térmico. O limite vira uma RAZÃO, e razão viaja.
 *
 * Fora do teste isto não é usado: quem mede o jogo rodando é o
 * `scene/perfProbe` (F9 no /play).
 */

/** o que a rodada mediu, impresso no fim para quem estiver olhando */
export const relatorio: { nome: string; valor: number; limite: number | string }[] = [];

/**
 * Trabalho de referência: aritmética pura, sem alocar nada.
 *
 * Sem alocação de propósito — se a referência mexesse no heap, o coletor de
 * lixo entraria na conta e a "velocidade da máquina" passaria a depender de
 * quanto lixo o teste anterior deixou.
 */
/** uma amostra do trabalho de referência */
function amostraDeCalibracao(): number {
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 2_000_000; i++) acc += (i % 977) * 0.5;
  const ms = performance.now() - t0;
  // devolve `acc` junto para o motor não descartar o laço como código morto
  return acc > -1 ? ms : ms;
}

export function calibrar(): number {
  amostraDeCalibracao(); // aquece o JIT: a primeira passada mede o compilador
  const amostras = [amostraDeCalibracao(), amostraDeCalibracao(), amostraDeCalibracao()].sort((a, b) => a - b);
  return amostras[1]!;
}

/**
 * Custo de uma operação em UNIDADES DE CALIBRAÇÃO (1 = tão caro quanto o
 * trabalho de referência).
 *
 * Usa a MEDIANA de várias repetições, não a média: uma pausa do coletor de lixo
 * no meio da série arrasta a média e não move a mediana. Descarta a primeira
 * repetição pelo mesmo motivo do aquecimento acima.
 *
 * ## Por que a calibração é REMEDIDA aqui dentro
 *
 * Medi-la uma vez, no começo do `describe`, supõe que a máquina continua igual
 * até o fim — e o vitest roda os arquivos em PARALELO. Rodando este teste
 * sozinho o A* dava 0,11; na suíte inteira, com os outros workers disputando
 * CPU, o mesmo A* dava 0,63 e reprovava contra um teto de 0,6. Não era o código
 * que tinha piorado: era a referência que estava velha.
 *
 * A referência é remedida LOGO DEPOIS das amostras da operação, no mesmo estado
 * de carga — mas cada lado continua tirando a MEDIANA da própria série. Casar
 * amostra a amostra (a primeira tentativa) foi pior: a operação aloca e a
 * referência não, então uma pausa do coletor cai só de um lado e envenena aquela
 * razão inteira.
 */
export function custoRelativo(nome: string, _calibracao: number, repeticoes: number, fn: () => void): number {
  fn(); // aquecimento

  // a referência ANTES e DEPOIS, enquadrando a janela em que a operação foi
  // medida (ver abaixo por que as duas)
  const antes = medianaDeCalibracao();
  const amostras: number[] = [];
  for (let i = 0; i < repeticoes; i++) {
    const t0 = performance.now();
    fn();
    amostras.push(performance.now() - t0);
  }
  amostras.sort((a, b) => a - b);
  const mediana = amostras[Math.floor(amostras.length / 2)]!;
  const depois = medianaDeCalibracao();

  /**
   * Vale a referência MAIS LENTA das duas.
   *
   * Medindo a referência só depois, um pico de carga que aconteceu DURANTE as
   * amostras não aparecia nela: a operação saía cara, a referência barata, e a
   * razão explodia — o A* dava 0,11 rodando sozinho e 0,77 na suíte inteira,
   * reprovando contra um teto de 0,6 sem nada ter piorado no código.
   *
   * Enquadrando a janela e ficando com a mais pessimista sobre a velocidade da
   * máquina, um pico dentro dela quase sempre encosta em pelo menos uma das
   * pontas. O viés é para o lado seguro: na dúvida, o teste PASSA — teste de
   * desempenho existe para pegar piora grande, e um que reprova sozinho é um
   * teste que alguém desliga.
   */
  const referencia = Math.max(antes, depois);
  const razao = referencia > 0 ? mediana / referencia : 0;
  relatorio.push({ nome, valor: Math.round(razao * 1000) / 1000, limite: "ver teste" });
  return razao;
}

/** mediana de três amostras da referência — uma pausa do coletor não a move */
function medianaDeCalibracao(): number {
  return [amostraDeCalibracao(), amostraDeCalibracao(), amostraDeCalibracao()].sort((a, b) => a - b)[1]!;
}

/** imprime o que foi medido — é o número que se usa para decidir o limite novo */
export function imprimirRelatorio(): void {
  if (relatorio.length === 0) return;
  const linhas = relatorio.map((r) => `  ${r.nome.padEnd(34)} ${String(r.valor).padStart(8)}`);
  // eslint-disable-next-line no-console
  console.log(`\n[orçamento de desempenho] custo relativo à calibração\n${linhas.join("\n")}\n`);
}
