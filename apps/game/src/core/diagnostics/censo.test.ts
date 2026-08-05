import { describe, expect, it } from "vitest";
import { bytesDeGeometria, bytesDeTextura, censoComRenderer, censoDaCena } from "./censo";

/**
 * O censo é a LINHA DE BASE da auditoria de assets — se ele mentir, todas as
 * otimizações depois dele são medidas contra um número errado.
 *
 * O que ele precisa acertar não é a contagem bruta (essa é trivial): é o
 * **reúso**. "278 malhas" e "50 geometrias" separados não dizem nada; 278 ÷ 50
 * é a resposta da pergunta que originou a auditoria.
 */

interface NoFalso {
  uuid?: string;
  name?: string;
  visible?: boolean;
  children?: NoFalso[];
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isLight?: boolean;
  count?: number;
  skeleton?: { uuid: string };
  geometry?: unknown;
  material?: unknown;
}

/** uma geometria de mentira com N vértices posicionais */
const geo = (uuid: string, vertices = 100) => ({
  uuid,
  name: uuid,
  attributes: { position: { count: vertices, itemSize: 3, array: { BYTES_PER_ELEMENT: 4 } } },
  index: null,
});

const tex = (uuid: string, w = 64, h = 64, mip = true) => ({
  uuid,
  name: uuid,
  image: { width: w, height: h },
  generateMipmaps: mip,
  isTexture: true,
});

const mat = (uuid: string, extras: Record<string, unknown> = {}) => ({ uuid, name: uuid, ...extras });

const malha = (g: unknown, m: unknown, extra: Partial<NoFalso> = {}): NoFalso => ({
  uuid: `mesh-${Math.random()}`,
  isMesh: true,
  visible: true,
  geometry: g,
  material: m,
  ...extra,
});

describe("reúso — a pergunta que originou a auditoria", () => {
  it("200 clones da MESMA árvore contam 200 referências e 1 geometria", () => {
    const g = geo("tronco");
    const m = mat("casca", { map: tex("casca.png") });
    const arvores = Array.from({ length: 200 }, () => malha(g, m));
    const c = censoDaCena({ children: arvores, visible: true } as never);

    expect(c.mesh).toBe(200);
    // é ESTE o número que responde "200 árvores = 200 geometrias?"
    expect(c.geometrias).toEqual({ referencias: 200, unicos: 1, reuso: 200 });
    expect(c.materiais).toEqual({ referencias: 200, unicos: 1, reuso: 200 });
    expect(c.texturas).toEqual({ referencias: 200, unicos: 1, reuso: 200 });
  });

  it("reúso 1,0 é a assinatura do desperdício — cada malha com o seu", () => {
    const soltas = Array.from({ length: 50 }, (_, i) => malha(geo(`g${i}`), mat(`m${i}`)));
    const c = censoDaCena({ children: soltas, visible: true } as never);
    expect(c.geometrias.reuso).toBe(1);
    expect(c.materiais.reuso).toBe(1);
  });

  it("cena vazia não divide por zero", () => {
    const c = censoDaCena({ children: [], visible: true } as never);
    expect(c.geometrias).toEqual({ referencias: 0, unicos: 0, reuso: 0 });
    expect(c.memoria.totalMb).toBe(0);
  });
});

