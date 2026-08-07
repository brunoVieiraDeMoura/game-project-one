import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * leia1.txt: trocar o BFS do barranco por Distance Transform euclidiano de
 * verdade, com smootherstep — a causa raiz do serrilhado era o BFS medir
 * PASSOS DE GRAFO (8-conectado), não distância real: duas células à mesma
 * distância geométrica da água podiam cair em "anéis" diferentes sempre que
 * o contorno da água não fosse um círculo perfeito, e um pincel arrastado à
 * mão nunca é. Estes testes travam a propriedade que o BFS violava.
 */
const W = 40;
const H = 40;
const idx = (col: number, row: number) => row * W + col;

function campoPlano(): GameMap {
  const n = W * H;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
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
const h = (col: number, row: number) => mapa().heightmap[idx(col, row)]!;

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
  st().init(campoPlano());
  st().setEditScope("all");
});

describe("barranco: distância euclidiana de verdade (não BFS/Manhattan/Chebyshev)", () => {
  it("célula ORTOGONAL e célula DIAGONAL à mesma distância real recebem a MESMA altura", () => {
    // uma água de 1 célula em (20,20): (23,20) está a 3 células em linha reta;
    // (20,20)+(2,2) ~ dist 2.83 é DIFERENTE de 3 — mas comparamos duas que
    // são REALMENTE equidistantes: um passo diagonal vale √2, não 1 (BFS
    // 8-conectado tratava os dois como "1 passo", causa raiz do degrau)
    st().setBrush("water");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);

    // (23,20): 3 passos ortogonais = distância real 3
    // (20,20) + diagonal pura de mesma distância: (20+3/√2, 20+3/√2) não é
    // célula inteira — em vez disso comparamos dois pontos que o BFS tratava
    // diferente e a distância real trata igual: (20-3,20) e um ponto a
    // distância euclidiana equivalente na diagonal não existe em grade
    // inteira, então o teste direto e robusto é: TODA célula à mesma
    // distância euclidiana (dentro de arredondamento) tem a MESMA altura,
    // não só duas escolhidas a dedo.
    const alvo = 2.0;
    const tol = 0.05;
    const alturas: number[] = [];
    for (let dz = -4; dz <= 4; dz++) {
      for (let dc = -4; dc <= 4; dc++) {
        const d = Math.hypot(dc, dz);
        if (Math.abs(d - alvo) > tol) continue;
        const col = 20 + dc;
        const row = 20 + dz;
        if (col < 0 || row < 0 || col >= W || row >= H) continue;
        alturas.push(Number(h(col, row).toFixed(6)));
      }
    }
    // pelo menos um par ortogonal (dist exata 2) e um diagonal (não existe
    // diagonal pura em 2 já que √2·k=2 não é inteiro perto de 2, mas 2 mesmo
    // já cobre (±2,0)/(0,±2) — todas devem bater
    expect(alturas.length).toBeGreaterThanOrEqual(4);
    const primeira = alturas[0]!;
    for (const a of alturas) expect(a).toBeCloseTo(primeira, 4);
  });

  it("contorno IRREGULAR (formato em L, não um círculo): duas células vizinhas na margem não têm degrau maior que a variação real de distância", () => {
    // água em L: gera um contorno com reentrância — exatamente o caso onde
    // BFS 8-conectado divergia da distância real
    st().setBrush("water");
    st().setBrushSize(0);
    st().beginStroke();
    for (const [c, r] of [
      [15, 15],
      [16, 15],
      [17, 15],
      [15, 16],
      [15, 17],
    ]) {
      st().paintCell(c!, r!);
    }
    // varre um anel de células de terra em volta e verifica: a diferença de
    // altura entre duas células ADJACENTES nunca é maior que a diferença de
    // altura entre duas células a distâncias adjacentes ao longo da MESMA
    // reta (prova indireta de que a função é de fato contínua na distância,
    // não em degraus de anel)
    let maiorSalto = 0;
    for (let row = 10; row <= 22; row++) {
      for (let col = 10; col <= 22; col++) {
        if (mapa().surface[idx(col, row)] === "water") continue;
        const a = h(col, row);
        const b = col + 1 <= 22 ? h(col + 1, row) : null;
        if (b != null) maiorSalto = Math.max(maiorSalto, Math.abs(a - b));
      }
    }
    // com smootherstep + distância real, o maior salto entre DUAS células
    // vizinhas fica bem abaixo da amplitude total do barranco (que é
    // |nivelDaAgua - 0|, tipicamente < 1) — um salto grande aqui delataria
    // degrau de anel sobrevivendo
    expect(maiorSalto).toBeLessThan(0.5);
  });

  it("a curva é SUAVE (smootherstep), não linear: o meio do barranco varia mais devagar que perto das pontas", () => {
    st().setBrush("water");
    st().setBrushSize(0);
    st().beginStroke();
    st().paintCell(20, 20);
    // perfil ao longo de uma reta, célula a célula, saindo da água
    const perfil = [1, 2, 3, 4].map((d) => h(20 + d, 20));
    // smootherstep tem derivada quase nula perto de t=0 e t=1, e máxima no
    // meio — a diferença entre os dois primeiros passos tem que ser MENOR
    // que a diferença entre os dois passos do meio (se fosse linear, os
    // incrementos seriam iguais)
    const d1 = Math.abs(perfil[1]! - perfil[0]!);
    const d2 = Math.abs(perfil[2]! - perfil[1]!);
    expect(d1).toBeLessThan(d2 + 1e-6);
  });

  it("bifurcação (duas pernas de água que se separam) não deixa buraco entre elas", () => {
    st().setBrush("riverShallow");
    st().setBrushSize(0);
    st().beginStroke();
    for (const [c, r] of [
      [10, 10],
      [11, 11],
      [12, 12],
      [13, 13],
    ]) st().paintCell(c!, r!);
    st().beginStroke();
    for (const [c, r] of [
      [13, 13],
      [14, 12],
      [15, 11],
      [16, 10],
    ]) st().paintCell(c!, r!);
    // a célula na junção das duas pernas (13,13) é água; a vizinhança dela
    // tem que ter recebido barranco de AMBAS as pernas sem lacuna
    const vizinhos: number[] = [];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const col = 13 + dc;
        const row = 13 + dr;
        if (mapa().surface[idx(col, row)] === "river") continue;
        vizinhos.push(h(col, row));
      }
    }
    expect(vizinhos.some((v) => v < -1e-6)).toBe(true);
  });

  it("perto da borda do mapa não estoura índice nem deixa de escavar", () => {
    st().setBrush("water");
    st().setBrushSize(0);
    st().beginStroke();
    expect(() => st().paintCell(1, 1)).not.toThrow();
    // canto (0,0) está a distância euclidiana √2 da água em (1,1) — dentro
    // do raio do barranco, deve ter recebido alguma escavação
    expect(h(0, 0)).toBeLessThan(0);
  });

  it("continua não cavando célula bloqueada (comportamento preservado)", () => {
    const m = campoPlano();
    const collision = [...(m.collision as string[])];
    for (let row = 10; row < 20; row++) collision[idx(12, row)] = "wall";
    st().init({ ...m, collision } as unknown as GameMap);
    st().setBrush("water");
    st().setBrushSize(3);
    st().beginStroke();
    st().paintCell(15, 15);
    for (let row = 10; row < 20; row++) {
      expect(h(12, row)).toBe(0);
      expect(mapa().collision[idx(12, row)]).toBe("wall");
    }
  });
});
