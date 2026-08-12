import { useGLTF } from "@react-three/drei";
import forestCatalog from "./forest-catalog.json";
import hexDecorCatalog from "./hex-decor-catalog.json";
import hexTilesCatalog from "./hex-tiles-catalog.json";
import natureCatalog from "./nature-catalog.json";

/**
 * Registro de props do mundo (skill-r3f-conventions): assetId (usado no
 * GameMap.props e no editor 3D) → url do glTF. As listas vêm de
 * nature-catalog.json (Quaternius, `assets-new/editor-map` → `/assets/
 * nature` — vegetação/pedra ATIVA do editor), hex-decor-catalog.json/
 * hex-tiles-catalog.json (KayKit Hexagon: construções — `/assets/hex`, ainda
 * ativa) e forest-catalog.json (Forest_Nature_map — `/assets/props`,
 * DESATIVADA: ver `hidden` abaixo). Resolução de prop fica só aqui — nunca
 * hardcode um assetId como string mágica fora deste arquivo.
 */

export interface PropCatalogEntry {
  id: string;
  file: string;
  cat: string;
  label: string;
  /** montada aqui a partir de `file` (props/hex/nature) — não vem do JSON cru */
  url: string;
  /** escala inicial ao colocar no editor (alguns assets são pequenos → 5) */
  defaultScale?: number;
  /** raio (unidades locais) do círculo que envolve o `hull` — broad-phase */
  radius?: number;
  /** raio VISUAL do modelo inteiro (copa/telhado) em unidades locais. NÃO é
   * colisão: é quanto o objeto ocupa na cena, pro gerador procedural não
   * empilhar assets — a copa da árvore conta aqui, mas não barra o personagem. */
  spread?: number;
  /** POLÍGONO CONVEXO da base do modelo em XZ local, medido do glTF por
   * `scripts/measure-props.mjs`. É o bloco de colisão real: planta do castelo,
   * tronco da árvore (não a copa). Escalado/rotacionado pelo transform do prop
   * em createHexTerrainQuery. */
  hull?: [number, number][];
  /** só PONTE: piso em que se anda, medido do glTF. `y` acima da origem do
   * prop, `hx`/`hz` = meio-vão — tudo em unidades locais. */
  deck?: { y: number; hx: number; hz: number };
  /**
   * FORA da paleta/geração procedural, mas ainda RESOLVE (`PROP_URLS`) — é o
   * que separa "descontinuado" de "apagado". Migração `nature-catalog`
   * (2026-08): `forest-catalog` (grama/arbusto/árvore/árvore seca/rocha) saiu
   * de circulação, mas mapa já salvo com esses assetIds (ex.: `gpqa01`) não
   * pode virar prop invisível — `PropInstance` resolveria `undefined` e
   * simplesmente sumiria a planta, calado. `hidden` existe pra isso: item
   * some do picker e do scatter novo, sem quebrar posição já gravada.
   */
  hidden?: boolean;
}

// forest: file sem subdir → /assets/props ; hex: file já traz "hex/" → /assets ; nature: /assets/nature
type RawEntry = Omit<PropCatalogEntry, "url">;
const FOREST = (forestCatalog as RawEntry[]).map((e) => ({ ...e, url: `/assets/props/${e.file}`, hidden: true }));
const HEX = [...(hexDecorCatalog as RawEntry[]), ...(hexTilesCatalog as RawEntry[])].map((e) => ({ ...e, url: `/assets/${e.file}` }));
const NATURE = (natureCatalog as RawEntry[]).map((e) => ({ ...e, url: `/assets/nature/${e.file}` }));

export const PROP_CATALOG: PropCatalogEntry[] = [...HEX, ...NATURE, ...FOREST];

// TODOS entram aqui, hidden incluso — resolução de assetId→url nunca pode
// falhar por causa de descontinuação (ver `hidden` na interface)
export const PROP_URLS: Record<string, string> = Object.fromEntries(PROP_CATALOG.map((e) => [e.id, e.url]));

/** assetIds VISÍVEIS, pra dropdown/paleta do editor — hidden fica de fora */
export const PROP_IDS = PROP_CATALOG.filter((e) => !e.hidden).map((e) => e.id);

