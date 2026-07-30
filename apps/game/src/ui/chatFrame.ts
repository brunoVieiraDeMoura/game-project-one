/**
 * Chat (canto inferior-esquerdo) — arte pintada de
 * `assets-new/ui_definitiva/chat`, servida de `public/assets/ui/chat/`.
 *
 * A moldura NÃO é 9-slice: os quatro cantos são desenhos DIFERENTES e de
 * tamanhos diferentes (171×135, 206×137, 171×123, 206×128), com folhagem que
 * invade o painel. Então ela é montada à mão — quatro cantos ancorados e três
 * trechos retos esticados entre eles.
 *
 * O que ENCOSTA nos cantos foi medido na própria arte (varredura de alpha e de
 * cor na coluna/linha do encontro), e é isso que faz a emenda sumir. Cada peça
 * reta é uma FATIA EXATA do canto vizinho, então basta ancorá-la na mesma borda
 * e desenhá-la na altura/largura nativa:
 *
 *   cima     `mid-bar-extension-top` (19 px) = as 19 primeiras linhas do canto
 *   baixo    `mid-bar-extension-botton` (9 px) = as 9 ÚLTIMAS (conferido cor a
 *            cor: #3f2810/a236, #43382c/a172, #bbb8ad/a75 idênticos nos dois)
 *   esquerda 12 px de traço, começando 1 px da borda
 *   direita  26 px, terminando 1 px antes da borda
 *
 * O da direita é largo porque inclui a faixa escura que serve de calha da barra
 * de rolagem; só uns 6 px dele são o dourado.
 *
 * As bordas ARREDONDADAS de dentro (abas, caixa de texto, campo de digitar) NÃO
 * têm arte própria: `border-curve.png` e `reta-buttons.png` são byte a byte os
 * mesmos arquivos das barras de HP/SP, então quem desenha é o 9-slice que
 * `ui/charFrame.ts` já monta (`barFrameUrl`). Não vale copiar o PNG duas vezes.
 */

const BASE = "/assets/ui/chat";

export const CHAT_ART = {
  cornerTopLeft: `${BASE}/top-left-curve.png`,
  cornerTopRight: `${BASE}/top-right-curve.png`,
  cornerBottomLeft: `${BASE}/left-botton-curve.png`,
  cornerBottomRight: `${BASE}/right-botton-curve.png`,
  edgeTop: `${BASE}/mid-bar-extension-top.png`,
  edgeBottom: `${BASE}/mid-bar-extension-botton.png`,
  edgeLeft: `${BASE}/bar-mid-extension-left.png`,
  edgeRight: `${BASE}/bar-mid-extension-right.png`,
  /** calha da rolagem (repete na vertical) */
  scrollTrack: `${BASE}/background-rolling-bar.png`,
  /** ponta do cursor de rolagem; a de baixo é esta girada 180° */
  scrollCap: `${BASE}/rolling-bar-and-start.png`,
  /** miolo do cursor, esticado */
  scrollMid: `${BASE}/rolling-bar-mid.png`,
  /** seta — o desenho aponta para BAIXO; a de cima vai espelhada */
  scrollArrow: `${BASE}/arrow.png`,
  send: `${BASE}/button-chat.png`,
  addTab: `${BASE}/button-plus-add-tab-chat.png`,
  closeTab: `${BASE}/tab-off.png`,
} as const;

/** tamanho nativo de cada peça (lido do PNG) */
export const CHAT_ART_SIZE = {
  cornerTopLeft: { w: 171, h: 132 },
  cornerTopRight: { w: 206, h: 137 },
  cornerBottomLeft: { w: 171, h: 121 },
  cornerBottomRight: { w: 206, h: 128 },
  edgeTop: { w: 300, h: 19 },
  edgeBottom: { w: 168, h: 9 },
  edgeLeft: { w: 14, h: 85 },
  edgeRight: { w: 29, h: 74 },
  scrollTrack: { w: 11, h: 23 },
  scrollCap: { w: 23, h: 28 },
  scrollMid: { w: 23, h: 31 },
  scrollArrow: { w: 23, h: 22 },
  send: { w: 62, h: 55 },
  addTab: { w: 48, h: 48 },
  closeTab: { w: 22, h: 22 },
} as const;

/**
 * Escala de render da moldura.
 *
 * Medida na referência (821×334, painel de 796×301): o trilho dourado da
 * esquerda ocupa 6 px onde a arte tem 12, e o de baixo 6 onde a arte tem
 * 11–12. Meio, portanto — e é assim que os cantos ficam do tamanho que a
 * referência mostra.
 */
export const FRAME_SCALE = 0.5;

/**
 * Espessura de cada trilho, em px de tela. Em cima e embaixo é a altura NATIVA
 * da peça (ela é a fatia exata do canto), nos lados é o traço medido.
 */
