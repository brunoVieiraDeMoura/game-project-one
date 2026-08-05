/**
 * Janela de Missões (Alt+U / botão da barra de menu) — arte de
 * `assets-new/ui_definitiva/quest`, servida de `public/assets/ui/quest/`.
 *
 * Das doze peças do pacote, NOVE são byte a byte (md5 conferido) arquivos que o
 * repo já tinha — `curva`/`reta` das barras, `square-skill`, `ring-level`,
 * `tab-off`, `arrow`, `rolling-bar-*` e `background-rolling-bar`. Entra uma:
 * `background.png`, a placa inteira (o `rs.png` do pacote é a mesma arte numa
 * tela 2× mais larga, arquivo de trabalho, e o `reference.png` é o mockup).
 *
 * A placa traz TUDO desenhado: moldura de folhagem, barra do título, o painel
 * escuro da lista à esquerda e a cena de floresta do detalhe à direita — como o
 * inventário e o status, e por isso ela também sai do `Panel` genérico.
 */

import { CHROME, windowWidth } from "./windowChrome";

const BASE = "/assets/ui/quest";

export const QT_ART = {
  /** placa inteira: moldura, título, painel da lista e cena do detalhe */
  plate: `${BASE}/background.png`,
} as const;

/**
 * Tamanho LÓGICO da placa.
 *
 * A arte tem 1783×1454 — muito maior que a das outras janelas (o inventário tem
 * 294 de largura, o status 601). Se `WINDOW_SCALE` fosse aplicado direto nela a
 * janela sairia com 2.496 px de largura. Então a placa é normalizada para um
 * tamanho lógico com a MESMA proporção (1783/1454 = 1,226), e é ele que passa
 * pela escala comum da família — assim o "x", as fontes e a rolagem continuam
 * do tamanho das outras janelas.
 */
export const QT_PLATE = { w: 560, h: 457 } as const;

/** tamanho nativo da arte — origem de todas as medidas abaixo */
const ART = { w: 1783, h: 1454 } as const;

/** px da ARTE → px lógicos da placa */
export function daArte(v: number): number {
  return (v * QT_PLATE.w) / ART.w;
}

/** caixa medida na arte → caixa em px lógicos */
export function caixaDaArte(r: { x: number; y: number; w: number; h: number }) {
  return { x: daArte(r.x), y: daArte(r.y), w: daArte(r.w), h: daArte(r.h) };
}

/**
 * Medidas em pixel de `background.png`, lidas do perfil de cor:
 *
 * - painel escuro da lista: x 26..734, y 205..1424 (o chapado #2e291d)
 * - cena de floresta do detalhe: x 746..1718, y 196..1408
 * - barra do título: madeira escura a partir de y≈25, à direita de x≈700
 *
 * O conteúdo recua das bordas porque a moldura pintada avança sobre os dois
 * painéis — encostado nela, texto e slot pareciam estourados para fora.
 */
export const QT_LAYOUT_ART = {
  /**
   * "Missões" na barra de madeira do topo.
   *
   * A caixa NÃO é centrada na placa: a barra de madeira só existe do x≈700 para
   * a direita e o aro do "x" ocupa a ponta dela, então o vão útil vai de 705 a
   * 1610 — o título centrado na placa inteira saía visivelmente à direita.
   */
  title: { x: 705, y: 40, w: 905, h: 120 },
  /** aro do "x", no canto superior-direito */
  close: { cx: 1718, cy: 105, d: 0 },

  /** campo da lista de missões (as linhas rolam aqui dentro) */
  list: { x: 70, y: 235, w: 620, h: 1160 },
  /** barra de rolagem da lista, à direita dela */
  scroll: { x: 700, y: 235, w: 52, h: 1160 },

  /**
   * Painel do detalhe: um marrom translúcido sobre a cena de floresta.
   *
   * A placa não o desenha — a mata vai de ponta a ponta. Sem ele o conteúdo da
   * direita (faixas, recompensas e botões) flutuava sobre a floresta e parecia
   * fora do painel.
   *
   * Ele COBRE a cena inteira: a floresta vai de x 747 a 1718 e de y 196 a 1396
   * (medido no PNG servido, com algumas colunas indo a 1414), e o painel vai de
   * 745 a 1720 e de 194 a 1420 — passando de cada borda, para não sobrar um
   * fio de verde na emenda. Recuado 30 px, como estava, o verde aparecia em
   * volta de todo o conteúdo.
   *
   * É ele também que dá o CONTORNO: as caixas abaixo cabem todas dentro dele.
   */
  detailPanel: { x: 745, y: 194, w: 975, h: 1226 },

  /** faixa "MISSÃO EM ANDAMENTO" no alto do painel */
  detailHeader: { x: 803, y: 240, w: 859, h: 52 },
  /** cartão de pergaminho: nome, texto e objetivos */
  paper: { x: 803, y: 306, w: 859, h: 704 },
  /**
   * Faixa, quadrados e botões recuam MAIS que o pergaminho (60 px de cada
   * lado): a referência mostra esse bloco de baixo mais estreito que o texto, e
   * é esse degrau que separa a leitura da recompensa.
   */
  rewardsHeader: { x: 863, y: 1030, w: 739, h: 52 },
  rewards: { x: 863, y: 1092, w: 739, h: 140 },
  actions: { x: 863, y: 1252, w: 739, h: 86 },
} as const;

