/**
 * Telas de ENTRADA — `/login` e `/char-select`.
 *
 * As duas usam a mesma cena pintada de fundo. A moldura de folhagem dos painéis
 * é a MOLDURA DO CHAT: os quatro cantos de `ui_definitiva/login` são byte a byte
 * (md5 conferido) os de `public/assets/ui/chat/`, e o mesmo vale para
 * `ring-level`, `tab-off`, `button-plus-add-tab-chat` e as peças da rolagem. Do
 * pacote inteiro só DOIS arquivos entraram no repo: o fundo e a seta.
 *
 * O fundo é **JPEG**, e é a única imagem do projeto que não é PNG: ela não tem
 * alpha (medido: 3 canais) e é uma pintura de tela cheia, onde o PNG com paleta
 * dava 1.055 KB contra 523 KB do JPEG na mesma qualidade. Todo o resto da UI é
 * PNG porque precisa de recorte; esta não precisa.
 */

const BASE = "/assets/ui/login";

export const LOGIN_ART = {
  /** cena pintada — vale para as duas telas */
  background: `${BASE}/background.jpg`,
  /** seta de voltar; o desenho aponta para a ESQUERDA */
  back: `${BASE}/button-arrow-left.png`,
} as const;

/**
 * Tamanho NATIVO da pintura. É dele que sai a proporção do palco.
 *
 * O fundo era desenhado com `cover`, o que AMPLIAVA e cortava a arte para
 * preencher qualquer janela — o "zoom in" do relato. Agora a cena entra inteira
 * (`contain`, via a proporção deste palco) e o que sobra nas laterais é
 * preenchido com escuro. É o "deixa normal, estende só se for necessário".
 */
export const LOGIN_ART_SIZE = {
  background: { w: 1536, h: 1024 },
  back: { w: 22, h: 39 },
} as const;

export const LOGIN_RATIO = LOGIN_ART_SIZE.background.w / LOGIN_ART_SIZE.background.h;

/**
 * TODA medida destas telas é em % do PALCO, nunca em px de tela.
 *
 * As placas de região precisam cair sobre o vulcão, as pirâmides, o gelo e os
 * templos da pintura — em px elas se desgarrariam da arte na primeira janela de
 * tamanho diferente. `u(n)` devolve `n` centésimos da largura do palco, e é a
 * unidade de tudo: fonte, recuo, espessura de borda.
 */
export const u = (n: number) => `calc(var(--palco) * ${n})`;

/**
 * As quatro regiões, ancoradas na pintura.
 *
 * `x`/`y` são o CANTO de referência em % do palco, e `lado` diz de que borda
 * eles são medidos — as da direita ancoram por `right` para a coluna de placas
 * ficar alinhada mesmo com nomes de larguras diferentes, que é o que a
 * referência mostra.
 */
export const LOGIN_REGIOES = [
  {
    nome: "Valthera",
    lenda: "Terra das Areias e das Fortalezas",
    simbolo: "sol",
    lado: "esq",
    x: 2.4,
    y: 18.6,
  },
  {
    nome: "Kaishan",
    lenda: "Terra dos Imperadores e dos Templos",
    simbolo: "dragao",
    lado: "dir",
    x: 2.4,
    y: 18.6,
  },
  {
    nome: "Eryndor",
    lenda: "Coração do Império e da Civilização",
    simbolo: "leao",
    lado: "esq",
    x: 2.4,
    y: 45.9,
  },
  {
    nome: "Nayrath",
    lenda: "Terra do Gelo e das Lendas Antigas",
    simbolo: "floco",
    lado: "dir",
    x: 2.4,
    y: 45.9,
  },
] as const;

/**
 * Onde o painel de login fica, medido na referência.
 *
 * A LARGURA é em `u()` (centésimos da largura do palco), porque é uma medida
 * horizontal. A posição vertical não está aqui: o painel é CENTRADO na tela,
 * que é o pedido — âncora fixa o deixava baixo demais em janela larga.
 */
export const LOGIN_FORM = { largura: 26 } as const;

export type LoginRegiao = (typeof LOGIN_REGIOES)[number];

/**
 * Os atalhos do rodapé.
 *
 * `href` vazio quer dizer que o destino ainda não existe — e nesse caso o botão
 * não vira link: um `<a>` para lugar nenhum promete uma página que não há. Ver
 * `LoginLinks`.
 */
