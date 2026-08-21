import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { useGLTF } from "@react-three/drei";
import {
  PROP_CATALOG,
  PROP_IDS,
  PROP_URLS,
  SCATTER_CATEGORIES,
  SOLID_CATEGORIES,
  descartarPropsForaDoMapa,
  preloadPropsDoMapa,
  urlsDoMapa,
} from "./registry";

/**
 * O CATÁLOGO descreve os modelos que existem — e o número bate com a geometria.
 *
 * Nasceu de "checar a renderização de cada asset no mapa"
 * (`next-change-editor.txt`). A varredura de uma vez não serve: catálogo é
 * gerado (`props:measure`) e arte entra e sai do repo, então o que impede a
 * divergência de voltar é isto rodar junto com a suíte.
 *
 * O que ele NÃO cobre: se o modelo está bonito, bem orientado ou na escala
 * certa. Isso precisa de olho na tela e de GPU — aqui ficam só os fatos que dão
 * para conferir sem desenhar nada.
 */

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");

/** JSON de um `.gltf` do repo */
function gltf(url: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(raiz, url), "utf8"));
}

/**
 * Maior distância da ORIGEM, em XZ, a um canto da caixa do modelo — com a escala
 * e a translação do nó aplicadas.
 *
 * É a MESMA métrica de `radius` (`scripts/measure-props.mjs` faz `hypot(x, z)`
 * da origem ao ponto mais distante do hull), e essa igualdade é o ponto: na
 * primeira tentativa comparei o raio com MEIA CAIXA e 144 dos 267 assets
 * pareceram errados. Não estavam — um modelo fora de centro tem, por
 * construção, raio maior que a meia largura dele.
 *
 * Como o hull é só a FATIA DE BAIXO, `radius` tem de caber neste teto.
 */
function tetoDaOrigem(url: string): number {
  const g = gltf(url);
  const caixaPorMesh = new Map<number, { bx: [number, number]; bz: [number, number] }>();
  for (const [mi, m] of (g.meshes ?? []).entries()) {
    let bx: [number, number] = [Infinity, -Infinity];
    let bz: [number, number] = [Infinity, -Infinity];
    for (const prim of m.primitives ?? []) {
      const a = g.accessors?.[prim.attributes?.POSITION];
      if (!a?.min || !a?.max) continue;
      bx = [Math.min(bx[0], a.min[0]), Math.max(bx[1], a.max[0])];
      bz = [Math.min(bz[0], a.min[2]), Math.max(bz[1], a.max[2])];
    }
    caixaPorMesh.set(mi, { bx, bz });
  }
  let teto = 0;
  for (const n of g.nodes ?? []) {
    if (n.mesh === undefined) continue;
    const b = caixaPorMesh.get(n.mesh);
    if (!b || !Number.isFinite(b.bx[0])) continue;
    const [sx, , sz] = n.matrix ? [n.matrix[0], n.matrix[5], n.matrix[10]] : (n.scale ?? [1, 1, 1]);
    const [tx, , tz] = n.translation ?? [0, 0, 0];
    for (const x of b.bx) for (const z of b.bz) teto = Math.max(teto, Math.hypot(x * sx + tx, z * sz + tz));
  }
  return teto;
}

describe("o catálogo de props", () => {
  it("tem entradas", () => {
    // 267 hoje: 105 do Forest, 30 do hex-decor, 132 dos hex-tiles
    expect(PROP_CATALOG.length).toBeGreaterThan(200);
  });

  it("todo asset tem ARQUIVO no repo", () => {
    /**
     * Uma entrada sem arquivo aparece na paleta, entra no scatter e some da
     * cena — e o `useGLTF` estoura dentro de um `Suspense`, então o sintoma é
     * "o mapa parou de carregar", não "faltou um modelo".
     */
    const faltando = PROP_CATALOG.filter((e) => !fs.existsSync(path.join(raiz, PROP_URLS[e.id]!)));
    expect(faltando.map((e) => e.id)).toEqual([]);
  });

  it("nenhum id repetido entre os três catálogos", () => {
    // `PROP_URLS` é um objeto por id: um id repetido silencia o outro sem erro,
    // e o asset que some é sempre o do catálogo carregado primeiro
    expect(PROP_CATALOG.length).toBe(new Set(PROP_CATALOG.map((e) => e.id)).size);
  });

  it("raio, espalhamento e hull são positivos e utilizáveis", () => {
    const ruins = PROP_CATALOG.filter(
      (e) => !((e.radius ?? 0) > 0) || !((e.spread ?? 0) > 0) || !Array.isArray(e.hull) || e.hull.length < 3,
    );
    expect(ruins.map((e) => e.id)).toEqual([]);
  });

  it("o RAIO cabe na geometria — o número descreve o modelo", () => {
    /**
     * Raio maior que o modelo faz o prop bloquear célula que ele não ocupa (o
     * `export:mapcache` converte raio em parede), e o jogador esbarra no nada.
     * Menor demais faz o contrário: o personagem atravessa a árvore.
     *
     * 2% de folga para arredondamento — o catálogo grava com três casas.
     */
    const acima = PROP_CATALOG.filter((e) => (e.radius ?? 0) > tetoDaOrigem(PROP_URLS[e.id]!) * 1.02);
    expect(acima.map((e) => e.id)).toEqual([]);
  });

  it("toda categoria espalhável tem pelo menos um asset", () => {
    // uma categoria no slider sem asset nenhum é um controle que não faz nada
    for (const cat of SCATTER_CATEGORIES) {
      expect(PROP_CATALOG.some((e) => e.cat === cat), `categoria vazia: ${cat}`).toBe(true);
    }
  });

  it("as categorias SÓLIDAS existem no catálogo", () => {
    // `SOLID_CATEGORIES` é o que impede asset em cima de asset; um nome errado
    // ali não dá erro, só deixa de proteger
    const cats = new Set(PROP_CATALOG.map((e) => e.cat));
    for (const cat of SOLID_CATEGORIES) {
      expect(cats.has(cat), `categoria sólida inexistente: ${cat}`).toBe(true);
    }
  });
});

