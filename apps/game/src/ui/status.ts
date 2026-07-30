/**
 * Janela de Status (Alt+A / Alt+Q) — arte pintada de
 * `assets-new/ui_definitiva/status`, servida de `public/assets/ui/status/`.
 *
 * Mesma receita das outras: o fundo é UMA imagem e todo o resto é posicionado
 * em % dela, com `STATUS_WIDTH` reescalando o conjunto num número só.
 *
 * Peças repetidas (md5 conferido, nada duplicado no repo): `square-skill` é o
 * canto dos slots, `curva`/`reta` são as das barras de HP/SP,
 * `button-plus-add-tab-chat` é o "+" do chat, `button-arrow-left` é a seta do
 * paginador da barra de skills, `ring-level` e `tab-off` vêm da placa do
 * personagem e do chat.
 */

const BASE = "/assets/ui/status";

export const ST_ART = {
  plate: `${BASE}/status-background.png`,
  helmet: `${BASE}/icon-helmt.png`,
  face: `${BASE}/icon-face.png`,
  body: `${BASE}/icon-body.png`,
  coat: `${BASE}/icon-coat.png`,
  legs: `${BASE}/icon-legs.png`,
  foot: `${BASE}/icon-foot.png`,
  ring: `${BASE}/icon-ring.png`,
  shield: `${BASE}/icon-shield.png`,
  weapon: `${BASE}/icon-weapon.png`,
} as const;

/** tamanho nativo do fundo — origem de todas as medidas abaixo */
export const ST_PLATE = { w: 601, h: 363 } as const;

/**
 * Medidas em pixel de `status-background.png`.
 *
 * A cena de floresta (onde entra o personagem) ocupa x 24..263 — medido pelo
 * verde saturado, que só existe ali. O painel escuro é o resto até a moldura, e
 * a divisória entre "Status" e "Atributos" saiu da proporção da referência
 * (0,483 da largura do painel).
 */
export const ST_LAYOUT = {
  title: { x: 30, y: 10, w: 285, h: 34 },
  /** cena de floresta: fundo do retrato e dos slots de equipamento */
  scene: { x: 24, y: 50, w: 240, h: 300 },
  /**
   * Onde o personagem e desenhado DENTRO da cena.
   *
   * Nao e a cena inteira: enquadrado nela o boneco ficava gigante e com os pes
   * no rodape da moldura. A plataforma de pedra da arte fica em y ~285..320
   * (medido pelo tom quente #9f8f4f / #7d6c36 no meio da cena), entao a caixa
   * termina em 300 — o enquadramento deixa 4% de folga embaixo e os pes caem
   * em cima da pedra.
   */
  avatar: { x: 79, y: 110, w: 130, h: 190 },
  /**
   * Colunas do painel. O vão em volta da divisória vertical é FOLGADO de
   * propósito (18 px de cada lado): com as colunas coladas nela a leitura ficava
   * apertada e a linha parecia parte do texto.
   */
  stats: { x: 280, y: 58, w: 129, h: 246 },
  attrs: { x: 445, y: 58, w: 139, h: 190 },
  /** dica + Cancelar/Confirmar, embaixo da coluna de atributos */
  /**
   * So os dois botoes. A dica saiu daqui para dentro do "?" ao lado dos pontos
   * livres: com o texto junto, a coluna passava do fundo e os botoes caiam para
   * fora da moldura.
   */
  actions: { x: 445, y: 292, w: 139, h: 30 },
  /** divisória vertical entre as duas colunas */
  divider: { x: 427, y: 62, h: 246 },
  /**
   * O "x" desceu e foi para a direita: em (578, 22) ele encostava na moldura de
   * cima e parecia solto do canto.
   */
  close: { cx: 583, cy: 30, d: 34 },
} as const;

/** teto de atributo do projeto — o "+" fica cinza ao chegar nele */
export const ST_ATTR_MAX = 130;

