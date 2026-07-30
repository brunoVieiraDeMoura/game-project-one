/**
 * Inventário (Alt+E / botão da barra de menu) — arte pintada de
 * `assets-new/ui_definitiva/bag`, servida de `public/assets/ui/bag/`.
 *
 * Como as outras janelas, o fundo é UMA imagem e o resto é posicionado em % dela:
 * `BAG_WIDTH` reescala tudo num número só.
 *
 * Quase todo o pacote é REPETIDO (md5 conferido): `square-skill` é o canto dos
 * slots da barra de habilidades, `curva-das-bordas-barra-hp-sp` e
 * `reta-barra-hp-sp` são as peças das barras de HP/SP, `ring-level` é o aro da
 * placa do personagem e `tab-off` é o "x" do chat. Só entram no repo os três
 * arquivos novos: o fundo, a moeda e o peso.
 */

const BASE = "/assets/ui/bag";

export const BAG_ART = {
  /** janela inteira: moldura, faixa do título e as duas faixas de baixo */
  plate: `${BASE}/inventory-background.png`,
  /** ícone à esquerda do contador de ouro (substitui o zeny) */
  coin: `${BASE}/coin.png`,
  /** ícone à esquerda do contador de peso */
  weight: `${BASE}/weight.png`,
} as const;

/** tamanho nativo do fundo — origem de todas as medidas abaixo */
export const BAG_PLATE = { w: 294, h: 342 } as const;

/**
 * Medidas em pixel de `inventory-background.png`, lidas do perfil da coluna
 * central (onde a arte troca de faixa):
 *
 *   y 16..45   faixa do título
 *   y 47..295  campo escuro
 *   y 297..335 faixa de baixo, das duas contagens
 *
 * O campo chapado começa em x=14 e vai até 280 — mas isso é a BEIRADA, colada
 * no bisel. Todo conteúdo abre em x=30 e fecha em 264 (16 px de recuo de cada
 * lado): antes as caixas iam de 20 a 274 e encostavam na moldura, o que fazia
 * aba, slot e contador parecerem estourados para fora.
 *
 * A grade é 5 × 4 como na referência.
 */
export const BAG_CONTENT = { x: 30, w: 234 } as const;

export const BAG_LAYOUT = {
  title: { x: BAG_CONTENT.x, y: 16, w: BAG_CONTENT.w, h: 30 },
  tabs: { x: BAG_CONTENT.x, y: 50, w: BAG_CONTENT.w, h: 28 },
  grid: { x: BAG_CONTENT.x, y: 88, w: BAG_CONTENT.w, h: 192 },
  weight: { x: BAG_CONTENT.x, y: 302, w: 116, h: 28 },
  gold: { x: 154, y: 302, w: 110, h: 28 },
  /**
   * Aro do "x". Ele ENCAVALA o canto superior-direito, como na referência: com
   * `cx` 272 a borda direita dele encostava exatamente na da moldura e o botão
   * parecia recuado; em 280 ele passa ~8 px para fora, que é a sobra que o
   * desenho mostra.
   */
  close: { cx: 278, cy: 20, d: 34 },
} as const;

export const BAG_GRID = { cols: 5, rows: 4, gap: 5 } as const;
/**
 * Largura de render da janela. Tudo aqui é % da arte, então este é o único
 * número a mexer para a janela inteira crescer — slots, abas, fontes e o aro do
 * "x" acompanham.
 */
export const BAG_WIDTH = 420;

/**
 * Abas do inventário. As cores são as do change (consumível verde,
 * equipamentos azul, outros marrom) com opacidade — a madeira por baixo
 * continua aparecendo — e o texto vai BRANCO em todas, porque quem identifica a
 * aba é o fundo.
 */
export const BAG_TABS = [
  { key: "consumiveis", label: "Consumível", cor: "rgba(46,96,44,0.62)" },
  { key: "equipamentos", label: "Equipamentos", cor: "rgba(28,58,104,0.62)" },
  { key: "outros", label: "Outros", cor: "rgba(94,64,32,0.62)" },
] as const;
export type BagTab = (typeof BAG_TABS)[number]["key"];

export const BAG_COLORS = {
  ink: "#f4ecd8",
  inkDim: "#c3b596",
  slot: "rgba(20,18,10,0.5)",
  slotHover: "rgba(46,42,22,0.6)",
  counter: "rgba(20,18,10,0.55)",
  shadow: "rgba(20,12,4,0.92)",
  /** miolo do aro do "x" — vermelho, como na referência */
  closeTint: "#8f2b20",
} as const;
