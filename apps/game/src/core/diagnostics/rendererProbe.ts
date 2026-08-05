import type * as THREE from "three";
import {
  avaliarGatilho,
  preencherQuadro,
  quadro,
  quadroCorrente,
  registrarEvento,
  registrarMeta,
  ativo,
} from "./flightRecorder";

/**
 * SONDA DO RENDERER — a ponte entre o WebGL e a caixa-preta.
 *
 * O `flightRecorder` não conhece o jogo NEM o three: ele recebe números e
 * strings. Este módulo é quem sabe o que é um `WebGLRenderer`, e é por isso que
 * ele existe separado — sem ele, ou o gravador passaria a importar three, ou
 * cada `<Canvas>` teria a sua própria versão da mesma conta.
 *
 * ## Por que isto é necessário
 *
 * O projeto já teve dois defeitos de render e os dois foram achados À MÃO, fora
 * do gravador:
 *
 * - **4.042 texturas vivas contra 5 na cena** (o `SkeletonUtils.clone` fazia um
 *   `boneTexture` por malha skinada, nove por personagem);
 * - **`Context Lost` × 19** — o `<Canvas>` do retrato do ALVO remontava a cada
 *   seleção, e como o `dispose()` do R3F não libera contexto, o Chrome estourava
 *   o teto de ~16 e **forçava a perda do MAIS ANTIGO, que é o canvas do jogo**.
 *
 * O segundo produz engasgo, e engasgo é o gatilho do salto de posição: a
 * investigação de render e a de movimento são a mesma, e é por isso que elas
 * têm de cair no MESMO anel.
 *
 * ## O que ele não faz
 *
 * Não inventa memória de GPU. Não existe API padrão na web para isso — lê-se a
 * extensão `GMAN_webgl_memory` quando ela está presente e escreve-se `NaN`
 * quando não, que o despejo serializa como `null`. Um número estimado ali seria
 * pior que a lacuna.
 */

/**
 * Quanto o renderer anterior precisa ter vivido para a recriação valer captura.
 *
 * Em DEV o React monta, DESMONTA e remonta cada componente (StrictMode), e o
 * renderer descartado nesse ciclo vive milissegundos. Sem esta condição TODA
 * sessão de desenvolvimento abriria com uma captura falsa no primeiro segundo —
 * e um gatilho que sempre dispara é um gatilho que ninguém olha.
 */
export const VIDA_MINIMA_MS = 1000;

/**
 * Os contadores viram evento no máximo a cada meio segundo.
 *
 * Geometria, textura e programa mudam CENTENAS de vezes durante a carga: são
 * 169 chunks de terreno e dezenas de shaders no aquecimento. Um evento por
 * mudança inundaria o anel de 512 e expulsaria tudo o mais — justamente a rede,
 * a predição e o chunk que a captura existe para pôr lado a lado. Coalescido, a
 * carga custa ~2 eventos por segundo por contador e o regime custa ZERO, porque
 * em regime o delta é 0.
 */
export const INTERVALO_CONTADORES_MS = 500;

/**
 * Quantas medidas de GPU podem estar no ar ao mesmo tempo.
 *
 * Medido num dump real (GTX 1660 Ti / ANGLE D3D11): com 4, só **105 de 414
 * quadros** saíam com `gpuMs` e havia lacunas de até 22 quadros — o resultado
 * do driver demora vários quadros e, com o pool cheio, o quadro seguinte não
 * chega a começar medida nenhuma. Lacuna é honesta (`null`, nunca zero), mas
 * uma série com um quarto dos pontos é ruim para achar o pico, que é o que se
 * procura.
 */
const POOL_DE_QUERIES = 8;

export interface OpcoesDeSonda {
  /** aparece nos eventos: "jogo", "retrato"… */
  nome: string;
  /**
   * É o canvas do JOGO?
   *
   * Só ele arma `rendererRecriado`, embrulha `gl.render` e mede GPU. Os
   * retratos do HUD nascem e morrem por ação do jogador (abrir a janela de
   * Status, selecionar um alvo) — capturar isso encheria os quatro slots de
   * caso com ruído de UI. Eles continuam emitindo evento e contando em
   * `contextosVivos`, que é o número que denuncia o churn.
   */
  principal?: boolean;
}

