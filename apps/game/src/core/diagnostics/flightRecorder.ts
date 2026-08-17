/**
 * FLIGHT RECORDER — a caixa-preta do cliente (DEV).
 *
 * Existe por um motivo só, e ele é de CORRELAÇÃO. O projeto já tinha duas
 * medidas: `net/movDebug` conta eventos de movimento e `scene/perfProbe` mede o
 * quadro. Nenhuma das duas consegue pôr duas séries lado a lado no MESMO
 * instante — e o defeito que se persegue ("andando longe, o personagem trava,
 * volta algumas células e segue") é justamente um cruzamento: rede × predição ×
 * reconciliação × chunk × quadro longo. Contador agregado não responde "o que
 * mais estava acontecendo quando ele recuou".
 *
 * Aqui grava-se uma LINHA POR QUADRO num anel, e quando um gatilho dispara
 * (hoje: o desenho recuar mais de uma célula) a janela em volta dele —
 * `QUADROS_ANTES` antes e `QUADROS_DEPOIS` depois — é copiada para um "caso",
 * com todos os eventos do intervalo. É o que transforma o relato numa linha do
 * tempo.
 *
 * ## O que este módulo NÃO faz, de propósito
 *
 * Não conhece o jogo. Nenhum import de `net/`, `grid/`, `play/` ou `hud/`: ele
 * recebe números e strings, nunca um `SelfMotion` ou um `GameMap`. Quem sabe o
 * que significa cada coluna é o CHAMADOR. É isso que o deixa reaproveitável
 * para o próximo bug (combate, IA, streaming) sem virar uma refatoração agora.
 *
 * E não altera nada: ele só observa. Nenhuma condição do movimento lê o que se
 * escreve aqui.
 *
 * ## Duas regras que não são detalhe
 *
 * 1. **Custo zero em produção.** Todo ponto de entrada abre com
 *    `if (!ativo()) return`, e `ativo()` começa por `import.meta.env.DEV` — que
 *    o Vite substitui por `false` no build, deixando o corpo morrer no
 *    tree-shake. Mesmo mecanismo do `movDebug` e do `PerfProbe`.
 * 2. **O gravador não pode causar o defeito que mede.** Um objeto por quadro
 *    seriam ~60 alocações por segundo alimentando exatamente a pressão de GC
 *    que ele existe para acusar. Por isso o quadro vai em colunas
 *    (`Float64Array` alocadas UMA vez) e a linha é escrita num objeto de
 *    rascunho compartilhado (`quadro()`), copiado campo a campo. Objeto só no
 *    anel de EVENTOS, que é raro.
 */

/** quantos quadros o anel guarda (~30 s a 60 FPS) */
export const CAP_QUADROS = 1800;
/** quantos eventos o anel guarda */
export const CAP_EVENTOS = 512;
/** quadros preservados ANTES do gatilho */
export const QUADROS_ANTES = 300;
/** quadros gravados DEPOIS do gatilho */
export const QUADROS_DEPOIS = 120;
/** quantos casos ficam na memória (o mais antigo sai) */
export const MAX_CASOS = 4;

/**
 * Prazo de parede para uma captura fechar, mesmo sem quadro nenhum.
 *
 * Uma captura só fechava depois de `QUADROS_DEPOIS` chamadas de
 * `confirmarQuadro()` — e o caso que mais importa numa investigação de render é
 * justamente aquele em que o QUADRO PARA: perder o contexto WebGL do canvas do
 * jogo congela o laço, o "depois" nunca chega e o JSON sai sem o caso que se
 * acabou de provocar. Passado o prazo, fecha-se com o que houver.
 */
export const LIMITE_CAPTURA_MS = 2000;

/**
 * `render` é propriedade do QUADRO (o marco `quadro-longo`, o próprio
 * `gatilho`); `renderer` é o ciclo de vida do DEVICE (contexto, canvas,
 * renderer, shader, textura). São coisas diferentes e por isso são duas
 * categorias — juntá-las faria "render/…" querer dizer as duas.
 */
export type Categoria =
  | "network"
  | "prediction"
  | "reconciliation"
  | "chunks"
  | "render"
  | "renderer"
  | "cena"
  /** ciclo de vida do VFX de skill (start/end/mount/unmount) — ver `core/diagnostics/vfxProbe.ts` */
  | "vfx"
  /** achados de custo ATRIBUÍDOS a VFX ativo (longtask correlacionada, spike, crescimento de DOM) */
  | "vfx-performance";

/**
 * Quem escreveu o trecho de movimento em vigor.
 *
 * Guardado como número porque a coluna é `Float64Array` — texto não entra em
 * anel de tamanho fixo sem alocar. A tradução de volta acontece só na
 * exportação, onde custo não importa.
 */
export const CAUSAS = ["", "predicao", "servidor", "fixpos", "snap"] as const;
export type Causa = (typeof CAUSAS)[number];

export function codigoDaCausa(c: string | undefined): number {
  const i = CAUSAS.indexOf((c ?? "") as Causa);
  return i < 0 ? 0 : i;
}

/**
 * Uma linha de quadro.
 *
 * Todos os campos são numéricos — é o que permite guardá-los em colunas de
 * tamanho fixo. Booleano vai como 0/1 e texto vira código (ver `CAUSAS`).
 *
 * Os campos são escritos por TRÊS chamadores diferentes (o `NetPlayer` põe
 * movimento, o `PerfProbe` põe quadro/desenho, o `SquareTerrain` põe chunk), e é
 * por isso que o rascunho PERSISTE entre quadros: quem escreve esporadicamente
 * (a posição que o servidor mandou, por exemplo) deixa o último valor conhecido
 * valendo, em vez de zerar a coluna nos quadros em que não chegou pacote. As
 * únicas exceções são os acumuladores de chunk, zerados a cada `confirmarQuadro`
 * porque eles descrevem o quadro e não um estado.
 */
export interface LinhaQuadro {
  t: number;
  quadro: number;
  /** ver `novaCaminhada` */
  walkId: number;
  /** qual trecho DENTRO da caminhada (0, 1, 2… — a emenda incrementa) */
  trechoSeq: number;

  /** desvio estimado para o relógio do map-server (`NaN` = ainda sem estimativa) */
  tickServidor: number;

  /** posição DESENHADA, em unidades de mundo */
  renderX: number;
  renderZ: number;
  /** posição LÓGICA (célula fracionária interpolada) */
  logicoX: number;
  logicoY: number;
  movendo: number;

  /** destino do trecho em vigor */
  destinoX: number;
  destinoY: number;
  /** 1 = trecho previsto pelo cliente, ainda não confirmado */
  predito: number;
  /** ver `CAUSAS` */
  causa: number;

  /** célula que o SERVIDOR mandou no último pacote de movimento */
  servidorX: number;
  servidorY: number;