export const LOGIN_LINKS = [
  { chave: "site", rotulo: "Site Oficial", icone: "globo", href: "" },
  { chave: "discord", rotulo: "Discord", icone: "discord", href: "" },
  { chave: "noticias", rotulo: "Notícias", icone: "pergaminho", href: "" },
  { chave: "suporte", rotulo: "Suporte", icone: "escudo", href: "" },
] as const;

/** classificação indicativa, no canto inferior-esquerdo */
export const LOGIN_RATING = {
  idade: "12",
  descritores: ["Violência Fantasia", "Interação de Usuários"],
  rodape: "Classificação Indicativa",
  /**
   * Amarelo do 12 anos, do sistema brasileiro (ClassInd).
   *
   * Cada faixa tem a SUA cor e elas significam coisa: verde é livre, azul 10,
   * amarelo 12, laranja 14, vermelho 16, preto 18. Escolher outro tom faria a
   * placa dizer uma faixa diferente da que está escrita nela.
   */
  cor: "#f2c200",
} as const;

/** a epígrafe do canto inferior-direito */
export const LOGIN_EPIGRAFE = {
  texto: "Impérios nascem da ambição, mas sobrevivem pela glória.",
  fonte: "Crônicas de Asterion",
} as const;

export const LOGIN_TITULO = {
  nome: ["Império", "Antigo"],
  /**
   * A linha entre o nome e a chamada.
   *
   * Era "2500+ AC" — uma data que não diz nada sobre o jogo e ainda amarra a
   * ambientação a um ano. "A Era de Asterion" amarra ao que a própria tela já
   * cita na epígrafe ("Crônicas de Asterion"): as duas passam a falar do mesmo
   * mundo, e o nome vira coisa do jogo em vez de enfeite.
   */
  era: "A Era de Asterion",
  chamada: "Quatro Continentes. Um Império. Sua Lenda.",
} as const;

/**
 * A tipografia do TÍTULO — capitulares romanas, não a serifa de texto.
 *
 * O resto da UI usa Georgia (`FRAME_FONT`), que é uma serifa de LEITURA: ela
 * tem contraste baixo e formas arredondadas, boas para parágrafo e péssimas para
 * um nome gravado em pedra. A pilha aqui procura as titulares clássicas que o
 * Windows costuma ter, na ordem do mais próximo de uma inscrição romana para o
 * mais comum — e cai em Georgia no fim, para nunca ficar sem serifa.
 *
 * Sem webfont de propósito: seria um arquivo novo no repo e uma licença a
 * carregar, por um texto de duas palavras que aparece numa tela só.
 */
export const LOGIN_TITLE_FONT =
  '"Trajan Pro", "Perpetua Titling MT", "Copperplate Gothic Bold", "Palatino Linotype", "Book Antiqua", Constantia, Georgia, serif';

/**
 * Escala da moldura de folhagem nos painéis destas telas.
 *
 * O chat usa 0,5 numa caixa de ~420 px. Aqui o painel de personagens passa de
 * 800 e, na mesma escala, a folhagem viraria um fio em volta de um vão enorme —
 * a arte tem cantos DESENHADOS (não é 9-slice), e o que dá a leitura deles é o
 * tamanho.
 */
export const LOGIN_FRAME_SCALE = 0.72;

/** largura do painel de personagens (o de login é medido em % do palco) */
export const LOGIN_PANEL = { charW: 900 } as const;

/**
 * A paleta destas telas.
 *
 * O dourado sai da própria pintura (as bandeiras e os braseiros da varanda), e
 * é ele que costura título, placas e molduras. O painel precisa de um véu por
 * baixo do texto: sem ele a cena passa por trás das letras e nada se lê.
 */
export const LOGIN_COLORS = {
  /** véu dos painéis e das placas */
  panel: "rgba(14,11,8,0.86)",
  /** campo de digitar, um degrau mais escuro que o painel */
  field: "rgba(8,6,4,0.78)",
  ink: "#f4ecd8",
  inkDim: "#c9bb9c",
  inkFaint: "#8f8368",
  shadow: "rgba(12,7,2,0.95)",
  /** o dourado das bordas e do título */
  gold: "#c9a227",
  goldSoft: "rgba(201,162,39,0.55)",
  goldFaint: "rgba(201,162,39,0.22)",
  /** botão de ENTRAR — o vinho da capa do imperador na pintura */
  entrar: "#6d1f1c",
  entrarBorda: "#a8452f",
  /** botão de CRIAR CONTA — o azul das bandeiras */
  criar: "#1c2c52",
  criarBorda: "#3f5c96",
  /** vermelho do aviso de erro */
  danger: "#e0524a",
} as const;
