/**
 * DEDUPLICAÇÃO DE TEXTURA entre arquivos glTF.
 *
 * ## O defeito, medido
 *
 * `forest_texture.png` tem **48 KB em disco**, é 1024×1024, e é referenciado por
 * **101 dos 105 `.gltf`** do pacote Forest. Cada `.gltf` é um DOCUMENTO à parte:
 * o `GLTFLoader` cria um `THREE.Texture` novo por arquivo, e o cache do drei é
 * chaveado pela url do GLTF — não da imagem —, então ele nunca enxerga que são a
 * mesma coisa.
 *
 * O censo do `prt_fild08` mediu **225,12 MB de textura na cena**; dividido pelos
 * 5,33 MB de uma 1024² RGBA8 com mipmap, dá **~42 cópias do mesmo arquivo**.
 * 48 KB viram 224 MB — fator de 4.700×.
 *
 * O sinal já tinha aparecido antes e foi subestimado: o `assetProbe` registrou
 * `forest_texture.png` com `vezes: 5` no `voo-1785932685455.json`. E o
 * `gl.info.memory.textures` não denuncia nada, porque ele conta OBJETOS —
 * contagem de recurso não distingue reúso de duplicata.
 *
 * ## Como
 *
 * Um cache de módulo por FONTE da imagem. A primeira textura de cada fonte vira
 * a canônica; as seguintes são substituídas por ela em todo material que as
 * usava.
 *
 * **Muta a cena do cache do `useGLTF` de propósito, e ANTES de qualquer clone**
 * — a mesma decisão (e o mesmo motivo) do `fundirSkinned`: deduplicar depois, em
 * cada clone, pagaria a varredura por instância que nasce. Idempotente pelo
 * `WeakSet`, então o StrictMode chamando duas vezes não faz diferença.
 */

/** o mínimo que este módulo toca — `unknown` no resto, para o teste rodar sem three */
interface Tex {
  uuid?: string;
  name?: string;
  isTexture?: boolean;
  /**
   * `src` só existe quando a imagem é um `HTMLImageElement`.
   *
   * No Chrome o `GLTFLoader` usa `ImageBitmapLoader` (GLTFLoader.js:2682), e um
   * `ImageBitmap` **não tem `src`** — foi por isso que a primeira versão deste
   * módulo não deduplicou nada: a chave devolvia `null` para toda textura e o
   * censo continuou acusando 40 cópias. Fica como o último recurso; a
   * identidade de verdade vem do parser (ver `fonteDaTextura`).
   */
  image?: { src?: string };
  wrapS?: number;
  wrapT?: number;
  colorSpace?: string;
  flipY?: boolean;
  channel?: number;
  dispose?: () => void;
}

/**
 * O que se usa do glTF carregado, além da cena.
 *
 * `parser.associations` mapeia cada `THREE.Texture` de volta ao índice dela no
 * documento (GLTFLoader.js:3347), e daí se chega à `uri` da imagem. É a única
 * identidade EXATA disponível — o resto é palpite.
 */
export interface GltfMinimo {
  scene?: No | null;
  parser?: {
    associations?: { get(k: unknown): { textures?: number } | undefined };
    json?: {
      textures?: { source?: number }[];
      images?: { uri?: string }[];
    };
    options?: { path?: string };
  };
}

interface Mat {
  uuid?: string;
  [slot: string]: unknown;
}

interface No {
  material?: Mat | Mat[];
  children?: No[];
}

/** a textura escolhida para cada fonte — vive enquanto o módulo viver */
const canonicas = new Map<string, Tex>();
/** cenas já processadas; o `useGLTF` cacheia por url e a varredura é uma vez só */
const jaFeitas = new WeakSet<object>();

/**
 * A chave inclui as CONFIGURAÇÕES, não só a url.
 *
 * Duas texturas da mesma imagem com `wrapS` ou `colorSpace` diferentes não são
 * intercambiáveis — trocar uma pela outra mudaria como o prop aparece. No pacote
 * Forest elas saem todas do mesmo exportador e batem, mas depender disso seria
 * assumir; incluir as configurações na chave torna a troca correta por
 * construção, e no pior caso a deduplicação simplesmente não acontece.
 *
 * Devolve `null` quando não há fonte identificável: imagem embutida num `.glb`
 * ganha um blob diferente a cada carga, e ali duas texturas iguais são
 * indistinguíveis de duas diferentes. Não deduplicar é a resposta segura.
 */
