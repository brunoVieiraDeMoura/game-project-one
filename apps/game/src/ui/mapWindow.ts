/**
 * Janela de Mapa (Alt+M) — arte de `assets-new/ui_definitiva/mapa`.
 *
 * Das dez peças do pacote, OITO são byte a byte (md5 conferido) arquivos que o
 * repo já tem: os quatro cantos com folhagem e os dois trechos retos laterais
 * são os do CHAT (`public/assets/ui/chat/`), `ring-level` é o aro da placa do
 * personagem e `tab-off` é o "x". Entram DOIS arquivos:
 *
 *   `name-plate.png`  a placa de madeira do título (363×41)
 *   `world-map.jpg`   o mapa-múndi pintado (era `mapa.png`, 1536×1024)
 *
 * Como a Lista de Amigos, esta janela não tem PNG de fundo: a moldura é a do
 * chat (`hud/ChatFrame`, que já aceita `escala`), e é justamente a moldura que o
 * pacote traz. Nada de `ChatFrame` foi copiado — o componente serve a terceira
 * tela agora (chat, login e mapa).
 *
 * **O mapa-múndi virou JPEG.** Ele é pintura de tela cheia e não tem alpha
 * (`sharp().stats().isOpaque` = true), o mesmo caso do fundo do login — a única
 * outra imagem não-PNG do projeto. Em PNG o arquivo tem 3,7 MB, 8× o maior
 * asset de UI do repo; reamostrado para 1200×800 e em JPEG q84 fica em 321 KB,
 * na faixa do fundo do status (276 KB) e do quest (416 KB). 1200 px é 1,4× a
 * largura de render do campo (834 px), o que deixa folga para tela hi-dpi sem
 * pagar por 1536.
 */

import { CHROME, windowWidth } from "./windowChrome";

const BASE = "/assets/ui/map";

export const MAP_ART = {
  /** placa de madeira com folhagem nas duas pontas — título da janela */
  namePlate: `${BASE}/name-plate.png`,
  /** mapa-múndi pintado, 1200×800 */
  world: `${BASE}/world-map.jpg`,
} as const;

/** tamanho nativo do mapa-múndi, em px — origem do enquadramento da aba "Mundo" */
export const WORLD_SIZE = { w: 1200, h: 800 } as const;

/**
 * A placa de madeira do título é esticada em 3 FATIAS, não inteira.
 *
 * Medido no PNG (363×41): o corpo opaco da barra vai de x≈20 a x≈344 e as duas
 * pontas são a vinha saindo dela (só as linhas y 2..8 sobrevivem ali). A
 * folhagem que encavala a barra ocupa os ~70 px de cada extremo; o miolo é
 * madeira lisa de veio horizontal (medido em x=150..170: perfil idêntico), que
 * é o que se pode esticar sem deformar desenho nenhum.
 *
 * Vai por `border-image` com `fill` (as duas pontas em tamanho fixo, o miolo
 * esticado no vão), a mesma técnica do 9-slice das barras — só que num eixo.
 */
export const NAME_PLATE = { w: 363, h: 41, cap: 72 } as const;

/** tamanho da placa desta janela, em px de ARTE (ver `ui/windowChrome`) */
export const MAP_PLATE = { w: 640, h: 496 } as const;

/**
 * Medidas em px de ARTE, como nas outras janelas da família.
 *
 * O campo tem proporção 1,59 — perto do 1,5 do mapa-múndi, que assim quase o
 * preenche, e larga o bastante para um mapa QUADRADO do rAthena (400×400) caber
 * inteiro com as duas colunas de sobra que a legenda e o zoom ocupam. O
 * enquadramento é `contain` nos dois casos (ver `enquadrar`), então nenhuma
 * proporção é imposta ao conteúdo.
 */
export const MAP_LAYOUT = {
  /** placa do título, centrada e encavalando o trilho de cima da moldura */
  title: { x: (MAP_PLATE.w - 320) / 2, y: 2, w: 320, h: (320 * NAME_PLATE.h) / NAME_PLATE.w },
  /** aro do "x", na ponta direita — o mesmo `ring-level` das outras janelas */
  close: { cx: MAP_PLATE.w - 30, cy: 24, d: CHROME.closeD },
  /** fileira de abas, embaixo da placa e à esquerda */
  tabs: { x: 28, y: 48, w: 260, h: CHROME.tabH },
  /** leitura de coordenada, na mesma linha das abas e ancorada à direita */
  coords: { x: MAP_PLATE.w - 28 - 250, y: 48, w: 250, h: CHROME.tabH },
  /** campo onde o mapa é desenhado */
  field: { x: 24, y: 82, w: 592, h: 372 },
  /** legenda e dica, embaixo do campo */
  footer: { x: 24, y: 460, w: 592, h: 28 },
  /** botões de zoom, flutuando no canto inferior-direito do campo */
  zoom: { d: 34, margin: 10 },
} as const;