/**
 * Recuos de dentro do cartão de pergaminho, em px da arte.
 *
 * O texto da missão rola: descrição comprida é comum e esticar o cartão
 * empurraria as recompensas para fora do painel. Título e objetivos ficam
 * FIXOS (topo e base) e só o corpo rola no meio — assim o contador de objetivo,
 * que é o que o jogador confere, nunca sai da vista.
 */
export const QT_PAPER_PAD = { x: 44, top: 30, bottom: 26, gap: 22 } as const;

/** altura de uma linha da lista e o vão entre duas, em px da arte */
export const QT_ROW_ART = { h: 100, gap: 10 } as const;

/** lado de um quadrado de recompensa e o vão entre eles, em px da arte */
export const QT_REWARD_ART = { size: 140, gap: 54 } as const;

export const QT_WIDTH = windowWidth(QT_PLATE.w);

/** diâmetro do aro do "x" — o comum às janelas com arte própria */
export const QT_CLOSE_D = CHROME.closeD;

/**
 * Cores amostradas da referência, não escolhidas no olho.
 *
 * A janela tem DOIS fundos e por isso duas tintas: o painel da lista é escuro
 * (creme sobre ele) e o pergaminho do detalhe é claro (marrom sobre ele) — a
 * mesma divisão do livro de habilidades, onde a tinta é marrom porque o fundo
 * é claro.
 */
export const QT_COLORS = {
  /** linha da lista: quase preta (#211813), a selecionada um tom acima */
  row: "rgba(33,24,19,0.72)",
  rowHover: "rgba(52,40,26,0.8)",
  rowActive: "rgba(74,58,30,0.85)",
  /** texto sobre o painel escuro */
  ink: "#f2e8d2",
  inkDim: "#a99a80",
  /** texto sobre o pergaminho do detalhe */
  paperInk: "#4a3a24",
  paperInkDim: "#6f6047",
  /** título da missão no pergaminho (#617c6e medido) */
  paperTitle: "#3f5a4c",
  /** faixa clara do cabeçalho do detalhe */
  headerInk: "#e8f2ea",
  headerBand: "rgba(46,58,50,0.55)",
  /**
   * Faixa e slots das recompensas.
   *
   * Elas ficam sobre a CENA DE FLORESTA, não sobre o pergaminho, então a tinta
   * aqui é clara — o `paperInk` marrom que serve ao texto do detalhe some no
   * fundo escuro. É a mesma janela com dois fundos e duas tintas.
   */
  rewardsBand: "rgba(24,20,12,0.72)",
  rewardSlot: "rgba(20,16,9,0.72)",
  shadow: "rgba(20,12,4,0.9)",
  /** painel marrom translúcido sobre a floresta, atrás de todo o detalhe */
  detailPanel: "rgba(46,34,20,0.62)",
  /** pergaminho por cima dele, atrás do texto do detalhe */
  paper: "linear-gradient(180deg,rgba(226,213,178,0.90) 0%,rgba(214,199,161,0.88) 55%,rgba(198,183,146,0.86) 100%)",
  /** ouro do "Rastrear" (#af700a medido) e o tom aceso de quando está ativo */
  track: "rgba(150,96,10,0.92)",
  tracking: "rgba(196,132,22,0.95)",
  /** "Abandonar": fundo escuro e traço vermelho, como na referência */
  abandon: "rgba(48,20,18,0.88)",
  abandonInk: "#e2857c",
  /** miolo do aro do "x" */
  closeTint: "#8f2b20",
  /**
   * Marcador de estado da linha.
   *
   * Só dois glifos: "?" enquanto a missão não acabou e "✓" quando está pronta.
   * A cor separa disponível (dourada, chama atenção) de em andamento (apagada).
   */
  markOpen: "#e8bb54",
  markProgress: "#c8b48a",
  markDone: "#6f9a4e",
} as const;