  /** pedidos previstos ainda não reconhecidos */
  filaPredicao: number;
  /** 1 = há `move:to` esperando resposta */
  pedidoNoAr: number;
  /** 1 = a caminhada ainda tem trecho a pedir */
  temDestinoFinal: number;

  /** ida e volta medida entre `move:to` e o `self:move` que casa por destino */
  rttMedido: number;
  /** intervalo desde o pacote de movimento anterior */
  dtEntreSnapshots: number;

  quadroMs: number;
  drawCalls: number;
  triangulos: number;

  /**
   * O DEVICE — escrito pelo `PerfProbe` a partir de `gl.info` e do
   * `core/diagnostics/rendererProbe`.
   *
   * Como `drawCalls`/`triangulos`, `renderMs` e `gpuMs` descrevem o quadro
   * ANTERIOR: eles são lidos no começo do quadro, e o render daquele quadro
   * ainda não aconteceu.
   */
  geometrias: number;
  programas: number;
  texturas: number;
  /** tempo de CPU dentro de `gl.render` (somado — o composer chama mais de uma vez) */
  renderMs: number;
  /** tempo de GPU do quadro (`EXT_disjoint_timer_query_webgl2`); `NaN` sem a extensão */
  gpuMs: number;
  /** memória de GPU, só quando a extensão `GMAN_webgl_memory` existe; `NaN` senão */
  memoriaGpuMb: number;
  /** heap de JS (`performance.memory`, só no Chrome) — NÃO é memória de GPU */
  heapMb: number;
  /** quantos contextos WebGL estão vivos (o jogo + cada retrato do HUD) */
  contextosVivos: number;
  /** geração do renderer do jogo — muda quando ele é recriado */
  rendererId: number;

  /**
   * A ÁRVORE DA CENA — escrita pelo `core/diagnostics/cenaProbe`.
   *
   * O device pode estar perfeito e o mundo sumir mesmo assim: basta o
   * `<Suspense>` re-suspender, porque o R3F ESCONDE os filhos do boundary
   * (`hideInstance` → `object.visible = false`) em vez de desmontá-los. Aí os
   * draw calls vão a zero com a geometria toda ainda alocada, que é uma
   * assinatura que nenhuma coluna de `renderer` distingue de "cena vazia".
   */
  sceneFilhos: number;
  /** 1 = `scene.visible`; é a leitura direta do `hideInstance` do R3F */
  sceneVisivel: number;
  /** malhas visíveis com geometria — AMOSTRADO a 10 Hz (ver `cenaProbe`) */
  objetosRender: number;
  cameraId: number;
  /** 1 = matrizes finitas e `near < far` */
  cameraOk: number;
  /** chunks de terreno construídos e retidos no cache do `SquareTerrain` */
  chunksNoCache: number;
  /** props dentro do culling (`visibleProps.length`) */
  propsVisiveis: number;
  /** acumulados desde o `limpar()` — degrau na série = aconteceu ali */
  suspensoes: number;
  desmontagensCena: number;
  /** requisições de loader começadas e ainda não terminadas */
  assetsEmVoo: number;
  /** 0 fora de suspensão; ms desde que um boundary caiu no fallback */
  suspensoMs: number;

  /**
   * ONDE O QUADRO LONGO GASTOU — três acumuladores, zerados a cada quadro.
   *
   * Existem para partir o custo em pedaços que se possam ATRIBUIR. Um
   * `frameLongo` de 378 ms com chunks, props e draw calls inalterados
   * (`voo-1785938553239.json`) não diz de onde veio; com estas três colunas, a
   * conta fecha ou sobra — e o que sobra é do React ou do coletor, que é
   * justamente a distinção que não dava para fazer.
   */
  contextoMs: number;
  descarteMs: number;
  modeloMs: number;
  /** trabalho síncrono medido por `medir()` — hoje, o caminho de TROCA DE MAPA */
  trocaMs: number;
  /**
   * `AnimationMixer.update` de TODAS as entidades, somado.
   *
   * Fica FORA de `gl.render`, então SOMA ao `renderMs` — os dois juntos são o
   * custo de CPU do quadro.
   */
  animacaoMs: number;
  /**
   * `scene.updateMatrixWorld` — a descida recursiva inteira, uma medida só.
   *
   * Está DENTRO de `gl.render`, então é SUBCONJUNTO do `renderMs` e **não pode
   * ser somado a ele**. É o número que diz quanto custa a população de nós da
   * cena, que é a pergunta do instancing dos props.
   */
  matrizMs: number;

  /**
   * O que SOBRA depois de atribuir tudo que se sabe medir.
   *
   * `sobra = quadroMs - renderMs - animacaoMs - contextoMs - descarteMs -
   * modeloMs - trocaMs`. Não é acumulador: é recalculada TODO quadro em cima
   * das colunas que acabaram de ser escritas (fim do `useFrame` de
   * `PerfProbe`, depois de `amostrarContadores`), então ela sempre descreve o
   * quadro que fechou, nunca soma entre quadros.
   *
   * `renderMs` e `animacaoMs` são custo de CPU que FICA FORA de `gl.render`
   * mas soma a ele (ver comentário de `animacaoMs`); `contextoMs`/
   * `descarteMs`/`modeloMs`/`trocaMs` são os três suspeitos de churn de
   * device já nomeados. Não subtrai `matrizMs`: ele é SUBCONJUNTO de
   * `renderMs`, e tirar os dois contaria a matriz duas vezes. O que sobra
   * depois disso é React (commit, reconciliação) ou o coletor de lixo do
   * motor — nenhum dos dois tem coluna própria, e não é este módulo quem
   * decide qual dos dois foi. `heapDeltaMb` ao lado é o único sinal que
   * ajuda a decidir: sobra grande com queda de heap é candidato a GC; sobra
   * grande sem queda de heap não é.
   */
  sobraMs: number;
  /**
   * Heap de JS deste quadro menos o do quadro anterior (`performance.memory`,
   * só Chrome). Negativo = heap caiu = coletor pode ter rodado; positivo =
   * heap cresceu = alocação, não coleta. `NaN` fora do Chrome ou no primeiro
   * quadro da sessão (não há "anterior" ainda) — lacuna honesta, não zero.
   */
  heapDeltaMb: number;

  /** acumuladores do quadro — zerados em `confirmarQuadro` */
  chunksConstruidos: number;
  msDeChunk: number;
  /** estado, não acumulador */
  filaDeChunks: number;
  chunksVisiveis: number;

