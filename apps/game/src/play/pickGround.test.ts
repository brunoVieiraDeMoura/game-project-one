import { describe, expect, it } from "vitest";
import { nearestHit, topmostXZ, type Hit } from "./pickGround";

/**
 * O cursor tem que apontar o TOPO sob o mouse, não o chão embaixo do bloco.
 *
 * O caso real: o handler mora no grupo e, sem `stopPropagation`, o R3F o chama
 * uma vez por objeto atingido — terreno primeiro, plano-base de y≈0 por último.
 * Usando `e.point`, a última chamada vencia e o cursor pulava para a célula do
 * chão. Estes testes fixam a regra: vale o hit MAIS PRÓXIMO.
 */
const hit = (distance: number, x: number, z: number, y = 0): Hit => ({ distance, point: { x, y, z } });

describe("nearestHit", () => {
  it("escolhe o mais próximo mesmo com a lista fora de ordem", () => {
    const topo = hit(10, 100, 100, 6);
    const plano = hit(24, 130, 130, 0);
    expect(nearestHit([plano, topo])).toBe(topo);
    expect(nearestHit([topo, plano])).toBe(topo);
  });

  it("lista vazia devolve null", () => {
    expect(nearestHit([])).toBeNull();
  });

  it("ignora distância não finita (raio paralelo, hit degenerado)", () => {
    const bom = hit(30, 1, 1);
    expect(nearestHit([hit(Number.POSITIVE_INFINITY, 9, 9), bom])).toBe(bom);
    expect(nearestHit([hit(Number.NaN, 9, 9)])).toBeNull();
  });
});

describe("topmostXZ", () => {
  it("devolve o XZ do topo, não o do plano de baixo", () => {
    // bloco de 3 níveis: o topo está 15 unidades adiante do ponto no plano y=0
    const p = topmostXZ([hit(24, 130, 130), hit(10, 100, 100, 6)], { x: 130, z: 130 });
    expect(p).toEqual({ x: 100, z: 100 });
  });

  it("sem interseção nenhuma, cai no fallback (o plano de clique)", () => {
    expect(topmostXZ([], { x: 7, z: 9 })).toEqual({ x: 7, z: 9 });
  });

  it("célula apontada muda de fato: 15 unidades = 7 células de 2,0", () => {
    const doPlano = topmostXZ([], { x: 130, z: 130 });
    const doTopo = topmostXZ([hit(10, 100, 100, 6)], { x: 130, z: 130 });
    const cel = (v: number) => Math.floor(v / 2);
    expect(cel(doPlano.x) - cel(doTopo.x)).toBe(15);
  });
});
