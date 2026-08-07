/**
 * Janela de Habilidades (Alt+S / botão da barra de menu) — arte de
 * `assets-new/ui_definitiva/skills`, servida de `public/assets/ui/skills/`.
 *
 * Das dez peças do pacote, SETE são byte a byte (md5 conferido) arquivos que o
 * repo já tinha — `ring-level`, `curva`/`reta` das barras, `square-skill`,
 * `tab-off`, o "+" e a seta do paginador. Entram três: o livro aberto e os dois
 * quadros da virada de página.
 *
 * Diferente das outras janelas, aqui o fundo NÃO ocupa a placa inteira: as abas
 * ficam ACIMA do livro e o aro do "x" à direita dele, como na referência. Por
 * isso a placa é maior que a arte, e `SK_BOOK` diz onde o livro é desenhado
 * dentro dela.
 */

import { SK_CLASS_BY_PREFIX, classeDaSkill, SKILL_ELEMENT_LABELS, SKILL_TYPE_LABELS } from "@ragnarok/game-data";
import { CHROME, windowWidth } from "./windowChrome";

export { SK_CLASS_BY_PREFIX, classeDaSkill };
// Chaves alargadas pra `Record<string,string>`: os pontos de uso indexam por
// um `type`/`element` que já chegou como string solta do pacote de rede
// (net/skillCatalog), não pelo literal do enum.
export const SK_ELEMENT_NAMES: Record<string, string> = SKILL_ELEMENT_LABELS;
export const SK_TYPE_NAMES: Record<string, string> = SKILL_TYPE_LABELS;

const BASE = "/assets/ui/skills";

export const SK_ART = {
  /** livro aberto (436×252) — as duas páginas e a lombada */
  book: `${BASE}/skillbook.png`,
  /** quadros da virada de página, na ordem */
  page1: `${BASE}/page-animation-1.png`,
  page2: `${BASE}/page-animation-2.png`,
} as const;

/**
 * Fitas de classe (as "marks"), no lugar das abas.
 *
 * Cada cor vem em DUAS peças: `mark-N` é a ponta — o bico em V, à esquerda — e
 * `mark-N-extend` é o trecho reto que estica até caber o nome. Mesma receita da
 * placa do paginador da barra de habilidades: ponta na medida nativa, corpo
 * esticado.
 *
 * São quatro cores e elas ciclam pela ordem das classes, como as abas ciclavam.
 */
export const SK_MARK_ART = [1, 2, 3, 4].map((n) => ({
  tip: `${BASE}/mark-${n}.png`,
  body: `${BASE}/mark-${n}-extend.png`,
}));

/** tamanho nativo de cada ponta — a largura dela não pode ser esticada */
export const SK_MARK_TIP = [
  { w: 41, h: 36 },
  { w: 38, h: 37 },
  { w: 42, h: 39 },
  { w: 38, h: 40 },
] as const;

/**
 * Quanto o livro cresceu em relação à arte (436×252).
 *
 * É o ÚNICO número a mexer para o livro inteiro mudar de tamanho: as páginas, o
 * conteúdo delas, a folha da virada, o aro do "x" e a própria placa saem daqui.
 * Antes as medidas estavam cravadas em coordenada de placa e crescer o livro
 * exigia recalcular todas à mão.
 */
export const SK_BOOK_K = 1.15;

/** tamanho nativo da arte do livro */
const BOOK_ART = { w: 436, h: 252 } as const;

/**
 * Margem à ESQUERDA do livro, para as fitas de classe.
 *
 * Elas ficam empilhadas nessa lateral com a ponta em V apontando para fora e o
 * corpo entrando por baixo da borda do livro (`referencia-da-mark.png`), então
 * o nome cresce para a ESQUERDA. 130 px de placa cabem "Cavaleiro Rúnico", o
 * rótulo mais longo da tabela de classes; acima disso o texto ganha "…".
 */
export const SK_MARK_MARGIN = 130;

