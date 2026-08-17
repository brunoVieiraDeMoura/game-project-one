import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GameMap, MapProp } from "@ragnarok/map-format";
import { buildHorizonGeometry, alturaDoHorizonte, PASSO_HORIZONTE } from "./HorizonMesh";
import { SQUARE_SIZE, squareLevelToY } from "./squareGrid";
import { buildTreeImpostorInstances, resolverInstanciasVisiveis, type TreeImpostorInstance } from "./TreeImpostors";

/** BANDA_TRANSICAO_ALTURA não é exportada de TreeImpostors.tsx (constante interna) — duplicada aqui só pro teste saber onde a transição termina */
const BANDA_TRANSICAO_ALTURA_TESTE = 40;

/**
 * "VEGETAÇÃO NÃO PODE SOBREVIVER AO TERRENO" — teste específico da Fase de
 * coerência de horizonte (pedido §§47-60, `render-tecnic.txt` seção 25).
 *
 * Mapas sintéticos com platô estreito, penhasco largo e terreno plano —
 * nenhum mapa REAL do rAthena serve pra este teste hoje: todo mapa migrado
 * tem `props: []` (confirmado antes desta rodada), e o único mapa de demo com
 * props (`play/squareDemoMap.ts`) é pequeno demais (40×40 células) pro raio
 * de detalhe padrão não cobrir o mapa inteiro sozinho.
 */
function mapaFake(width: number, height: number): GameMap {
  const n = width * height;
  return {
    size: { width, height },
    collision: Array.from({ length: n }, () => "walkable"),
    surface: Array.from({ length: n }, () => "grass"),
    heightmap: Array.from({ length: n }, () => 0),
  } as unknown as GameMap;
}

const idx = (map: GameMap, c: number, r: number) => r * map.size.width + c;

describe("alturaDoHorizonte bate com a geometria construída (round-trip)", () => {
  it("em cada vértice EXATO da grade decimada, o valor bate com o atributo `position` da malha", () => {
    const map = mapaFake(120, 120);
    // relevo variado — platô + penhasco, pra não testar só terreno plano
    for (let r = 40; r < 80; r++) for (let c = 20; c < 26; c++) map.heightmap[idx(map, c, r)] = 3;
    for (let r = 0; r < 120; r++) for (let c = 60; c < 90; c++) map.heightmap[idx(map, c, r)] = 4;

    const b = buildHorizonGeometry(map);
    const pos = b.geometry.getAttribute("position");
    let checados = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const yGeometria = pos.getY(i);
      const yFuncao = alturaDoHorizonte(map, x, z);
      expect(yFuncao).toBeCloseTo(yGeometria, 4);
      checados++;
    }
    expect(checados).toBeGreaterThan(100);
    b.geometry.dispose();
  });

  it("num ponto ENTRE dois vértices (bilinear), o valor fica entre o menor e o maior dos 4 vizinhos", () => {
    const map = mapaFake(80, 80);
    for (let r = 0; r < 80; r++) for (let c = 40; c < 80; c++) map.heightmap[idx(map, c, r)] = 5;
    const passoMundo = PASSO_HORIZONTE * SQUARE_SIZE;
    // ponto no meio do primeiro quad da grade real (não da franja)
    const x = passoMundo * 0.5;
    const z = passoMundo * 0.5;
    const y = alturaDoHorizonte(map, x, z);
    const y00 = alturaDoHorizonte(map, 0, 0);
    const y10 = alturaDoHorizonte(map, passoMundo, 0);
    const y01 = alturaDoHorizonte(map, 0, passoMundo);
    const y11 = alturaDoHorizonte(map, passoMundo, passoMundo);
    const menor = Math.min(y00, y10, y01, y11);
    const maior = Math.max(y00, y10, y01, y11);
    expect(y).toBeGreaterThanOrEqual(menor - 1e-6);
    expect(y).toBeLessThanOrEqual(maior + 1e-6);
  });
});

