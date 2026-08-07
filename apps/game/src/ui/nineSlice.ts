import { useEffect, useState } from "react";

/**
 * Monta um 9-slice em RUNTIME a partir de UM canto desenhado.
 *
 * A arte deste projeto (barras de HP/SP, abas do chat, slots de skill) traz
 * sempre a mesma peça: o canto SUPERIOR-DIREITO, com trechos retos saindo dele.
 * Os outros três cantos são o mesmo desenho espelhado — não há PNG para eles —
 * e por isso não dá para apontar `border-image` direto para o arquivo.
 *
 * Aqui um canvas remonta a imagem completa (corte × 2 + miolo) e o resultado
 * vira `border-image-source`. Assim cada caixa é UM elemento e a moldura
 * acompanha qualquer tamanho, em vez de oito divs por caixa.
 *
 * Por que espelhar funciona sem emenda: a coluna de FORA do canto é a mesma
 * linha do trecho reto (conferido pixel a pixel nos dois PNGs das barras —
 * alpha 36/105/191/240/251 idêntico), então as bordas encostam exatas.
 */

export interface NineSliceSpec {
  /** PNG com o canto — superior-direito por padrão, ver `cornerAnchor` */
  corner: string;
  /**
   * De que canto a arte É, antes de qualquer espelhamento.
   *
   * Toda a arte do projeto até aqui trazia o canto SUPERIOR-DIREITO — daí o
   * default. `bordas-botoes-cards.png` (login-new) é o primeiro caso
   * contrário: o chanfro corre do canto inferior-esquerdo pro meio da borda
   * de cima (linha 0 opaca só a partir de x=11, coluna 0 só a partir de y=9 —
   * conferido no alpha). Montar como se fosse superior-direito giraria o
   * chanfro para o lado errado em TODO canto — visível de cara, o desenho é
   * assimétrico.
   */
  cornerAnchor?: "top-right" | "top-left";
  /** x da arte onde começa o quadrado do canto (o resto à esquerda é reto) */
  cornerSx: number;
  /** lado do quadrado do canto, em px da arte — vira `border-image-slice` */
  slice?: number;
  /**
   * PNG do trecho reto horizontal. Sem ele, o reto é recortado do próprio
   * canto (a faixa logo à esquerda dele e a logo abaixo), o que serve quando a
   * arte não traz peça separada.
   */
  edge?: string;
  /** espessura do traço em px da arte (altura do `edge`, ou medida no canto) */
  edgeThickness: number;
}

const MIOLO = 8; // faixa central da imagem gerada; só precisa existir

const cache = new Map<string, string>();
const pendente = new Map<string, Promise<string>>();

function chave(spec: NineSliceSpec): string {
  return `${spec.corner}|${spec.cornerAnchor ?? "tr"}|${spec.cornerSx}|${spec.slice ?? 24}|${spec.edge ?? ""}|${spec.edgeThickness}`;
}

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`falhou ao carregar ${src}`));
    img.src = src;
  });
}

async function montar(spec: NineSliceSpec): Promise<string> {
  const S = spec.slice ?? 24;
  const T = spec.edgeThickness;
  const OUT = S * 2 + MIOLO;

  const [canto, reto] = await Promise.all([
    carregar(spec.corner),
    spec.edge ? carregar(spec.edge) : Promise.resolve(null),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = OUT;
  canvas.height = OUT;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("sem contexto 2d");

  // Cantos: fx/fy = -1 espelham. `translate` leva a origem para a borda oposta
  // antes do espelho, senão o desenho sai fora da caixa.
  const porCanto = (dx: number, dy: number, fx: number, fy: number) => {
    g.save();
    g.translate(dx + (fx < 0 ? S : 0), dy + (fy < 0 ? S : 0));
    g.scale(fx, fy);
    g.drawImage(canto, spec.cornerSx, 0, S, S, 0, 0, S, S);
    g.restore();
  };
  // `flip` inverte qual slot recebe a arte SEM espelho. Com o default
  // (superior-direito), `flip = 1` reproduz exatamente o comportamento de
  // sempre — nenhum consumidor existente muda de resultado.
  const flip = spec.cornerAnchor === "top-left" ? -1 : 1;
  porCanto(OUT - S, 0, flip, 1); // superior-direito
  porCanto(0, 0, -flip, 1); // superior-esquerdo
  porCanto(OUT - S, OUT - S, flip, -1); // inferior-direito
  porCanto(0, OUT - S, -flip, -1); // inferior-esquerdo

  /**
   * Trechos retos. Todos saem do MESMO desenho de traço horizontal — com peça
   * própria, o PNG inteiro; sem peça, o quadradinho `[cornerSx-T, cornerSx]`
   * do canto, que já é traço reto puro. As bordas verticais são esse mesmo
   * traço girado.
   *
   * Girar em vez de recortar a coluna vertical do canto não é preguiça: no
   * `drawImage` a LARGURA da origem vira o comprimento do destino e a ALTURA
   * vira a espessura. Um recorte da coluna traz espessura na largura, e sairia
   * deitado.
   *
   * Em toda peça a linha 0 é a face de FORA, e cada giro leva essa linha para a
   * borda certa.
   */
  const desenharTraco = (dw: number, dh: number) => {
    if (reto) g.drawImage(reto, 0, 0, reto.naturalWidth, reto.naturalHeight, 0, 0, dw, dh);
    else g.drawImage(canto, spec.cornerSx - T, 0, T, T, 0, 0, dw, dh);
  };

  g.save(); // topo
  g.translate(S, 0);
  desenharTraco(MIOLO, T);
  g.restore();

  g.save(); // base
  g.translate(S, OUT);
  g.scale(1, -1);
  desenharTraco(MIOLO, T);
  g.restore();

  g.save(); // esquerda
  g.translate(0, S + MIOLO);
  g.rotate(-Math.PI / 2);
  desenharTraco(MIOLO, T);
  g.restore();

  g.save(); // direita
  g.translate(OUT, S);
  g.rotate(Math.PI / 2);
  desenharTraco(MIOLO, T);
  g.restore();

  const url = canvas.toDataURL("image/png");
  cache.set(chave(spec), url);
  return url;
}

/** data-url do 9-slice (montado uma vez por sessão, por spec) */
export function nineSliceUrl(spec: NineSliceSpec): Promise<string> {
  const k = chave(spec);
  const pronto = cache.get(k);
  if (pronto) return Promise.resolve(pronto);
  let p = pendente.get(k);
  if (!p) {
    p = montar(spec);
    pendente.set(k, p);
  }
  return p;
}

/** já pronto? (evita um quadro com a caixa sem moldura) */
export function nineSliceCached(spec: NineSliceSpec): string | null {
  return cache.get(chave(spec)) ?? null;
}

/**
 * O 9-slice é montado num canvas, o que exige os PNGs carregados. Até lá a
 * caixa aparece sem moldura (nunca some) — e como o data-url fica no cache do
 * módulo, do segundo mount em diante ele já vem pronto no primeiro render.
 */
export function useNineSlice(spec: NineSliceSpec): string | null {
  const k = chave(spec);
  const [url, setUrl] = useState<string | null>(() => nineSliceCached(spec));
  useEffect(() => {
    if (nineSliceCached(spec)) {
      setUrl(nineSliceCached(spec));
      return;
    }
    let vivo = true;
    nineSliceUrl(spec).then(
      (u) => vivo && setUrl(u),
      () => {
        /* sem moldura é melhor que HUD quebrado */
      },
    );
    return () => {
      vivo = false;
    };
    // a spec é um literal estável por chamador; a chave cobre o conteúdo dela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return url;
}
