import { ativo, quadro, registrarEvento } from "./flightRecorder";

/**
 * SONDA DE CARREGAMENTO — quem estava sendo baixado quando o mundo apagou.
 *
 * ## Por que o carregador, e não o componente
 *
 * O React não conta O QUE suspendeu, só que suspendeu: a promessa é lançada
 * durante o render e o boundary a captura sem nome nem origem. Perguntar ao
 * `PropInstance` responderia só sobre props, e ainda seria PALPITE ("este
 * `useGLTF` provavelmente vai suspender"). Quem sabe de verdade é o CARREGADOR.
 *
 * `THREE.DefaultLoadingManager` é o ponto certo porque é geral: o `GLTFLoader`
 * que o drei constrói dentro do `useGLTF` não recebe manager próprio, então cai
 * no default — e o mesmo vale para `TextureLoader` e qualquer outro. Uma sonda
 * só cobre glb de prop, glb de personagem, textura de terreno e o que vier
 * depois.
 *
 * `itemStart`/`itemEnd`/`itemError` são propriedades de INSTÂNCIA do
 * `LoadingManager` (o construtor as atribui), então são embrulháveis e
 * restauráveis — o mesmo mecanismo que o `rendererProbe` usa em `gl.render` e
 * `gl.dispose`.
 *
 * ## A regra que não pode ser quebrada
 *
 * O embrulho SEMPRE chama o original. Este módulo observa o caminho por onde
 * passa todo asset do jogo; engasgar aqui não atrapalharia a medição, pararia o
 * carregamento.
 */

/** acima disto o asset sai em evento PRÓPRIO, com url — asset lento é o suspeito */
export const ASSET_LENTO_MS = 100;
/**
 * Abaixo disto a carga provavelmente veio do cache HTTP do navegador.
 *
 * HEURÍSTICA, e rotulada como tal no dado: não existe forma de perguntar ao
 * `fetch` de dentro do three se houve hit de disco. 30 ms é curto demais para
 * uma ida à rede e longo o bastante para caber parse de um glb pequeno.
 */
export const LIMIAR_REDE_MS = 30;
/** janela de coalescência dos eventos de asset (a carga do mapa dispara dezenas) */
export const INTERVALO_ASSETS_MS = 500;

export interface AssetEmVoo {
  url: string;
  desde: number;
}

export interface AssetResolvido {
  url: string;
  duracaoMs: number;
  /** ver `LIMIAR_REDE_MS` — heurística, não fato */
  origem: "rede" | "cache-http";
  /** quantas vezes ESTA url passou pelo carregador (>1 = o cache do drei não a reteve) */
  vezes: number;
}

// ---------------------------------------------------------------- estado

const emVoo = new Map<string, number>();
/** quantas vezes cada url passou pelo carregador, e o último tempo de carga */
const historico = new Map<string, { vezes: number; ultimaDuracaoMs: number }>();
/** o último item que TERMINOU — é o candidato a "resolveu a promessa" */
let ultimoResolvido: AssetResolvido | null = null;

/** deltas coalescidos */
let comecados = 0;
let terminados = 0;
let falhados = 0;
let proximoFlush = 0;

let desfazer: (() => void) | null = null;

// ---------------------------------------------------------------- leitura

/** as urls que estão sendo carregadas AGORA — a resposta de "quem suspendeu" */
export function assetsEmVoo(): AssetEmVoo[] {
  const agora = performance.now();
  const fora: AssetEmVoo[] = [];
  for (const [url, desde] of emVoo) fora.push({ url, desde: agora - desde });
  return fora;
}

export function quantosEmVoo(): number {
  return emVoo.size;
}

/**
 * O último asset que terminou de carregar.
 *
 * Chamado na REVELAÇÃO de um boundary, ele é a melhor resposta disponível para
 * "qual recurso resolveu a promessa": o React não informa qual promessa
 * destravou o boundary, mas o item que acabou de terminar imediatamente antes é
 * quem tem a chance de ter sido. Vai rotulado como candidato, não como fato.
 */
export function ultimoAssetResolvido(): AssetResolvido | null {
  return ultimoResolvido;
}

/**
 * Diagnóstico de cache para uma suspensão.
 *
 * São DOIS caches e confundi-los daria a conclusão errada:
 *
 * - o do drei (`useLoader`) devolve o resultado SEM chamar o loader. Então
 *   `itemStart` disparar já significa **miss** dele;
 * - suspender sem NENHUM asset em voo é o contrário: ou foi hit do drei (que
 *   não deveria suspender — e observar isso seria a descoberta), ou o que
 *   suspendeu não é asset nenhum.
 */