  /**
   * VFX de skill — escrito pelo `core/diagnostics/vfxProbe.ts`.
   *
   * Os VFX de skill são DOM/CSS (`drei <Html>`), não three.js — `drawCalls`/
   * `triangulos`/`geometrias` deste mesmo quadro continuam valendo (eles
   * medem o device), mas não atribuem nada a uma skill. Estas colunas são o
   * lado DOM/CSS que faltava: quantos VFX estão vivos, quanto o portal de
   * Html cresceu, e long task correlacionada — tudo NUMÉRICO, como o resto
   * do rascunho; o detalhe "QUAL skill" mora nos eventos `vfx/start` e
   * `vfx/end` (ver `Evento.dados`), não em coluna nenhuma.
   */
  vfxAtivos: number;
  /**
   * Portais `<Html>` sob o container do canvas (`gl.domElement.parentNode`),
   * RELATIVO a uma baseline capturada quando `vfxAtivos` esteve em 0 pela
   * última vez. `target.children.length` é leitura O(1) — sem
   * `querySelectorAll`, então cabe todo quadro sem custo de varredura.
   * Inclui outros overlays do MESMO container (números de dano, rótulos de
   * entidade) — não é exclusivo de VFX, ver docblock de `vfxProbe.ts`.
   */
  vfxHtmlCount: number;
  /**
   * Nós DOM totais sob o mesmo container, relativo à mesma baseline —
   * AMOSTRADO a ~10 Hz (mesma técnica de `objetosRender`/`PASSO_DA_VARREDURA`
   * do `cenaProbe`), nunca por quadro: é uma varredura de verdade
   * (`querySelectorAll("*")`), só que escopada ao container de Html em vez
   * do documento inteiro.
   */
  vfxDomNodeCount: number;
  /** long tasks (PerformanceObserver) que caíram com ≥1 VFX ativo — acumulador do quadro */
  vfxLongTaskCount: number;
  vfxLongTaskMs: number;
  /** nós adicionados+removidos (MutationObserver, só enquanto `vfxAtivos>0`) — acumulador do quadro */
  vfxMutacoes: number;
}

const CAMPOS: (keyof LinhaQuadro)[] = [
  "t",
  "quadro",
  "walkId",
  "trechoSeq",
  "tickServidor",
  "renderX",
  "renderZ",
  "logicoX",
  "logicoY",
  "movendo",
  "destinoX",
  "destinoY",
  "predito",
  "causa",
  "servidorX",
  "servidorY",
  "filaPredicao",
  "pedidoNoAr",
  "temDestinoFinal",
  "rttMedido",
  "dtEntreSnapshots",
  "quadroMs",
  "drawCalls",
  "triangulos",
  "geometrias",
  "programas",
  "texturas",
  "renderMs",
  "gpuMs",
  "memoriaGpuMb",
  "heapMb",
  "contextosVivos",
  "rendererId",
  "sceneFilhos",
  "sceneVisivel",
  "objetosRender",
  "cameraId",
  "cameraOk",
  "chunksNoCache",
  "propsVisiveis",
  "suspensoes",
  "desmontagensCena",
  "assetsEmVoo",
  "suspensoMs",
  "contextoMs",
  "descarteMs",
  "modeloMs",
  "trocaMs",
  "animacaoMs",
  "matrizMs",
  "sobraMs",
  "heapDeltaMb",
  "chunksConstruidos",
  "msDeChunk",
  "filaDeChunks",
  "chunksVisiveis",
  "vfxAtivos",
  "vfxHtmlCount",
  "vfxDomNodeCount",
  "vfxLongTaskCount",
  "vfxLongTaskMs",
  "vfxMutacoes",
];

/** os acumuladores: descrevem o quadro, então voltam a zero depois de gravados */
const ACUMULADORES: (keyof LinhaQuadro)[] = [
  "chunksConstruidos",
  "msDeChunk",
  // os três de custo do quadro: descrevem o QUADRO, não um estado, então não
  // podem vazar para o quadro seguinte como o resto do rascunho faz
  "contextoMs",
  "descarteMs",
  "modeloMs",
  "trocaMs",
  "animacaoMs",
  "matrizMs",
  // long task/mutação correlacionadas a VFX: descrevem o QUADRO (quanto caiu
  // NELE), não um estado — mesma razão dos três de cima
  "vfxLongTaskCount",
  "vfxLongTaskMs",
  "vfxMutacoes",
];

function linhaVazia(): LinhaQuadro {
  const l = {} as LinhaQuadro;
  for (const c of CAMPOS) l[c] = 0;
  l.tickServidor = NaN;
  l.rttMedido = NaN;
  // "não medido" não é zero: sem a extensão de timer não há tempo de GPU, e sem
  // a de memória não há bytes. Zero ali seria um número inventado — o
  // `arredondar` do despejo transforma NaN em `null`, que é a lacuna honesta.
  l.gpuMs = NaN;
  l.memoriaGpuMb = NaN;
  l.heapMb = NaN;
  l.heapDeltaMb = NaN;
  return l;
}

export interface Evento {
  t: number;
  cat: Categoria;
  tipo: string;
  walkId: number;
  /** quadro global em que ele aconteceu, para casar com a linha */
  quadro: number;
  dados?: Record<string, unknown>;
}

export interface Caso {
  motivo: string;
  valor: number;
  /** instante do gatilho (`performance.now`) — as linhas do tempo são relativas a ele */
  t0: number;
  quadroGatilho: number;
  walkId: number;
  quadros: LinhaQuadro[];
  eventos: Evento[];
}

// ---------------------------------------------------------------- estado

const colunas = new Map<keyof LinhaQuadro, Float64Array>();
for (const c of CAMPOS) colunas.set(c, new Float64Array(CAP_QUADROS));

let escrita = 0;
/** quadros gravados desde o `limpar()` — é o índice GLOBAL, não o do anel */
let totalQuadros = 0;

const eventos: Evento[] = [];
let escritaEvento = 0;

const rascunho = linhaVazia();

let casos: Caso[] = [];
/** captura em andamento: quantos quadros ainda faltam depois do gatilho */
let capturaPendente: {
  motivo: string;
  valor: number;
  t0: number;
  quadro: number;
  /** a caminhada em vigor NO GATILHO — ela pode ter mudado até a captura fechar */
  walkId: number;
  faltam: number;
  /** instante de parede em que ela fecha mesmo sem quadro (ver `LIMITE_CAPTURA_MS`) */
  prazo: number;
} | null = null;
/** o relógio que fecha a captura quando NENHUM quadro vem (contexto perdido) */
let timerDoPrazo: ReturnType<typeof setTimeout> | null = null;

let caminhadaAtual = 0;
let ligadoPorFlag = true;

/**
 * Alguém chamou `confirmarQuadro()` desde o último `abrirQuadro()`?
 *
 * Quem fecha a linha é o `NetPlayer`, e ele só monta COM SESSÃO. Numa
 * investigação de render isso é um buraco: no preview do editor, num mapa sem
 * cena 3D ou na tela de erro o anel simplesmente não gira. `abrirQuadro()`
 * fecha a linha anterior quando ninguém a fechou — e este booleano é o que
 * impede a linha de ser gravada duas vezes quando o dono ESTÁ lá.
 *
 * Nasce VERDADEIRO: no primeiro `abrirQuadro()` da sessão não existe linha
 * anterior, e fechá-la gravaria um quadro todo zerado na frente do anel.
 */
