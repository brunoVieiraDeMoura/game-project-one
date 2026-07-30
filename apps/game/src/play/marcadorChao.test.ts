import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { TerrainQuery } from "@ragnarok/engine-core";
import { baseDoProp, moldarMarcador, raizDoProp } from "./pickGround";

/**
 * O marcador de destino (o quadrado no chão) tem que VESTIR o relevo.
 *
 * Um quad plano só encosta no terreno onde a altura bate com a do centro: numa
 * rampa ele espeta de um lado e afunda do outro, e o jogador vê metade do
 * quadrado — o relato de que "ele perde o formato ao passar sobre rampas e
 * montanhas". Cada vértice passa a ser amostrado no `TerrainQuery`, o MESMO que
 * o movimento consulta.
 */
const SEGS = 6;
const RAIO = 1;

/** rampa constante no eixo X (0,25 de altura por unidade de mundo) */
const rampa: TerrainQuery = {
  getHeight: (x) => x * 0.25,
  isWalkable: () => true,
};
/** morro: um cone suave em volta da origem */
const morro: TerrainQuery = {
  getHeight: (x, z) => Math.max(0, 3 - Math.hypot(x, z) * 0.5),
  isWalkable: () => true,
};

function geoMarcador() {
  return new THREE.PlaneGeometry(RAIO * 2, RAIO * 2, SEGS, SEGS);
}

/** ys dos vértices, na ordem em que o marcador escreve */
function alturas(geo: THREE.BufferGeometry): number[] {
  const pos = geo.getAttribute("position");
  const out: number[] = [];
  for (let v = 0; v < pos.count; v++) out.push(pos.getY(v));
  return out;
}

describe("moldarMarcador", () => {
  it("cada vértice fica na altura do terreno naquele ponto", () => {
    const geo = geoMarcador();
    moldarMarcador(geo, 10, 4, RAIO, rampa);
    const pos = geo.getAttribute("position");
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      // LIFT = 0,06 de folga contra z-fighting
      expect(pos.getY(v)).toBeCloseTo(rampa.getHeight(x, z) + 0.06, 5);
    }
  });

  it("na rampa o marcador INCLINA (num plano rígido, todos os ys seriam iguais)", () => {
    const geo = geoMarcador();
    moldarMarcador(geo, 10, 4, RAIO, rampa);
    const ys = alturas(geo);
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    // largura 2 × inclinação 0,25 = 0,5 de diferença entre as pontas
    expect(max - min).toBeCloseTo(0.5, 2);
  });

  it("no lombo do morro ele CURVA: o meio fica acima da média das pontas", () => {
    const geo = geoMarcador();
    moldarMarcador(geo, 0, 0, RAIO, morro);
    const pos = geo.getAttribute("position");
    const meio = (SEGS / 2) * (SEGS + 1) + SEGS / 2; // vértice central da grade
    const yMeio = pos.getY(meio);
    const yCantos = [0, SEGS, SEGS * (SEGS + 1), (SEGS + 1) * (SEGS + 1) - 1].map((v) => pos.getY(v));
    const mediaCantos = yCantos.reduce((a, b) => a + b, 0) / yCantos.length;
    expect(yMeio).toBeGreaterThan(mediaCantos);
  });

  it("fica centrado no ponto pedido e do tamanho pedido", () => {
    const geo = geoMarcador();
    moldarMarcador(geo, 7, -3, RAIO, rampa);
    const pos = geo.getAttribute("position");
    const xs: number[] = [];
    const zs: number[] = [];
    for (let v = 0; v < pos.count; v++) {
      xs.push(pos.getX(v));
      zs.push(pos.getZ(v));
    }
    expect(Math.min(...xs)).toBeCloseTo(7 - RAIO);
    expect(Math.max(...xs)).toBeCloseTo(7 + RAIO);
    expect(Math.min(...zs)).toBeCloseTo(-3 - RAIO);
    expect(Math.max(...zs)).toBeCloseTo(-3 + RAIO);
  });

  it("terreno plano continua dando marcador plano", () => {
    const plano: TerrainQuery = { getHeight: () => 2, isWalkable: () => true };
    const geo = geoMarcador();
    moldarMarcador(geo, 0, 0, RAIO, plano);
    for (const y of alturas(geo)) expect(y).toBeCloseTo(2.06, 5);
  });
});

/**
 * Reproduz a hierarquia MEDIDA na cena: o filho direto do grupo é um `Object3D`
 * vazio na ORIGEM, e a translação do prop mora no nó `Scene` de dentro do .gltf.
 * Por isso o alvo não pode ser a posição da raiz — seria sempre (0,0).
 */
function propComoNaCena(x: number, z: number) {
  const grupo = new THREE.Group();
  const wrapper = new THREE.Object3D(); // fica na origem, como o do R3F
  const cenaGltf = new THREE.Group();
  cenaGltf.name = "Scene";
  cenaGltf.position.set(x, 0, z); // aqui está a posição de verdade
  // tronco fino no centro + copa larga e alta, deslocada de propósito
  const tronco = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6));
  tronco.position.set(0, 2, 0);
  const copa = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8));
  copa.position.set(0, 8, 0);
  cenaGltf.add(tronco, copa);
  wrapper.add(cenaGltf);
  grupo.add(wrapper);
  grupo.updateMatrixWorld(true);
  return { grupo, wrapper, copa, tronco };
}

describe("raizDoProp", () => {
  it("sobe da malha atingida até o filho direto do grupo", () => {
    const { grupo, wrapper, copa } = propComoNaCena(10, 20);
    expect(raizDoProp(copa, grupo)).toBe(wrapper);
  });

  it("objeto fora do grupo devolve null (não inventa alvo)", () => {
    const grupo = new THREE.Group();
    const solto = new THREE.Mesh();
    expect(raizDoProp(solto, grupo)).toBeNull();
    expect(raizDoProp(solto, undefined)).toBeNull();
  });

  it("malha que JÁ é filha direta do grupo é a própria raiz", () => {
    const grupo = new THREE.Group();
    const m = new THREE.Mesh();
    grupo.add(m);
    expect(raizDoProp(m, grupo)).toBe(m);
  });
});

describe("baseDoProp", () => {
  it("acertar a COPA devolve o eixo do tronco, não a raiz vazia na origem", () => {
    const { grupo, copa } = propComoNaCena(120, 240);
    const pe = baseDoProp(copa, grupo);
    // era o bug: usar a posição do nó raiz dava (0,0) — 331 células de erro
    expect(pe).toEqual({ x: 120, z: 240 });
  });

  it("dá o mesmo ponto para qualquer parte do prop atingida", () => {
    const { grupo, copa, tronco } = propComoNaCena(50, 70);
    expect(baseDoProp(copa, grupo)).toEqual(baseDoProp(tronco, grupo));
  });

  it("memoiza por prop (props não andam no /play)", () => {
    const { grupo, copa, wrapper } = propComoNaCena(8, 9);
    const primeiro = baseDoProp(copa, grupo);
    // mover depois não muda a resposta: é cache proposital, não bug
    wrapper.position.set(999, 0, 999);
    grupo.updateMatrixWorld(true);
    expect(baseDoProp(copa, grupo)).toBe(primeiro);
  });

  it("subárvore sem geometria devolve null em vez de NaN", () => {
    const grupo = new THREE.Group();
    const vazio = new THREE.Object3D();
    grupo.add(vazio);
    expect(baseDoProp(vazio, grupo)).toBeNull();
  });
});