export function diagnosticoDeCache(): { cache: "miss" | "sem-asset"; emVoo: string[] } {
  const urls = [...emVoo.keys()];
  return { cache: urls.length > 0 ? "miss" : "sem-asset", emVoo: urls };
}

/** só para o teste */
export function zerarAssets(): void {
  emVoo.clear();
  historico.clear();
  ultimoResolvido = null;
  comecados = 0;
  terminados = 0;
  falhados = 0;
  proximoFlush = 0;
}

// ---------------------------------------------------------------- coalescência

function talvezEmitir(agora: number): number {
  if (agora < proximoFlush) return 0;
  proximoFlush = agora + INTERVALO_ASSETS_MS;
  if (comecados === 0 && terminados === 0 && falhados === 0) return 0;
  registrarEvento(
    "cena",
    "assets",
    { comecados, terminados, falhados, emVoo: emVoo.size },
    agora,
  );
  comecados = 0;
  terminados = 0;
  falhados = 0;
  return 1;
}

// ---------------------------------------------------------------- registro

/**
 * O formato mínimo do `LoadingManager` que esta sonda toca — declarado aqui
 * para o teste poder passar um objeto simples, sem three.
 */
export interface GerenciadorObservavel {
  itemStart(url: string): void;
  itemEnd(url: string): void;
  itemError(url: string): void;
}

/**
 * Passa a observar um `LoadingManager` (por padrão o global do three).
 *
 * Devolve a limpeza. Chamada uma vez, no boot, em DEV: o manager é global e a
 * sonda tem de existir antes do primeiro asset — instalada depois, ela perderia
 * exatamente a carga inicial.
 */
export function observarCarregamento(manager: GerenciadorObservavel): () => void {
  // idempotente: um segundo registro empilharia embrulhos e contaria em dobro
  if (desfazer) return desfazer;

  /**
   * Guarda a REFERÊNCIA original, não uma cópia com `bind`.
   *
   * Restaurar um `bind` devolveria uma função equivalente mas DIFERENTE, e
   * quem tivesse guardado a original em outro lugar passaria a olhar para um
   * objeto que não é mais o do manager. A chamada usa `.call(manager, …)`, que
   * dá o mesmo `this` sem criar função nova.
   */
  const inicioOriginal = manager.itemStart;
  const fimOriginal = manager.itemEnd;
  const erroOriginal = manager.itemError;

  manager.itemStart = (url: string) => {
    const agora = performance.now();
    emVoo.set(url, agora);
    comecados++;
    if (ativo()) talvezEmitir(agora);
    // SEMPRE o original: este é o caminho por onde passa todo asset do jogo
    inicioOriginal.call(manager, url);
  };

  manager.itemEnd = (url: string) => {
    const agora = performance.now();
    const desde = emVoo.get(url);
    emVoo.delete(url);
    terminados++;
    if (desde !== undefined) {
      const duracaoMs = agora - desde;
      const h = historico.get(url) ?? { vezes: 0, ultimaDuracaoMs: 0 };
      h.vezes++;
      h.ultimaDuracaoMs = duracaoMs;
      historico.set(url, h);
      ultimoResolvido = {
        url,
        duracaoMs,
        origem: duracaoMs < LIMIAR_REDE_MS ? "cache-http" : "rede",
        vezes: h.vezes,
      };
      /**
       * Asset LENTO não pode ser diluído numa soma.
       *
       * A coalescência existe para a carga do mapa não inundar o anel de 512
       * eventos, mas o asset demorado é justamente o suspeito de segurar o
       * boundary — ele sai individual, com a url.
       */
      if (ativo() && duracaoMs >= ASSET_LENTO_MS) {
        registrarEvento(
          "cena",
          "asset-lento",
          { url, ms: Math.round(duracaoMs), origem: ultimoResolvido.origem, vezes: h.vezes },
          agora,
        );
      }
    }
    if (ativo()) talvezEmitir(agora);
    fimOriginal.call(manager, url);
  };

  manager.itemError = (url: string) => {
    const agora = performance.now();
    // sem isto a url fica pendurada no `emVoo` para sempre e todo retrato
    // seguinte acusaria um asset em voo que já morreu
    emVoo.delete(url);
    falhados++;
    // erro é raro e é causa possível do apagão (a promessa resolve pelo caminho
    // errado): sai individual, sem coalescer
    if (ativo()) registrarEvento("cena", "asset-erro", { url }, agora);
    erroOriginal.call(manager, url);
  };

  desfazer = () => {
    manager.itemStart = inicioOriginal;
    manager.itemEnd = fimOriginal;
    manager.itemError = erroOriginal;
    desfazer = null;
  };
  return desfazer;
}

/** escreve a coluna do quadro — chamada pelo `cenaProbe` */
export function escreverColunaDeAssets(): void {
  quadro().assetsEmVoo = emVoo.size;
}
