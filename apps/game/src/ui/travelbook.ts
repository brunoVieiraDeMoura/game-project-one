/**
 * Skin TravelBookLite (Crusenho) — o pack de pixel-art de livro que veste o HUD.
 *
 * Arte em `public/assets/ui/travelbook/`. As peças são MINÚSCULAS (slot 30×30,
 * moldura 62×30, página 104×147), então tudo aqui gira em torno de duas regras:
 *
 *  1. `image-rendering: pixelated` — sem isso o navegador interpola e a arte
 *     vira borrão;
 *  2. escala INTEIRA (UI_SCALE) — meio pixel destrói o traço do pixel-art. Toda
 *     medida derivada (borda, slot, barra) é múltipla dela.
 *
 * Licença: uso livre, inclusive comercial, COM CRÉDITO (o crédito aparece na
 * janela de configurações). Revenda proibida. Ver
 * public/assets/ui/travelbook/LICENSE-crusenho.txt.
 */

const BASE = "/assets/ui/travelbook";

export const UI_SCALE = 3;

export const TB = {
  frame: `${BASE}/UI_TravelBook_Frame01a.png`,
  frameSelect: `${BASE}/UI_TravelBook_FrameSelect01a.png`,
  popup: `${BASE}/UI_TravelBook_Popup01a.png`,
  pageLeft: `${BASE}/UI_TravelBook_BookPageLeft01a.png`,
  pageRight: `${BASE}/UI_TravelBook_BookPageRight01a.png`,
  cover: `${BASE}/UI_TravelBook_BookCover01a.png`,
  slot: `${BASE}/UI_TravelBook_Slot01a.png`,
  slotHover: `${BASE}/UI_TravelBook_Slot01b.png`,
  slotActive: `${BASE}/UI_TravelBook_Slot01c.png`,
  select: `${BASE}/UI_TravelBook_Select01a.png`,
  bar: `${BASE}/UI_TravelBook_Bar01a.png`,
  fillWarm: `${BASE}/UI_TravelBook_Fill01a.png`,
  fillDark: `${BASE}/UI_TravelBook_Fill01b.png`,
  button: `${BASE}/UI_TravelBook_Button01a_1.png`,
  buttonHover: `${BASE}/UI_TravelBook_Button01a_3.png`,
  buttonPress: `${BASE}/UI_TravelBook_Button01a_5.png`,
  iconHeart: `${BASE}/UI_TravelBook_IconHeart01a.png`,
  iconEnergy: `${BASE}/UI_TravelBook_IconEnergy01a.png`,
  iconCoin: `${BASE}/UI_TravelBook_IconCoin01a.png`,
  iconGear: `${BASE}/UI_TravelBook_IconGear01a.png`,
  iconStar: `${BASE}/UI_TravelBook_IconStar01a.png`,
  cursor: `${BASE}/UI_TravelBook_Cursor01c.png`,
} as const;

/**
 * Cores medidas dos próprios PNGs (pixel dominante de cada peça) — assim o
 * texto e as bordas desenhadas em CSS batem exatamente com a arte, em vez de
 * "quase".
 */
export const BOOK = {
  /** pergaminho da página */
  paper: "#ffd7a8",
  paperShade: "#dea974",
  paperEdge: "#c7895d",
  /** contorno escuro do pack */
  ink: "#493333",
  inkSoft: "#6b4a35",
  inkFaint: "#8a7868",
  /** madeira escura (slots, botões) */
  wood: "#45292a",
  woodLight: "#634041",
  woodPale: "#825f60",
  /** dourado do preenchimento de barra */
  gold: "#e5b67f",
  parchmentLight: "#ffe3c6",
} as const;

/** `image-rendering` + fundo esticado por peça inteira. */
export const pixelated = {
  imageRendering: "pixelated" as const,
};

/**
 * Moldura 9-slice a partir de uma peça do pack.
 *
 * `slice` é em pixels da ARTE (não da tela); a borda desenhada é slice×UI_SCALE
 * para manter a escala inteira. `repeat` (e não `stretch`) preserva o
 * padrãozinho da borda em painéis grandes.
 */
export function bookFrame(url: string, slice = 6, scale = UI_SCALE) {
  return {
    borderStyle: "solid" as const,
    borderWidth: slice * scale,
    borderImageSource: `url(${url})`,
    borderImageSlice: slice,
    borderImageRepeat: "repeat" as const,
    borderImageWidth: `${slice * scale}px`,
    ...pixelated,
  };
}

/** Fundo de uma peça repetida em escala inteira (barras, trilhos). */
export function bookTile(url: string, tileWidth: number, tileHeight: number, scale = UI_SCALE) {
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${tileWidth * scale}px ${tileHeight * scale}px`,
    backgroundRepeat: "repeat-x" as const,
    ...pixelated,
  };
}

/** Fundo de uma peça única esticada em múltiplo inteiro (slot, botão). */
export function bookPiece(url: string) {
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: "100% 100%",
    backgroundRepeat: "no-repeat" as const,
    ...pixelated,
  };
}
