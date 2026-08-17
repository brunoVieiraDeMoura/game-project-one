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

import { CHROME, windowWidth } from "./windowChrome";

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
 * A grade é 3 × 4: quatro colunas espremiam o slot além do que a arte
 * (`inventory-background.png`) desenha para o campo — o "Alt+E estourando o
 * container" do relato. Três colunas dão ~33% mais lado por slot que quatro, e
 * o excedente de itens passa a ser problema de ROLAGEM, não de espremer mais
 * coisa na mesma largura.
 */
export const BAG_CONTENT = { x: 30, w: 234 } as const;

export const BAG_LAYOUT = {
  title: { x: BAG_CONTENT.x, y: 16, w: BAG_CONTENT.w, h: 30 },
  /**
   * A ALTURA vem de `CHROME.tabH`, comum às três janelas com arte própria: em
   * 28 a aba do inventário saa com 40 px de tela contra 30,5 da de amigos. O
   * `y` desceu de 50 para 51 para a fileira continuar centrada na mesma faixa
   * da arte.
   */
  tabs: { x: BAG_CONTENT.x, y: 51, w: BAG_CONTENT.w, h: CHROME.tabH },
  grid: { x: BAG_CONTENT.x, y: 88, w: BAG_CONTENT.w, h: 192 },
  weight: { x: BAG_CONTENT.x, y: 302, w: 116, h: 28 },
  gold: { x: 154, y: 302, w: 110, h: 28 },
  /**
   * Aro do "x". Ele ENCAVALA o canto superior-direito, como na referência: com
   * `cx` 272 a borda direita dele encostava exatamente na da moldura e o botão
   * parecia recuado; em 280 ele passa ~8 px para fora, que é a sobra que o
   * desenho mostra.
   */
  close: { cx: 278, cy: 20, d: CHROME.closeD },
} as const;

export const BAG_GRID = {
  cols: 3,
  /** fileiras VISÍVEIS — o que passar disso rola */
  rows: 4,
  gap: 5,
  /**
   * Vão reservado à barra de rolagem, em px de arte.
   *
   * A barra é a mesma do chat (`hud/ChatScrollbar`), e as peças dela são
   * `arrow`, `background-rolling-bar` e `rolling-bar-*` do pacote da bolsa —
   * byte a byte (md5 conferido) as que o repo já tinha. Nenhum arquivo novo.
   */
  barra: 13,
  /** vão entre a grade e a barra */
  barraGap: 5,
} as const;

/**
 * Teto do slot do inventário, em múltiplo do slot da SkillBar
 * (`ui/skillBar.SKILL_SLOT_SIZE`) — o inventário pode ter slot MAIOR que a
 * barra de habilidades (pedido explícito), nunca a barra fica maior por
 * causa disto: o multiplicador entra só do lado do inventário
 * (`hud/InventoryWindow.tsx: ladoSlot`), `SKILL_SLOT_SIZE` em si não muda.
 */
export const INVENTORY_SLOT_SCALE = 1.5;

/**
 * Teto de caracteres do nome sob o slot.
 *
 * Nome de item do RO passa de trinta caracteres ("Wing Of Fly", "Old Blue Box",
 * e os equipamentos são piores). Sem teto ele empurrava a faixa e estourava a
 * moldura — o Alt+E "quebrado" do relato.
 *
 * Doze é o que cabia no slot de QUATRO colunas (a densidade antiga, ver
 * `BAG_GRID.cols`) — com três colunas o slot ficou mais largo, então o teto
 * continua seguro (nunca estoura), só deixou de ser o limite exato. O corte
 * tira os TRÊS últimos caracteres do que sobra e concatena "…", então o
 * resultado tem exatamente 12: nove de nome mais as reticências.
 */
export const BAG_NOME_MAX = 12;

export function encurtarNome(nome: string): string {
  if (nome.length <= BAG_NOME_MAX) return nome;
  return `${nome.slice(0, BAG_NOME_MAX - 3)}...`;
}
/**
 * Largura de render da janela.
 *
 * Sai de `WINDOW_SCALE`, a escala ÚNICA da família de janelas com arte própria
 * (ver `ui/windowChrome.ts`): com ela um px de arte vale o mesmo px de tela
 * aqui, no status e nos amigos, e o "x", as abas, a rolagem e as fontes ficam
 * do mesmo tamanho nas três sem tabela de exceção. Dá 412 px — o inventário
 * praticamente não se mexeu (era 420), porque foi a densidade DELE (5×4 slots)
 * que fixou a escala.
 */
export const BAG_WIDTH = windowWidth(BAG_PLATE.w);

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
