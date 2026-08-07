import type * as THREE from "three";
import { ativo, avaliarGatilho, quadro, registrarEvento } from "./flightRecorder";
import { assetsEmVoo, diagnosticoDeCache, escreverColunaDeAssets, ultimoAssetResolvido } from "./assetProbe";
import { escreverColunaDeTroca } from "./medir";

/**
 * SONDA DA ÁRVORE DA CENA — por que o mundo ficou vazio num quadro.
 *
 * O `rendererProbe` vigia o DEVICE, e o defeito que se persegue acontece com o
 * device saudável: na referência (`desmontando.jpg`) o mundo apaga por ~1 quadro
 * com **0 draw calls**, mas `geo/tex/prog 190/78/20` (geometria toda alocada),
 * `renderer #1` (nunca recriado) e a HUD intacta — ela vive FORA do `<Canvas>`.
 *
 * `GradientSky` é `frustumCulled={false}`, ou seja, desenha sempre. Zero draw
 * calls, então, elimina câmera ruim e culling agressivo: sobra "a cena inteira
 * está invisível" ou "a cena não tem filhos", e geometria intacta descarta o
 * segundo.
 *
 * ## A hipótese, e como ela pode CAIR
 *
 * No `@react-three/fiber` 9.6.1, re-suspender um `<Suspense>` **esconde** os
 * filhos em vez de desmontá-los (`hideInstance` → `object.visible = false`, e
 * `detach` no que entrou por `attach`, como o `<fog>`). Bate com a assinatura.
 *
 * Mas isto é HIPÓTESE, e este módulo é construído para derrubá-la se for o caso.
 * Nenhuma coleta pressupõe Suspense, e o retrato separa as quatro leituras:
 *
 * | leitura | o que é |
 * |---|---|
 * | suspendeu, com asset em voo | a hipótese, com o `.glb` nomeado |
 * | suspendeu, com `emVoo` vazio | suspendeu por outra coisa, não por asset |
 * | não suspendeu e `sceneVisivel: 0` | é o `OcultarCena` da tela de carregamento |
 * | `sceneFilhos: 0` | desmonte de verdade |
 * | filhos visíveis e `objetosRender: 0` | culling ou câmera |
 */

/** de quantos em quantos quadros a árvore é varrida (~10 Hz a 60 FPS) */
export const PASSO_DA_VARREDURA = 6;
/** janela de coalescência dos eventos de chunk */
export const INTERVALO_CHUNKS_MS = 500;

/**
 * Categorias do relatório.
 *
 * Elas saem do nome do ancestral mais próximo, NUNCA de heurística sobre o tipo
 * da malha — num laudo, adivinhação é pior que lacuna. Quem não está sob nenhum
 * grupo nomeado cai em `outros`, que é uma resposta, em vez de ser somado a
 * alguma categoria por engano.
 */
export const GRUPOS: Record<string, string> = {
  "map-props": "props",
  "editor-terrain": "terreno",
  chunks: "chunks",
  agua: "agua",
  "net-entidades": "entidades",
  "skill-vfx": "efeitos",
};

export type PorCategoria = Record<string, number>;

// ---------------------------------------------------------------- estado

let quadros = 0;
let ultimoObjetos = 0;

/**
 * O último estado, para o overlay do F9.
 *
 * Objeto de MÓDULO reusado, e escrito mesmo com o gravador DESLIGADO: quem
 * desliga o voo quer parar de capturar, não de ver o medidor. Mesma regra do
 * `rendererProbe`.
 */
const instantaneo = { filhos: 0, visiveis: 0, suspenso: false, emVoo: 0, visivel: true };

let suspensoes = 0;
let desmontagens = 0;
let montagens = 0;
/**
 * Instantes do ÚLTIMO de cada coisa — "houve?" vira "quando?".
 *
 * `-1` é o sentinela de "nunca aconteceu", e NÃO zero: `performance.now()` vale
 * 0 no primeiro instante da página, então `> 0` como teste de "foi carimbado"
 * perde exatamente a primeira suspensão da sessão — que é a que acontece
 * durante a carga, quando mais asset está em voo.
 */