describe("contagem por tipo", () => {
  it("separa Mesh, InstancedMesh e SkinnedMesh, e SOMA as instâncias", () => {
    const g = geo("g");
    const m = mat("m");
    const c = censoDaCena({
      visible: true,
      children: [
        malha(g, m),
        malha(g, m, { isInstancedMesh: true, count: 500 }),
        malha(g, m, { isInstancedMesh: true, count: 300 }),
        malha(g, m, { isSkinnedMesh: true, skeleton: { uuid: "esq1" } }),
        { uuid: "luz", isLight: true, visible: true },
      ],
    } as never);

    expect(c.mesh).toBe(1);
    expect(c.instancedMesh).toBe(2);
    // sem isto, "2 InstancedMesh" esconderia se são 2 peças ou 800
    expect(c.instancias).toBe(800);
    expect(c.skinnedMesh).toBe(1);
    expect(c.luzes).toBe(1);
    // grupos e luzes entram no total de Object3D, mas não em `mesh`
    expect(c.object3d).toBe(6);
  });

  it("esqueleto compartilhado aparece como reúso", () => {
    const g = geo("g");
    const m = mat("m");
    const esq = { uuid: "rig" };
    const c = censoDaCena({
      visible: true,
      children: [
        malha(g, m, { isSkinnedMesh: true, skeleton: esq }),
        malha(g, m, { isSkinnedMesh: true, skeleton: esq }),
        malha(g, m, { isSkinnedMesh: true, skeleton: { uuid: "outro" } }),
      ],
    } as never);
    expect(c.esqueletos).toMatchObject({ referencias: 3, unicos: 2 });
  });

  it("`renderizaveis` ignora o invisível — é comparável ao que se desenha", () => {
    const g = geo("g");
    const m = mat("m");
    const c = censoDaCena({
      visible: true,
      children: [malha(g, m), malha(g, m, { visible: false }), { uuid: "grupo", visible: true }],
    } as never);
    expect(c.renderizaveis).toBe(1);
  });
});

describe("texturas dentro de ShaderMaterial", () => {
  it("são encontradas nos UNIFORMS, não só nos slots nomeados", () => {
    /**
     * O terreno, a água e os VFX usam `ShaderMaterial`, e ali a textura mora em
     * `uniforms.X.value` — fora do alcance de uma varredura por chave. Perder
     * isso subestimaria a memória justamente nos maiores consumidores.
     */
    const m = mat("shader", {
      uniforms: { uMapa: { value: tex("terreno.png", 512, 512) }, uTempo: { value: 0 } },
    });
    const c = censoDaCena({ visible: true, children: [malha(geo("g"), m)] } as never);
    expect(c.texturas.unicos).toBe(1);
  });

  it("material em ARRAY conta todos os slots", () => {
    const c = censoDaCena({
      visible: true,
      children: [malha(geo("g"), [mat("a", { map: tex("a.png") }), mat("b", { map: tex("b.png") })])],
    } as never);
    expect(c.materiais.unicos).toBe(2);
    expect(c.texturas.unicos).toBe(2);
  });
});

describe("texturas DUPLICADAS — o achado que a auditoria quase perdeu", () => {
  /**
   * Medido no `prt_fild08`: `forest_texture.png` tem 48 KB em disco, é
   * 1024×1024 e é referenciado por **101 dos 105 `.gltf`** do pacote Forest.
   * Cada `.gltf` é um documento à parte, então o `GLTFLoader` cria um `Texture`
   * NOVO por arquivo — e o cache do drei é por url do GLTF, não da imagem.
   * Resultado: ~42 cópias na cena, **225 MB** de textura para 5,33 MB de
   * conteúdo.
   *
   * A lista de "maiores texturas" só INSINUAVA isso (oito linhas com o mesmo
   * nome). Este agrupamento prova.
   */
  const comFonte = (uuid: string, src: string) => ({
    uuid,
    name: "forest_texture",
    image: { width: 1024, height: 1024, src },
    generateMipmaps: true,
    isTexture: true,
  });

  it("agrupa pela FONTE da imagem e cobra só o excedente", () => {
    const filhos = Array.from({ length: 42 }, (_, i) =>
      malha(geo(`g${i}`), mat(`m${i}`, { map: comFonte(`t${i}`, "/assets/props/forest_texture.png") })),
    );
    const c = censoDaCena({ visible: true, children: filhos } as never);

    expect(c.texturas.unicos).toBe(42);
    const d = c.texturasDuplicadas[0]!;
    expect(d.fonte).toContain("forest_texture.png");
    expect(d.copias).toBe(42);
    expect(d.mbCada).toBe(5.33);
    // uma cópia é legítima; o desperdício são as outras 41
    expect(d.mbDesperdicado).toBe(mbEsperado(41));
  });

  it("textura usada por muitos materiais mas carregada UMA vez não é duplicata", () => {
    const t = comFonte("unica", "/assets/props/forest_texture.png");
    const filhos = Array.from({ length: 42 }, (_, i) => malha(geo(`g${i}`), mat(`m${i}`, { map: t })));
    const c = censoDaCena({ visible: true, children: filhos } as never);

    expect(c.texturas).toMatchObject({ referencias: 42, unicos: 1 });
    // 42 referências ao MESMO objeto é reúso correto, não desperdício
    expect(c.texturasDuplicadas).toEqual([]);
  });

  it("fontes diferentes não são agrupadas", () => {
    const c = censoDaCena({
      visible: true,
      children: [
        malha(geo("a"), mat("a", { map: comFonte("t1", "/a.png") })),
        malha(geo("b"), mat("b", { map: comFonte("t2", "/b.png") })),
      ],
    } as never);
    expect(c.texturasDuplicadas).toEqual([]);
  });
});