/** onde o livro é desenhado dentro da placa, já crescido */
export const SK_BOOK = {
  x: SK_MARK_MARGIN,
  y: 6,
  w: BOOK_ART.w * SK_BOOK_K,
  h: BOOK_ART.h * SK_BOOK_K,
} as const;

/** px da arte do LIVRO → px da placa */
export function noLivro(v: number): number {
  return v * SK_BOOK_K;
}

/** caixa em coordenada da arte do livro → caixa em coordenada da placa */
export function caixaDoLivro(r: { x: number; y: number; w: number; h: number }) {
  return {
    x: SK_BOOK.x + r.x * SK_BOOK_K,
    y: SK_BOOK.y + r.y * SK_BOOK_K,
    w: r.w * SK_BOOK_K,
    h: r.h * SK_BOOK_K,
  };
}

/**
 * Placa: o livro mais a folga de cima (as fitas) e da direita (o aro do "x").
 *
 * As fitas mordem a borda de cima do livro e o aro encavala o canto
 * superior-direito — os dois precisam de espaço FORA da arte, e é ele que a
 * placa acrescenta.
 */
export const SK_PLATE = {
  w: SK_BOOK.x + SK_BOOK.w + CHROME.closeD / 2 + 12,
  h: SK_BOOK.y + SK_BOOK.h + 6,
} as const;

/**
 * Medidas em px da ARTE DO LIVRO (origem no canto superior-esquerdo dele).
 *
 * As duas páginas, medidas no `skillbook.png` pelo pergaminho claro — o único
 * tom claro da arte: esquerda x 30..205, direita 230..405, as duas de y 3 a
 * 222, lombada em 206..229. Livro simétrico.
 *
 * O conteúdo não usa a página inteira: ela é desenhada em perspectiva e
 * estreita embaixo (em y=210 a esquerda já vai só de 33 a 192, contra 30..204
 * no meio). As caixas respeitam a parte mais estreita, senão texto e ícone
 * encostariam na dobra.
 */
export const SK_PAGE_ART = {
  left: { x: 34, y: 14, w: 158, h: 198 },
  right: { x: 246, y: 14, w: 154, h: 198 },
} as const;

/**
 * Recuo do conteúdo da página ESQUERDA, em px da arte do livro.
 *
 * A pilha de fitas passa por cima da lombada esquerda, e sem esse recuo o nome
 * da habilidade e o ícone começavam colados nela. Um número só desloca o bloco
 * inteiro — título, retrato, descrição e a tabela de fatos — porque todas as
 * caixas da página saem de `ESQ`.
 */
export const SK_PAGE_PAD_L = 16;

/** origem comum das caixas da página esquerda */
const ESQ = { x: 34 + SK_PAGE_PAD_L, w: 158 - SK_PAGE_PAD_L } as const;

export const SK_LAYOUT_ART = {
  // --- página esquerda: a habilidade escolhida ---
  /** "Habilidades de <classe>" */
  header: { x: ESQ.x, y: 14, w: ESQ.w, h: 16 },
  icon: { x: ESQ.x, y: 36, w: 44, h: 44 },
  /**
   * Nome e tipo são UM bloco, não duas caixas fixas.
   *
   * "WATER MAGIC" da referência cabe numa linha, mas "Increase SP Recovery" —
   * nome real do skill_db — não: com uma caixa de altura fixa a segunda linha
   * era cortada no meio da letra e passava por cima do tipo.
   */
  nameBlock: { x: ESQ.x + 50, y: 34, w: ESQ.w - 50, h: 48 },
  desc: { x: ESQ.x, y: 88, w: ESQ.w, h: 46 },
  divider: { x: ESQ.x, y: 138, w: ESQ.w, h: 1 },
  /** bloco Tipo/Elemento/Custo/Alcance/Recarga */
  facts: { x: ESQ.x, y: 148, w: ESQ.w, h: 62 },

  // --- página direita: a grade ---
  /**
   * A grade desce e volta um pouco para a esquerda em relação à referência
   * (x 246 → 236, y 20 → 34): a página direita também estreita embaixo e o
   * primeiro ícone estava alto e colado na margem de fora.
   */
  grid: { x: 236, y: 34, w: 154, h: 108 },
  /** "Pontos: N" */
  points: { x: 246, y: 178, w: 74, h: 18 },
  /** "1 / 2" + setas */
  pager: { x: 324, y: 174, w: 76, h: 26 },
} as const;