const NUNCA = -1;
let tSuspensao = NUNCA;
let tRevelacao = NUNCA;
let tDesmontagem = NUNCA;
let tChunk = NUNCA;
let tProps = NUNCA;
/** boundary suspenso AGORA (`null` = nenhum) */
let boundarySuspenso: string | null = null;
let ultimoBoundary = "";

let propsVisiveis = 0;
let chunksNoCache = 0;
let chunkCriadas = 0;
let chunkRemovidas = 0;
let proximoFlushChunk = 0;

/**
 * `scene.children.length` do último quadro que DESENHOU.
 *
 * Não é "o quadro anterior": numa sequência de quadros vazios o "antes" tem de
 * continuar sendo o último estado BOM, senão a comparação vira zero contra zero
 * e não diz nada.
 */
let filhosComDesenho = 0;
/** o quadro anterior desenhou alguma coisa? — é a TRANSIÇÃO que dispara */
let desenhavaAntes = false;

export function zerarCena(): void {
  quadros = 0;
  ultimoObjetos = 0;
  suspensoes = 0;
  desmontagens = 0;
  montagens = 0;
  tSuspensao = NUNCA;
  tRevelacao = NUNCA;
  tDesmontagem = NUNCA;
  tChunk = NUNCA;
  tProps = NUNCA;
  boundarySuspenso = null;
  ultimoBoundary = "";
  propsVisiveis = 0;
  chunksNoCache = 0;
  chunkCriadas = 0;
  chunkRemovidas = 0;
  proximoFlushChunk = 0;
  filhosComDesenho = 0;
  desenhavaAntes = false;
  instantaneo.filhos = 0;
  instantaneo.visiveis = 0;
  instantaneo.suspenso = false;
  instantaneo.emVoo = 0;
  instantaneo.visivel = true;
}

// ---------------------------------------------------------------- marcadores

export function marcarSuspensao(boundary: string, agora = performance.now()): void {
  suspensoes++;
  tSuspensao = agora;
  boundarySuspenso = boundary;
  ultimoBoundary = boundary;
  /**
   * As urls em voo NESTE instante são a resposta de "qual asset iniciou a
   * suspensão" — e a lista vazia é um resultado igualmente válido, que aponta
   * para fora da hipótese em vez de escondê-la.
   */
  registrarEvento("cena", "suspendeu", { boundary, ...diagnosticoDeCache() }, agora);
}

export function marcarRevelacao(boundary: string, agora = performance.now()): void {
  tRevelacao = agora;
  if (boundarySuspenso === boundary) boundarySuspenso = null;
  const resolveu = ultimoAssetResolvido();
  registrarEvento(
    "cena",
    "revelou",
    {
      boundary,
      ms: tSuspensao !== NUNCA ? Math.round(agora - tSuspensao) : null,
      // CANDIDATO, não fato: o React não diz qual promessa destravou o
      // boundary, e o item que acabou de terminar é quem teve a chance de ser
      candidato: resolveu ? resolveu.url : null,
      cargaMs: resolveu ? Math.round(resolveu.duracaoMs) : null,
      origem: resolveu?.origem ?? null,
      vezes: resolveu?.vezes ?? null,
    },
    agora,
  );
}

/**
 * Montagem/desmontagem de QUALQUER subárvore nomeada.
 *
 * Genérica porque a pergunta "quem remontou" não é só da cena: o retrato do HUD
 * recria um contexto WebGL inteiro ao montar, e descobrir QUEM o montou exige
 * marcar HUD, placa e janela separadamente. Nomes distintos são o que
 * transforma "algo remontou" em "o HUD remontou e levou os três retratos".
 *
 * O `caminho` é o rastro de pilha PODADO. O React não conta por que um
 * componente montou, e um rastro é a única evidência disponível de qual
 * commit o originou. Ele só é colhido na montagem — que é rara — e por isso
 * `new Error()` aqui não é o custo que o gravador existe para acusar.
 */
export function marcarMontagemDe(nome: string, dados?: Record<string, unknown>): void {
  registrarEvento("cena", "montou-em", { nome, ...dados, caminho: rastro() });
}