/**
 * Estado de uma missão.
 *
 * `available` = ainda não aceita, `active` = em andamento, `done` = objetivos
 * cumpridos, falta entregar.
 *
 * Na LISTA só há dois glifos: "?" para o que ainda não acabou (disponível e em
 * andamento) e "✓" para o que está pronto. O "!" da referência não é usado —
 * pedido do projeto.
 */
export type QuestState = "available" | "active" | "done";

export interface QuestObjective {
  texto: string;
  feito: number;
  total: number;
}

export interface QuestReward {
  /**
   * "xp" e "job" desenham o rótulo; "item" desenha o nome curto.
   *
   * O tipo continua `zeny` — é o nome do campo no servidor —, mas o RÓTULO é
   * "Ouro", como no contador do inventário. Só o nome muda.
   */
  kind: "xp" | "job" | "zeny" | "item";
  label: string;
  amount?: number;
}

export interface Quest {
  id: string;
  nome: string;
  estado: QuestState;
  /** região/NPC que deu a missão — aparece sob o nome no detalhe */
  origem: string;
  nivel: number;
  descricao: string;
  objetivos: QuestObjective[];
  recompensas: QuestReward[];
}

/**
 * Missões de MOCKUP.
 *
 * O jogo ainda não tem missões próprias e as do rAthena não vão ser usadas
 * (ZC.QUEST_LIST nem é lido pelo gateway), então a janela desenha esta lista
 * enquanto o sistema de missões não existe. Está tudo num arquivo só, e o dia
 * que o servidor mandar missão de verdade é este `QUEST_MOCK` que sai —
 * nenhum componente conhece esses dados de perto.
 */
