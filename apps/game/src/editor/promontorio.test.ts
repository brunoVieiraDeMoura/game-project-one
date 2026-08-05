import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";
import { editorGrid } from "./activeGrid";

/**
 * Promontório: a língua de terra que avança e termina em PONTA (marcação 2 da
 * referência `Desktop/ref/ref2.png`).
 *
 * O que o define é a BORDA, não altura nova: o topo continua no nível de onde
 * ele sai, o terreno em volta fica onde está, e a fronteira vira degrau — que é
 * o que desenha a face de terra exposta.
 */
const W = 40;
const H = 40;
const idx = (col: number, row: number) => row * W + col;

/** meio mapa em nível 4 (terra firme), meio em 0 (o vazio para onde avança) */
function penhasco(): GameMap {
  const n = W * H;
  const heightmap: number[] = new Array(n).fill(0);
  for (let row = 0; row < H; row++) for (let col = 0; col < 20; col++) heightmap[idx(col, row)] = 4;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap,
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const mapa = () => st().map!;

/** arrasta da âncora até a ponta, como o mouse faria */
function arrastar(de: [number, number], ate: [number, number], tamanho = 5) {
  st().setBrush("ledge");
  st().setBrushSize(tamanho);
  st().beginStroke();
  st().beginRamp(de[0], de[1]);
  st().paintCell(ate[0], ate[1]);
  st().endRamp();
}

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], rampAnchor: null, rampBase: null });
  st().init(penhasco());
  st().setEditScope("all");
});