let fechadoPeloDono = true;

// ---------------------------------------------------------------- flag

const CHAVE = "ragnarok:voo";

/**
 * A escolha vale desde a tela de LOGIN e sobrevive à navegação.
 *
 * Mesma lição do `net/pingSimulado`: o socket nasce no login, então um
 * `?voo=1` posto só na URL do `/play` chegaria tarde para metade da sessão.
 * Guardar no `localStorage` resolve, e `?voo=0` limpa.
 */
function lerFlagGuardada(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const url = new URLSearchParams(window.location.search).get("voo");
    if (url === "1" || url === "0") {
      const v = url === "1";
      localStorage.setItem(CHAVE, v ? "1" : "0");
      return v;
    }
    const guardado = localStorage.getItem(CHAVE);
    return guardado === null ? true : guardado === "1";
  } catch {
    return true;
  }
}

function gravarFlag(v: boolean): void {
  ligadoPorFlag = v;
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAVE, v ? "1" : "0");
  } catch {
    /* modo privado / cota cheia: a flag não vale uma exceção */
  }
}

/**
 * Está gravando?
 *
 * `import.meta.env.DEV` PRIMEIRO, e por isso a expressão inteira vira
 * `false && …` no build de produção — o compilador então descarta o corpo de
 * quem chama.
 */
export function ativo(): boolean {
  return import.meta.env.DEV && ligadoPorFlag;
}

export function ligar(): void {
  gravarFlag(true);
}

export function desligar(): void {
  gravarFlag(false);
}

// ---------------------------------------------------------------- gatilhos

export type NomeGatilho =
  | "rollback"
  | "frameLongo"
  | "trocaDeChunk"
  | "perdaDeSnapshot"
  | "rttAlto"
  | "contextoPerdido"
  | "rendererRecriado"
  | "mundoVazio"
  | "vfxPerformanceSpike"
  | "manual";

export interface Gatilho {
  ligado: boolean;
  /** dispara quando o valor observado PASSA disto */
  limiar: number;
  descricao: string;
}

/**
 * Os gatilhos são uma TABELA, não um `if` espalhado.
 *
 * Só o `rollback` (e o manual) entram ligados nesta fase — é o defeito que se
 * persegue. Os outros já existem declarados porque o custo de declará-los é
 * zero e o de voltar aqui no meio da próxima investigação não é: com a tabela,
 * o suspeito seguinte entra com `__voo.gatilho("frameLongo", true)` no console,
 * sem recompilar nem tocar no gravador.
 */
const gatilhos: Record<NomeGatilho, Gatilho> = {
  rollback: { ligado: true, limiar: 1, descricao: "o desenho recuou mais de N células dentro do mesmo trecho" },
  /**
   * 200 ms, e não os 50 de antes.
   *
   * Em 50 a carga de mapa dispara na primeira dezena de quadros e queima os
   * quatro slots de caso antes de o jogador andar — e um gatilho que só pega o
   * começo da sessão não pega defeito nenhum. 200 é engasgo que o jogador SENTE.
   */
  frameLongo: { ligado: true, limiar: 200, descricao: "quadro acima de N ms" },
  trocaDeChunk: { ligado: false, limiar: 0, descricao: "o centro de visão mudou de chunk" },
  perdaDeSnapshot: { ligado: false, limiar: 250, descricao: "buraco de N ms entre pacotes de movimento" },
  rttAlto: { ligado: false, limiar: 300, descricao: "ida e volta acima de N ms" },
  contextoPerdido: { ligado: true, limiar: 0, descricao: "webglcontextlost em qualquer canvas" },
  /**
   * O valor observado é a GERAÇÃO do renderer, então a primeira (1) não passa
   * do limiar e só a RECRIAÇÃO dispara. Quem decide se vale a pena disparar é o
   * `rendererProbe` (só o canvas do jogo, e só quando o anterior viveu de
   * verdade — ver `VIDA_MINIMA_MS` lá).
   */
  rendererRecriado: { ligado: true, limiar: 1, descricao: "o renderer do jogo foi recriado (geração > N)" },
  /**
   * O mundo 3D sumiu por um quadro.
   *
   * Quem observa (`cenaProbe`) relata a TRANSIÇÃO de "desenhava" para "não
   * desenha", nunca o valor cru: durante a tela de carregamento a cena é
   * apagada DE PROPÓSITO (`OcultarCena`), e um gatilho por valor dispararia
   * 60×/s ali, queimando os quatro slots antes de o jogo começar.
   */
  mundoVazio: { ligado: true, limiar: 0, descricao: "os draw calls caíram para zero com a cena montada" },
  /**
   * `frameLongo` (200 ms) já pega o engasgo GERAL; este é mais sensível
   * (33 ms — um quadro perdido a 30 FPS) mas só dispara com VFX de skill
   * ATIVO — separa "o jogo engasgou" de "o VFX que acabou de nascer
   * engasgou". Avaliado por `core/diagnostics/vfxProbe.ts`, não aqui: o
   * gravador não sabe o que é VFX, só recebe o valor (ms) e os dados
   * (skills ativas) prontos.
   */
  vfxPerformanceSpike: { ligado: true, limiar: 33, descricao: "quadro acima de N ms com ≥1 VFX de skill ativo" },
  manual: { ligado: true, limiar: 0, descricao: "pedido pelo console" },
};

export function configurarGatilho(nome: NomeGatilho, ligado: boolean, limiar?: number): void {
  const g = gatilhos[nome];
  if (!g) return;
  g.ligado = ligado;
  if (typeof limiar === "number") g.limiar = limiar;
}

export function estadoDosGatilhos(): Record<NomeGatilho, Gatilho> {
  return JSON.parse(JSON.stringify(gatilhos)) as Record<NomeGatilho, Gatilho>;
}

/**
 * Um gatilho observou um valor. Dispara se estiver ligado e o valor passar do
 * limiar.
 *
 * Quem chama não decide se captura — só relata o que mediu. É o que mantém o
 * critério num lugar só.
 */
export function avaliarGatilho(nome: NomeGatilho, valor: number, dados?: Record<string, unknown>): void {
  if (!ativo()) return;
  const g = gatilhos[nome];
  if (!g || !g.ligado || !(valor > g.limiar)) return;
  dispararCaptura(nome, valor, dados);
}

/**
 * Congela a janela em volta de agora.
 *
 * Os `QUADROS_ANTES` já estão no anel — é por isso que o recorder grava o tempo
 * todo em vez de começar a gravar quando o problema aparece: no instante em que
 * o rollback é percebido, o que interessa já aconteceu.
 *
 * Uma captura em andamento não é substituída por outra: o segundo disparo é
 * quase sempre o eco do primeiro (o mesmo solavanco em dois quadros seguidos), e
 * trocar a janela perderia o começo do caso.
 */