/** aro do "x", em coordenada da PLACA (fica fora do livro) */
export const SK_CLOSE = {
  cx: SK_BOOK.x + SK_BOOK.w + 6,
  cy: SK_BOOK.y + 6,
  d: CHROME.closeD,
} as const;

/**
 * Pilha de fitas na lateral esquerda, em px da ARTE DO LIVRO.
 *
 * Medido em `referencia-da-mark.png` (508×252, com o livro em tamanho nativo a
 * partir de x=72): as quatro fitas ocupam y 26..64, 77..116, 128..164 e
 * 178..213 — passo de 51, altura 36..40 (a nativa de cada peça) — e o corpo
 * delas termina em x≈76, ou seja, 4 px POR BAIXO da borda do livro. É esse
 * encaixe que faz a fita parecer presa entre as páginas em vez de colada ao
 * lado.
 */
export const SK_MARKS = {
  /** y da primeira fita */
  top: 26,
  /** onde a pilha pode terminar (o pergaminho acaba em 222) */
  bottom: 214,
  /** altura de uma fita, quando cabem todas com folga */
  h: 38,
  /** vão entre duas, quando cabem todas com folga */
  gap: 12,
  /** vão mínimo antes de começar a encolher a fita */
  gapMin: 4,
  /**
   * Quanto o corpo entra POR BAIXO do livro.
   *
   * A referência mostra 4 px, mas ali a fita e o livro são um desenho só. Aqui
   * são dois elementos e a fita é desenhada POR CIMA, então ela precisa avançar
   * de verdade sobre a madeira para parecer apoiada nela e não encostada ao
   * lado: 22 px enfiam o corte reto do corpo bem para dentro da lombada, o que
   * também é o que abre espaço para o recuo do conteúdo (`SK_PAGE_PAD_L`).
   */
  overlap: 22,
  /** recuo do texto dentro do corpo da fita */
  padX: 10,
} as const;

/**
 * Altura e vão das fitas para uma quantidade de classes.
 *
 * Um personagem de terceira classe chega a seis grupos, e as medidas da
 * referência (quatro fitas) não cabem: em vez de deixar a pilha vazar para fora
 * do livro, o vão encolhe primeiro e só depois a fita.
 */
export function pilhaDeMarcas(n: number): { h: number; gap: number } {
  const vao = SK_MARKS.bottom - SK_MARKS.top;
  if (n <= 1) return { h: SK_MARKS.h, gap: SK_MARKS.gap };
  if (n * SK_MARKS.h + (n - 1) * SK_MARKS.gap <= vao) {
    return { h: SK_MARKS.h, gap: SK_MARKS.gap };
  }
  const gap = SK_MARKS.gapMin;
  return { h: Math.min(SK_MARKS.h, (vao - gap * (n - 1)) / n), gap };
}

/**
 * A virada de página, quadro a quadro.
 *
 * Comportamento tirado de `animacao-da-pagina.png`, que mostra os quatro
 * estágios montados sobre o livro. Duas coisas que eu tinha errado antes:
 *
 * 1. A folha é PRESA NO VINCO, não centrada nele. A borda costurada fica em
 *    x=217,5 (o meio da lombada) e a folha se abre para UM lado — como uma
 *    página real, que gira em torno da costura.
 * 2. São QUATRO quadros, não dois. Os dois desenhos do pacote são as duas
 *    aberturas (larga e estreita) e cada um aparece dos DOIS lados: larga à
 *    direita → estreita à direita → estreita à esquerda → larga à esquerda. É a
 *    folha subindo do lado direito, passando da vertical e caindo no esquerdo.
 *
 * Voltar é a mesma sequência ao contrário, o que sai de graça: cada quadro já
 * sabe o lado, e inverter a lista inverte a animação.
 */