export const RAIL = {
  top: CHAT_ART_SIZE.edgeTop.h * FRAME_SCALE,
  bottom: CHAT_ART_SIZE.edgeBottom.h * FRAME_SCALE,
  left: 12 * FRAME_SCALE,
  right: 26 * FRAME_SCALE,
} as const;

/**
 * A folhagem do canto superior-esquerdo entra ~50 px na arte (a coluna x=39
 * ainda desce até y=58), então a fileira de abas começa depois disso — na
 * referência a primeira aba abre em x≈44 do painel. Nas outras bordas o adorno
 * fica fora do caminho e só os trilhos contam.
 */
export const CONTENT_PAD = {
  top: 10,
  bottom: 9,
  left: 9,
  right: 9,
  /** recuo extra da fileira de abas, para não passar por baixo da folhagem */
  tabsLeft: 24,
} as const;

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

/** Canais do chat. `local` saiu (ui-change.txt: "chat local vai ser o geral"). */
export const CHAT_TABS = ["geral", "global", "party", "guild", "comercio"] as const;
export type ChatTab = (typeof CHAT_TABS)[number];

/**
 * Escopo que o gateway manda → aba onde a linha mora.
 *
 * `self` é a própria fala devolvida pelo map-server e `public` é a fala de
 * quem está por perto: as duas são conversa de mapa, ou seja, GERAL. O resto
 * tem canal próprio (ver `ChatScope` em gateway/src/protocol.ts).
 */
export const SCOPE_TO_TAB: Record<string, ChatTab> = {
  self: "geral",
  public: "geral",
  system: "geral",
  announce: "global",
  global: "global",
  party: "party",
  guild: "guild",
  trade: "comercio",
};

/** aba → escopo que o `chat:send` leva (o Geral vai sem, = fala de mapa) */
export const TAB_SCOPE: Record<ChatTab, string | undefined> = {
  geral: undefined,
  global: "global",
  party: "party",
  guild: "guild",
  comercio: "trade",
};

/** abas que abrem por padrão (as outras entram pelo "+") */
export const DEFAULT_TABS: ChatTab[] = ["geral", "global", "party"];
/** o Geral não fecha: é para onde cai todo o resto */
export const FIXED_TAB: ChatTab = "geral";

export const TAB_LABEL: Record<ChatTab, string> = {
  geral: "Geral",
  global: "Global",
  party: "Party",
  guild: "Guild",
  comercio: "Comércio",
};

/**
 * Prefixo que a linha ganha na aba GERAL (ui-change.txt): "#Guild - Fulano :
 * mensagem", com o canal na cor dele e o resto em branco. Só no Geral — dentro
 * da aba do canal repetir o nome dele em toda linha seria ruído.
 */
export const TAB_PREFIX: Record<ChatTab, string | null> = {
  geral: null,
  global: "#Global",
  party: "#Party",
  guild: "#Guild",
  comercio: "#Comércio",
};

/**
 * Cor de cada canal (ui-change.txt). O fundo da aba é a cor com opacidade — a
 * madeira por baixo tem que continuar aparecendo — e `ink` é a versão clara
 * dela, usada SÓ no prefixo da linha no Geral ("#Guild" em verde). Nome de
 * quem falou e mensagem vão em branco: colorir a linha inteira embaralhava a
 * leitura de quem está com várias abas juntas no Geral.
 */
export const TAB_COLOR: Record<ChatTab, { tab: string; ink: string }> = {
  geral: { tab: "rgba(238,232,216,0.30)", ink: "#f2ead9" },
  global: { tab: "rgba(28,54,104,0.58)", ink: "#8fb4ec" },
  guild: { tab: "rgba(44,96,44,0.55)", ink: "#9ed694" },
  party: { tab: "rgba(72,146,188,0.50)", ink: "#8ad9ea" },
  comercio: { tab: "rgba(176,142,38,0.52)", ink: "#e9cf76" },
};

/** rótulo da aba e corpo da mensagem: branco em cima de qualquer cor de canal */
export const CHAT_INK = "#f8f6f0";

/**
 * Fundos internos, todos translúcidos como o change pede ("background com
 * opacidade"): a arte da moldura tem folhagem e sombra que precisam continuar
 * visíveis por baixo.
 */
export const CHAT_BG = {
  /** dentro da moldura, atrás de tudo */
  panel: "rgba(26,20,10,0.55)",
  /** canvas das mensagens — mais fechado que o painel, para o texto ler */
  canvas: "rgba(14,12,7,0.62)",
  /** campo de digitar — amarronzado, mais claro que o canvas */
  input: "rgba(77,64,45,0.72)",
} as const;