export function dispararCaptura(motivo: string, valor = 0, dados?: Record<string, unknown>): void {
  if (!ativo() || capturaPendente) return;
  /**
   * O gatilho dispara DENTRO do quadro, antes de ele ser confirmado — então o
   * instante certo é o `t` do rascunho (que o chamador já escreveu no começo do
   * `useFrame`), não o do último quadro gravado, que é o anterior.
   */
  const t0 = rascunho.t > 0 ? rascunho.t : agoraMs();
  capturaPendente = {
    motivo,
    valor,
    t0,
    quadro: totalQuadros,
    walkId: rascunho.walkId,
    faltam: QUADROS_DEPOIS,
    prazo: agoraMs() + LIMITE_CAPTURA_MS,
  };
  /**
   * O relógio é a rede de segurança do caso EM QUE O QUADRO PARA.
   *
   * `confirmarQuadro()` também confere o prazo, mas ele só roda se houver
   * quadro — e perder o contexto WebGL congela o laço. Sem este `setTimeout` a
   * captura do `contextoPerdido`, que é a razão de ele existir, nunca fecharia.
   */
  if (typeof setTimeout === "function") {
    if (timerDoPrazo) clearTimeout(timerDoPrazo);
    timerDoPrazo = setTimeout(fecharCapturaPorPrazo, LIMITE_CAPTURA_MS);
  }
  registrarEvento("render", "gatilho", { motivo, valor, ...dados }, t0);
}

function agoraMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

/** fecha a captura pendente se o prazo dela venceu — chamável sem quadro nenhum */
export function fecharCapturaPorPrazo(): void {
  if (capturaPendente && agoraMs() >= capturaPendente.prazo) fecharCaptura();
}

// ---------------------------------------------------------------- caminhada

/**
 * Abre uma caminhada e devolve o id dela.
 *
 * O id nasce AQUI, não no jogo: correlacionar predição, pacote e quadro é
 * problema do gravador, e deixar o contador do lado de lá espalharia estado de
 * depuração pela lógica. Quem chama só guarda o número e o carimba de volta.
 *
 * Uma caminhada é a ORDEM inteira ("vá até ali"), não o trecho: uma travessia
 * longa é pedida em pedaços de ~16 células e é justamente por isso que o id tem
 * de sobreviver às emendas — sem ele, o rollback na costura de um trecho não
 * teria como ser ligado ao clique que o originou.
 */
export function novaCaminhada(): number {
  caminhadaAtual++;
  rascunho.walkId = caminhadaAtual;
  rascunho.trechoSeq = 0;
  return caminhadaAtual;
}

/** um trecho novo da MESMA caminhada (a emenda, ou um redirecionamento) */
export function novoTrecho(): void {
  rascunho.trechoSeq++;
}

export function caminhadaCorrente(): number {
  return caminhadaAtual;
}

// ---------------------------------------------------------------- quadro

/**
 * O rascunho do quadro em andamento — SEMPRE o mesmo objeto.
 *
 * Escreve-se `quadro().logicoX = …` e no fim do quadro `confirmarQuadro()`
 * copia tudo para as colunas. Devolver um objeto novo aqui seria uma alocação
 * por quadro por chamador, que é exatamente o que este módulo não pode fazer.
 */
export function quadro(): LinhaQuadro {
  return rascunho;
}

/** soma ao acumulador de chunk do quadro (vem de mais de um lugar por quadro) */
export function somarChunk(chunks: number, ms: number): void {
  if (!ativo()) return;
  rascunho.chunksConstruidos += chunks;
  rascunho.msDeChunk += ms;
}

/**
 * Abre o quadro — chamado pelo `PerfProbe` em prioridade −1000, antes de todo
 * mundo.
 *
 * Ele existe por causa de uma dependência que não é óbvia: quem FECHA a linha é
 * o `NetPlayer`, e o `NetPlayer` só monta quando há sessão e amarração com o
 * mapa do rAthena. Sem sessão — preview do editor, mapa sem cena 3D, tela de
 * erro — o anel nunca girava e o gravador não gravava NADA, o que inutiliza uma
 * investigação de renderização, que não depende de estar logado.
 *
 * Com o dono presente não muda nada: ele fechou a linha, a bandeira está de pé
 * e aqui só se limpa a bandeira.
 */
export function abrirQuadro(): void {
  if (!ativo()) return;
  if (!fechadoPeloDono) confirmarQuadro();
  fechadoPeloDono = false;
}

/**
 * Fecha o quadro: copia o rascunho para o anel e avança a captura pendente.
 *
 * Quem chama é o `NetPlayer`, no fim do `useFrame` dele — depois de todos os
 * outros escritores terem posto os campos deles. Sem ele, o `abrirQuadro()` do
 * quadro SEGUINTE faz o serviço.
 */
export function confirmarQuadro(): void {
  if (!ativo()) return;
  fechadoPeloDono = true;
  rascunho.quadro = totalQuadros;
  for (const c of CAMPOS) colunas.get(c)![escrita] = rascunho[c];
  escrita = (escrita + 1) % CAP_QUADROS;
  totalQuadros++;
  for (const a of ACUMULADORES) rascunho[a] = 0;

  if (capturaPendente) {
    capturaPendente.faltam--;
    // o prazo TAMBÉM fecha: um quadro de 400 ms esticaria os 120 quadros do
    // "depois" por vários segundos, e o caso ficaria pendente enquanto o
    // jogador já esqueceu o que provocou
    if (capturaPendente.faltam <= 0 || agoraMs() >= capturaPendente.prazo) fecharCaptura();
  }
}

/**
 * A linha de um índice GLOBAL de quadro, ou `null` se ela já foi sobrescrita.
 *
 * O índice global não é o do anel: ele conta desde o `limpar()` e sobrevive às
 * voltas, que é o que permite dizer "300 quadros antes DAQUELE" sem guardar
 * ponteiro nenhum.
 */
function linhaEm(indiceGlobal: number): LinhaQuadro | null {
  if (indiceGlobal < 0 || indiceGlobal >= totalQuadros) return null;
  if (totalQuadros - indiceGlobal > CAP_QUADROS) return null;
  const pos = indiceGlobal % CAP_QUADROS;
  const l = {} as LinhaQuadro;
  for (const c of CAMPOS) l[c] = colunas.get(c)![pos]!;
  return l;
}

/**
 * Escreve num quadro JÁ GRAVADO — a única forma de anotar uma medida que chega
 * depois do quadro que ela descreve.
 *
 * Existe pelo timer de GPU: `EXT_disjoint_timer_query_webgl2` é assíncrono e o
 * resultado só fica disponível dois ou três quadros adiante. Anotá-lo na linha
 * corrente seria atribuir o custo ao quadro errado, que é pior que não medir.
 * Devolve `false` quando aquele quadro já saiu do anel.
 *
 * Corolário aceito: um caso é COPIADO do anel ao fechar, então os dois ou três
 * últimos quadros da janela podem sair sem `gpuMs`. O gatilho está 120 quadros
 * antes disso, que é onde se olha.
 */
