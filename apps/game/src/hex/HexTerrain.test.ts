import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { weldTopFace } from "./HexTerrain";

/**
 * O weld tem que colar a borda tanto do tile PLANO quanto da RAMPA. A regressão
 * que motivou a reescrita: a versão antiga empurrava a borda toda pro maior Y
 * do modelo, o que colava só a tampa alta da rampa e deixava a costura em volta
 * de toda a parte inclinada (visível nas estradas "sloped high").
 */

const SIN60 = Math.sqrt(3) / 2;

/** monta um pedaço de borda como nos tiles KayKit: anel interno (apótema 0.95)
 * na altura da superfície, anel externo (apótema 1.0) 0.05 abaixo — o chanfro
 * de 45° — e o TOPO DA PAREDE lateral no mesmo Y do chanfro, com normal
 * horizontal. `surfaceY(x,z)` define se a superfície é plana ou inclinada. */
function edgeStrip(surfaceY: (x: number, z: number) => number, normalOf: () => [number, number, number]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2;
    const dirX = Math.cos(ang), dirZ = Math.sin(ang);
    // apótema do ponto: normaliza pra ter exatamente 0.95 / 1.00
    const apo = Math.max(Math.abs(dirX), Math.abs(dirX * 0.5 + dirZ * SIN60), Math.abs(-dirX * 0.5 + dirZ * SIN60));
    const ix = (dirX / apo) * 0.95, iz = (dirZ / apo) * 0.95;
    const ox = dirX / apo, oz = dirZ / apo;
    const [nx, ny, nz] = normalOf();
    pos.push(ix, surfaceY(ix, iz), iz);
    nrm.push(nx, ny, nz);
    pos.push(ox, surfaceY(ix, iz) - 0.05, oz); // chanfro: desce 0.05
    nrm.push(nx * 0.7, 0.707, nz * 0.7); // normal inclinada do chanfro
    pos.push(ox, surfaceY(ix, iz) - 0.05, oz); // topo da parede (mesmo lugar)
    nrm.push(dirX, 0, dirZ); // normal horizontal
    pos.push(ox, surfaceY(ix, iz) - 1, oz); // base da parede
    nrm.push(dirX, 0, dirZ);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

/** grupos do strip: cada volta tem interno, chanfro, topo-de-parede e base */
function pairs(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const out: { innerY: number; outerY: number; outerNy: number; innerNy: number; wallTopY: number; wallTopNy: number; baseY: number }[] = [];
  for (let i = 0; i + 3 < p.count; i += 4) {
    out.push({
      innerY: p.getY(i),
      outerY: p.getY(i + 1),
      outerNy: n.getY(i + 1),
      innerNy: n.getY(i),
      wallTopY: p.getY(i + 2),
      wallTopNy: n.getY(i + 2),
      baseY: p.getY(i + 3),
    });
  }
  return out;
}

describe("weldTopFace", () => {
  it("tile plano: a borda externa sobe pro nível da superfície", () => {
    const g = weldTopFace(edgeStrip(() => 0, () => [0, 1, 0]));
    for (const { innerY, outerY, outerNy } of pairs(g)) {
      expect(outerY).toBeCloseTo(innerY, 5);
      expect(outerY).toBeCloseTo(0, 5);
      expect(outerNy).toBeCloseTo(1, 5); // chanfro deixou de pegar luz de lado
    }
  });

  it("o chanfro COLAPSA (anel interno vai até a borda) — senão vira acne de sombra", () => {
    const g = weldTopFace(edgeStrip(() => 0, () => [0, 1, 0]));
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i += 4) {
      const x = p.getX(i), z = p.getZ(i);
      const apo = Math.max(Math.abs(x), Math.abs(x * 0.5 + z * SIN60), Math.abs(-x * 0.5 + z * SIN60));
      expect(apo).toBeCloseTo(1, 4); // interno esticado até a borda real
    }
  });

  it("o TOPO DA PAREDE sobe junto (senão abre vão, visível com hexScale alto)", () => {
    const g = weldTopFace(edgeStrip(() => 0, () => [0, 1, 0]));
    for (const { wallTopY, outerY, wallTopNy, baseY } of pairs(g)) {
      expect(wallTopY).toBeCloseTo(outerY, 5); // encosta na superfície
      expect(wallTopNy).toBeCloseTo(0, 5); // continua sombreando de lado
      expect(baseY).toBeCloseTo(-1, 5); // a base do bloco NÃO foi arrastada
    }
  });

  it("na rampa, cada ponto da parede acompanha a altura local da superfície", () => {
    const g = weldTopFace(edgeStrip((x) => (x + 1) / 2, () => [-0.447, 0.894, 0]));
    const ys = new Set<number>();
    for (const { wallTopY, outerY } of pairs(g)) {
      expect(wallTopY).toBeCloseTo(outerY, 5);
      ys.add(Number(wallTopY.toFixed(3)));
    }
    expect(ys.size).toBeGreaterThan(3); // seguiu a inclinação, não virou platô
  });

  it("rampa: cada ponto da borda vai pra ALTURA DA SUPERFÍCIE ALI (não pro topo)", () => {
    // superfície inclinada: sobe 1 nível ao longo de X, como os *_sloped_high
    const slope = (x: number) => (x + 1) / 2;
    const g = weldTopFace(edgeStrip((x) => slope(x), () => [-0.447, 0.894, 0]));
    const ys = new Set<number>();
    for (const { innerY, outerY } of pairs(g)) {
      expect(outerY).toBeCloseTo(innerY, 5); // colou na superfície local
      ys.add(Number(outerY.toFixed(3)));
    }
    // a borda continua em alturas DIFERENTES (a rampa não virou um platô)
    expect(ys.size).toBeGreaterThan(3);
    const arr = [...ys];
    expect(Math.max(...arr) - Math.min(...arr)).toBeGreaterThan(0.5);
  });

  it("rampa: a normal da borda acompanha a inclinação (não vira (0,1,0))", () => {
    const g = weldTopFace(edgeStrip((x) => (x + 1) / 2, () => [-0.447, 0.894, 0]));
    for (const { outerNy, innerNy } of pairs(g)) {
      expect(outerNy).toBeCloseTo(innerNy, 5);
      expect(outerNy).toBeLessThan(0.95); // inclinada, não achatada
    }
  });

  it("peça sem chanfro (só borda, tipo hex_water) passa intacta", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([1, 0, 0, 0, 0, 1, -1, 0, 0], 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    expect(weldTopFace(g)).toBe(g); // mesma referência = não clonou nem mexeu
  });
});
