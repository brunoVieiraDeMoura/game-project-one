/**
 * Frame do personagem (topo-esquerda do /play) — arte pintada de
 * `assets-new/ui_definitiva/character-up-left`, servida de
 * `public/assets/ui/character-frame/`.
 *
 * Este arquivo é a REGUA da arte: toda coordenada abaixo foi MEDIDA no PNG
 * (varredura de alpha/cor, não olhômetro) e é guardada em pixel NATIVO da peça.
 * Quem desenha converte para porcentagem do container, que tem exatamente a
 * proporção da placa — assim o frame inteiro escala num número só (`width`) e
 * nada sai do lugar.
 *
 * Diferente do TravelBook (ui/travelbook.ts), esta arte NÃO é pixel-art: é
 * pintada e com alpha suave, então nada aqui usa `image-rendering: pixelated`
 * nem escala inteira — interpolar é o certo.
 */

import { nineSliceCached, nineSliceUrl, type NineSliceSpec } from "./nineSlice";

const BASE = "/assets/ui/character-frame";

export const CHAR_FRAME = {
  /** placa inteira: aro do avatar (vazado) + painel de madeira */
  plate: `${BASE}/plate.png`,
  /** aro de nível (vazado no meio) — usado duas vezes: base e classe */
  ring: `${BASE}/ring-level.png`,
  /** canto SUPERIOR-DIREITO da moldura das barras (os outros 3 são espelhos) */
  barCorner: `${BASE}/bar-corner.png`,
  /** trecho reto da mesma moldura, para esticar entre os cantos */
  barEdge: `${BASE}/bar-edge.png`,
} as const;

/** tamanho nativo de `plate.png` — origem de todas as medidas abaixo */
export const PLATE = { w: 663, h: 195 } as const;

/**
 * Medidas em pixel de `plate.png`:
 *
 * - `hole`: buraco do aro (flood fill do alpha a partir do centro) —
 *   x 45..199, y 16..170, 155×155 exatos. É onde entra o retrato.
 * - `hp`/`sp`/`name`: derivados de `referencia-pronto.jpg` (628×185, a mesma
 *   placa a 94,7%), reescalados por 663/628. A faixa de madeira útil vai de
 *   x=230 (fim do aro) a x≈640; a linha do nome é mais curta (x≈570) porque a
 *   ramagem do canto superior-direito invade o painel.
 * - `ringBase`/`ringJob`: os dois discos da referência, na borda de baixo.
 *
 * O NOME não encosta no topo do painel: na referência a faixa de maiúsculas
 * fica em y 40..58 (centro 50), não em 33 como estava — colado na moldura ele
 * parecia "fora do lugar". E ele começa em x≈250, ~16 px à DIREITA das barras.
 *
 * Os aros saem maiores que a referência (72 contra 60) a pedido; o da classe
 * anda um pouco para a esquerda do ponto medido (207 contra 216) para não
 * cobrir o rótulo "SP", que nasce logo depois da ponta arredondada da barra.
 */
export const PLATE_LAYOUT = {
  hole: { cx: 122, cy: 93, d: 155 },
  name: { x: 248, y: 32, w: 320, h: 36 },
  hp: { x: 234, y: 76, w: 372, h: 36 },
  sp: { x: 234, y: 118, w: 372, h: 36 },
  /**
   * Onde o HP vai quando NÃO há SP (é o caso do monstro: o rAthena não manda
   * SP de mob). Centro exato entre as duas faixas — deixar o HP no lugar de
   * sempre abriria um vão vazio embaixo dele, e a placa parecia quebrada.
   */
  hpAlone: { x: 234, y: 97, w: 372, h: 36 },
  ringBase: { cx: 60, cy: 150, d: 72 },
  ringJob: { cx: 207, cy: 150, d: 72 },
} as const;

/**
 * Buraco de `ring-level.png` medido por flood fill: centrado (50%/50%), mas
 * 75,7% da LARGURA contra 78,1% da ALTURA — a imagem é 74×73 com a arte em
 * 73×73, então esticá-la para um quadrado deixa o vazado levemente ovalado. O
 * disco que pinta o miolo tem que ser FOLGADO (84%) para o excesso ficar
 * escondido sob o aro: com 76% sobrava um fio de céu dentro do anel embaixo, e
 * era o "fundo do jogo vazando".
 */
export const RING_HOLE_INSET = "8%";

export interface PlateRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PlateCircle {
  cx: number;
  cy: number;
  d: number;
}

/** retângulo da arte → caixa absoluta em % do container */
export function boxPct(r: PlateRect) {
  return {
    position: "absolute" as const,
    left: `${(r.x / PLATE.w) * 100}%`,
    top: `${(r.y / PLATE.h) * 100}%`,
    width: `${(r.w / PLATE.w) * 100}%`,
    height: `${(r.h / PLATE.h) * 100}%`,
  };
}

/**
 * Disco da arte → caixa absoluta em %. Continua REDONDO porque o container tem
 * a proporção da placa: `d/PLATE.w` da largura e `d/PLATE.h` da altura dão o
 * mesmo número de pixels na tela.
 */
export function circlePct(c: PlateCircle) {
  return {
    position: "absolute" as const,
    left: `${((c.cx - c.d / 2) / PLATE.w) * 100}%`,
    top: `${((c.cy - c.d / 2) / PLATE.h) * 100}%`,
    width: `${(c.d / PLATE.w) * 100}%`,
    height: `${(c.d / PLATE.h) * 100}%`,
  };
}

