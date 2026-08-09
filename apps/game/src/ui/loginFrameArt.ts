import type { NineSliceSpec } from "./nineSlice";

/**
 * A ARTE NOVA de `/login` (`ui_definitiva/login-new`, leia1.txt): o quadro que
 * envolve a tela inteira ("canva principal"), os cartões pequenos (regiões,
 * classificação, rodapé, botões) e as duas fitas de banner.
 *
 * Continua em `public/assets/ui/login/`, o MESMO diretório de sempre
 * (`background.jpg`, `button-arrow-left.png`) — o `login2/` da sessão anterior
 * era o desvio; aqui os nomes vêm crus do pacote fonte, igual `chat/`.
 *
 * As MEDIDAS abaixo (retângulo de cada trilho, banda de cada fita) foram
 * tiradas do alpha de verdade (`sharp`, varredura linha a linha da coluna/
 * linha de fora de cada PNG), não chutadas — é o mesmo método que já valia
 * para `chatFrame.ts`/`RAIL`. Reconferir: script em `node -e` lendo
 * `img.raw().ensureAlpha()` e procurando onde `alpha > 10` começa/termina em
 * cada coluna/linha extrema.
 */

const BASE = "/assets/ui/login";

export const LOGIN_FRAME_ART = {
  // canva principal — o quadro externo, em volta da tela inteira
  canvaTop: `${BASE}/borda-top-principal.png`,
  canvaBottom: `${BASE}/borda-bot-principal.png`,
  canvaEdgeTop: `${BASE}/extensor-cima-barra-principal.png`,
  canvaEdgeSide: `${BASE}/extensor-lateral-barra-principal.png`,
  canvaEdgeBottom: `${BASE}/extensor-barra-bot-principal.png`,

  // cartão pequeno — regiões, classificação, rodapé, botões
  cardCorner: `${BASE}/bordas-botoes-cards.png`,
  cardEdgeH: `${BASE}/extensor-bordas-botoes-cards-top.png`,
  cardEdgeV: `${BASE}/extensor-bordas-botoes-cards.png`,

  // fita "A ERA DE ASTERION"
  eraCap: `${BASE}/lado-a-era-de-asterion.png`,
  eraExt: `${BASE}/extensor-a-era-de-asterion.png`,
  ramo: `${BASE}/ramo-atras-do-logo.png`,

  // fita "Entre em sua jornada"
  headerCap: `${BASE}/papel-login-centro-topo-entre-em-sua-jornada.png`,
  headerExt: `${BASE}/extensor-papel-login-centro-topo-entre-em-sua-jornada.png`,

  // epígrafe — imagem CHAPADA, sem extensor (não é 9-slice)
  epigrafe: `${BASE}/papel-baixo-direita.png`,
} as const;

/** tamanho nativo (px) de cada peça — canvas inteiro, já = bounding box do alpha
 * pras retas; os cantos/fitas têm folga transparente, daí `LOGIN_FRAME_BAND` */
export const LOGIN_FRAME_SIZE = {
  // remedido 2026-08-09: os 3 arquivos abaixo foram reenviados de novo (2ª
  // vez) e as medidas antigas (158×157 etc) ficaram do envio ANTERIOR —
  // ninguém tinha remedido depois do refresh. Era essa divergência que fazia
  // o canto (esticado num box do tamanho errado) não bater com a grossura da
  // barra extensora encostada nele.
  canvaTop: { w: 284, h: 236 },
  canvaBottom: { w: 335, h: 128 },
  canvaEdgeTop: { w: 165, h: 13 },
  canvaEdgeSide: { w: 16, h: 156 },
  canvaEdgeBottom: { w: 69, h: 128 },
  cardCorner: { w: 32, h: 29 },
  cardEdgeH: { w: 20, h: 8 },
  cardEdgeV: { w: 7, h: 25 },
  eraCap: { w: 147, h: 52 },
  eraExt: { w: 47, h: 45 },
  ramo: { w: 96, h: 139 },
  headerCap: { w: 152, h: 68 },
  headerExt: { w: 56, h: 51 },
  epigrafe: { w: 318, h: 137 },
} as const;

/**
 * Trilho do canva principal, em px NATIVOS da arte (remedido 2026-08-09 na
 * `borda-top-principal.png` atual: coluna direita opaca y0..13 → topo 14;
 * linha de baixo opaca x0..16 → lateral 17 — é a mesma peça de sempre, a
 * grossura do próprio desenho não mudou nos refreshes). A base é a exceção:
 * ali quem decide a espessura é a própria `borda-bot-principal` (128 — ver
 * `CANVA_BOTTOM_LEAD_IN`), não um trilho fino escondido atrás do conteúdo.
 */
export const CANVA_RAIL = { top: 14, side: 17, bottom: 128 } as const;

/**
 * A peça `borda-bot-principal.png` reenviada (2026-08-07) é OPACA desde
 * y=0 nas duas colunas de fora (conferido de novo por alpha, `sharp`) — a
 * versão anterior tinha 11 linhas vazadas no topo, esta não tem mais.
 */
export const CANVA_BOTTOM_LEAD_IN = 0;

/**
 * A banda ÚTIL de cada peça de fita — medida na coluna x=0 de cada PNG, que é
 * onde a arte não afina para a ponta (a ponta em V só existe do lado do
 * `cap`). Ponta e extensor têm alturas de banda quase iguais (42 / 42 na era,
 * 51 / 50 no cabeçalho), mas em OFFSETS diferentes dentro do canvas — alinhar
 * pelo topo do canvas em vez da banda deixaria um degrau na emenda.
 */
export const RIBBON_BAND = {
  era: { cap: { top: 9, h: 42 }, ext: { top: 2, h: 42 } },
  header: { cap: { top: 12, h: 51 }, ext: { top: 1, h: 50 } },
} as const;

/**
 * `bordas-botoes-cards.png` é um canto SUPERIOR-ESQUERDO (linha 0 opaca só a
 * partir de x=11, coluna 0 opaca só a partir de y=9 — o chanfro corre do
 * canto inferior-esquerdo pro meio da borda de cima). `nineSlice.ts` por
 * padrão espera o canto SUPERIOR-DIREITO (é o que toda a arte do projeto até
 * aqui trazia) — daí o `cornerAnchor: "top-left"`.
 */
export const CARD_FRAME: NineSliceSpec = {
  corner: LOGIN_FRAME_ART.cardCorner,
  cornerAnchor: "top-left",
  cornerSx: 0,
  slice: 29,
  edge: LOGIN_FRAME_ART.cardEdgeH,
  edgeThickness: 8,
};

/** o traço ocupa 8 dos 29 px do canto — é daqui que sai o recuo do véu/conteúdo */
export const CARD_STROKE_RATIO = 8 / 29;