/** categorias (ordem de exibição na paleta) → entradas VISÍVEIS (hidden não
 * aparece no picker nem entra em `SCATTER_CATEGORIES`/geração procedural —
 * só em `PROP_URLS`, pra mapa antigo continuar resolvendo) */
export const PROP_BY_CATEGORY: { cat: string; label: string; items: PropCatalogEntry[] }[] = (() => {
  const order = ["tree", "tree_bare", "bush", "grass", "flower", "plant", "rock", "stone", "hill", "mountain", "building", "road", "river", "coast", "ramp", "bridge", "other"];
  const labels: Record<string, string> = {
    tree: "Árvores",
    tree_bare: "Árvores secas",
    bush: "Arbustos",
    grass: "Grama",
    flower: "Flores",
    plant: "Plantas",
    rock: "Rochas",
    stone: "Pedras",
    hill: "Colinas",
    mountain: "Montanhas",
    building: "Casas & Construções",
    road: "Estradas",
    river: "Rios",
    coast: "Costa",
    ramp: "Rampas",
    bridge: "Pontes",
    other: "Outros",
  };
  const groups = new Map<string, PropCatalogEntry[]>();
  for (const e of PROP_CATALOG) {
    if (e.hidden) continue;
    if (!groups.has(e.cat)) groups.set(e.cat, []);
    groups.get(e.cat)!.push(e);
  }
  return order
    .filter((c) => groups.has(c))
    .map((c) => ({ cat: c, label: labels[c] ?? c, items: groups.get(c)! }));
})();

const BY_ID: Record<string, PropCatalogEntry> = Object.fromEntries(PROP_CATALOG.map((e) => [e.id, e]));

export function propUrl(assetId: string): string | undefined {
  return PROP_URLS[assetId];
}

/** nome amigável do asset (paleta/hierarquia/inspector) */
export function propLabel(assetId: string): string {
  return BY_ID[assetId]?.label ?? assetId;
}

/** categoria do asset (tree/rock/building/road/…) — usada na regra que impede
 * scatter de vegetação sobre construções/estradas/rios. */
export function propCategory(assetId: string): string | undefined {
  return BY_ID[assetId]?.cat;
}

/** categorias que OCUPAM a célula pela SUPERFÍCIE do terreno (não por prop):
 * tiles de estrada/rio/costa não têm entrada em MapProp, são derivados da
 * superfície pelo HexTerrain — mesmo assim bloqueiam scatter de vegetação. */
export const OCCUPYING_CATEGORIES = new Set(["building", "road", "river", "coast"]);

/** categorias "sólidas": ocupam espaço físico de verdade — nenhum outro asset
 * AUTO-GERADO pode nascer em cima (regra do usuário: montanha nunca em cima de
 * árvore/rio/estrada/pedra/construção, e nenhum auto-asset empilha sobre outro
 * em geral). Usada por occupiedCells() pra bloquear TODO scatter, não só
 * vegetação-sobre-construção como antes. */
export const SOLID_CATEGORIES = new Set(["building", "road", "river", "coast", "tree", "rock", "hill", "mountain", "tree_bare"]);

/** categorias espalháveis pelo gerador procedural (as demais — estradas/rios —
 * são manuais/geração conectada, fora do scatter aleatório). `flower`/`plant`/
 * `stone` entraram com o pacote `nature-catalog` (2026-08) — mesmo tratamento
 * raso de `grass`/`bush`: sem colisão, sem bloquear outro scatter em cima. */
export const SCATTER_CATEGORIES = ["tree", "rock", "hill", "mountain", "building", "tree_bare", "bush", "grass", "flower", "plant", "stone"];

/** collider físico por categoria (Rapier, ver PropInstance): sólidos ganham
 * "hull" (convex hull, encaixa a área ocupada na escala do objeto); decoração
 * rasteira/sem-volume não colide — regra do usuário. */
const COLLIDER_BY_CATEGORY: Record<string, "hull" | "none"> = {
  mountain: "hull",
  tree: "hull",
  rock: "hull",
  hill: "hull",
  building: "hull",
  tree_bare: "hull",
  bush: "none",
  grass: "none",
  flower: "none",
  plant: "none",
  stone: "none",
  road: "none",
  river: "none",
  coast: "none",
  ramp: "none",
  bridge: "none",
  other: "none",
};