describe("resolverInstanciasVisiveis — a árvore/arbusto distante nunca sobrevive ao terreno", () => {
  const RADIUS = 40; // raio de detalhe pequeno de propósito, pra sobrar mapa fora dele
  const LIMITE = 100;

  function instanciaEm(x: number, y: number, z: number): TreeImpostorInstance {
    return { position: new THREE.Vector3(x, y, z), assetId: "tree_1_a", scale: 1, flip: 1 };
  }

  it("nenhuma instância além de `limite` é desenhada (causa B — teto ausente)", () => {
    const map = mapaFake(200, 200);
    const instances = [instanciaEm(0, 0, 0), instanciaEm(500, 0, 500), instanciaEm(150, 0, 0)];
    const alturas = new Float32Array(instances.length); // valor não importa pra este teste
    const visiveis = resolverInstanciasVisiveis(instances, alturas, { x: 0, z: 0 }, RADIUS, LIMITE);
    for (const v of visiveis) expect(v.d).toBeLessThanOrEqual(LIMITE);
    // a instância a 500,500 (d≈707) NUNCA aparece
    expect(visiveis.some((v) => instances[v.index] === instances[1])).toBe(false);
  });

  it("nenhuma instância dentro do raio de detalhe é desenhada (a árvore 3D real já cobre)", () => {
    const instances = [instanciaEm(10, 0, 0)]; // d=10 < RADIUS=40
    const alturas = new Float32Array(1);
    const visiveis = resolverInstanciasVisiveis(instances, alturas, { x: 0, z: 0 }, RADIUS, LIMITE);
    expect(visiveis).toEqual([]);
  });

  it("PLATÔ ESTREITO: o Y desenhado nunca fica acima da superfície do horizonte além da banda de transição", () => {
    // platô de 6 células (< janela de nivelMinimoNaVizinhanca = 9) — o caso em
    // que o mínimo da vizinhança "engole" o topo inteiro, produzindo o maior
    // gap medido (`_medirCoerencia.test.ts`, causa A)
    const map = mapaFake(200, 200);
    for (let r = 60; r < 140; r++) for (let c = 60; c < 66; c++) map.heightmap[idx(map, c, r)] = 3;

    const instances: TreeImpostorInstance[] = [];
    for (let row = 60; row < 140; row += 4) {
      instances.push(instanciaEm(63 * SQUARE_SIZE + 1, squareLevelToY(3), row * SQUARE_SIZE + 1));
    }
    const alturas = new Float32Array(instances.length);
    for (let i = 0; i < instances.length; i++) {
      alturas[i] = alturaDoHorizonte(map, instances[i]!.position.x, instances[i]!.position.z);
    }
    // centro de visão longe do platô — toda instância do platô fica fora do
    // raio de detalhe E além da banda de transição (100% ancorada no horizonte)
    const center = { x: 0, z: 200 * SQUARE_SIZE };
    const visiveis = resolverInstanciasVisiveis(instances, alturas, center, RADIUS, 1000);
    expect(visiveis.length).toBeGreaterThan(0);
    let algumTotalmenteAncorado = false;
    for (const v of visiveis) {
      if (v.d - RADIUS < BANDA_TRANSICAO_ALTURA_TESTE) continue; // ainda em transição, Y parcialmente autorado — não é o caso testado
      // 100% ancorado: Y tem de ser EXATAMENTE a altura do horizonte ali —
      // nunca o Y autorado do prop (que ficaria até 4+ unidades acima, o
      // "impostor voando" medido antes da correção, ver `_medirCoerencia`)
      expect(v.y).toBeCloseTo(alturas[v.index]!, 4);
      algumTotalmenteAncorado = true;
    }
    expect(algumTotalmenteAncorado).toBe(true);
  });

  it("terreno PLANO: Y continua coerente (gap ≈ 0), a correção não introduz erro onde não havia bug", () => {
    const map = mapaFake(100, 100);
    const instances = [instanciaEm(80 * SQUARE_SIZE, 0, 50 * SQUARE_SIZE)];
    const alturas = new Float32Array([alturaDoHorizonte(map, instances[0]!.position.x, instances[0]!.position.z)]);
    const center = { x: 0, z: 50 * SQUARE_SIZE };
    const visiveis = resolverInstanciasVisiveis(instances, alturas, center, RADIUS, 1000);
    expect(visiveis).toHaveLength(1);
    // terreno plano: gap é só o OFFSET_Y (-0,3) — pequeno, nunca os 4+ do platô
    expect(Math.abs(visiveis[0]!.y - alturas[0]!)).toBeLessThan(0.5);
  });
});

describe("buildTreeImpostorInstances + resolverInstanciasVisiveis, ponta a ponta", () => {
  it("props de mapa.props que caem fora do raio de detalhe e dentro do limite aparecem; nada mais", () => {
    const map = mapaFake(100, 100);
    const props = [
      { id: "a", assetId: "tree_1_a", position: [5, 0, 5], rotation: [0, 0, 0], scale: [1, 1, 1], colliderType: "none" }, // perto — não deve aparecer
      { id: "b", assetId: "tree_1_a", position: [90 * SQUARE_SIZE, 0, 5], rotation: [0, 0, 0], scale: [1, 1, 1], colliderType: "none" }, // longe — deve aparecer
    ] as unknown as MapProp[];
    const instances = buildTreeImpostorInstances(props);
    const alturas = new Float32Array(instances.length);
    for (let i = 0; i < instances.length; i++) alturas[i] = alturaDoHorizonte(map, instances[i]!.position.x, instances[i]!.position.z);
    const visiveis = resolverInstanciasVisiveis(instances, alturas, { x: 0, z: 0 }, 40, 1000);
    expect(visiveis).toHaveLength(1);
    expect(instances[visiveis[0]!.index]!.assetId).toBe("tree_1_a");
    expect(instances[visiveis[0]!.index]!.position.x).toBeCloseTo(90 * SQUARE_SIZE, 3);
  });
});
