/**
 * Cursores do jogo — a arte pintada de `ui_definitiva/cursor` no lugar do
 * cursor do sistema.
 *
 * ## Por que passa por canvas em vez de ir direto no CSS
 *
 * `cursor: url(...)` desenha a imagem no tamanho NATIVO e não aceita
 * `image-rendering`, então não existe "cursor pixelado em 2×" só com CSS: numa
 * tela grande a seta de 31×30 fica minúscula, e qualquer tentativa de esticar
 * pelo navegador borraria a pixel art. A saída é reamostrar no `nearest` num
 * canvas e entregar o resultado como data URI — aí a imagem já CHEGA no tamanho
 * certo e o navegador não interpola nada.
 *
 * A mesma máquina resolve a "animação levinha ao clicar": a versão pressionada é
 * a arte reduzida (ou, na mão, a arte de clique que o pacote traz), gerada uma
 * vez e trocada por ~120 ms no `mousedown`.
 *
 * ## Hotspot
 *
 * MEDIDO da arte, não chutado (`node` decodificando o PNG): seta e espada têm o
 * pixel opaco em (0,0), então a ponta é ali; o `block_area` é um símbolo redondo
 * e o ponto é o centro; a mão aponta com a ponta do dedo em (14,3).
 *
 * A mão de clique guarda o MESMO hotspot da mão aberta de propósito — a arte
 * dela já vem mais baixa (opaca a partir de y=8 contra y=3), e é essa diferença
 * que faz o dedo "afundar" sem o cursor pular de lugar na tela.
 */

const BASE = "/assets/ui/cursor";

/**
 * Tamanho na tela, em px do LADO MAIOR.
 *
 * As artes vêm em tamanhos diferentes (a seta tem 31×30, a espada 39×37, o
 * bloqueio 26×26), e escalar todas pelo mesmo fator deixaria umas maiores que as
 * outras sem motivo. Normalizando pelo lado maior, todas ficam do mesmo porte —
 * o de um cursor de sistema, que é o que se espera.
 *
 * A proporção de cada arte é preservada; o hotspot acompanha a escala real que
 * cada uma recebeu.
 */
const CURSOR_LADO = 32;

/** teto de segurança: navegador ignora cursor acima de 128 px */
const CURSOR_LADO_MAX = 128;

/** quanto a versão pressionada encolhe (o "afunda e volta" do clique) */
const PRESSIONADO = 0.88;

/** por quanto tempo o cursor fica pressionado depois do clique */
export const CURSOR_CLIQUE_MS = 120;

export type CursorKind = "normal" | "attack" | "block" | "hand" | "skillshot";

interface Def {
  url: string;
  /** ponto da arte, em px NATIVOS, que aponta */
  hotspot: [number, number];
  /** arte própria para o estado pressionado; sem ela, reduz a normal */
  urlPressionado?: string;
  /** o que usar se a imagem não carregar */
  fallback: string;
}

const DEFS: Record<CursorKind, Def> = {
  normal: { url: `${BASE}/cursor_normal.png`, hotspot: [0, 0], fallback: "default" },
  attack: { url: `${BASE}/cursor_atack.png`, hotspot: [0, 0], fallback: "crosshair" },
  // símbolo redondo de 26×26: o ponto é o centro dele
  block: { url: `${BASE}/block_area.png`, hotspot: [13, 13], fallback: "not-allowed" },
  hand: {
    url: `${BASE}/hand_open_take_drop.png`,
    hotspot: [14, 4],
    urlPressionado: `${BASE}/hand_open_take_drop_click_action.png`,
    fallback: "pointer",
  },
  /**
   * Mira de skill de área/chão.
   *
   * A arte é um anel achatado (32×15) — um círculo visto em perspectiva, que é
   * como a área da skill aparece no chão. O ponto que ela aponta é o CENTRO
   * dele, não uma ponta: é ali que a magia vai cair.
   */
  skillshot: { url: `${BASE}/circle-skillshot.png`, hotspot: [16, 8], fallback: "crosshair" },
};

/** `kind:pressionado` → valor pronto do `cursor` */
const cache = new Map<string, string>();
const carregando = new Set<string>();
/** quem quer ser avisado quando um cursor termina de ser montado */
const ouvintes = new Set<() => void>();

export function aoMontarCursor(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

/**
 * Reamostra no NEAREST e devolve o `cursor` completo, com hotspot já escalado.
 *
 * `imageSmoothingEnabled = false` é o equivalente de canvas ao
 * `image-rendering: pixelated` — sem ele o dobro sairia borrado, que é
 * exatamente o que a regra de pixel art do projeto proíbe.
 */
async function montar(kind: CursorKind, pressionado: boolean): Promise<string> {
  const def = DEFS[kind];
  const src = pressionado && def.urlPressionado ? def.urlPressionado : def.url;
  const img = await carregar(src);

  // com arte própria de clique a escala é cheia (a arte JÁ está pressionada);
  // sem ela, encolhe — é o "afunda e volta" gerado aqui
  const encolher = pressionado && !def.urlPressionado ? PRESSIONADO : 1;
  /**
   * Normaliza pelo LADO MAIOR e nunca AUMENTA a arte.
   *
   * `Math.min(1, …)` porque ampliar pixel art de cursor deixa o ponteiro
   * desproporcional na tela — o pedido foi justamente voltar aos tamanhos
   * padrão. Quem já é menor que o alvo (a mira de 32×15) fica como está.
   */
  const lado = Math.max(img.naturalWidth, img.naturalHeight);
  const escala = Math.min(1, CURSOR_LADO / lado) * encolher;
  const w = Math.max(1, Math.min(CURSOR_LADO_MAX, Math.round(img.naturalWidth * escala)));
  const h = Math.max(1, Math.min(CURSOR_LADO_MAX, Math.round(img.naturalHeight * escala)));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("sem contexto 2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, w, h);

  const hx = Math.round(def.hotspot[0] * escala);
  const hy = Math.round(def.hotspot[1] * escala);
  return `url('${canvas.toDataURL("image/png")}') ${hx} ${hy}, ${def.fallback}`;
}

/**
 * O valor do `cursor` para este estado.
 *
 * Devolve na hora se já estiver montado; senão dispara a montagem, entrega o
 * fallback do sistema e avisa os ouvintes quando ficar pronto. Assim a primeira
 * passada de mouse nunca fica sem cursor.
 */
export function cursorCss(kind: CursorKind, pressionado = false): string {
  const chave = `${kind}:${pressionado}`;
  const pronto = cache.get(chave);
  if (pronto) return pronto;

  if (!carregando.has(chave)) {
    carregando.add(chave);
    void montar(kind, pressionado)
      .then((css) => {
        cache.set(chave, css);
        for (const fn of ouvintes) fn();
      })
      .catch(() => {
        // arte faltando não pode deixar o site sem cursor
        cache.set(chave, DEFS[kind].fallback);
        for (const fn of ouvintes) fn();
      });
  }
  return DEFS[kind].fallback;
}

/** monta tudo de uma vez (chamado no boot) — troca de estado sem piscar */
export function precarregarCursores(): void {
  if (typeof document === "undefined") return;
  for (const kind of Object.keys(DEFS) as CursorKind[]) {
    cursorCss(kind, false);
    cursorCss(kind, true);
  }
}
