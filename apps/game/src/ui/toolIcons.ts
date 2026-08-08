import type { WindowKey } from "../hud/hudStore";

/**
 * Botões do menu (canto inferior-direito) — arte pintada de
 * `assets-new/ui_definitiva/tools-right-down`, servida de
 * `public/assets/ui/tools/`.
 *
 * Cada PNG já é o botão INTEIRO: moldura de madeira + fundo colorido + o
 * desenho. Não há peça separada de moldura, então nada aqui é 9-slice — o botão
 * é a imagem, e o rótulo entra por cima.
 *
 * Como a placa do personagem (ui/charFrame.ts), a arte é pintada: nada de
 * `image-rendering: pixelated` nem escala inteira.
 */

const BASE = "/assets/ui/tools";

/** janela → arte. A ORDEM aqui é a da referência, e é a que a barra desenha. */
export const TOOL_ICONS: { key: WindowKey; label: string; art: string; hotkey: string }[] = [
  { key: "inventory", label: "Inventário", art: `${BASE}/bag.png`, hotkey: "Alt+E" },
  { key: "skills", label: "Skills", art: `${BASE}/skills.png`, hotkey: "Alt+S" },
  { key: "status", label: "Status", art: `${BASE}/status.png`, hotkey: "Alt+A" },
  { key: "map", label: "Mapa", art: `${BASE}/map.png`, hotkey: "Alt+M" },
  { key: "quests", label: "Quest", art: `${BASE}/quest.png`, hotkey: "Alt+U" },
  { key: "friends", label: "Friends", art: `${BASE}/friend-list.png`, hotkey: "Alt+Z" },
  { key: "settings", label: "Settings", art: `${BASE}/settings.png`, hotkey: "Alt+O" },
];

/**
 * Geometria medida na referência (1205×185, sete botões de 155×143 com 15 px
 * entre eles):
 *
 * - `LABEL_BOTTOM`: a linha de base do rótulo fica 11% acima da borda de baixo
 *   do botão (texto em y 128..142 num botão que vai de 16 a 158).
 * - `labelSize`: na referência a maiúscula tem 10% da altura do botão. Aqui é
 *   17% DE PROPÓSITO: a referência é uma prancha de 143 px por botão e no HUD
 *   ele tem 48 — no mesmo proporcional o nome sairia com 5 px e ninguém leria.
 *   É o único número que não copia a arte, e o teto é este: com 19% a palavra
 *   mais longa ("Inventário") encosta na moldura pintada.
 * - `gap`: 15/155 da largura do botão, arredondado para a altura de render.
 *
 * Sete botões a 48 px dão ~375 px de barra — o teto útil, porque a barra de
 * skills (centrada, ~520 px) chega perto dos 900 px numa tela de 1280.
 */
export const TOOL_LAYOUT = {
  /** altura de render de cada botão, em px de tela */
  height: 48,
  labelBottom: 0.11,
  labelSize: 0.17,
  gap: 3,
} as const;

/** creme do rótulo, amostrado no pixel mais claro do texto da referência */
export const TOOL_LABEL_COLOR = "#fdfce7";
/** a arte é escura sob o texto (#3a210d acima, #432a14 abaixo): sombra dura */
export const TOOL_LABEL_SHADOW = "0 1px 2px rgba(18,10,3,0.95), 0 0 3px rgba(18,10,3,0.8)";