// ---------------------------------------------------------------- estado

/**
 * Canvas já vistos — é o que separa "canvas criado" de "renderer criado".
 *
 * Num remonte do R3F os dois nascem juntos, então a distinção parece
 * acadêmica; ela não é. Se um dia só o renderer for recriado sobre o mesmo
 * elemento, o dado diz a verdade em vez de supor — e é exatamente esse tipo de
 * suposição que fez a investigação anterior custar duas rodadas.
 *
 * `WeakSet`: o elemento removido do DOM não pode ser mantido vivo pela sonda.
 */
const canvasVistos = new WeakSet<HTMLCanvasElement>();

/**
 * Renderers já vistos — e este WeakSet é a correção de um FALSO-POSITIVO que o
 * primeiro dump de verdade pegou (`voo-1785932685455.json`).
 *
 * A sonda vive num `useEffect`, e efeito que roda de novo NÃO quer dizer
 * renderer novo. O `<Canvas>` fica FORA do `<Suspense>` do `PlayView`, mas o
 * `PerfProbe` e a `Scene` ficam DENTRO: quando o boundary re-suspende, o React
 * destrói os efeitos dos filhos e os recria na revelação. A limpeza + o setup
 * disparavam "renderer recriado" com o MESMO `gl`.
 *
 * O laudo já dizia isso e eu não estava lendo: `canvasNovo: false` e
 * `contextosVivos` parado em 3 do começo ao fim — nem o canvas nem a contagem
 * de contextos tinham mudado, só a subárvore React (geometrias 166 → 101,
 * texturas 75 → 46, um quadro com 0 draw calls).
 *
 * Agora a recriação é uma propriedade do OBJETO, não do ciclo de vida do
 * componente — a mesma regra que o `canvasVistos` já aplicava ao elemento.
 */
const renderersVistos = new WeakSet<THREE.WebGLRenderer>();

interface Geracao {
  geracao: number;
  nasceuEm: number;
  /** preenchido na limpeza; `undefined` = ainda vivo */
  viveu?: number;
}
const geracoes = new Map<string, Geracao>();

let vivos = 0;
/** geração do renderer do JOGO — a coluna `rendererId` */
let idDoJogo = 0;

/** somado pelo embrulho de `gl.render`; lido e zerado a cada quadro */
let renderMsAcumulado = 0;
/** profundidade de `gl.render` — o EffectComposer chama de dentro de si mesmo */
let profundidadeDeRender = 0;

/**
 * Os três custos que partem um quadro longo em pedaços atribuíveis.
 *
 * O `frameLongo` de 378 ms do `voo-1785938553239.json` tinha chunks, props,
 * visibilidade e draw calls INALTERADOS — ou seja, não era a cena. A única
 * coisa acontecendo era um `renderer/canvas-criado {nome:"retrato"}` 6 ms
 * antes. Mas "um canvas nasceu por perto" não é o mesmo que "criar o canvas
 * custou 378 ms": entre uma coisa e outra cabem a criação do CONTEXTO, o
 * descarte do renderer velho, o clone do MODELO, o remonte do React e uma pausa
 * do coletor. Sem medir os três primeiros, não há como saber qual é.
 *
 * Somados e zerados por quadro, como o `renderMsAcumulado`. O que sobra do
 * `quadroMs` depois de subtraí-los é React ou GC — e essa é a distinção que
 * este bloco existe para permitir.
 */
let contextoMsAcumulado = 0;
let descarteMsAcumulado = 0;
let modeloMsAcumulado = 0;

/** chamado por quem clona/funde o personagem (`assets.useCharacter`) */
export function somarCustoDeModelo(ms: number): void {
  modeloMsAcumulado += ms;
  instantaneo.modeloMsTotal += ms;
}