/** collider a usar ao colocar/gerar um asset (por categoria do catálogo) */
export function colliderForCategory(cat: string | undefined): "hull" | "none" {
  return (cat ? COLLIDER_BY_CATEGORY[cat] : undefined) ?? "none";
}

/**
 * Exceções por ASSET dentro de uma categoria que colide. São peças rasas,
 * "pintadas" no chão — o personagem passa por dentro (regra do usuário):
 * plantação e terra batida têm 0.39 e 0.07 de altura, não são obstáculo.
 */
const WALKTHROUGH_ASSETS = new Set(["hex_building_grain", "hex_building_dirt"]);

/** collider de um asset específico: exceção primeiro, senão a categoria */
export function colliderForAsset(assetId: string): "hull" | "none" {
  if (WALKTHROUGH_ASSETS.has(assetId)) return "none";
  return colliderForCategory(propCategory(assetId));
}

/** o asset é uma PONTE? (passagem por cima da água — ver createHexTerrainQuery) */
export function isBridgeProp(assetId: string): boolean {
  return propCategory(assetId) === "bridge";
}

/**
 * Categorias que NÃO são decoração: são o próprio CHÃO da célula. O HexTerrain
 * desenha essas peças a partir de `surface` (e da conectividade dos vizinhos),
 * não de MapProp — colocar uma como prop deixaria o tile de grama embaixo,
 * atravessando o modelo. Ver `placeTileAsset` no editorStore: colocar um desses
 * PINTA a superfície da célula em vez de criar objeto.
 */
export const TILE_SURFACE_BY_CATEGORY: Record<string, "dirt" | "river" | "grass"> = {
  road: "dirt",
  river: "river",
  coast: "grass", // a faixa de areia é derivada de ter água vizinha
  ramp: "grass", // a rampa vem de map.ramps (borda de descida), não de prop
};

/** o asset é uma peça de CHÃO (pinta superfície) em vez de decoração? */
export function tileSurfaceFor(assetId: string): "dirt" | "river" | "grass" | undefined {
  const cat = propCategory(assetId);
  return cat ? TILE_SURFACE_BY_CATEGORY[cat] : undefined;
}

/** TABULEIRO da ponte em unidades LOCAIS (medido do .gltf por
 * scripts/measure-props.mjs): `y` = altura do piso acima da origem do prop,
 * `hx`/`hz` = meio-vão. É o único prop em que se anda POR CIMA, então a
 * travessia sai daqui e não de um palpite de altura. */
export function propDeck(assetId: string): { y: number; hx: number; hz: number } | undefined {
  return BY_ID[assetId]?.deck;
}

/** raio de COLISÃO já escalado: círculo que envolve o `hull` da base do modelo
 * × a escala do prop. Serve de broad-phase — quem decide de fato é o polígono
 * (propHull). Sem medida no catálogo, cai num raio genérico. */
export function propRadius(assetId: string, scale = 1): number {
  const r = BY_ID[assetId]?.radius;
  return (r != null ? r : 0.5) * scale;
}

/** raio VISUAL já escalado — espaço ocupado na cena (não é colisão). Usado
 * pelo gerador procedural pra não nascer asset em cima de asset. */
export function propSpread(assetId: string, scale = 1): number {
  const e = BY_ID[assetId];
  return (e?.spread ?? e?.radius ?? 0.5) * scale;
}

/** polígono de colisão do asset (XZ local, convexo). undefined = usa só o raio */
export function propHull(assetId: string): readonly (readonly [number, number])[] | undefined {
  return BY_ID[assetId]?.hull;
}

/** o prop BLOQUEIA passagem? (categoria sólida + collider != none) — mesma
 * regra que o editor grava em MapProp.colliderType. */
export function isSolidProp(assetId: string): boolean {
  const cat = propCategory(assetId);
  return !!cat && SOLID_CATEGORIES.has(cat) && colliderForAsset(assetId) !== "none";
}