export function marcarDesmontagemDe(nome: string, dados?: Record<string, unknown>): void {
  registrarEvento("cena", "desmontou-em", { nome, ...dados });
}

/**
 * As primeiras linhas úteis da pilha.
 *
 * As duas de cima são sempre esta função e quem a chamou, e o fundo é o
 * agendador do React — nenhum dos dois diz nada. O miolo é o caminho de
 * componentes, que é o que se quer ler no laudo.
 */
function rastro(): string {
  const linhas = (new Error().stack ?? "").split("\n").slice(3, 9);
  return linhas
    .map((l) => l.trim().replace(/^at\s+/, "").replace(/\s*\(.*\)$/, "").replace(/https?:\/\/[^\s)]+/, ""))
    .filter(Boolean)
    .join(" ← ");
}

export function marcarMontagemDaCena(agora = performance.now()): void {
  montagens++;
  registrarEvento("cena", "montou", { montagens }, agora);
}

export function marcarDesmontagemDaCena(agora = performance.now()): void {
  desmontagens++;
  tDesmontagem = agora;
  registrarEvento("cena", "desmontou", { desmontagens }, agora);
}

export function marcarPropsVisiveis(n: number, agora = performance.now()): void {
  if (n === propsVisiveis) return;
  const de = propsVisiveis;
  propsVisiveis = n;
  tProps = agora;
  registrarEvento("cena", "props", { de, para: n }, agora);
}

/**
 * Criação/remoção de chunk, COALESCIDA.
 *
 * A pré-carga são 169 chunks; um evento por chunk inundaria o anel de 512 e
 * expulsaria a rede e a predição, que é justamente o que a captura existe para
 * pôr lado a lado. O carimbo `tChunk`, esse, é atualizado sempre — é ele que
 * responde "houve chunk no mesmo instante?".
 */
export function marcarChunk(criadas: number, removidas: number, cache: number, agora = performance.now()): void {
  chunksNoCache = cache;
  if (criadas === 0 && removidas === 0) return;
  chunkCriadas += criadas;
  chunkRemovidas += removidas;
  tChunk = agora;
  if (agora < proximoFlushChunk) return;
  proximoFlushChunk = agora + INTERVALO_CHUNKS_MS;
  registrarEvento("cena", "chunks", { criadas: chunkCriadas, removidas: chunkRemovidas, cache }, agora);
  chunkCriadas = 0;
  chunkRemovidas = 0;
}

// ---------------------------------------------------------------- varredura

function cameraValida(camera: THREE.Camera | undefined | null): boolean {
  if (!camera) return false;
  const e = camera.matrixWorld?.elements;
  const p = camera.projectionMatrix?.elements;
  if (!e || !p) return false;
  for (const v of e) if (!Number.isFinite(v)) return false;
  for (const v of p) if (!Number.isFinite(v)) return false;
  const c = camera as unknown as { near?: number; far?: number };
  if (typeof c.near === "number" && typeof c.far === "number" && !(c.near < c.far)) return false;
  return true;
}

interface NoDaCena {
  visible: boolean;
  name?: string;
  children?: NoDaCena[];
  geometry?: unknown;
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
}

function renderizavel(o: NoDaCena): boolean {
  return Boolean((o.isMesh || o.isPoints || o.isLine) && o.geometry);
}

/**
 * Conta malhas VISÍVEIS, atribuindo cada uma à categoria do ancestral nomeado
 * mais próximo.
 *
 * Desce só por nó visível: um pai invisível esconde a subárvore inteira no
 * three, então contar filhos dele mentiria — e é exatamente esse o caso que se
 * está investigando.
 */
export function contarPorCategoria(raiz: NoDaCena): { total: number; porCategoria: PorCategoria } {
  const porCategoria: PorCategoria = {};
  let total = 0;
  const andar = (o: NoDaCena, categoria: string) => {
    if (!o.visible) return;
    const cat = (o.name && GRUPOS[o.name]) || categoria;
    if (renderizavel(o)) {
      total++;
      porCategoria[cat] = (porCategoria[cat] ?? 0) + 1;
    }
    const filhos = o.children;
    if (filhos) for (const f of filhos) andar(f, cat);
  };
  if (!raiz.visible) return { total: 0, porCategoria };
  for (const f of raiz.children ?? []) andar(f, "outros");
  return { total, porCategoria };
}