describe("pincel de promontório", () => {
  it("estende o platô para fora da terra firme", () => {
    // antes: tudo além da coluna 19 está em 0
    expect(mapa().heightmap[idx(24, 20)]).toBe(0);
    arrastar([19, 20], [30, 20]);
    // a raiz do promontório saiu no nível da terra firme
    expect(mapa().heightmap[idx(21, 20)]!).toBeGreaterThan(3);
  });

  it("AFINA até a ponta — é o que o torna bicudo", () => {
    arrastar([19, 20], [33, 20], 6);
    const largura = (col: number) => {
      let n = 0;
      for (let row = 0; row < H; row++) if ((mapa().heightmap[idx(col, row)] ?? 0) > 0.5) n++;
      return n;
    };
    const perto = largura(22);
    const meio = largura(27);
    const ponta = largura(31);
    expect(perto).toBeGreaterThan(meio);
    expect(meio).toBeGreaterThan(ponta);
    expect(ponta).toBeLessThanOrEqual(4);
  });

  it("a ponta fica MAIS BAIXA que a raiz", () => {
    arrastar([19, 20], [33, 20], 6);
    const raiz = mapa().heightmap[idx(21, 20)]!;
    const ponta = mapa().heightmap[idx(31, 20)]!;
    expect(ponta).toBeLessThan(raiz);
  });

  it("a borda é IRREGULAR, não um triângulo perfeito", () => {
    // é o que dá as variações pedidas: dois promontórios não saem iguais
    arrastar([19, 20], [33, 20], 6);
    const larguras: number[] = [];
    for (let col = 21; col <= 30; col++) {
      let n = 0;
      for (let row = 0; row < H; row++) if ((mapa().heightmap[idx(col, row)] ?? 0) > 0.5) n++;
      larguras.push(n);
    }
    // uma cunha perfeita decresce em passo constante; a nossa não
    const passos = larguras.slice(1).map((v, i) => v - larguras[i]!);
    expect(new Set(passos).size).toBeGreaterThan(1);
  });

  it("o ÂNGULO manda na altura: 55° ergue mais que 25°", () => {
    const pico = (g: number) => {
      st().init(penhasco());
      st().setEditScope("all");
      st().setLedgeAngle(g);
      arrastar([19, 20], [33, 20], 6);
      let alto = -Infinity;
      for (const h of mapa().heightmap) if (h > alto) alto = h;
      return alto - 4; // acima do nível da raiz
    };
    const a25 = pico(25);
    const a55 = pico(55);
    // altura = meia-largura × tanθ → a razão é a das tangentes (tolerância do
    // ruído do contorno, que muda a meia-largura de cada seção)
    const esperado = Math.tan((55 * Math.PI) / 180) / Math.tan((25 * Math.PI) / 180);
    expect(a55 / a25).toBeGreaterThan(esperado * 0.75);
    expect(a55 / a25).toBeLessThan(esperado * 1.25);
  });

  it("a face desce no ângulo escolhido, medida em MUNDO", () => {
    st().setLedgeAngle(45);
    arrastar([19, 20], [33, 20], 6);
    // perfil lateral numa seção: do eixo para fora, célula a célula
    const col = 23;
    const alturas: number[] = [];
    for (let row = 20; row < 34; row++) alturas.push(mapa().heightmap[idx(col, row)] ?? 0);
    const nivel = Math.abs(editorGrid().levelToY(1) - editorGrid().levelToY(0));
    const larguraCelula = editorGrid().cellWidth();
    const quedas: number[] = [];
    for (let i = 1; i < alturas.length; i++) {
      const d = alturas[i - 1]! - alturas[i]!;
      if (d > 1e-6 && alturas[i]! > 0.01) quedas.push((d * nivel) / larguraCelula);
    }
    expect(quedas.length).toBeGreaterThan(2);
    // mediana, não média: a última célula da faixa cai direto no terreno de
    // fora (é a quina do promontório) e puxaria a média para cima
    quedas.sort((a, b) => a - b);
    const mediana = quedas[Math.floor(quedas.length / 2)]!;
    expect(mediana).toBeGreaterThan(Math.tan(Math.PI / 4) * 0.9);
    expect(mediana).toBeLessThan(Math.tan(Math.PI / 4) * 1.1);
  });

  it("grama em cima, TERRA embaixo", () => {
    /**
     * A face era ROCHA. Virou TERRA por dois motivos, e os dois valem registrar:
     * `surface: "stone"` significa MONTANHA no resto do editor (é por ele que o
     * "Desfazer ⛏" reconhece uma, e por ele que o scatter decide onde não pôr
     * árvore), e o promontório é um corte no CAMPO — o que aparece debaixo da
     * grama cortada é solo, não pedra. Mesma regra da saia de desnível.
     */
    arrastar([19, 20], [33, 20], 6);
    const doMorro: { h: number; s: string }[] = [];
    for (let row = 0; row < H; row++)
      for (let col = 21; col < 34; col++) {
        const h = mapa().heightmap[idx(col, row)] ?? 0;
        if (h > 4.01) doMorro.push({ h, s: mapa().surface[idx(col, row)]! });
      }
    const terra = doMorro.filter((c) => c.s === "dirt");
    const grama = doMorro.filter((c) => c.s === "grass");
    expect(terra.length).toBeGreaterThan(0);
    expect(grama.length).toBeGreaterThan(0);
    // e nada de rocha: rocha aqui viraria montanha aos olhos do editor
    expect(doMorro.filter((c) => c.s === "stone")).toHaveLength(0);
    // a terra é a parte BAIXA da face
    const mediaTerra = terra.reduce((a, c) => a + c.h, 0) / terra.length;
    const mediaGrama = grama.reduce((a, c) => a + c.h, 0) / grama.length;
    expect(mediaTerra).toBeLessThan(mediaGrama);
  });

  it("não cava o terreno mais alto por onde passa", () => {
    // arrastando POR DENTRO da terra firme, nada pode descer
    const antes = [...mapa().heightmap];
    arrastar([5, 20], [15, 20], 5);
    for (let i = 0; i < antes.length; i++) {
      expect(mapa().heightmap[i]!).toBeGreaterThanOrEqual(antes[i]! - 1e-9);
    }
  });

  it("não abre passagem em célula bloqueada", () => {
    const m = penhasco();
    const collision = [...(m.collision as string[])];
    for (let row = 18; row < 23; row++) for (let col = 24; col < 28; col++) collision[idx(col, row)] = "wall";
    st().init({ ...m, collision } as unknown as GameMap);
    arrastar([19, 20], [33, 20], 6);
    for (let row = 18; row < 23; row++) {
      for (let col = 24; col < 28; col++) expect(mapa().collision[idx(col, row)]).toBe("wall");
    }
  });
});
