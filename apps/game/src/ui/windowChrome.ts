/**
 * Medidas COMUNS às janelas com arte própria (inventário, status, amigos).
 *
 * O problema que isto resolve: cada janela tem a própria arte, e cada uma vinha
 * com a própria escala (largura de render ÷ largura da arte) — 1,43 no
 * inventário, 1,26 no status, 1,53 nos amigos. Como TODA medida de dentro passa
 * por essa escala, o mesmo número de arte virava três tamanhos diferentes na
 * tela. Medido antes desta unificação:
 *
 *   aro do "x"     status 43,0 px · inventário 48,6 px · amigos 67,1 px
 *   altura da aba  amigos 30,5 px · inventário 40,0 px
 *   fonte do aba   inventário 12,9 px · amigos 15,3 px
 *   fonte do título status 21,5 px · inventário 27,1 px · amigos 29,0 px
 *   rolagem        amigos 24,4 px · chat 11,5 px
 *
 * Ou seja: o "x" dos amigos era 56% maior que o do status, e as três janelas
 * escreviam o título em três corpos diferentes.
 *
 * A correção NÃO é uma tabela de tamanhos em px de tela. É mais simples e mais
 * robusta: **uma escala só para a família**. Com `WINDOW_SCALE` valendo para as
 * três, um número de arte passa a valer o MESMO px de tela em qualquer uma
 * delas, e a correlação deixa de precisar de manutenção — não há como uma
 * janela sair do padrão sem alguém mudar a escala de propósito.
 *
 * Por isso `CHROME` e `TYPE` abaixo estão em px de ARTE, não de tela: cada
 * janela já multiplica por `escala`, e a escala agora é a mesma.
 *
 * 1,40 foi escolhido porque deixa o INVENTÁRIO praticamente onde estava (420 →
 * 412 px): ele é a janela mais densa — 5×4 slots — e é ela quem define o piso
 * de tamanho legível. O status cresce 11% (760 → 841) e os amigos encolhem 8%
 * (700 → 643), os dois para dentro do padrão.
 */

/** escala única da família de janelas: px de tela por px de arte */
export const WINDOW_SCALE = 1.4;

/** largura de render de uma janela a partir da largura da arte dela */
export function windowWidth(plateW: number): number {
  return plateW * WINDOW_SCALE;
}

/**
 * Peças de moldura comuns, em px de ARTE.
 *
 * Os valores são a média do que as três janelas já praticavam na tela, de volta
 * para arte — assim nada dá um salto visual; o que muda é quem estava fora da
 * curva (o "x" e a rolagem dos amigos).
 */
export const CHROME = {
  /** diâmetro do aro do "x" → 46,2 px de tela (era 43,0 / 48,6 / 67,1) */
  closeD: 33,
  /** altura da fileira de abas → 35,0 px (era 40,0 e 30,5) */
  tabH: 25,
  /** `border` do `CurvedBox` de uma aba → 9,8 px */
  tabBorder: 7,
  /** `border` do `CurvedBox` de uma caixa interna (contador, balão) → 11,2 px */
  boxBorder: 8,
  /** largura da barra de rolagem desenhada → 18,2 px (era 24,4) */
  scrollW: 13,
  /** altura de um ícone dentro de contador/botão → 19,6 px (era 21,4 e 16,8) */
  iconH: 14,
} as const;

/**
 * Escada tipográfica, em px de ARTE.
 *
 * Seis degraus e nada fora deles. Antes cada janela escolhia o corpo no lugar
 * de uso (17, 15, 14, 13, 11, 10.5, 10, 9 só no status), o que fazia rótulos de
 * mesmo papel saírem diferentes de uma tela para a outra.
 */
export const TYPE = {
  /** título da janela → 25,2 px de tela */
  title: 18,
  /** cabeçalho de seção ("Status", "Atributos") → 18,2 px */
  section: 13,
  /** nome próprio numa linha de lista → 16,8 px */
  name: 12,
  /** rótulo e valor corrente → 14,0 px */
  label: 10,
  /** legenda, segunda linha, dica → 12,6 px */
  small: 9,
  /** texto de aba → 13,3 px */
  tab: 9.5,
} as const;