/**
 * `AnimationMixer.update`, somado no quadro.
 *
 * Chamado por CADA entidade viva (`assets.useCharacter`), então o acumulador é
 * a única forma de ter o total: um número por entidade não responde "a animação
 * está limitando o quadro?".
 */
let animacaoMsAcumulado = 0;
export function somarCustoDeAnimacao(ms: number): void {
  animacaoMsAcumulado += ms;
}

/**
 * `scene.updateMatrixWorld` — embrulhado na INSTÂNCIA da cena.
 *
 * O caminho óbvio seria `Object3D.prototype.updateMatrixWorld`, e ele é o
 * errado: o método desce recursivamente por milhares de nós a cada quadro, e o
 * cronômetro custaria mais que o medido. Embrulhando só a raiz, uma chamada
 * mede a descida inteira.
 *
 * O número resultante está DENTRO de `gl.render`, ou seja, é subconjunto do
 * `renderMs` — somar os dois contaria em dobro.
 */
let matrizMsAcumulado = 0;
let desfazerMatriz: (() => void) | null = null;

export function observarMatrizesDaCena(scene: THREE.Scene): () => void {
  if (desfazerMatriz) return desfazerMatriz;
  const original = scene.updateMatrixWorld;
  const eraProprio = Object.prototype.hasOwnProperty.call(scene, "updateMatrixWorld");
  scene.updateMatrixWorld = function medido(force?: boolean) {
    const t0 = performance.now();
    try {
      original.call(this, force);
    } finally {
      matrizMsAcumulado += performance.now() - t0;
    }
  };
  desfazerMatriz = () => {
    if (eraProprio) scene.updateMatrixWorld = original;
    else delete (scene as Partial<THREE.Scene>).updateMatrixWorld;
    desfazerMatriz = null;
  };
  return desfazerMatriz;
}

// ---------------------------------------------------------------- contadores

interface Contador {
  anterior: number;
  delta: number;
}
const contadores: Record<string, Contador> = {
  geometria: { anterior: 0, delta: 0 },
  textura: { anterior: 0, delta: 0 },
  programa: { anterior: 0, delta: 0 },
};
let proximoFlush = 0;

/**
 * Acumula a diferença de um contador. Pura de propósito — é ela que o teste
 * exercita, porque não há WebGL no vitest.
 */
export function acumularContador(nome: keyof typeof contadores | string, valor: number): void {
  const c = contadores[nome];
  if (!c) return;
  c.delta += valor - c.anterior;
  c.anterior = valor;
}

/**
 * Solta um evento por contador que MUDOU, no máximo a cada
 * `INTERVALO_CONTADORES_MS`. Devolve quantos eventos saíram (o teste lê isso).
 */
export function talvezEmitirContadores(agora: number): number {
  if (agora < proximoFlush) return 0;
  proximoFlush = agora + INTERVALO_CONTADORES_MS;
  let emitidos = 0;
  for (const [nome, c] of Object.entries(contadores)) {
    if (c.delta === 0) continue;
    // "programa subiu" É a recompilação de shader: o three só acrescenta à
    // lista quando um material é desenhado pela primeira vez com um programa
    // que ainda não existia (é o mesmo sinal que a tela de aquecimento usa).
    const tipo = nome === "programa" ? (c.delta > 0 ? "shader-compilado" : "shader-descartado") : nome;
    registrarEvento("renderer", tipo, { delta: c.delta, total: c.anterior }, agora);
    c.delta = 0;
    emitidos++;
  }
  return emitidos;
}

/** só para o teste: volta ao estado de módulo recém-carregado */
export function zerarSonda(): void {
  for (const c of Object.values(contadores)) {
    c.anterior = 0;
    c.delta = 0;
  }
  proximoFlush = 0;
  geracoes.clear();
  vivos = 0;
  idDoJogo = 0;
  renderMsAcumulado = 0;
  contextoMsAcumulado = 0;
  descarteMsAcumulado = 0;
  modeloMsAcumulado = 0;
  animacaoMsAcumulado = 0;
  matrizMsAcumulado = 0;
  profundidadeDeRender = 0;
  pendentes.length = 0;
  gpu = null;
  memoria = null;
}

