import { describe, expect, it } from "vitest";
import { fogDistances, GameplayConfigSchema } from "@ragnarok/game-data";
import { scaleToWorld } from "./useGameplayConfig";

/**
 * O hexScale multiplica o mundo inteiro — inclusive a altura de cada nível.
 * Toda distância de mundo precisa acompanhar, senão aumentar o bloco enfia a
 * câmera dentro do terreno e fecha a névoa em cima do personagem.
 */
const cfg = (patch: Record<string, number | string> = {}) => GameplayConfigSchema.parse(patch);

describe("scaleToWorld", () => {
  it("hexScale 1 não mexe em nada", () => {
    const c = cfg({ hexScale: 1 });
    expect(scaleToWorld(c)).toStrictEqual(c);
  });

  it("hexScale fora da faixa cai no limite que o GRID usa de verdade", () => {
    // o admin oferece até 12; passar disso desenharia o mundo num tamanho e
    // calcularia distância/posição noutro — foi o que jogou o player pra fora
    const absurdo = scaleToWorld(cfg({ hexScale: 999 }));
    expect(absurdo.hexScale).toBe(12);
    const base = cfg({ hexScale: 1 });
    // a névoa é fração do raio, então ela acompanha por tabela
    expect(fogDistances(absurdo).far).toBeCloseTo(fogDistances(base).far * 12, 4);
  });

  it("escala névoa, alcance e pulo pelo tamanho do bloco", () => {
    const base = cfg({ hexScale: 1 });
    const big = scaleToWorld(cfg({ hexScale: 10 }));
    for (const k of ["renderDistance", "moveSpeed", "jumpHeight", "gravity"] as const) {
      expect(big[k]).toBeCloseTo(base[k] * 10, 5);
    }
    // a névoa não tem campo próprio em unidades: ela sai do raio, que escalou
    expect(fogDistances(big).near).toBeCloseTo(fogDistances(base).near * 10, 5);
    expect(fogDistances(big).far).toBeCloseTo(fogDistances(base).far * 10, 5);
  });

  it("personagem e câmera acompanham o tamanho do bloco", () => {
    const base = cfg({ hexScale: 1 });
    const big = scaleToWorld(cfg({ hexScale: 10 }));
    // charScale é proporção do hexágono: 10× o bloco = 10× o personagem
    expect(big.charScale).toBeCloseTo(base.charScale * 10, 5);
    expect(big.cameraDistance).toBeCloseTo(base.cameraDistance * 10, 4);
  });

  it("personagem miúdo ainda mantém a câmera FORA do bloco", () => {
    const big = scaleToWorld(cfg({ hexScale: 10, charScale: 0.01 }));
    expect(big.cameraDistance).toBeGreaterThan(10);
  });

  it("NÃO escala o que não é distância de mundo", () => {
    const base = cfg({ hexScale: 1 });
    const big = scaleToWorld(cfg({ hexScale: 10 }));
    expect(big.cameraMaxZoom).toBe(base.cameraMaxZoom); // multiplicador
    expect(big.cameraRotateSpeed).toBe(base.cameraRotateSpeed);
    expect(big.animationSpeed).toBe(base.animationSpeed);
    expect(big.hexScale).toBe(10);
  });

  it("o pulo mantém a DURAÇÃO (altura e gravidade escalam juntas)", () => {
    const tempoDeVoo = (h: number, g: number) => Math.sqrt((2 * h) / g);
    const base = cfg({ hexScale: 1 });
    const big = scaleToWorld(cfg({ hexScale: 7 }));
    expect(tempoDeVoo(big.jumpHeight, big.gravity)).toBeCloseTo(tempoDeVoo(base.jumpHeight, base.gravity), 6);
  });

  it("a câmera fica FORA do bloco: distância > altura de um nível", () => {
    // com hexScale 10 um nível tem 10 de altura; a câmera a 6 ficava dentro dele
    const big = scaleToWorld(cfg({ hexScale: 10 }));
    expect(big.cameraDistance).toBeGreaterThan(10);
    // e a névoa não pode fechar antes de alguns hexágonos (largura = 2×escala)
    expect(fogDistances(big).near).toBeGreaterThan(2 * 10);
  });
});