/**
 * Uma amostra por quadro — chamada pelo `PerfProbe` em prioridade −1000.
 *
 * O que é O(1) vai todo quadro. A VARREDURA é amostrada a ~10 Hz porque a cena
 * passa de mil `Object3D` com props e entidades, e o gravador não pode produzir
 * o custo que ele existe para acusar. Entre amostras a coluna guarda o último
 * valor, que é o comportamento que o rascunho do gravador já documenta — e no
 * quadro que importa (o do gatilho) o número é exato, porque o retrato varre
 * tudo.
 */
export function amostrarCena(
  scene: THREE.Scene | null,
  camera: THREE.Camera | null,
  drawCalls: number,
  agora = performance.now(),
): void {
  quadros++;
  if (!scene) return;

  if (quadros % PASSO_DA_VARREDURA === 0) {
    ultimoObjetos = contarPorCategoria(scene as unknown as NoDaCena).total;
  }

  const suspensoMs = boundarySuspenso !== null && tSuspensao !== NUNCA ? agora - tSuspensao : 0;

  instantaneo.filhos = scene.children.length;
  instantaneo.visiveis = ultimoObjetos;
  instantaneo.suspenso = boundarySuspenso !== null;
  instantaneo.visivel = scene.visible;

  if (ativo()) {
    const q = quadro();
    q.sceneFilhos = scene.children.length;
    q.sceneVisivel = scene.visible ? 1 : 0;
    q.objetosRender = ultimoObjetos;
    q.cameraId = camera?.id ?? 0;
    q.cameraOk = cameraValida(camera) ? 1 : 0;
    q.chunksNoCache = chunksNoCache;
    q.propsVisiveis = propsVisiveis;
    q.suspensoes = suspensoes;
    q.desmontagensCena = desmontagens;
    q.suspensoMs = suspensoMs;
    escreverColunaDeAssets();
    instantaneo.emVoo = q.assetsEmVoo;
  }

  /**
   * FORA do `if (ativo())`, e isso não é detalhe.
   *
   * O `medir()` acumula sempre que roda em DEV, mas quem ZERA o acumulador é
   * esta escrita. Dentro do `if`, um período com o voo desligado empilhava tudo
   * e despejava o total no PRIMEIRO quadro gravado: no
   * `voo-1785966296680.json` isso saiu como `trocaMs.max = 514,5 ms` num dump
   * sem um único evento `cena/custo` e sem portal nenhum — um pico fantasma,
   * exatamente o tipo de coisa que já custou rodadas de investigação.
   *
   * Escrever no rascunho com o gravador parado é inofensivo: aquela linha nunca
   * é confirmada.
   */
  escreverColunaDeTroca();

  // o "antes" do retrato é o último estado BOM, não o quadro anterior
  if (drawCalls > 0) filhosComDesenho = scene.children.length;
}

/**
 * A TRANSIÇÃO para zero — separada da amostra porque quem a avalia precisa do
 * retrato, e o retrato é caro.
 *
 * Só a transição dispara. Durante a tela de carregamento a cena é apagada de
 * propósito (`OcultarCena`) e os draw calls ficam em zero por centenas de
 * quadros; um gatilho por VALOR queimaria os quatro slots ali, antes de o jogo
 * começar.
 */