// ------------------------------------------------- criação de contexto WebGL

/**
 * Quanto custa CRIAR um contexto WebGL — medido no ponto exato.
 *
 * O `<Canvas>` do R3F cria o renderer dentro de um efeito próprio, então não há
 * onde cronometrá-lo de fora. Mas todo contexto do navegador nasce no MESMO
 * lugar: `HTMLCanvasElement.prototype.getContext`. Embrulhá-lo uma vez, em DEV,
 * dá o número real e vale para qualquer canvas — o do jogo, os três retratos e
 * qualquer outro que apareça.
 *
 * Só contextos WebGL são cronometrados: os `2d` do minimapa, do gerador de
 * textura e do 9-slice passam batidos, e somá-los ao mesmo número tornaria a
 * coluna ilegível.
 */
const TIPOS_WEBGL = new Set(["webgl", "webgl2", "experimental-webgl"]);
let desfazerContexto: (() => void) | null = null;

export function observarCriacaoDeContexto(): () => void {
  if (desfazerContexto) return desfazerContexto;
  if (typeof HTMLCanvasElement === "undefined") return () => {};

  const original = HTMLCanvasElement.prototype.getContext;
  // `any` aqui é a assinatura sobrecarregada do DOM: reproduzi-la não
  // acrescentaria segurança nenhuma, o embrulho é transparente por construção
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = function medido(this: HTMLCanvasElement, ...args: any[]): any {
    const tipo = String(args[0]);
    if (!TIPOS_WEBGL.has(tipo)) return (original as any).apply(this, args);
    const t0 = performance.now();
    try {
      return (original as any).apply(this, args);
    } finally {
      const ms = performance.now() - t0;
      contextoMsAcumulado += ms;
      instantaneo.contextoMsTotal += ms;
      instantaneo.contextosCriados++;
      // individual, sempre: criar contexto é raro e caro, e é exatamente o
      // suspeito que se está pesando — coalescer perderia o número
      registrarEvento("renderer", "contexto-criado", {
        tipo,
        ms: Math.round(ms * 10) / 10,
        tamanho: `${this.width}x${this.height}`,
      });
    }
  } as typeof original;

  desfazerContexto = () => {
    HTMLCanvasElement.prototype.getContext = original;
    desfazerContexto = null;
  };
  return desfazerContexto;
}

/**
 * Tarefas longas do navegador, pela API nativa.
 *
 * Ela responde uma pergunta que as colunas não respondem: o quadro de 378 ms
 * foi UMA tarefa bloqueando a thread, ou muitas pequenas somadas? São causas
 * diferentes — a primeira é trabalho síncrono nosso, a segunda é o laço não
 * conseguindo rodar. A `attribution` do navegador costuma vir vazia, então o
 * valor está na duração e no instante, não nela.
 */
let desfazerLongtask: (() => void) | null = null;

export function observarTarefasLongas(limiarMs = 120): () => void {
  if (desfazerLongtask) return desfazerLongtask;
  if (typeof PerformanceObserver === "undefined") return () => {};
  let obs: PerformanceObserver;
  try {
    obs = new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) {
        if (e.duration < limiarMs) continue;
        registrarEvento("renderer", "tarefa-longa", { ms: Math.round(e.duration), nome: e.name });
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    // `longtask` não existe em todo navegador; a ausência não vale exceção
    return () => {};
  }
  desfazerLongtask = () => {
    obs.disconnect();
    desfazerLongtask = null;
  };
  return desfazerLongtask;
}

// ---------------------------------------------------------------- memória

/**
 * Memória de GPU — só existe com a extensão `GMAN_webgl_memory` (a da biblioteca
 * webgl-memory, injetada por quem quer medir). Não há API padrão, e o resto do
 * projeto já trata lacuna como lacuna: "—" na lista de amigos, `null` no JSON.
 */
interface ExtensaoDeMemoria {
  getMemoryInfo(): { memory?: { total?: number } };
}
let memoria: ExtensaoDeMemoria | null | undefined;

