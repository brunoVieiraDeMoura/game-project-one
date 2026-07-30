import type { GameMap } from "@ragnarok/map-format";
import { cellIndex } from "@ragnarok/map-format";

/**
 * O que cada mancha de terreno bloqueado É, deduzido da FORMA dela.
 *
 * O `map_cache.dat` do rAthena guarda um byte por célula, e esse byte só diz
 * "não passa" — não distingue árvore de pedra, de casa ou de encosta. Essa
 * informação vive nos arquivos do CLIENTE (`.gat` com altura, `.rsw` com os
 * modelos posicionados), que não estão no projeto.
 *
 * O que dá para ler é o TAMANHO e o FORMATO da mancha, e num campo do Ragnarok
 * isso é bastante: obstáculo de uma célula é um arbusto ou pedra; duas ou três
 * juntas, uma árvore; um quadrado 2×2, uma árvore grande. Manchas maiores são
 * outra coisa — encosta, construção, a moldura do mapa — e ficam de fora da
 * substituição automática (categoria `structure`).
 *
 * A vizinhança é de 4 (ortogonal): duas células que se tocam só pela quina são
 * dois obstáculos, não um só.
 */

export type ClusterKind = "small" | "medium" | "large" | "structure";

export interface BlockedCluster {
  cells: Array<[number, number]>;
  kind: ClusterKind;
  /** centro geométrico em célula (fracionário: um 2×2 cai no meio das quatro) */
  center: { col: number; row: number };
  /** true quando encosta na moldura do mapa — é a borda, não um objeto */
  onBorder: boolean;
}

/** classificação pedida em change.txt, pela contagem e pelo formato */
function kindOf(cells: Array<[number, number]>): ClusterKind {
  const n = cells.length;
  if (n === 1) return "small";
  if (n === 2) return "medium";
  if (n === 3) return "medium"; // o "L" e a linha de três
  if (n === 4) return is2x2(cells) ? "large" : "medium";
  return "structure";
}

/** as quatro células formam um quadrado 2×2? */
function is2x2(cells: Array<[number, number]>): boolean {
  const cols = cells.map(([c]) => c);
  const rows = cells.map(([, r]) => r);
  const minC = Math.min(...cols), maxC = Math.max(...cols);
  const minR = Math.min(...rows), maxR = Math.max(...rows);
  return maxC - minC === 1 && maxR - minR === 1;
}

/**
 * Todas as manchas bloqueadas do mapa, classificadas.
 *
 * `wall` e `cliff` entram; água não (ela é andável no rAthena e tem tratamento
 * próprio). Percorre o mapa uma vez, com uma pilha explícita — recursão em
 * 160.000 células estoura a pilha do JS.
 */
export function findBlockedClusters(map: GameMap): BlockedCluster[] {
  const { width: W, height: H } = map.size;
  const bloqueada = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= W || row >= H) return false;
    const c = map.collision[cellIndex(map, col, row)];
    return c === "wall" || c === "cliff";
  };

  const visto = new Uint8Array(W * H);
  const out: BlockedCluster[] = [];

  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = cellIndex(map, col, row);
      if (visto[i] || !bloqueada(col, row)) continue;

      const cells: Array<[number, number]> = [];
      const pilha: Array<[number, number]> = [[col, row]];
      visto[i] = 1;
      let onBorder = false;

      while (pilha.length > 0) {
        const [c, r] = pilha.pop()!;
        cells.push([c, r]);
        if (c === 0 || r === 0 || c === W - 1 || r === H - 1) onBorder = true;
        // vizinhança de 4: quina não conecta
        for (const [nc, nr] of [
          [c + 1, r],
          [c - 1, r],
          [c, r + 1],
          [c, r - 1],
        ] as Array<[number, number]>) {
          if (!bloqueada(nc, nr)) continue;
          const ni = cellIndex(map, nc, nr);
          if (visto[ni]) continue;
          visto[ni] = 1;
          pilha.push([nc, nr]);
        }
      }

      const somaC = cells.reduce((a, [c]) => a + c, 0);
      const somaR = cells.reduce((a, [, r]) => a + r, 0);
      out.push({
        cells,
        kind: kindOf(cells),
        center: { col: somaC / cells.length, row: somaR / cells.length },
        onBorder,
      });
    }
  }
  return out;
}

/** quantas manchas de cada tipo — o resumo que o painel do editor mostra */
export function summarizeClusters(clusters: BlockedCluster[]): Record<ClusterKind, number> {
  const out: Record<ClusterKind, number> = { small: 0, medium: 0, large: 0, structure: 0 };
  for (const c of clusters) out[c.kind]++;
  return out;
}
