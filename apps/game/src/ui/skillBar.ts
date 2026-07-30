import type { NineSliceSpec } from "./nineSlice";

/**
 * Barra de habilidades (baixo-centro) — arte pintada de
 * `assets-new/ui_definitiva/skillbar`, servida de `public/assets/ui/skillbar/`.
 *
 * Como a placa do personagem (ui/charFrame.ts), o fundo é UMA imagem e tudo o
 * mais é posicionado em % dela: `SKILL_BAR_WIDTH` reescala o conjunto inteiro
 * num número só. Nada aqui é pixel-art — a arte é pintada, então interpolar é
 * o certo.
 */

const BASE = "/assets/ui/skillbar";

export const SB_ART = {
  /** painel inteiro, com o medalhão à esquerda e a folhagem à direita */
  plate: `${BASE}/background-skill-bar.png`,
  /** canto SUPERIOR-DIREITO do quadro de um slot (os outros 3 são espelhos) */
  slotCorner: `${BASE}/square-skill.png`,
  /** metade ESQUERDA da placa do paginador; espelhada vira a direita */
  pagerHalf: `${BASE}/button-skill-bar-toogle-123.png`,
  /** trilhos que esticam a placa entre as duas metades */
  pagerRailTop: `${BASE}/button-skill-bar-toogle-123-extend-top-side.png`,
  pagerRailBottom: `${BASE}/button-skill-bar-toogle-123-extend-botton-side.png`,
  /** seta apontando para a ESQUERDA; espelhada vira a da direita */
  arrow: `${BASE}/button-arrow-left.png`,
} as const;

/**
 * Placa do paginador, em px da arte.
 *
 * A metade é um "D" DEITADO: corpo cheio até x≈37 e os dois trilhos seguindo
 * sozinhos até x=53 — o miolo entre eles é transparente. Por isso a placa
 * esticada precisa de três coisas: as duas metades nas pontas, os trilhos
 * esticando entre elas e um preenchimento por baixo, senão o meio fica vazado.
 *
 * As alturas dos trilhos vieram de casar cor com cor no ponto de encontro (x=49
 * da metade): o trilho de cima é a peça a partir da linha 0 da placa (alpha
 * 192/240/254/255/250/226/161/71/17 contra 194/243/255/255/253/227/159/73/16 —
 * a mesma curva), e o de baixo começa na linha 53 (187/239/253/255 batendo
 * exato). Isso MUDOU quando a arte foi corrigida: antes a metade tinha 54×69 e
 * os trilhos caíam em 4 e 57.
 */
export const PAGER_ART = {
  half: { w: 52, h: 62 },
  rail: { w: 16, h: 9 },
  arrow: { w: 22, h: 39 },
  railTopY: 0,
  railBottomY: 53,
} as const;

/**
 * Miolo da placa. Amostrado na BEIRADA INTERNA da metade (x=34), não no centro
 * dela: é ali que o preenchimento encosta no desenho, e o corpo da peça tem um
 * escurecido no meio da altura — pegar a cor do centro (#4b4024) deixava uma
 * emenda clara visível no encontro.
 */
export const PAGER_FILL = "linear-gradient(180deg,#453d27 0%,#342d1e 50%,#403823 100%)";

/** tamanho nativo do fundo — origem de todas as medidas abaixo */
export const SB_PLATE = { w: 996, h: 208 } as const;

/**
 * Moldura de um slot.
 *
 * `square-skill.png` é o mesmo tipo de peça das barras de HP/SP: um canto
 * superior-direito com traço reto saindo dele — daí "4 dessas girando cria um
 * square", como o change.txt diz. Medido na varredura de alpha: o traço tem
 * 8 px e o quadrado do canto começa em x=38 (a arte vai até x=61, e 61−24+1
 * = 38). Antes disso é reto puro, que é de onde o montador tira as bordas.
 */
export const SLOT_FRAME: NineSliceSpec = {
  corner: SB_ART.slotCorner,
  cornerSx: 38,
  slice: 24,
  edgeThickness: 8,
};

/**
 * Medidas em pixel de `background-skill-bar.png`, dentro do campo verde
 * (y 24..196).
 *
 * O que define as bordas úteis são os ADORNOS, não o campo: o medalhão da
 * esquerda vai até x≈71 (medido no pixel claro mais à direita dele, y=70), e a
 * folhagem da direita começa em x≈969 na altura dos slots mas desce para x≈910
 * na altura das barras. Daí o conteúdo abrir em x=80, os slots irem até 836
 * (paginador em 848..966) e as barras pararem em 900 — colado no 36 que eu
 * tinha, a primeira caixa passava por cima do medalhão.
 *
 * O paginador cresceu de 118 para 170 (o "1 / 3" estava espremido) e quem cedeu
 * foi a fileira de slots, de 756 para 704: entre o fim dela e a folhagem só
 * cabem ~133 px, e alargar a barra inteira faria ela encostar no chat e no menu.
 *
 * As proporções vêm da referência (894×203): nove slots com um vão pequeno, o
 * paginador logo à direita deles, e duas barras de XP embaixo.
 */
export const SB_LAYOUT = {
  slots: { x: 80, y: 26, w: 704, h: 80 },
  /** altura = a da arte (62), para os trilhos caírem no pixel medido */
  pager: { x: 796, y: 35, w: 170, h: 62 },
  xpBase: { x: 80, y: 116, w: 820, h: 32 },
  xpJob: { x: 80, y: 152, w: 820, h: 32 },
} as const;

/** vão entre slots, em px da arte */
export const SLOT_GAP = 8;

/**
 * Cores amostradas da arte e da referência: o miolo do slot é o verde escuro do
 * painel, o trilho vazio da XP é a madeira no escuro, e os preenchimentos são
 * os mesmos tons das barras da referência.
 */
export const SB_COLORS = {
  slot: "rgba(24,22,12,0.55)",
  slotHover: "rgba(46,42,22,0.62)",
  trough: "#2f2818",
  label: "#d6c8a3",
  ink: "#f4ecd8",
  shadow: "rgba(20,12,4,0.92)",
} as const;

/** largura de render do painel; toda medida da arte escala a partir daqui */
export const SB_WIDTH = 660;

/**
 * Barra de conjuração (ui-change.txt): fica ENTRE a barra de skills e o
 * personagem, com um terço da largura dela.
 *
 * A moldura é a mesma das barras de HP/SP (`curva-das-bordas-barra-hp-sp` +
 * `reta-barra-hp-sp`, que o change manda usar) — ou seja, o `BAR_FRAME` que
 * `ui/charFrame.ts` já monta. Não há PNG novo aqui.
 *
 * O roxo não existe na arte, então é a MESMA curva de claridade do HP com a
 * matiz girada de ~80° para 280° — assim ele tem o mesmo relevo pintado das
 * outras barras em vez de um degradê inventado.
 */
export const CAST_BAR = { w: Math.round(SB_WIDTH / 3), h: 26 } as const;
export const CAST_FILL = "linear-gradient(180deg,#864da3 0%,#5a2b72 14%,#512567 55%,#431d56 100%)";

/** XP de base (verde) e de classe (azul), medidas na referência */
export const XP_BASE_FILL = "linear-gradient(180deg,#8fb257 0%,#5f8130 16%,#4f6d26 60%,#3d551c 100%)";
export const XP_JOB_FILL = "linear-gradient(180deg,#7fb0cd 0%,#3f7699 16%,#356584 60%,#284f6a 100%)";