/** medida da arte → px de tela, dada a largura de render da placa */
export function scaleOf(plateWidth: number) {
  return plateWidth / PLATE.w;
}

/** mesmo disco, `px` da arte maior em cada lado */
export function grow(c: PlateCircle, px: number): PlateCircle {
  return { cx: c.cx, cy: c.cy, d: c.d + px * 2 };
}

/**
 * Quanto o retrato passa POR BAIXO do aro.
 *
 * O buraco é um círculo exato (raio 77,5 em (122,93), conferido em cinco linhas
 * e cinco colunas) e de borda DURA — o alpha salta de 0 para 255 num pixel. Um
 * disco do tamanho exato dele parece certo na conta e vaza na tela: a placa é
 * desenhada com escala fracionária (400/663) e o recorte redondo do retrato é
 * suavizado, então meio pixel de diferença abre um fio de céu na beirada.
 * Encaixar o disco 4 px para dentro da madeira resolve dos quatro lados — e cabe:
 * o aro tem 12 px de madeira opaca no ponto mais fino (topo) e 33 px na
 * esquerda.
 */
export const AVATAR_OVERLAP = 4;

/**
 * Cores AMOSTRADAS da arte e da referência (nada escolhido no olho):
 * madeira do painel, creme do texto, e os gradientes das barras lidos coluna a
 * coluna no meio de cada uma.
 */
export const FRAME_COLORS = {
  wood: "#5d3f23",
  woodDark: "#3d2a18",
  cream: "#f7f1e5",
  creamDim: "#d8c9b2",
  /** contorno escuro que a arte usa em todo texto sobre madeira */
  shadow: "rgba(24,14,6,0.9)",
  /** trilho vazio das barras — a referência está cheia, então é a madeira no escuro */
  trough: "#231a11",
  troughDeep: "#120c06",
  /** miolo dos aros: base é marrom, classe é azulado (medido nos dois discos) */
  ringBase: "#43321e",
  ringJob: "#2f3d47",
} as const;

/** perfil vertical medido no meio da barra verde da referência */
export const HP_FILL = "linear-gradient(180deg,#8ea24d 0%,#56712a 14%,#4a6725 55%,#3b551d 100%)";
/** idem, na barra azul */
export const SP_FILL = "linear-gradient(180deg,#617f97 0%,#36516f 14%,#2f4c6c 55%,#23405c 100%)";
/**
 * HP do ALVO. A arte não traz barra vermelha, então é a MESMA curva do HP com a
 * matiz girada de ~80° para ~8° e a claridade de cada parada preservada — assim
 * a barra do monstro tem o mesmo relevo pintado da do jogador, e não um degradê
 * inventado. O tom do meio (#8a2f22) é o vermelho que o HUD já usa em erro.
 */
export const ENEMY_FILL = "linear-gradient(180deg,#b05a45 0%,#8a2f22 14%,#78271c 55%,#5c1c15 100%)";

/** serifa: a arte é pintada, e fonte de sistema sem serifa destoa dela */
export const FRAME_FONT = "Georgia, 'Times New Roman', serif";

/**
 * Fonte só dos NÚMEROS — e Georgia está de fora de propósito: os algarismos
 * dela são de estilo antigo (o 3, o 4, o 7 e o 9 descem abaixo da linha, o 0 e
 * o 1 têm altura de minúscula), e "37187 / 37187" saía embaralhado. Cambria e
 * Times têm algarismos alinhados; `tabular-nums` ainda prende a largura, senão
 * o HP dança de posição a cada golpe.
 */
export const FRAME_NUM_FONT = "Cambria, 'Times New Roman', 'Liberation Serif', serif";
export const FRAME_NUM_VARIANT = "lining-nums tabular-nums";

// ---------------------------------------------------------------------------
// Moldura das barras: 9-slice montado em runtime
// ---------------------------------------------------------------------------

/**
 * Moldura das barras: o 9-slice genérico (`ui/nineSlice`) montado com as peças
 * das barras de HP/SP.
 *
 * A arte traz UM canto (o superior-direito) e UM trecho reto; os outros três
 * cantos são o mesmo desenho espelhado, como o change.txt pede. Medidas da
 * varredura de alpha do PNG: o canto ocupa x 53..76, y 0..23 (24×24) e antes
 * disso é traço reto puro; o traço tem 9 px, e a coluna x=76 (a de FORA) é
 * justamente a linha 0 de `bar-edge.png` — por isso os espelhamentos casam
 * pixel a pixel.
 *
 * As mesmas peças vestem as abas e caixas do chat: `border-curve.png` e
 * `reta-buttons.png` de lá são byte a byte estes arquivos.
 */
export const BAR_FRAME: NineSliceSpec = {
  corner: CHAR_FRAME.barCorner,
  cornerSx: 53,
  slice: 24,
  edge: CHAR_FRAME.barEdge,
  edgeThickness: 9,
};

/** corte (`border-image-slice`) da imagem gerada */
export const BAR_FRAME_SLICE = BAR_FRAME.slice ?? 24;

/** data-url do 9-slice das barras (montado uma vez por sessão) */
export function barFrameUrl(): Promise<string> {
  return nineSliceUrl(BAR_FRAME);
}

/** já pronto? (evita um frame com a barra sem moldura) */
export function barFrameCached(): string | null {
  return nineSliceCached(BAR_FRAME);
}
