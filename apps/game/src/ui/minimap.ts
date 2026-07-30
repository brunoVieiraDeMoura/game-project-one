/**
 * Minimapa (topo-direita) — arte pintada de `assets-new/ui_definitiva/mini-map`,
 * servida de `public/assets/ui/minimap/`.
 *
 * Como as outras placas, o fundo é UMA imagem e o resto é posicionado em % dela:
 * `MINIMAP_WIDTH` reescala o conjunto num número só.
 *
 * Boa parte do pacote é REPETIDA de outras telas — `ring-level`,
 * `curva-das-bordas-barra-hp-sp`, `reta-barra-hp-sp`, `tab-off`, `arrow`,
 * `rolling-bar-*` e `background-rolling-bar` são byte a byte os arquivos do
 * chat e da placa do personagem (md5 conferido). Então o aro do sino usa o PNG
 * de `character-frame/`, e o popup e a rolagem usam os de `chat/`; nada disso é
 * copiado de novo.
 */

const BASE = "/assets/ui/minimap";

export const MM_ART = {
  /** moldura inteira: aro, rosa dos ventos e as duas placas */
  plate: `${BASE}/mini-map-background.png`,
  zoomIn: `${BASE}/zoom-in.png`,
  zoomOut: `${BASE}/zoom-out.png`,
  bell: `${BASE}/bell.png`,
  sun: `${BASE}/sun.png`,
  moon: `${BASE}/moon.png`,
  /** seta que marca o personagem; o desenho aponta para CIMA */
  player: `${BASE}/personagem.png`,
} as const;

/** tamanho nativo do fundo — origem de todas as medidas abaixo */
export const MM_PLATE = { w: 429, h: 438 } as const;

/**
 * Medidas em pixel de `mini-map-background.png`.
 *
 * O círculo saiu do MAIOR VÃO transparente de cada linha e de cada coluna, e
 * não de varredura radial: radialmente as folhas que entram no aro cortam o
 * raio cedo (davam 153 onde o vão real passa de 170) e o centro saía errado.
 * Pelo vão, o meio é o mesmo em toda linha (209,5..210) e em toda coluna
 * (236,5..237,5), com raio ≈174 — a coluna do meio é a única que discorda
 * (222), porque ali quem corta o vão é a placa do relógio, não o aro.
 *
 * O `cy` MEDIDO é 237, não 228: com o valor antigo o círculo ficava 9 px alto e
 * abria um vão de fundo embaixo. O raio vai a 178 (4 acima do medido) para o
 * mapa passar POR BAIXO da moldura, como o retrato faz na placa do personagem —
 * do tamanho exato ele deixaria meia-lua nas beiradas.
 *
 * A placa do relógio usa o RECESSO escuro (x≈90..336, y 386..427 → centro
 * 213×406), não a caixa externa: o desenho tem bisel, e centralizar pela caixa
 * deixava o relógio alto e à direita dentro dele.
 */
export const MM_LAYOUT = {
  circle: { cx: 210, cy: 237, r: 178 },
  /** placa de cima: nome do mapa */
  namePlate: { x: 52, y: 16, w: 300, h: 46 },
  /** placa de baixo: sol/lua + relógio */
  clockPlate: { x: 90, y: 384, w: 246, h: 44 },
  /** botões de zoom, centrados NO aro (esquerda e direita, meia altura) */
  zoom: { d: 62 },
  /** aro do sino, fora do canto superior-direito */
  bellRing: { cx: 392, cy: 142, d: 84 },
  /** seta do personagem */
  player: { w: 22, h: 27 },
} as const;

/** largura de render da moldura */
export const MINIMAP_WIDTH = 250;

/**
 * Níveis de zoom, em "quantas vezes o mapa cabe na janela".
 *
 * 1 = mapa inteiro; daí em diante a janela encolhe e segue o personagem. O teto
 * é 8 porque além disso a janela fica menor que a área que o jogador enxerga na
 * cena, e o minimapa deixa de servir para se localizar.
 */
export const MM_ZOOM = [1, 1.5, 2, 3, 4, 6, 8] as const;

/** cores do mapa desenhado (colisão reduzida) e dos pontos */
export const MM_COLORS = {
  walkable: [58, 84, 46] as const,
  wall: [34, 32, 26] as const,
  water: [44, 78, 122] as const,
  cliff: [82, 62, 34] as const,
  npc: "#7dd3fc",
  mob: "#ef4444",
  ink: "#f2e7cd",
  shadow: "rgba(20,12,4,0.92)",
} as const;

/** o sol some às 18h e volta às 6h (ui-change.txt) */
export function isDaytime(hour: number): boolean {
  return hour >= 6 && hour < 18;
}