/**
 * O preload do mapa existe por um defeito MEDIDO, não por precaução.
 *
 * O `preloadProps()` que ele substitui era literalmente vazio, e o `PlayView` o
 * chamava no boot como se pré-carregasse. Sem preload, um `.gltf` frio entrando
 * no culling suspendia o boundary da cena inteira — 177 ms no
 * `voo-1785937156994.json`, com o mundo sumindo por um quadro e o cache de 169
 * chunks indo junto no remonte.
 */
describe("preload dos props do mapa", () => {
  it("pede uma vez por URL distinta, não por instância", () => {
    const espia = vi.spyOn(useGLTF, "preload").mockImplementation(() => {});
    const a = PROP_IDS[0]!;
    const b = PROP_IDS[1]!;
    // um mapa de verdade tem milhares de instâncias de poucas espécies
    const props = [a, a, a, b, a, b].map((assetId) => ({ assetId }));

    expect(preloadPropsDoMapa(props)).toBe(2);
    expect(espia).toHaveBeenCalledTimes(2);
    expect(espia.mock.calls.map((c) => c[0]).sort()).toEqual([PROP_URLS[a], PROP_URLS[b]].sort());
    espia.mockRestore();
  });

  it("assetId fora do catálogo é ignorado, não quebra a carga do mapa", () => {
    const espia = vi.spyOn(useGLTF, "preload").mockImplementation(() => {});
    // mapa salvo antes de um prop sair do catálogo: quem avisa é o
    // `PropInstance` não desenhando nada, e o preload não pode derrubar a cena
    expect(preloadPropsDoMapa([{ assetId: "nao_existe_mais" }])).toBe(0);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it("mapa sem props não pede nada", () => {
    const espia = vi.spyOn(useGLTF, "preload").mockImplementation(() => {});
    expect(preloadPropsDoMapa([])).toBe(0);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});

/**
 * T8 (`docs/otimizacao-heuristicas.md`) — descarte do cache do `useGLTF` na
 * troca de mapa. Só RAM (heap JS): `useGLTF.clear` não dá dispose em nada,
 * só remove a entrada do cache — ver docblock de `descartarPropsForaDoMapa`.
 */
describe("descarte de props fora do mapa (T8)", () => {
  it("descarta só as urls que SAÍRAM — não toca nas que continuam no mapa novo", () => {
    const espia = vi.spyOn(useGLTF, "clear").mockImplementation(() => {});
    const a = PROP_IDS[0]!;
    const b = PROP_IDS[1]!;
    const c = PROP_IDS[2]!;
    const antigas = urlsDoMapa([{ assetId: a }, { assetId: b }]);
    const novas = urlsDoMapa([{ assetId: b }, { assetId: c }]); // b fica, a sai, c é novo

    descartarPropsForaDoMapa(antigas, novas);

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith(PROP_URLS[a]);
    espia.mockRestore();
  });

  it("mapa novo usa o MESMO conjunto do antigo — não descarta nada", () => {
    const espia = vi.spyOn(useGLTF, "clear").mockImplementation(() => {});
    const a = PROP_IDS[0]!;
    const urls = urlsDoMapa([{ assetId: a }]);

    descartarPropsForaDoMapa(urls, urls);

    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it("mapa antigo vazio (primeiro mapa da sessão) não descarta nada", () => {
    const espia = vi.spyOn(useGLTF, "clear").mockImplementation(() => {});
    descartarPropsForaDoMapa([], urlsDoMapa([{ assetId: PROP_IDS[0]! }]));
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it("mapa novo vazio (voltou pro login/preview) descarta TUDO do mapa antigo", () => {
    const espia = vi.spyOn(useGLTF, "clear").mockImplementation(() => {});
    const antigas = urlsDoMapa([{ assetId: PROP_IDS[0]! }, { assetId: PROP_IDS[1]! }]);
    descartarPropsForaDoMapa(antigas, []);
    expect(espia).toHaveBeenCalledTimes(antigas.length);
    espia.mockRestore();
  });
});