/**
 * Slots de equipamento sobre a cena, como na referência: quatro de cada lado e
 * dois embaixo (arma e escudo). São os dez do RO — os dois anéis são os
 * acessórios.
 */
export const ST_SLOTS = [
  { key: "helmet", art: ST_ART.helmet, label: "Topo", cx: 64, cy: 112 },
  { key: "body", art: ST_ART.body, label: "Armadura", cx: 64, cy: 171 },
  { key: "coat", art: ST_ART.coat, label: "Capa", cx: 64, cy: 222 },
  { key: "ring1", art: ST_ART.ring, label: "Acessório 1", cx: 64, cy: 273 },
  { key: "face", art: ST_ART.face, label: "Rosto", cx: 234, cy: 112 },
  { key: "legs", art: ST_ART.legs, label: "Calça", cx: 234, cy: 171 },
  { key: "foot", art: ST_ART.foot, label: "Sapatos", cx: 234, cy: 222 },
  { key: "ring2", art: ST_ART.ring, label: "Acessório 2", cx: 234, cy: 273 },
  { key: "weapon", art: ST_ART.weapon, label: "Arma", cx: 122, cy: 315 },
  { key: "shield", art: ST_ART.shield, label: "Escudo", cx: 178, cy: 315 },
] as const;

export const ST_SLOT_D = 43;

/**
 * Os seis atributos, com o nome curto que a referência usa (FOR/DES/SOR em vez
 * de STR/DEX/LUK) e a explicação que o próprio pacote traz em
 * `especificação de cada status (str-int-etc).txt`.
 */
export type RaisableStat = "str" | "agi" | "vit" | "int" | "dex" | "luk";

export const ST_ATTRS: { key: RaisableStat; sigla: string; nome: string; texto: string }[] = [
  {
    key: "str",
    sigla: "FOR",
    nome: "Força",
    texto:
      "Aumenta o dano de ataques físicos, principalmente de personagens que lutam de perto. Também melhora a capacidade de carregar itens e oferece alguma resistência a certos efeitos.",
  },
  {
    key: "agi",
    sigla: "AGI",
    nome: "Agilidade",
    texto:
      "Faz o personagem atacar mais rápido, aumenta a esquiva e melhora a resistência a alguns efeitos negativos.",
  },
  {
    key: "vit",
    sigla: "VIT",
    nome: "Vitalidade",
    texto:
      "Aumenta a vida (HP), melhora a defesa, fortalece a recuperação de HP e aumenta a resistência contra diversos efeitos negativos.",
  },
  {
    key: "int",
    sigla: "INT",
    nome: "Inteligência",
    texto:
      "Aumenta o poder de ataques mágicos, o SP (mana), melhora a recuperação de SP e reduz o tempo de conjuração de magias.",
  },
  {
    key: "dex",
    sigla: "DES",
    nome: "Destreza",
    texto:
      "Melhora a precisão, fortalece ataques à distância, acelera a conjuração e também beneficia algumas habilidades de criação e suporte.",
  },
  {
    key: "luk",
    sigla: "SOR",
    nome: "Sorte",
    texto:
      "É um atributo versátil que concede pequenos bônus em vários aspectos, como dano, acerto, crítico, esquiva e resistência a alguns efeitos negativos.",
  },
];

export const STATUS_WIDTH = 760;

export const ST_COLORS = {
  ink: "#e9dcc0",
  inkDim: "#a89a7e",
  label: "#c9bb9c",
  hp: "#7fc463",
  sp: "#6fa8dc",
  slot: "rgba(18,16,10,0.62)",
  slotHover: "rgba(46,42,22,0.7)",
  divider: "rgba(190,150,90,0.35)",
  /** opacidade da peça `reta-barra-hp-sp` quando ela vira divisória */
  dividerOpacity: 0.45,
  shadow: "rgba(16,10,3,0.95)",
  /** botões de baixo: o de confirmar é o destacado */
  cancel: "rgba(38,32,20,0.85)",
  confirm: "rgba(122,72,32,0.9)",
} as const;