function lerMemoriaGpuMb(gl: THREE.WebGLRenderer): number {
  if (memoria === undefined) {
    memoria = (gl.getContext().getExtension("GMAN_webgl_memory") as ExtensaoDeMemoria | null) ?? null;
  }
  const total = memoria?.getMemoryInfo().memory?.total;
  return typeof total === "number" ? total / 1048576 : NaN;
}

/**
 * Heap de JS, e ele tem NOME PRÓPRIO por isso: `performance.memory` não é
 * memória de GPU e chamá-la assim faria alguém tirar a conclusão errada. Vale
 * por outro motivo — é o que liga um quadro de 200 ms a uma pausa do coletor.
 */
function lerHeapMb(): number {
  const m = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof m?.usedJSHeapSize === "number" ? m.usedJSHeapSize / 1048576 : NaN;
}

// ---------------------------------------------------------------- GPU timer

/**
 * Tempo de GPU por quadro (`EXT_disjoint_timer_query_webgl2`).
 *
 * A 60 FPS com vsync o tempo de CPU esconde o custo de GPU — foi com esta
 * extensão que se mediu 4,37 ms no editor e se decidiu NÃO trocar o material do
 * chão por Lambert. Ela é assíncrona: o resultado sai dois ou três quadros
 * depois, e por isso é escrito de volta na linha do quadro a que pertence
 * (`preencherQuadro`), nunca na corrente.
 */
interface TimerDeGpu {
  ctx: WebGL2RenderingContext;
  alvo: number;
  disjoint: number;
}
let gpu: TimerDeGpu | null = null;
const pendentes: { query: WebGLQuery; quadro: number }[] = [];
let queryEmCurso: WebGLQuery | null = null;

function abrirTimerDeGpu(gl: THREE.WebGLRenderer): void {
  const ctx = gl.getContext() as WebGL2RenderingContext;
  // WebGL 1 não tem `createQuery`; sem a extensão a coluna fica NaN e o resto
  // do módulo continua valendo
  if (typeof ctx?.createQuery !== "function") return;
  const ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2") as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    | null;
  if (!ext) return;
  gpu = { ctx, alvo: ext.TIME_ELAPSED_EXT, disjoint: ext.GPU_DISJOINT_EXT };
}

function comecarMedidaDeGpu(): void {
  if (!gpu || queryEmCurso || pendentes.length >= POOL_DE_QUERIES) return;
  const q = gpu.ctx.createQuery();
  if (!q) return;
  gpu.ctx.beginQuery(gpu.alvo, q);
  queryEmCurso = q;
}

function terminarMedidaDeGpu(): void {
  if (!gpu || !queryEmCurso) return;
  gpu.ctx.endQuery(gpu.alvo);
  pendentes.push({ query: queryEmCurso, quadro: quadroCorrente() });
  queryEmCurso = null;
}

function colherMedidasDeGpu(): void {
  if (!gpu || pendentes.length === 0) return;
  const ctx = gpu.ctx;
  // "disjoint" é o driver avisando que o relógio dele foi interrompido: TODAS
  // as medidas no ar viram lixo, e usá-las seria pior que não medir
  if (ctx.getParameter(gpu.disjoint)) {
    for (const p of pendentes) ctx.deleteQuery(p.query);
    pendentes.length = 0;
    return;
  }
  for (let i = pendentes.length - 1; i >= 0; i--) {
    const p = pendentes[i]!;
    if (!ctx.getQueryParameter(p.query, ctx.QUERY_RESULT_AVAILABLE)) continue;
    const ns = ctx.getQueryParameter(p.query, ctx.QUERY_RESULT) as number;
    preencherQuadro(p.quadro, "gpuMs", ns / 1e6);
    ctx.deleteQuery(p.query);
    pendentes.splice(i, 1);
  }
}

function fecharTimerDeGpu(): void {
  if (gpu) {
    for (const p of pendentes) gpu.ctx.deleteQuery(p.query);
    if (queryEmCurso) gpu.ctx.deleteQuery(queryEmCurso);
  }
  pendentes.length = 0;
  queryEmCurso = null;
  gpu = null;
}

