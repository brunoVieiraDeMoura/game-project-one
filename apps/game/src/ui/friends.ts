/**
 * Lista de Amigos (Alt+Z / botão da barra de menu) — desenhada a partir de
 * `assets-new/ui_definitiva/friend-list/friend-reference.png`.
 *
 * Esta janela é a PRIMEIRA sem PNG de fundo: o pacote não traz um
 * `background.png` como o inventário ou o status, só a referência pintada e as
 * peças soltas. E das onze peças, DEZ são byte a byte (md5 conferido) arquivos
 * que o repo já tem — `curva-das-bordas-barra-hp-sp` e `reta-barra-hp-sp` das
 * barras de HP/SP, `square-skill` dos slots de habilidade, `ring-level` da placa
 * do personagem, `tab-off`, `arrow`, `rolling-bar-*`, `background-rolling-bar` e
 * `button-plus-add-tab-chat` do chat. Só `friends-icon.png` entrou no repo.
 *
 * Sem fundo pintado, a moldura da janela é o 9-slice das barras montado em
 * escala grande (`ui/CurvedBox`) — é exatamente o que a referência mostra: o
 * mesmo canto dourado com a folha, esticado. Mantida a receita das outras
 * janelas: medidas em pixel da referência e `FL_WIDTH` reescalando tudo.
 *
 * Medidas: a referência tem 467×351, mas o painel ocupa (6,5)..(464,246) — o
 * resto é a página de fundo do mockup e o diálogo solto embaixo. Tudo aqui está
 * relativo ao PAINEL, já com essa origem descontada.
 *
 * A ÚNICA medida que NÃO copia a referência é a altura: 258 em vez dos 242 dela.
 * A moldura do mockup é um traço fino, a nossa é o 9-slice das barras com
 * `border` de 10 px de arte — e nos 242 originais o "+ Adicionar Amigo"
 * terminava a 4 px da borda, ou seja, POR BAIXO da madeira. Os 16 px a mais
 * devolvem essa margem e o crescimento da fileira de abas (que passou a usar a
 * altura comum às três janelas) sem espremer as cinco linhas da lista.
 */

import { CHROME, windowWidth } from "./windowChrome";

const BASE = "/assets/ui/friends";

export const FL_ART = {
  /** único arquivo novo do pacote: o ícone de gente, no aro do título */
  icon: `${BASE}/friends-icon.png`,
} as const;

/** tamanho do painel na referência — origem de todas as medidas abaixo */
export const FL_PLATE = { w: 459, h: 258 } as const;

/**
 * Medidas em pixel do painel.
 *
 * Como se chegou nelas (perfil de cor da referência, descontada a origem):
 *
 * - as cinco linhas da lista aparecem como faixas de creme em y 56..83, 88..114,
 *   119..146, 150..178, 182..209 — passo de 31,5 e altura de 28. `row`/`rowGap`
 *   saem daí.
 * - o creme de cada linha vai de x 24 a 417, e a barra de rolagem ocupa
 *   423..439; o campo escuro que contém os dois termina em 446.
 * - a fileira de abas fica em y 31..51, começando em x 44 — não em 20, porque o
 *   aro do ícone avança sobre o canto e a primeira aba tem que passar por fora
 *   dele.
 *
 * Os dois aros são postos SIMÉTRICOS (24 de cada borda). Na referência o da
 * direita está ~6 px mais para fora que o da esquerda, o que é ruído de mockup:
 * copiar a assimetria deixaria a janela torta em qualquer largura diferente.
 */
export const FL_LAYOUT = {
  /** aro com o ícone de gente, encavalando o canto superior-esquerdo */
  icon: { cx: 24, cy: 20, d: CHROME.closeD },
  /** aro com o "x" — o mesmo `ring-level`, espelhado na outra ponta */
  close: { cx: FL_PLATE.w - 24, cy: 20, d: CHROME.closeD },
  /** o título ocupa só o vão ENTRE os aros, senão o texto passa por baixo deles */
  title: { x: 52, y: 5, w: FL_PLATE.w - 104, h: 30 },
  tabs: { x: 44, y: 34, w: FL_PLATE.w - 64, h: CHROME.tabH },
  /** campo escuro que contém as linhas e a barra de rolagem */
  field: { x: 20, y: 62, w: 426, h: 161 },
  /** botão "+ Adicionar Amigo", embaixo à esquerda */
  add: { x: 24, y: 227, w: 112, h: 21 },
} as const;