export function preencherQuadro(indiceGlobal: number, campo: keyof LinhaQuadro, valor: number): boolean {
  if (!ativo()) return false;
  if (indiceGlobal < 0 || indiceGlobal >= totalQuadros) return false;
  if (totalQuadros - indiceGlobal > CAP_QUADROS) return false;
  colunas.get(campo)![indiceGlobal % CAP_QUADROS] = valor;
  return true;
}

/** o índice GLOBAL do quadro em andamento — o que `preencherQuadro` recebe depois */
export function quadroCorrente(): number {
  return totalQuadros;
}

function fecharCaptura(): void {
  const p = capturaPendente;
  capturaPendente = null;
  if (timerDoPrazo) {
    clearTimeout(timerDoPrazo);
    timerDoPrazo = null;
  }
  if (!p) return;
  const de = Math.max(0, p.quadro - QUADROS_ANTES);
  const ate = Math.min(totalQuadros - 1, p.quadro + QUADROS_DEPOIS);
  const quadros: LinhaQuadro[] = [];
  for (let i = de; i <= ate; i++) {
    const l = linhaEm(i);
    if (l) quadros.push(l);
  }
  const tDe = quadros.length > 0 ? quadros[0]!.t : p.t0;
  const tAte = quadros.length > 0 ? quadros[quadros.length - 1]!.t : p.t0;
  casos.push({
    motivo: p.motivo,
    valor: p.valor,
    t0: p.t0,
    quadroGatilho: p.quadro,
    walkId: p.walkId,
    quadros,
    eventos: eventosOrdenados().filter((e) => e.t >= tDe && e.t <= tAte),
  });
  // teto de memória: o caso mais antigo sai
  if (casos.length > MAX_CASOS) casos = casos.slice(casos.length - MAX_CASOS);
}

// ---------------------------------------------------------------- eventos

/**
 * Um evento pontual, com categoria.
 *
 * `dados` é livre e só é lido na exportação — mas ele ALOCA, então evento é
 * para o que acontece algumas vezes por segundo (um pacote, um pedido, um
 * chunk), nunca para algo por quadro. O que é por quadro é coluna.
 */
export function registrarEvento(
  cat: Categoria,
  tipo: string,
  dados?: Record<string, unknown>,
  t = typeof performance !== "undefined" ? performance.now() : 0,
): void {
  if (!ativo()) return;
  const e: Evento = { t, cat, tipo, walkId: rascunho.walkId, quadro: totalQuadros, dados };
  if (eventos.length < CAP_EVENTOS) {
    eventos.push(e);
  } else {
    eventos[escritaEvento] = e;
  }
  escritaEvento = (escritaEvento + 1) % CAP_EVENTOS;
}

/** os eventos do anel em ordem cronológica */
export function eventosOrdenados(): Evento[] {
  if (eventos.length < CAP_EVENTOS) return [...eventos];
  return [...eventos.slice(escritaEvento), ...eventos.slice(0, escritaEvento)];
}

// ---------------------------------------------------------------- leitura

export function casosCapturados(): Caso[] {
  return casos;
}

export function quadrosGravados(): number {
  return Math.min(totalQuadros, CAP_QUADROS);
}

export function estado(): {
  gravando: boolean;
  quadros: number;
  totalQuadros: number;
  eventos: number;
  casos: number;
  capturando: boolean;
  walkId: number;
} {
  return {
    gravando: ativo(),
    quadros: quadrosGravados(),
    totalQuadros,
    eventos: eventos.length,
    casos: casos.length,
    capturando: capturaPendente !== null,
    walkId: caminhadaAtual,
  };
}

export function limpar(): void {
  escrita = 0;
  totalQuadros = 0;
  eventos.length = 0;
  escritaEvento = 0;
  casos = [];
  capturaPendente = null;
  if (timerDoPrazo) {
    clearTimeout(timerDoPrazo);
    timerDoPrazo = null;
  }
  fechadoPeloDono = true;
  caminhadaAtual = 0;
  const vazia = linhaVazia();
  for (const c of CAMPOS) rascunho[c] = vazia[c];
}

/** só para o teste: a flag em memória, sem passar pelo `localStorage` */
export function forcarFlag(v: boolean): void {
  ligadoPorFlag = v;
}

// ---------------------------------------------------------------- timeline

/**
 * A linha do tempo de um caso, no formato pedido em `next-change-game2.txt`.
 *
 * Os tempos são RELATIVOS ao gatilho (negativos antes dele): o que se quer ler é
 * "o que aconteceu nos 400 ms que antecederam o rollback", e um carimbo
 * absoluto de `performance.now()` obrigaria a subtrair de cabeça a cada linha.
 *
 * Além dos eventos, entram marcos derivados das COLUNAS — quadro longo e o
 * próprio rollback —, porque eles não são eventos: são propriedades da série.
 */