export const SK_FLIP_FRAMES = [
  { arte: 1, lado: 1 },
  { arte: 2, lado: 1 },
  { arte: 2, lado: -1 },
  { arte: 1, lado: -1 },
] as const;

/** proporção nativa de cada desenho (130×274 e 65×274) */
export const SK_PAGE_ANIM = [
  { w: 130, h: 274 },
  { w: 65, h: 274 },
] as const;

/**
 * Onde a folha vive, em px da arte do livro.
 *
 * Ela vai em tamanho NATIVO (130×274 e 65×274) multiplicado por `SK_BOOK_K`, o
 * mesmo fator do livro — não numa altura derivada do pergaminho. Foi esse o
 * erro anterior: eu tinha estimado o enquadramento no olho (uma caixa de 244 px
 * de altura) e a folha saía a 89% do tamanho certo, pequena dentro do livro
 * crescido.
 *
 * Medido nos quatro quadros de `animacao-da-pagina.png`, com o livro deles em
 * tamanho nativo: o topo do pergaminho (arte y=3) cai em y=40/41 do quadro e a
 * ponta da folha em y=0/1 — ou seja, ela começa 36 px ACIMA da arte do livro e
 * a altura nativa de 274 leva a dobra de baixo até y=238, ainda dentro da capa.
 * As larguras batem: a larga vai do vinco (217,5) a 347 e a ponta dela aparece
 * até x=344; a estreita, a 282 contra 281 medidos.
 */
export const SK_FLIP_BOX = {
  /** x da costura: o meio da lombada, entre as páginas 205 e 230 */
  creaseX: 217.5,
  /** topo da folha, acima da borda do livro (a página levantada passa dela) */
  top: -36,
} as const;

/** grade da referência: três colunas por linha, duas linhas por página */
export const SK_GRID = { cols: 3, rows: 2, gap: 16 } as const;

/**
 * Largura das colunas do bloco de fatos.
 *
 * Na referência o rótulo ("Elemento:") e o valor ("Água") são duas colunas
 * alinhadas, não um texto corrido — com a maior palavra ("Elemento:") ocupando
 * pouco mais de um terço da página.
 */
export const SK_FACT_LABEL_W = 0.42;

export const SK_WIDTH = windowWidth(SK_PLATE.w);

/**
 * Duração de CADA quadro da virada.
 *
 * São quatro (`SK_FLIP_FRAMES`), então a folha inteira leva 280 ms — perto do
 * tempo real de virar uma página, e curto o bastante para não parecer que a
 * janela travou entre uma página de habilidades e a outra.
 */
export const SK_FLIP_MS = 70;

/**
 * Cores medidas no `skillbook.png` e na referência.
 *
 * A tinta é MARROM sobre pergaminho, não creme sobre madeira como nas outras
 * janelas: aqui o fundo é claro. Foi por isso que nada de `FL_COLORS`/
 * `BAG_COLORS` serviu.
 */
export const SK_COLORS = {
  /** tinta do texto no pergaminho (medido #4a3a24) */
  ink: "#4a3a24",
  inkDim: "#7d6a4d",
  /** título da habilidade, um tom mais forte */
  inkStrong: "#3a2b16",
  /** filete que separa a descrição do bloco de fatos */
  rule: "rgba(120,96,60,0.45)",
  /** texto sobre a aba (madeira) */
  tabInk: "#f2e8d2",
  shadow: "rgba(20,12,4,0.85)",
  /** contorno do ícone escolhido */
  selected: "#e8bb54",
  /** fundo do balão de nível ("1/10") */
  levelBadge: "rgba(38,26,12,0.88)",
  levelInk: "#f4ead4",
  /** nível no máximo: o balão esmaece, porque não há mais o que gastar ali */
  levelMaxInk: "#bda887",
  closeTint: "#8f2b20",
} as const;