export const QUEST_MOCK: Quest[] = [
  {
    id: "lobos",
    nome: "O Cerco dos Lobos",
    estado: "active",
    origem: "Guarda Aldric · Campo de Prontera",
    nivel: 12,
    descricao:
      "A alcateia desceu da serra e não sai mais das trilhas do norte. Os mercadores pararam de passar e a vila já sente falta do sal. Vá até o campo aberto e reduza o bando antes que eles cheguem aos currais.",
    objetivos: [
      { texto: "Derrotar lobos no campo norte", feito: 6, total: 10 },
      { texto: "Recuperar o carroção saqueado", feito: 0, total: 1 },
    ],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 4800 },
      { kind: "job", label: "JOB", amount: 1200 },
      { kind: "zeny", label: "Ouro", amount: 2500 },
    ],
  },
  {
    id: "raiz",
    nome: "A Raiz Que Sussurra",
    estado: "available",
    origem: "Herborista Mira · Floresta de Elvan",
    nivel: 18,
    descricao:
      "Dizem que no fundo da mata há uma raiz que canta quando a lua está cheia. Mira quer uma amostra, mas ninguém que foi atrás dela voltou com as duas mãos. Leve uma lamparina e não escute o que ela diz.",
    objetivos: [{ texto: "Colher a raiz cantante", feito: 0, total: 1 }],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 9000 },
      { kind: "item", label: "Cajado de Teixo" },
    ],
  },
  {
    id: "ponte",
    nome: "A Ponte de Veridia",
    estado: "done",
    origem: "Mestre de Obras Corvin · Veridia",
    nivel: 9,
    descricao:
      "A enchente levou metade da ponte e o vau só dá passagem para quem não tem pressa. Corvin conseguiu a madeira, mas os pregos sumiram do depósito na mesma noite — e ele desconfia de quem guarda a chave.",
    objetivos: [
      { texto: "Entregar tábuas de carvalho", feito: 12, total: 12 },
      { texto: "Descobrir quem levou os pregos", feito: 1, total: 1 },
    ],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 2100 },
      { kind: "zeny", label: "Ouro", amount: 800 },
    ],
  },
  {
    id: "farol",
    nome: "Luz no Farol Abandonado",
    estado: "available",
    origem: "Capitã Ysolde · Enseada de Arkan",
    nivel: 24,
    descricao:
      "O farol apagou faz três invernos e desde então dois navios encalharam no recife. O zelador não responde às cartas. Suba a escada em caracol, acenda o fogo e descubra por que ninguém mais quer aquele posto.",
    objetivos: [
      { texto: "Acender o braseiro do topo", feito: 0, total: 1 },
      { texto: "Encontrar o diário do zelador", feito: 0, total: 1 },
    ],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 15000 },
      { kind: "job", label: "JOB", amount: 4200 },
      { kind: "item", label: "Manto do Zelador" },
    ],
  },
  {
    id: "sal",
    nome: "Contrabando de Sal",
    estado: "active",
    origem: "Taverneiro Bram · Cidade de Arkan",
    nivel: 15,
    descricao:
      "Alguém está trazendo sal pela estrada velha sem pagar o pedágio da guilda. Bram não se importa com o imposto, mas o carregamento passa pela adega dele à noite e ele quer saber de quem é o pé que pisa no assoalho.",
    objetivos: [
      { texto: "Vigiar a adega até a madrugada", feito: 1, total: 1 },
      { texto: "Seguir o carroceiro sem ser visto", feito: 0, total: 3 },
    ],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 6400 },
      { kind: "zeny", label: "Ouro", amount: 5000 },
    ],
  },
  {
    id: "coroa",
    nome: "A Coroa Partida",
    estado: "available",
    origem: "Arquivista Toma · Biblioteca Real",
    nivel: 32,
    descricao:
      "A coroa do primeiro rei foi partida em três e cada pedaço ficou com uma casa. Duas devolveram a parte quando o trono pediu. A terceira jura que nunca teve nada — e o inventário da própria casa diz o contrário.",
    objetivos: [{ texto: "Recuperar o terceiro fragmento", feito: 0, total: 1 }],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 42000 },
      { kind: "job", label: "JOB", amount: 11000 },
      { kind: "item", label: "Selo da Casa Velha" },
    ],
  },
  {
    id: "poco",
    nome: "O Poço Que Não Enche",
    estado: "active",
    origem: "Anciã Neve · Vila de Pedravale",
    nivel: 7,
    descricao:
      "O poço da praça secou numa semana de chuva. Neve diz que não é falta de água, é excesso de alguma outra coisa lá embaixo. Ela pede que alguém desça com corda, e faz questão de que seja alguém que saiba nadar.",
    objetivos: [{ texto: "Descer ao fundo do poço", feito: 0, total: 1 }],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 1500 },
      { kind: "item", label: "Corda Trançada" },
    ],
  },
  {
    id: "ferreiro",
    nome: "O Último Encargo do Ferreiro",
    estado: "done",
    origem: "Ferreiro Halvard · Forja de Pedravale",
    nivel: 21,
    descricao:
      "Halvard não bate mais no ferro desde que a mão travou, mas tem um encargo pendente de vinte anos atrás e não quer morrer devendo. A lâmina está pronta pela metade; falta o têmpero, e o têmpero pede fogo de montanha.",
    objetivos: [
      { texto: "Trazer brasa do Monte Cinzento", feito: 1, total: 1 },
      { texto: "Assistir ao têmpero da lâmina", feito: 1, total: 1 },
    ],
    recompensas: [
      { kind: "xp", label: "EXP", amount: 19500 },
      { kind: "item", label: "Lâmina de Halvard" },
    ],
  },
];