export function chaveDaTextura(t: Tex, parser?: GltfMinimo["parser"]): string | null {
  const fonte = fonteDaTextura(t, parser);
  if (!fonte) return null;
  return [fonte, t.wrapS ?? "", t.wrapT ?? "", t.colorSpace ?? "", t.flipY ?? "", t.channel ?? ""].join("|");
}

/**
 * A URL da imagem por trás desta textura — pelo PARSER, não pelo objeto.
 *
 * `texture.image.src` seria o caminho óbvio e não funciona: no Chrome o
 * `GLTFLoader` carrega por `ImageBitmapLoader` e um `ImageBitmap` não tem
 * `src`. O parser, porém, guarda o vínculo textura → índice no documento, e do
 * índice se chega a `images[n].uri`, que é o nome do arquivo no disco.
 *
 * Devolve `null` para imagem EMBUTIDA (`bufferView` em vez de `uri`): ali dois
 * documentos com a mesma imagem são indistinguíveis, e não deduplicar é a
 * resposta segura.
 */
export function fonteDaTextura(t: Tex, parser?: GltfMinimo["parser"]): string | null {
  const assoc = parser?.associations?.get(t);
  const iTex = assoc?.textures;
  if (typeof iTex === "number") {
    const iImg = parser?.json?.textures?.[iTex]?.source;
    const uri = typeof iImg === "number" ? parser?.json?.images?.[iImg]?.uri : undefined;
    // sem `uri` a imagem veio de um `bufferView` (embutida no .glb)
    if (uri && !uri.startsWith("data:")) return `${parser?.options?.path ?? ""}${uri}`;
    return null;
  }
  // fora de um glTF (ou parser indisponível): o `src` ainda serve quando a
  // imagem é um `HTMLImageElement`
  const src = t.image?.src;
  if (!src || src.startsWith("blob:") || src.startsWith("data:")) return null;
  return src;
}

function ehTextura(v: unknown): v is Tex {
  return Boolean(v && typeof v === "object" && (v as Tex).isTexture);
}

/**
 * Troca as texturas duplicadas desta cena pelas canônicas. Devolve quantas
 * referências foram trocadas — 0 na segunda chamada, e é assim que se confere
 * que a idempotência funciona.
 */
export function compartilharTexturas(gltf: GltfMinimo | null | undefined): number {
  const raiz = gltf?.scene;
  if (!raiz || jaFeitas.has(raiz)) return 0;
  jaFeitas.add(raiz);
  const parser = gltf?.parser;

  let trocadas = 0;
  /** duplicatas que ficaram sem NENHUMA referência — só essas podem ser descartadas */
  const orfas = new Set<Tex>();

  const emMaterial = (mat: Mat) => {
    for (const [slot, valor] of Object.entries(mat)) {
      if (!ehTextura(valor)) continue;
      const chave = chaveDaTextura(valor, parser);
      if (!chave) continue;
      const canonica = canonicas.get(chave);
      if (!canonica) {
        canonicas.set(chave, valor);
        continue;
      }
      if (canonica === valor) continue;
      mat[slot] = canonica;
      orfas.add(valor);
      trocadas++;
    }
  };

  const andar = (o: No) => {
    const lista = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of lista) if (m) emMaterial(m);
    for (const f of o.children ?? []) andar(f);
  };
  andar(raiz);

  /**
   * Descartar a órfã é barato e quase sempre um no-op de GPU.
   *
   * A deduplicação roda ANTES do primeiro desenho (no `useMemo`, antes do clone
   * entrar na cena), então a duplicata normalmente nunca chegou a ser enviada
   * para a GPU e não há o que liberar. O `dispose()` fica pelo caso em que ela
   * chegou — um `.gltf` carregado e desenhado antes de outro que compartilha a
   * mesma imagem.
   */
  for (const t of orfas) t.dispose?.();
  return trocadas;
}

/** quantas fontes distintas o cache conhece — para o diagnóstico e o teste */
export function fontesConhecidas(): number {
  return canonicas.size;
}

/** só para o teste: o cache é de módulo e sobrevive entre casos */
export function zerarTexturasCompartilhadas(): void {
  canonicas.clear();
}