export function timeline(caso: Caso, limiarQuadroMs = 33): string {
  const linhas: { t: number; rotulo: string; detalhe: string }[] = [];

  for (const e of caso.eventos) {
    linhas.push({
      t: e.t - caso.t0,
      rotulo: `${e.cat}/${e.tipo}`,
      detalhe: e.dados ? resumirDados(e.dados) : "",
    });
  }

  for (const q of caso.quadros) {
    if (q.quadroMs > limiarQuadroMs) {
      // sobra/Δheap vão JUNTO da linha do quadro longo, não só no resumo do
      // gatilho: um caso pode ter mais de um quadro acima do limiar, e cada um
      // tem a própria decomposição — a pergunta "esse aqui foi GC?" é por
      // quadro, não só no instante do disparo
      const partes = [
        `${q.quadroMs.toFixed(1)} ms`,
        `quadro #${q.quadro}`,
        `pos ${q.renderX.toFixed(1)},${q.renderZ.toFixed(1)}`,
        `${q.drawCalls} calls`,
        `${Math.round(q.triangulos / 1000)}k tri`,
        `geo/tex/prog ${q.geometrias}/${q.texturas}/${q.programas}`,
        `sobra ${ou(q.sobraMs)} ms`,
        `Δheap ${ou(q.heapDeltaMb, 1)} MB`,
      ];
      // só aparece quando há VFX de skill ativo — é a linha que responde "o
      // quadro ficou lento ENQUANTO um VFX estava de pé?" sem precisar cruzar
      // manualmente com os eventos vfx/start-vfx/end ao redor
      if (q.vfxAtivos > 0) {
        partes.push(
          `vfx ${q.vfxAtivos} ativo(s) · html+${Math.round(q.vfxHtmlCount)} · dom+${Math.round(q.vfxDomNodeCount)}${q.vfxLongTaskMs > 0 ? ` · longtask ${ou(q.vfxLongTaskMs)}ms×${q.vfxLongTaskCount}` : ""}`,
        );
      }
      linhas.push({ t: q.t - caso.t0, rotulo: "render/quadro-longo", detalhe: partes.join("  ") });
    }
  }

  const gatilho = caso.quadros.find((q) => q.quadro === caso.quadroGatilho) ?? caso.quadros[0];
  /**
   * "célula(s)" e "causa=" só descrevem o ROLLBACK.
   *
   * `LinhaQuadro.causa` é do detector de recuada do `NetPlayer`
   * (predicao/servidor/fixpos/snap — QUEM escreveu a última posição), uma
   * coluna do QUADRO como outra qualquer. Ela persiste entre quadros como o
   * resto do rascunho (não é acumulador), então o valor lido aqui para um
   * `frameLongo` é só o que sobrou da última vez que a posição mudou — nada
   * a ver com o que tornou O QUADRO lento. Escrever "causa=servidor" ali lia
   * como "o servidor causou o frame longo", e não é isso que a coluna diz.
   * `caso.valor` também não é célula em nenhum outro gatilho — é ms em
   * `frameLongo`, contagem de geração em `rendererRecriado`, etc.
   */
  const ehRollback = caso.motivo === "rollback";
  const unidade = ehRollback ? "célula(s)" : "";
  const causaTxt = ehRollback && gatilho ? ` causa=${CAUSAS[gatilho.causa] || "?"}` : "";
  linhas.push({
    t: 0,
    rotulo: `>>> ${caso.motivo.toUpperCase()}`,
    detalhe: `${caso.valor.toFixed(2)}${unidade ? ` ${unidade}` : ""}${causaTxt}`,
  });

  /**
   * O estado do DEVICE no instante do gatilho.
   *
   * Numa investigação de renderização a primeira pergunta é "o que a cena
   * estava desenhando quando isso aconteceu", e ela não se responde lendo 420
   * linhas de coluna. Uma linha só, no t=0, com o que o F9 mostraria ali.
   */
  if (gatilho) {
    linhas.push({ t: 0, rotulo: "estado do renderer", detalhe: resumirRenderer(gatilho) });
    linhas.push({ t: 0, rotulo: "estado da cena", detalhe: resumirCena(gatilho) });
  }

  const fim = caso.quadros[caso.quadros.length - 1];
  if (fim) {
    linhas.push({
      t: fim.t - caso.t0,
      rotulo: "posição final",
      detalhe: `lógica ${fim.logicoX.toFixed(2)},${fim.logicoY.toFixed(2)} → destino ${fim.destinoX},${fim.destinoY}`,
    });
  }

  linhas.sort((a, b) => a.t - b.t);
  const corpo = linhas
    .map((l) => `t=${(l.t / 1000).toFixed(3).padStart(7)}  ${l.rotulo}${l.detalhe ? `  ${l.detalhe}` : ""}`)
    .join("\n     ↓\n");
  return `caso: ${caso.motivo} (${caso.valor.toFixed(2)}) — caminhada #${caso.walkId}, ${caso.quadros.length} quadros\n${corpo}`;
}

/** `NaN` vira "—": a lacuna tem de se LER como lacuna, não como zero */
function ou(v: number, casas = 1): string {
  return Number.isFinite(v) ? v.toFixed(casas) : "—";
}

function resumirRenderer(q: LinhaQuadro): string {
  return [
    `quadro ${ou(q.quadroMs)} ms`,
    `render cpu ${ou(q.renderMs)} / gpu ${ou(q.gpuMs)} ms`,
    `${q.drawCalls} calls`,
    `${Math.round(q.triangulos / 1000)} k tri`,
    `geo/tex/prog ${q.geometrias}/${q.texturas}/${q.programas}`,
    `contextos ${q.contextosVivos} (renderer #${q.rendererId})`,
    `vram ${ou(q.memoriaGpuMb, 0)} MB · heap ${ou(q.heapMb, 0)} MB (Δ${ou(q.heapDeltaMb, 1)})`,
    // o que sobra depois de renderMs/animacaoMs/contexto/descarte/modelo/troca:
    // React ou GC, sem coluna própria — `sobra` grande com `Δheap` negativo é
    // candidato a GC; grande sem queda de heap não é
    `sobra ${ou(q.sobraMs)} ms`,
  ].join("  ");
}

/**
 * O estado da ÁRVORE no instante do gatilho.
 *
 * A ordem das colunas aqui é a ordem em que se lê o diagnóstico: primeiro se a
 * cena existe (`filhos`), depois se ela está visível — porque `visível=não` com
 * filhos presentes é Suspense/`OcultarCena`, e `filhos=0` é desmonte de
 * verdade. Só então o que sobrou para desenhar.
 */
function resumirCena(q: LinhaQuadro): string {
  return [
    `filhos ${q.sceneFilhos}`,
    `visível ${q.sceneVisivel ? "sim" : "NÃO"}`,
    `renderizáveis ${q.objetosRender}`,
    `câmera #${q.cameraId}${q.cameraOk ? "" : " INVÁLIDA"}`,
    `chunks ${q.chunksVisiveis}/${q.chunksNoCache} (fila ${q.filaDeChunks})`,
    `props ${q.propsVisiveis}`,
    `suspensões ${q.suspensoes}${q.suspensoMs > 0 ? ` (SUSPENSO há ${Math.round(q.suspensoMs)} ms)` : ""}`,
    `desmontes ${q.desmontagensCena}`,
    `assets em voo ${q.assetsEmVoo}`,
    // a conta do quadro longo: o que sobra depois destes três é React ou GC
    `custo ctx ${ou(q.contextoMs)} / descarte ${ou(q.descarteMs)} / modelo ${ou(q.modeloMs)} / troca ${ou(q.trocaMs)} ms`,
    // `matriz` está DENTRO de `render`; `animação` está FORA. Somar os três
    // contaria a matriz duas vezes.
    `render ${ou(q.renderMs)} (matriz ${ou(q.matrizMs)}) + animação ${ou(q.animacaoMs)} ms`,
  ].join("  ");
}

function resumirDados(d: Record<string, unknown>): string {
  return Object.entries(d)
    .map(([k, v]) => `${k}=${typeof v === "number" ? Math.round(v * 1000) / 1000 : JSON.stringify(v)}`)
    .join(" ");
}

// ---------------------------------------------------------------- export