/** MB de N cópias de uma 1024² RGBA8 com mipmap, na mesma conta do censo */
function mbEsperado(copias: number): number {
  const bytes = Math.round(1024 * 1024 * 4 * 4 / 3);
  return Math.round((bytes * copias / 1048576) * 100) / 100;
}

describe("memória estimada", () => {
  it("geometria soma atributos e índice", () => {
    // 100 vértices × 3 floats × 4 bytes = 1200
    expect(bytesDeGeometria(geo("g", 100))).toBe(1200);
    expect(
      bytesDeGeometria({
        attributes: { position: { count: 10, itemSize: 3, array: { BYTES_PER_ELEMENT: 4 } } },
        index: { count: 30, array: { BYTES_PER_ELEMENT: 2 } },
      }),
    ).toBe(120 + 60);
  });

  it("textura assume RGBA8, e o mipmap acrescenta um TERÇO", () => {
    // 64×64×4 = 16384; a cadeia de mips soma 1 + ¼ + 1/16 + … = 4/3
    expect(bytesDeTextura(tex("t", 64, 64, false))).toBe(16384);
    expect(bytesDeTextura(tex("t", 64, 64, true))).toBe(Math.round(16384 * 4 / 3));
    // sem imagem carregada não há como estimar — zero, nunca um palpite
    expect(bytesDeTextura({ uuid: "x" })).toBe(0);
  });

  it("conta o recurso ÚNICO uma vez, não por referência", () => {
    const g = geo("g", 1000);
    const m = mat("m", { map: tex("t", 128, 128) });
    const c = censoDaCena({ visible: true, children: Array.from({ length: 200 }, () => malha(g, m)) } as never);
    /**
     * 200 árvores compartilhando uma geometria pesam UMA geometria: 12.000
     * bytes = 0,0114 MB, arredondado para 0,01. Se contasse por referência
     * seriam 2,29 MB — duas ordens de grandeza de diferença, que é exatamente o
     * erro que a auditoria existe para não cometer.
     */
    expect(c.memoria.geometriasMb).toBe(0.01);
    expect(c.memoria.exclui).toContain("ESTIMATIVA");
  });
});

describe("conferência cruzada com o renderer", () => {
  it("a diferença é ACHADO, e sai nomeada", () => {
    /**
     * O censo conta o GRAFO; `gl.info` conta o RENDERER. Divergir é esperado —
     * canvas de retrato, textura de UI e recurso pendente de descarte não estão
     * na cena do jogo. Um censo que batesse exato estaria contando errado.
     */
    const c = censoComRenderer(
      { visible: true, children: [malha(geo("g"), mat("m", { map: tex("t") }))] } as never,
      { memory: { geometries: 135, textures: 59 }, programs: new Array(19) },
    );
    expect(c.renderer.geometriasForaDaCena).toBe(134);
    expect(c.renderer.texturasForaDaCena).toBe(58);
    expect(c.renderer.programas).toBe(19);
  });

  it("sem `info` não inventa número", () => {
    const c = censoComRenderer({ visible: true, children: [] } as never);
    expect(c.renderer.geometrias).toBe(0);
  });
});
