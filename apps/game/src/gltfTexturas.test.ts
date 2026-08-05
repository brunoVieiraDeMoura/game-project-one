import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chaveDaTextura,
  compartilharTexturas,
  fonteDaTextura,
  fontesConhecidas,
  zerarTexturasCompartilhadas,
} from "./gltfTexturas";

/**
 * O MAIOR desperdício que a auditoria encontrou, e o que quase passou batido.
 *
 * `forest_texture.png` tem 48 KB em disco, é 1024×1024, e é referenciado por
 * **101 dos 105 `.gltf`** do pacote Forest. Cada `.gltf` é um documento à parte,
 * então o `GLTFLoader` cria um `THREE.Texture` novo por arquivo — e o cache do
 * drei é chaveado pela url do GLTF, não da imagem. O censo do `prt_fild08` mediu
 * **225 MB de textura para 5,33 MB de conteúdo**: ~42 cópias.
 *
 * A PRIMEIRA versão deste módulo chaveava por `texture.image.src` e não
 * deduplicou NADA — o censo seguinte continuou acusando 40 cópias. A razão está
 * em `GLTFLoader.js:2682`: no Chrome o loader usa `ImageBitmapLoader`, e um
 * `ImageBitmap` não tem `src`. A identidade de verdade é o
 * `parser.associations` (GLTFLoader.js:3347), que liga cada textura ao índice
 * dela no documento e, dali, à `uri` do arquivo.
 */

const tex = (uuid: string, extra: Record<string, unknown> = {}) => ({
  uuid,
  isTexture: true,
  // sem `image.src`: é assim que a textura chega no Chrome, e era esse o furo
  wrapS: 1000,
  wrapT: 1000,
  colorSpace: "srgb",
  flipY: false,
  dispose: vi.fn(),
  ...extra,
});

/**
 * Um "gltf carregado" de mentira: cena com um material, mais o PARSER.
 *
 * `uri: null` simula imagem EMBUTIDA (`bufferView` em vez de `uri`), que é o
 * caso em que deduplicar seria adivinhação.
 */
const gltf = (t: object, uri: string | null, slot = "map") => ({
  scene: { children: [{ material: { uuid: `m-${Math.random()}`, [slot]: t } }] },
  parser: {
    associations: new Map<unknown, { textures?: number }>([[t, { textures: 0 }]]),
    json: { textures: [{ source: 0 }], images: [uri === null ? {} : { uri }] },
    options: { path: "/assets/props/" },
  },
});

const textureDe = (g: ReturnType<typeof gltf>) =>
  (g.scene.children[0]!.material as Record<string, unknown>).map;

beforeEach(() => {
  zerarTexturasCompartilhadas();
});

describe("identidade da imagem", () => {
  it("vem do PARSER, não do `image.src` — que não existe num ImageBitmap", () => {
    const t = tex("a");
    const g = gltf(t, "forest_texture.png");
    expect(fonteDaTextura(t as never, g.parser as never)).toBe("/assets/props/forest_texture.png");
  });

  it("imagem EMBUTIDA devolve null — deduplicar ali seria adivinhação", () => {
    const t = tex("a");
    const g = gltf(t, null);
    expect(fonteDaTextura(t as never, g.parser as never)).toBeNull();
  });

  it("sem parser, cai no `src` — serve a textura que NÃO veio de glTF", () => {
    expect(fonteDaTextura({ isTexture: true, image: { src: "/x.png" } } as never)).toBe("/x.png");
    // blob e data-uri mudam a cada carga: indistinguíveis de imagens diferentes
    expect(fonteDaTextura({ isTexture: true, image: { src: "blob:http://x/1" } } as never)).toBeNull();
    expect(chaveDaTextura({ isTexture: true } as never)).toBeNull();
  });
});

describe("dedupe entre documentos glTF", () => {
  it("42 arquivos com a MESMA imagem passam a apontar para uma textura só", () => {
    const gs = Array.from({ length: 42 }, (_, i) => gltf(tex(`t${i}`), "forest_texture.png"));
    let trocadas = 0;
    for (const g of gs) trocadas += compartilharTexturas(g as never);

    // a primeira vira canônica; as outras 41 são substituídas
    expect(trocadas).toBe(41);
    expect(fontesConhecidas()).toBe(1);
    expect(new Set(gs.map(textureDe)).size).toBe(1);
  });

  it("a duplicata órfã é DESCARTADA, a canônica não", () => {
    const a = tex("a");
    const b = tex("b");
    compartilharTexturas(gltf(a, "x.png") as never);
    compartilharTexturas(gltf(b, "x.png") as never);

    expect(b.dispose).toHaveBeenCalledTimes(1);
    // descartar a canônica apagaria a textura de todo mundo que já aponta para ela
    expect(a.dispose).not.toHaveBeenCalled();
  });

  it("é IDEMPOTENTE — o StrictMode chamar duas vezes não troca nada", () => {
    const g = gltf(tex("t"), "x.png");
    expect(compartilharTexturas(g as never)).toBe(0); // primeira: vira canônica
    expect(compartilharTexturas(g as never)).toBe(0); // segunda: nem entra
  });

  it("varre TODOS os slots, não só `map`", () => {
    compartilharTexturas(gltf(tex("p"), "atlas.png") as never);
    const g = gltf(tex("n"), "atlas.png", "emissiveMap");
    expect(compartilharTexturas(g as never)).toBe(1);
    expect((g.scene.children[0]!.material as Record<string, unknown>).emissiveMap).toBeDefined();
  });

  it("desce a árvore inteira", () => {
    compartilharTexturas(gltf(tex("raiz"), "x.png") as never);
    const t = tex("fundo");
    const g = {
      scene: { children: [{ children: [{ children: [{ material: { uuid: "m", map: t } }] }] }] },
      parser: {
        associations: new Map<unknown, { textures?: number }>([[t, { textures: 0 }]]),
        json: { textures: [{ source: 0 }], images: [{ uri: "x.png" }] },
        options: { path: "/assets/props/" },
      },
    };
    expect(compartilharTexturas(g as never)).toBe(1);
  });
});

describe("quando NÃO deduplicar", () => {
  it("configurações diferentes NÃO são intercambiáveis", () => {
    /**
     * Duas texturas da mesma imagem com `wrapS` diferente desenham diferente;
     * trocar uma pela outra mudaria como o prop aparece. Incluir as
     * configurações na chave torna a troca correta por construção — no pior caso
     * a deduplicação simplesmente não acontece.
     */
    compartilharTexturas(gltf(tex("a", { wrapS: 1000 }), "x.png") as never);
    const g = gltf(tex("b", { wrapS: 1001 }), "x.png");
    expect(compartilharTexturas(g as never)).toBe(0);
    expect(fontesConhecidas()).toBe(2);
  });

  it("imagem embutida não entra no cache", () => {
    compartilharTexturas(gltf(tex("a"), null) as never);
    const g = gltf(tex("b"), null);
    expect(compartilharTexturas(g as never)).toBe(0);
    expect(fontesConhecidas()).toBe(0);
  });

  it("arquivos diferentes seguem separados", () => {
    compartilharTexturas(gltf(tex("a"), "a.png") as never);
    const g = gltf(tex("b"), "b.png");
    expect(compartilharTexturas(g as never)).toBe(0);
    expect(fontesConhecidas()).toBe(2);
  });

  it("gltf nulo ou sem cena não quebra", () => {
    expect(compartilharTexturas(null)).toBe(0);
    expect(compartilharTexturas(undefined)).toBe(0);
    expect(compartilharTexturas({} as never)).toBe(0);
  });
});