// ---------------------------------------------------------------- amostra

/**
 * O último estado do device, para o overlay do F9.
 *
 * Objeto de MÓDULO, reusado: uma alocação por quadro num medidor é exatamente o
 * que ele existe para acusar. E ele é escrito mesmo com o gravador DESLIGADO —
 * quem desliga o voo quer parar de capturar, não de ver o medidor.
 */
const instantaneo = {
  renderMs: 0,
  gpuMs: NaN as number,
  memoriaGpuMb: NaN as number,
  heapMb: NaN as number,
  contextos: 0,
  rendererId: 0,
  /** picos ACUMULADOS desde o boot — o overlay mostra o total, não o do quadro */
  contextoMsTotal: 0,
  descarteMsTotal: 0,
  modeloMsTotal: 0,
  contextosCriados: 0,
};

export function instantaneoDoRenderer(): Readonly<typeof instantaneo> {
  return instantaneo;
}

/**
 * Uma amostra por quadro — chamada pelo `PerfProbe` em prioridade −1000.
 *
 * `renderMs` e `gpuMs` descrevem o quadro ANTERIOR, pela mesma razão que
 * `gl.info.render` já descrevia: no começo do quadro o render dele ainda não
 * aconteceu.
 */
export function amostrarContadores(gl: THREE.WebGLRenderer, agora = performance.now()): void {
  const info = gl.info;
  const geometrias = info.memory.geometries;
  const texturas = info.memory.textures;
  const programas = info.programs?.length ?? 0;

  colherMedidasDeGpu();
  // a última medida COLHIDA, só para o overlay ter um número a mostrar; a série
  // de verdade é a coluna, escrita no quadro certo por `preencherQuadro`
  instantaneo.renderMs = renderMsAcumulado;
  instantaneo.memoriaGpuMb = lerMemoriaGpuMb(gl);
  instantaneo.heapMb = lerHeapMb();
  instantaneo.contextos = vivos;
  instantaneo.rendererId = idDoJogo;

  if (ativo()) {
    const q = quadro();
    q.geometrias = geometrias;
    q.texturas = texturas;
    q.programas = programas;
    q.renderMs = renderMsAcumulado;
    q.contextoMs = contextoMsAcumulado;
    q.descarteMs = descarteMsAcumulado;
    q.modeloMs = modeloMsAcumulado;
    q.animacaoMs = animacaoMsAcumulado;
    q.matrizMs = matrizMsAcumulado;
    q.memoriaGpuMb = instantaneo.memoriaGpuMb;
    q.heapMb = instantaneo.heapMb;
    q.contextosVivos = vivos;
    q.rendererId = idDoJogo;

    acumularContador("geometria", geometrias);
    acumularContador("textura", texturas);
    acumularContador("programa", programas);
    talvezEmitirContadores(agora);
  }

  renderMsAcumulado = 0;
  contextoMsAcumulado = 0;
  descarteMsAcumulado = 0;
  modeloMsAcumulado = 0;
  animacaoMsAcumulado = 0;
  matrizMsAcumulado = 0;
}

// ---------------------------------------------------------------- registro

/**
 * Passa a observar um renderer. Devolve a limpeza — chame-a no desmonte, senão
 * o `contextosVivos` mente e o embrulho de `gl.render` sobrevive ao renderer.
 */