// ---- escala inicial por asset (editável em /asset-scaling, persiste em localStorage) ----
const SCALE_KEY = "ragnarok.editor.assetScales";
let scaleCache: Record<string, number> | null = null;
function overrides(): Record<string, number> {
  if (scaleCache) return scaleCache;
  try { scaleCache = JSON.parse(localStorage.getItem(SCALE_KEY) || "{}"); } catch { scaleCache = {}; }
  return scaleCache!;
}

/** escala inicial ao colocar (override do /asset-scaling → default do catálogo → 1) */
export function propDefaultScale(assetId: string): number {
  const o = overrides()[assetId];
  if (o != null) return o;
  return BY_ID[assetId]?.defaultScale ?? 1;
}

/** escala configurada (mesma lógica; usada pela tela de dimensionamento) */
export function getAssetScale(assetId: string): number {
  return propDefaultScale(assetId);
}

/** define e persiste a escala default de um asset */
export function setAssetScale(assetId: string, scale: number) {
  const o = overrides();
  o[assetId] = scale;
  try { localStorage.setItem(SCALE_KEY, JSON.stringify(o)); } catch { /* noop */ }
}

/** escala do catálogo (pra reset) */
export function catalogScale(assetId: string): number {
  return BY_ID[assetId]?.defaultScale ?? 1;
}

/** Preload sob demanda: preload de UM asset (usado pela paleta ao focar). Não
 * pré-carrega os 105 de uma vez — pesado; drei cacheia quando o modelo entra. */
export function preloadProp(assetId: string) {
  const url = PROP_URLS[assetId];
  if (url) useGLTF.preload(url);
}

/**
 * As urls distintas que ESTE mapa usa — não as ~105 do catálogo inteiro, só
 * as espécies que foram autoradas nele. Fonte única pra duas coisas que
 * precisam do MESMO conjunto: `preloadPropsDoMapa` (dispara o download) e
 * `play/PlayView`'s `EsperaAssetsDoMapa` (sabe quando ele TERMINOU — ver o
 * comentário lá sobre por que a cortina de carregamento precisa disso).
 */
export function urlsDoMapa(props: readonly { assetId: string }[]): string[] {
  const urls = new Set<string>();
  for (const p of props) {
    const url = PROP_URLS[p.assetId];
    // assetId desconhecido não é erro aqui: o mapa pode citar um prop que saiu
    // do catálogo, e quem avisa disso é o `PropInstance` ao não desenhar nada
    if (url) urls.add(url);
  }
  return [...urls];
}

/**
 * Pré-carrega os assets que ESTE mapa usa. Devolve quantas urls distintas.
 *
 * Substitui um `preloadProps()` que era **no-op** — o `PlayView` o chamava no
 * boot como se pré-carregasse, e o comentário dizia "on-demand, drei cacheia".
 * Cacheia mesmo, mas só DEPOIS de baixar, e baixar acontecia no meio da
 * caminhada: medido no `voo-1785937156994.json`, um
 * `/assets/props/Rock_3_M_Color1.gltf` frio entrando no culling suspendeu o
 * boundary da cena por **177 ms** e o mundo inteiro sumiu por um quadro.
 *
 * Pré-carregar os 105 do catálogo continua sendo errado (é a objeção do
 * comentário antigo, e ela é válida). Mas o mapa não usa 105: ele usa as
 * espécies que foram autoradas nele, que são poucas dezenas de urls distintas
 * para milhares de instâncias. É esse conjunto — e só ele — que entra aqui.
 *
 * Idempotente: `useGLTF.preload` sobre url já carregada não faz nada, então
 * chamar de novo (StrictMode, troca de mapa) é de graça.
 *
 * **Fire-and-forget de propósito, e por isso não basta sozinho**: a API do
 * drei (`suspend-react`) descarta a promise (`void query(...)`) — não dá pra
 * `await` isto. Quem precisa SABER quando terminou (a cortina de
 * carregamento) usa `urlsDoMapa` + `useGLTF` dentro de um `<Suspense>`
 * próprio, não este preload.
 */
export function preloadPropsDoMapa(props: readonly { assetId: string }[]): number {
  const urls = urlsDoMapa(props);
  for (const url of urls) useGLTF.preload(url);
  return urls.length;
}