export function avaliarMundoVazio(
  gl: THREE.WebGLRenderer | null,
  scene: THREE.Scene | null,
  camera: THREE.Camera | null,
  drawCalls: number,
): void {
  const desenhaAgora = drawCalls > 0;
  const caiuAZero = desenhavaAntes && !desenhaAgora;
  desenhavaAntes = desenhaAgora;
  if (!caiuAZero || !ativo()) return;

  /**
   * NÃO DESENHAR DE PROPÓSITO NÃO É DEFEITO.
   *
   * Trocar de mapa desmonta a `<Scene>` e o `OcultarCena` apaga o que sobra
   * enquanto a tela de carregamento está no ar — os draw calls vão a zero
   * porque foi assim que se pediu. No `voo-1785940564494.json` isso produziu
   * DOIS casos `mundoVazio` (`sceneVisivel: false`, `filhosDepois: 0`,
   * `nomesDeFilhos: []`, `desmontagemHaMs: 4`) e queimou dois dos quatro slots,
   * exatamente como os rollbacks de portal tinham feito antes.
   *
   * A separação é limpa e não precisa de acoplamento nenhum: o defeito de
   * verdade (o Suspense escondendo a cena) tinha `sceneVisivel: true` e dez
   * filhos; o portal tem `false` e zero. Cena viva que para de desenhar é o que
   * este gatilho existe para pegar.
   *
   * Continua saindo EVENTO — só não vira captura. Perder a informação seria
   * trocar um falso positivo por um ponto cego, e a tela de carregamento
   * demorando demais é coisa que se vai querer ler na timeline.
   */
  const viva = Boolean(scene && scene.visible && scene.children.length > 0);
  if (!viva) {
    registrarEvento("cena", "vazio-esperado", {
      visivel: scene?.visible ?? null,
      filhos: scene?.children.length ?? 0,
      desmontagens,
    });
    return;
  }
  avaliarGatilho("mundoVazio", 1, retratoDaCena(gl, scene, camera));
}

/**
 * O retrato completo — só no gatilho, e por isso pode varrer tudo.
 *
 * Todo item de "houve?" sai como "há quantos ms": é a distância que liga causa a
 * efeito, e um booleano não liga.
 */
export function retratoDaCena(
  gl: THREE.WebGLRenderer | null,
  scene: THREE.Scene | null,
  camera: THREE.Camera | null,
  agora = performance.now(),
): Record<string, unknown> {
  const ctx = (() => {
    try {
      return gl?.getContext() ?? null;
    } catch {
      return null;
    }
  })();
  const conta = scene ? contarPorCategoria(scene as unknown as NoDaCena) : { total: 0, porCategoria: {} };
  const emVoo = assetsEmVoo();
  const resolveu = ultimoAssetResolvido();
  const desde = (t: number) => (t !== NUNCA ? Math.round(agora - t) : null);

  return {
    rendererOk: Boolean(gl),
    contextoOk: ctx ? !ctx.isContextLost() : false,
    cameraOk: cameraValida(camera),
    cameraId: camera?.id ?? null,

    filhosAntes: filhosComDesenho,
    filhosDepois: scene?.children.length ?? 0,
    sceneVisivel: scene?.visible ?? null,
    // o primeiro nível é onde se enxerga O QUE sumiu
    nomesDeFilhos: (scene?.children ?? [])
      .map((f) => `${f.name || f.type}${f.visible ? "" : "(oculto)"}`)
      .slice(0, 24),

    objetosRender: conta.total,
    porCategoria: conta.porCategoria,

    chunksNoCache,
    propsVisiveis,
    chunkHaMs: desde(tChunk),
    propsMudouHaMs: desde(tProps),

    boundary: boundarySuspenso ?? (ultimoBoundary || null),
    suspensoAgora: boundarySuspenso !== null,
    suspenseHaMs: desde(tSuspensao),
    revelacaoHaMs: desde(tRevelacao),
    suspensoes,
    desmontagemHaMs: desde(tDesmontagem),
    desmontagens,

    ...diagnosticoDeCache(),
    assetsEmVoo: emVoo.map((a) => `${a.url} (${Math.round(a.desde)} ms)`),
    ultimoResolvido: resolveu
      ? { url: resolveu.url, ms: Math.round(resolveu.duracaoMs), origem: resolveu.origem, vezes: resolveu.vezes }
      : null,
  };
}

/** para o overlay do F9 — vale com o gravador desligado */
export function instantaneoDaCena(): Readonly<typeof instantaneo> {
  return instantaneo;
}