export function observarRenderer(gl: THREE.WebGLRenderer, opcoes: OpcoesDeSonda): () => void {
  const { nome, principal = false } = opcoes;
  const canvas = gl.domElement;
  const agora = performance.now();

  const canvasNovo = !canvasVistos.has(canvas);
  if (canvasNovo) canvasVistos.add(canvas);

  /**
   * O MESMO objeto de novo = o efeito remontou, não o renderer nasceu.
   *
   * Sem esta distinção o Suspense do `PlayView` sozinho produzia "renderer
   * recriado" — ver o comentário de `renderersVistos`.
   */
  const rendererNovo = !renderersVistos.has(gl);
  if (rendererNovo) renderersVistos.add(gl);

  const anterior = geracoes.get(nome);
  const vidaAnterior = anterior ? (anterior.viveu ?? agora - anterior.nasceuEm) : 0;
  // a geração conta RENDERERS, não montagens: sem isto o `rendererId` da coluna
  // subiria a cada re-suspensão e deixaria de identificar coisa nenhuma
  const geracao = rendererNovo ? (anterior?.geracao ?? 0) + 1 : (anterior?.geracao ?? 1);
  geracoes.set(nome, { geracao, nasceuEm: rendererNovo ? agora : (anterior?.nasceuEm ?? agora) });

  vivos++;
  if (principal) idDoJogo = geracao;

  if (canvasNovo) registrarEvento("renderer", "canvas-criado", { nome, contextos: vivos });
  if (rendererNovo) {
    registrarEvento("renderer", "renderer-criado", { nome, geracao, contextos: vivos, canvasNovo });
  } else {
    // não é ruído: é o Suspense/HMR remontando a subárvore, e ele DERRUBA a cena
    // (geometria e textura despencam junto). Vale ver na timeline — só não é
    // motivo de captura.
    registrarEvento("renderer", "sonda-remontada", { nome, geracao, contextos: vivos });
  }

  /**
   * Recriação: renderer NOVO, só o canvas do jogo, e só quando o anterior VIVEU.
   *
   * As três condições são necessárias e por motivos diferentes — a primeira
   * porque efeito remontado não é renderer novo (foi o falso-positivo do
   * primeiro dump), a segunda porque abrir a janela de Status não é defeito, a
   * terceira porque o StrictMode recria tudo no boot (ver `VIDA_MINIMA_MS`).
   */
  if (rendererNovo && principal && geracao > 1 && vidaAnterior > VIDA_MINIMA_MS) {
    avaliarGatilho("rendererRecriado", geracao, { nome, vidaAnteriorMs: Math.round(vidaAnterior) });
  }

  /**
   * A sonda OBSERVA, não interfere: nada de `preventDefault` aqui.
   *
   * Preveni-lo mudaria o comportamento do jogo (o navegador passaria a tentar
   * restaurar o contexto), e um medidor que altera o que mede não serve. Ele
   * só anota — e o gatilho congela os 300 quadros anteriores, que é o que
   * responde "o que estava acontecendo quando o contexto caiu".
   */
  const perdeu = () => {
    registrarEvento("renderer", "contexto-perdido", { nome, contextos: vivos });
    avaliarGatilho("contextoPerdido", 1, { nome });
  };
  const restaurou = () => registrarEvento("renderer", "contexto-restaurado", { nome });
  canvas.addEventListener("webglcontextlost", perdeu);
  canvas.addEventListener("webglcontextrestored", restaurou);

  /**
   * O embrulho vai na INSTÂNCIA (propriedade própria sombreia o protótipo), e
   * só no renderer do jogo: `renderMs` é uma coluna só, e somar o retrato nela
   * misturaria duas cenas. Acumula em vez de atribuir porque o `EffectComposer`
   * do filtro retrô chama `gl.render` uma vez por passe.
   */
  const renderOriginal = gl.render.bind(gl);
  /**
   * `render` é método de PROTÓTIPO no three de hoje, mas já foi propriedade de
   * instância (o construtor atribuía `this.render = …`). Desfazer com `delete`
   * nesse caso apagaria o método de verdade e o canvas pararia de desenhar,
   * então a restauração pergunta em vez de supor.
   */
  const renderEraProprio = Object.prototype.hasOwnProperty.call(gl, "render");

  /**
   * DESTRUIÇÃO do renderer é `dispose()`, não a limpeza deste efeito.
   *
   * A limpeza roda toda vez que a subárvore remonta — foi o que produziu o
   * falso "renderer-destruido/criado" do primeiro dump. Quem realmente derruba
   * o renderer é o R3F chamando `gl.dispose()`, e é só isso que se anota como
   * destruição. Vale para os retratos também: é ali que se vê um contexto
   * morrendo de verdade contra um contexto apenas ABANDONADO — e a diferença
   * entre os dois é o defeito dos `Context Lost`, porque o `dispose()` do R3F
   * não libera o contexto.
   */
  const disposeOriginal = gl.dispose.bind(gl);
  const disposeEraProprio = Object.prototype.hasOwnProperty.call(gl, "dispose");
  gl.dispose = function observado() {
    const t0 = performance.now();
    try {
      disposeOriginal();
    } finally {
      // descartar renderer é um dos cinco suspeitos do quadro longo, e ele tem
      // de ser pesado SEPARADO da criação do próximo
      const ms = performance.now() - t0;
      descarteMsAcumulado += ms;
      instantaneo.descarteMsTotal += ms;
      registrarEvento("renderer", "renderer-destruido", {
        nome,
        geracao,
        contextos: vivos,
        ms: Math.round(ms * 10) / 10,
      });
    }
  } as THREE.WebGLRenderer["dispose"];

  if (principal) {
    abrirTimerDeGpu(gl);
    gl.render = function medido(scene: THREE.Object3D, camera: THREE.Camera) {
      const raiz = profundidadeDeRender === 0;
      profundidadeDeRender++;
      if (raiz) comecarMedidaDeGpu();
      const t0 = performance.now();
      try {
        renderOriginal(scene, camera);
      } finally {
        renderMsAcumulado += performance.now() - t0;
        profundidadeDeRender--;
        if (raiz) terminarMedidaDeGpu();
      }
    } as THREE.WebGLRenderer["render"];
  }

  return () => {
    canvas.removeEventListener("webglcontextlost", perdeu);
    canvas.removeEventListener("webglcontextrestored", restaurou);
    if (principal) {
      if (renderEraProprio) gl.render = renderOriginal;
      else delete (gl as Partial<THREE.WebGLRenderer>).render;
      fecharTimerDeGpu();
    }
    if (disposeEraProprio) gl.dispose = disposeOriginal;
    else delete (gl as Partial<THREE.WebGLRenderer>).dispose;
    vivos = Math.max(0, vivos - 1);
    const atual = geracoes.get(nome);
    if (atual && atual.geracao === geracao) atual.viveu = performance.now() - atual.nasceuEm;
    // "a sonda saiu", não "o renderer morreu" — quem diz isso é o `dispose`
    registrarEvento("renderer", "sonda-desligada", { nome, geracao, contextos: vivos });
    /**
     * O CANVAS morre depois do renderer, e num tempo que não é o nosso: no
     * desmonte o React roda as limpezas de efeito ANTES de tirar o elemento do
     * DOM, então perguntar aqui daria sempre "ainda conectado". Um tick depois a
     * resposta é a verdadeira — e só então o elemento sai do `WeakSet`, para um
     * canvas novo no mesmo lugar voltar a contar como novo.
     */
    setTimeout(() => {
      if (canvas.isConnected) return;
      canvasVistos.delete(canvas);
      registrarEvento("renderer", "canvas-destruido", { nome });
    }, 0);
  };
}

/**
 * Quem é a GPU e o que ela oferece — no `meta` do despejo.
 *
 * Um JSON de laudo sem isto não se lê meses depois: "gpuMs ausente" pode ser
 * bug da sonda ou navegador sem a extensão, e são conclusões opostas.
 */
export function registrarMetaDeGpu(gl: THREE.WebGLRenderer): void {
  try {
    const ctx = gl.getContext();
    const dbg = ctx.getExtension("WEBGL_debug_renderer_info") as
      | { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number }
      | null;
    registrarMeta({
      gpu: {
        vendor: dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        renderer: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        webgl2: typeof (ctx as WebGL2RenderingContext).createQuery === "function",
        timerDeGpu: gpu !== null,
        memoriaDeGpu: Boolean(ctx.getExtension("GMAN_webgl_memory")),
        maxTextura: ctx.getParameter(ctx.MAX_TEXTURE_SIZE),
      },
    });
  } catch {
    /* contexto já perdido: a meta é contexto, não vale uma exceção */
  }
}