export interface Despejo {
  versao: number;
  criadoEm: string;
  meta: Record<string, unknown>;
  /**
   * O gravador estava GRAVANDO? Quantos quadros girou?
   *
   * Sem isto, um despejo com zero casos é AMBÍGUO: fica idêntico se nada de
   * errado aconteceu e se ninguém apertou "gravar". As duas leituras são
   * opostas — uma confirma uma correção, a outra diz que não se mediu nada — e
   * o arquivo tem de bastar para distinguí-las, senão a conclusão depende de
   * alguém lembrar o que fez.
   */
  gravacao: ReturnType<typeof estado>;
  gatilhos: Record<string, Gatilho>;
  campos: string[];
  /**
   * p50/p95/máximo de CADA coluna, sobre o anel inteiro.
   *
   * Sem isto, um despejo com zero casos perdia a série de quadros por completo —
   * e zero caso é o resultado NORMAL de medir um custo em regime. Foi
   * exatamente o que aconteceu ao tentar ler `matrizMs` depois de desligar o
   * `matrixAutoUpdate` dos props: o arquivo tinha o anel de eventos, o censo e o
   * estado de gravação, e nenhuma das 48 colunas.
   *
   * `p50` responde "quanto custa em regime" e `p95`/`max` respondem "e no pior
   * quadro" — as duas perguntas que um gatilho responderia, sem precisar que ele
   * dispare. `NaN` (o que não foi medido) fica de fora da conta em vez de virar
   * zero.
   */
  resumo: Record<string, { p50: number; p95: number; max: number; n: number }>;
  /**
   * O ANEL INTEIRO de eventos, e não só o que os casos levaram.
   *
   * Um despejo sem caso nenhum jogava fora os 512 eventos — justamente o que se
   * quer ler quando a pergunta é "a correção pegou?": `cena/precompilou`,
   * `vazio-esperado`, os portais, os contextos criados. É o modo NORMAL de
   * conferir uma correção, e era o único em que o arquivo não dizia nada.
   */
  eventos: Evento[];
  casos: {
    motivo: string;
    valor: number;
    walkId: number;
    quadroGatilho: number;
    timeline: string;
    /** colunar, como no anel: uma chave por campo, do tamanho da janela */
    quadros: Record<string, number[]>;
    eventos: Evento[];
  }[];
}

let meta: Record<string, unknown> = {};

/** contexto da sessão (mapa, ping simulado…) — o export sem isso não se lê depois */
export function registrarMeta(m: Record<string, unknown>): void {
  meta = { ...meta, ...m };
}

/**
 * Meta colhida NA HORA DO DESPEJO, não no registro.
 *
 * O `registrarMeta` guarda um VALOR, e há coisa que só faz sentido medida no
 * instante em que se exporta: o censo do grafo de cena, por exemplo, registrado
 * na montagem descreveria uma cena ainda vazia. Aqui guarda-se a FUNÇÃO e ela é
 * chamada no `despejo()`.
 *
 * O gravador continua sem conhecer o jogo — ele chama uma função que alguém
 * registrou e serializa o que voltar, sem saber o que é.
 */
const coletores = new Map<string, () => unknown>();

export function registrarColetorDeMeta(nome: string, colher: () => unknown): void {
  coletores.set(nome, colher);
}

export function removerColetorDeMeta(nome: string): void {
  coletores.delete(nome);
}

/**
 * p50/p95/máximo de cada coluna, sobre os quadros que estão no anel.
 *
 * Reusa a MEDIANA em vez da média pela mesma razão que o `perf/orcamento`: uma
 * pausa do coletor envenena a média e não move a mediana. O `p95` e o `max`
 * ficam ao lado justamente para o pior quadro não desaparecer nessa robustez.
 *
 * `NaN` sai da conta — `gpuMs` sem a extensão, `memoriaGpuMb` sem a
 * `GMAN_webgl_memory` e `heapMb` fora do Chrome são lacunas, e tratá-las como
 * zero puxaria a mediana para baixo mentindo um custo menor.
 */
function resumoDasColunas(): Despejo["resumo"] {
  const n = quadrosGravados();
  const fora: Despejo["resumo"] = {};
  if (n === 0) return fora;
  const buf = new Float64Array(n);
  for (const campo of CAMPOS) {
    const col = colunas.get(campo)!;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const v = col[i]!;
      if (Number.isFinite(v)) buf[m++] = v;
    }
    if (m === 0) {
      fora[campo] = { p50: 0, p95: 0, max: 0, n: 0 };
      continue;
    }
    const fatia = buf.subarray(0, m);
    fatia.sort();
    const em = (p: number) => arredondar(fatia[Math.min(m - 1, Math.floor(m * p))]!);
    fora[campo] = { p50: em(0.5), p95: em(0.95), max: arredondar(fatia[m - 1]!), n: m };
  }
  return fora;
}

export function despejo(): Despejo {
  /**
   * Exportar no meio de uma captura não pode devolver um arquivo SEM ela.
   *
   * É o fluxo normal do `contextoPerdido`: provoca-se a perda, o quadro para, e
   * a primeira coisa que se faz é baixar o JSON. Sem isto o caso que se acabou
   * de causar seria justamente o que faltaria no arquivo.
   */
  if (capturaPendente) fecharCaptura();
  // colhido AGORA: o censo da cena registrado na montagem descreveria uma cena
  // vazia. Um coletor que estoura não pode derrubar o despejo inteiro — o laudo
  // vale mesmo sem uma das seções.
  const colhido: Record<string, unknown> = {};
  for (const [nome, colher] of coletores) {
    try {
      colhido[nome] = colher();
    } catch (e) {
      colhido[nome] = { erro: String(e) };
    }
  }
  return {
    versao: 3,
    criadoEm: new Date().toISOString(),
    meta: { ...meta, ...colhido },
    gravacao: estado(),
    gatilhos: estadoDosGatilhos(),
    campos: CAMPOS as string[],
    resumo: resumoDasColunas(),
    eventos: eventosOrdenados(),
    casos: casos.map((c) => {
      const quadros: Record<string, number[]> = {};
      for (const campo of CAMPOS) quadros[campo] = c.quadros.map((q) => arredondar(q[campo]));
      return {
        motivo: c.motivo,
        valor: c.valor,
        walkId: c.walkId,
        quadroGatilho: c.quadroGatilho,
        timeline: timeline(c),
        quadros,
        eventos: c.eventos,
      };
    }),
  };
}

/**
 * Três casas.
 *
 * O JSON de um caso tem ~28 colunas × 420 quadros; sem cortar a cauda do
 * `double` o arquivo triplica de tamanho guardando ruído de ponto flutuante que
 * ninguém vai ler. `NaN` vira `null` porque JSON não tem NaN.
 */
function arredondar(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : (null as unknown as number);
}

export function baixarJson(nome = `voo-${Date.now()}.json`): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(despejo(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- console

// `typeof window` porque este módulo é importado por TESTE (ambiente node)
if (import.meta.env.DEV && typeof window !== "undefined") {
  ligadoPorFlag = lerFlagGuardada();
  (window as unknown as { __voo?: unknown }).__voo = {
    estado,
    ligar,
    desligar,
    limpar,
    capturar: (motivo = "manual") => dispararCaptura(motivo, 0),
    gatilho: configurarGatilho,
    gatilhos: estadoDosGatilhos,
    casos: casosCapturados,
    eventos: eventosOrdenados,
    timeline: (i = 0) => {
      const c = casos[i];
      return c ? timeline(c) : "sem caso capturado";
    },
    json: despejo,
    baixar: baixarJson,
  };
}