/** largura de render, pela escala única da família de janelas */
export const MAP_WIDTH = windowWidth(MAP_PLATE.w);

/**
 * Níveis de zoom — os MESMOS do minimapa (`ui/minimap: MM_ZOOM`), de propósito.
 *
 * As duas telas mostram a mesma coisa em tamanhos diferentes, e ter escadas de
 * zoom distintas faria "afastar" significar coisas diferentes em cada uma.
 * 1 = conteúdo inteiro à vista.
 */
export const MAP_ZOOM = [1, 1.5, 2, 3, 4, 6, 8] as const;

export const MAP_TABS = [
  { key: "atual", label: "Mapa atual" },
  { key: "mundo", label: "Mundo" },
] as const;
export type MapTab = (typeof MAP_TABS)[number]["key"];

/**
 * Cores da janela.
 *
 * O terreno NÃO tem paleta própria: ele usa `MM_COLORS` do minimapa. As duas
 * telas desenham a mesma colisão, e duas paletas fariam o campo mudar de cor ao
 * abrir a janela — o jogador leria como outro lugar.
 */
export const MAP_COLORS = {
  /** dentro da moldura (a folhagem tem de aparecer por baixo) */
  panel: "rgba(26,20,10,0.62)",
  /** campo escuro atrás do mapa, e a cor do que está fora dele */
  field: "rgba(14,12,7,0.72)",
  ink: "#f2e8d2",
  inkDim: "#bdae91",
  shadow: "rgba(20,12,4,0.92)",
  /** aba escolhida / as outras — as mesmas da Lista de Amigos */
  tabActive: "rgba(82,88,36,0.92)",
  tabIdle: "rgba(55,54,55,0.78)",
  /** miolo do aro do "x" */
  closeTint: "#8f2b20",
  /** grade por cima do mapa, como a do mapa-múndi pintado */
  grid: "rgba(214,186,122,0.20)",
} as const;

/** de quantas em quantas células a grade é desenhada */
export const GRID_STEP = 10;
/** abaixo deste passo em px a grade vira ruído e não é desenhada */
export const GRID_MIN_PX = 14;

/**
 * Onde o conteúdo cai dentro do campo, dado zoom e arrasto.
 *
 * Função PURA porque é a única regra de verdade da navegação — e a parte fácil
 * de errar é o CLAMP: sem ele o arrasto leva o mapa para fora do campo e o
 * jogador fica olhando o vazio sem saber como voltar.
 *
 * Em zoom 1 o conteúdo cabe inteiro (`base` é o `contain`), a folga é zero e o
 * arrasto não tem para onde ir — o mapa fica centrado, que é o certo: não há
 * nada fora da vista para procurar.
 */
export function enquadrar(
  campo: { w: number; h: number },
  conteudo: { w: number; h: number },
  zoom: number,
  pan: { x: number; y: number },
): { escala: number; ox: number; oy: number } {
  const base = Math.min(campo.w / conteudo.w, campo.h / conteudo.h);
  const escala = base * zoom;
  const dw = conteudo.w * escala;
  const dh = conteudo.h * escala;
  const folgaX = Math.max(0, (dw - campo.w) / 2);
  const folgaY = Math.max(0, (dh - campo.h) / 2);
  const px = Math.max(-folgaX, Math.min(folgaX, pan.x));
  const py = Math.max(-folgaY, Math.min(folgaY, pan.y));
  return { escala, ox: (campo.w - dw) / 2 + px, oy: (campo.h - dh) / 2 + py };
}

/**
 * Arrasto que MANTÉM sob o ponteiro o ponto que já estava lá, ao trocar de zoom.
 *
 * Sem isto, aproximar joga a vista de volta para o centro do mapa e o jogador
 * perde o lugar que estava olhando — o gesto vira "aproxima e procura de novo".
 * A conta é a inversa de `enquadrar`: acha-se a coordenada de conteúdo sob o
 * ponteiro na escala velha e resolve-se o `pan` que a devolve na nova.
 */
export function panAoAproximar(
  campo: { w: number; h: number },
  conteudo: { w: number; h: number },
  antes: { zoom: number; pan: { x: number; y: number } },
  zoomNovo: number,
  ponteiro: { x: number; y: number },
): { x: number; y: number } {
  const a = enquadrar(campo, conteudo, antes.zoom, antes.pan);
  const u = (ponteiro.x - a.ox) / a.escala;
  const v = (ponteiro.y - a.oy) / a.escala;
  const base = Math.min(campo.w / conteudo.w, campo.h / conteudo.h);
  const escala = base * zoomNovo;
  return {
    x: ponteiro.x - u * escala - (campo.w - conteudo.w * escala) / 2,
    y: ponteiro.y - v * escala - (campo.h - conteudo.h * escala) / 2,
  };
}