/** altura de uma linha e o vão entre duas, em px da referência */
export const FL_ROW = { h: 28, gap: 3.5 } as const;

/**
 * Recuo do retrato dentro da linha. Na referência o quadrado do avatar quase
 * encosta nas duas bordas da linha — o que sobra de cada lado é o traço da
 * moldura dele.
 */
export const FL_AVATAR_INSET = 3;

/**
 * Largura da barra de rolagem. Vem de `CHROME`, comum às três janelas: em 16 px
 * de arte ela saía com 24,4 px de tela, mais larga que qualquer outra do HUD.
 */
export const FL_SCROLL_W = CHROME.scrollW;

/**
 * Largura de render.
 *
 * Sai de `WINDOW_SCALE` (ver `ui/windowChrome.ts`), a escala única das janelas
 * com arte própria. Dá 643 px contra os 700 de antes: esta era a janela de
 * escala mais ALTA das três (1,53), e por isso a que desenhava tudo maior — o
 * aro do "x" saa com 67 px contra 43 do status. Na escala comum a linha fica
 * com 39,2 px de altura, e as duas fontes dela (nome 16,8 e legenda 12,6)
 * somam 30,8 — cabem com folga.
 */
export const FL_WIDTH = windowWidth(FL_PLATE.w);

/**
 * As quatro abas da referência.
 *
 * Cada uma tem uma fonte de dados DIFERENTE, e é isso que decide o que a linha
 * mostra:
 *
 * - `amigos`   ZC_FRIENDS_LIST + ZC_FRIENDS_STATE — nome e online, nada mais
 * - `guilda`   ZC_MEMBERMGR_INFO — nome, nível, classe e online
 * - `recentes` NADA no protocolo: é memória do navegador (`net/friendStore`)
 * - `bloqueados` ZC_WHISPER_LIST — só o nome de quem está ignorado
 */
export const FL_TABS = [
  { key: "amigos", label: "Amigos" },
  { key: "guilda", label: "Guilda" },
  { key: "recentes", label: "Recentes" },
  { key: "bloqueados", label: "Bloqueados" },
] as const;
export type FriendTab = (typeof FL_TABS)[number]["key"];

/**
 * Cores amostradas da referência (não escolhidas no olho).
 *
 * O creme da linha tem um degradê de cima para baixo (#dbbf96 no topo, #dec39c
 * no meio, #ddc29a na base) que some se a linha for pintada chapada — é ele que
 * faz o pergaminho parecer papel e não retângulo.
 */
export const FL_COLORS = {
  /** fundo do painel (#3b3020 medido) */
  panel: "rgba(52,42,28,0.94)",
  /** campo escuro atrás das linhas (#1f1e16) */
  field: "rgba(26,23,16,0.72)",
  /** pergaminho da linha */
  row: "linear-gradient(180deg,#dbbf96 0%,#dfc49d 45%,#d8bd93 100%)",
  rowHover: "linear-gradient(180deg,#e8cfa8 0%,#ecd3ac 45%,#e3c9a2 100%)",
  /** texto de dentro da linha: marrom escuro sobre pergaminho */
  rowInk: "#3a2b18",
  rowInkDim: "#6d5a3c",
  /** texto sobre a madeira (título, abas, botão) */
  ink: "#f2e8d2",
  inkDim: "#bdae91",
  shadow: "rgba(20,12,4,0.92)",
  /** aba escolhida: o verde-oliva medido (#525824) */
  tabActive: "rgba(82,88,36,0.92)",
  /** as outras: ardósia (#373637) */
  tabIdle: "rgba(55,54,55,0.78)",
  /** ponto de estado ao lado de "Online"/"Offline" */
  online: "#4d8f2c",
  offline: "#9a917f",
  /** verde do "+ Adicionar Amigo" (#46491e) */
  add: "rgba(70,73,30,0.92)",
  /** miolo do aro do "x" */
  closeTint: "#8f2b20",
} as const;
