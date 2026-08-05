import { describe, expect, it } from "vitest";
import { GameplayConfigSchema, fogDistances } from "./server-config";

/**
 * A névoa virou FRAÇÃO do raio de renderização, e a config já gravada está no
 * formato antigo (dois números em unidades, mais um raio independente).
 *
 * O que estes testes travam é a promessa que justificou a mudança: a vista de
 * quem já tinha config NÃO muda — só para de desenhar o pedaço que ficava atrás
 * da névoa. Se a conversão errar, o jogador vê o mundo encolher ou crescer sem
 * ter pedido.
 */
describe("gameplay: névoa como fração do raio", () => {
  it("o default reproduz a vista de antes (90 → 120)", () => {
    const g = GameplayConfigSchema.parse({});
    const { near, far } = fogDistances(g);
    expect(near).toBeCloseTo(90, 0);
    expect(far).toBeCloseTo(120, 0);
    // e a malha acaba DEPOIS da névoa fechar — é isso que esconde a borda
    expect(far).toBeLessThan(g.renderDistance);
  });

  it("config antiga (fogNear/fogFar em unidades) converte sem mudar a vista", () => {
    // exatamente o que está salvo no servidor do projeto
    const g = GameplayConfigSchema.parse({ renderDistance: 200, fogNear: 90, fogFar: 120 });
    const { near, far } = fogDistances(g);
    expect(near).toBeCloseTo(90, 0);
    expect(far).toBeCloseTo(120, 0);
    // o raio, sim, encolhe: era 200 (e o terreno ia a 236) para esconder uma
    // névoa que fecha aos 120
    expect(g.renderDistance).toBeLessThan(140);
    expect(g.renderDistance).toBeGreaterThan(far);
  });

  it("os campos antigos não sobrevivem à conversão", () => {
    const g = GameplayConfigSchema.parse({ renderDistance: 200, fogNear: 90, fogFar: 120 }) as Record<string, unknown>;
    expect(g.fogNear).toBeUndefined();
    expect(g.fogFar).toBeUndefined();
  });

  it("config NOVA não é tocada pela conversão", () => {
    const g = GameplayConfigSchema.parse({ renderDistance: 300, fogNearFrac: 0.5, fogFarFrac: 0.8, fogFar: 999 });
    expect(g.renderDistance).toBe(300);
    expect(fogDistances(g).far).toBeCloseTo(240, 5);
  });

  it("mexer no raio leva a névoa junto — é o ponto da mudança", () => {
    const perto = GameplayConfigSchema.parse({ renderDistance: 100 });
    const longe = GameplayConfigSchema.parse({ renderDistance: 300 });
    expect(fogDistances(longe).far / fogDistances(perto).far).toBeCloseTo(3, 5);
    expect(fogDistances(longe).near / fogDistances(perto).near).toBeCloseTo(3, 5);
  });

  it("a névoa nunca passa do raio (não dá para desenhar borda de propósito)", () => {
    const g = GameplayConfigSchema.parse({ fogFarFrac: 1, fogNearFrac: 1 });
    expect(fogDistances(g).far).toBeLessThanOrEqual(g.renderDistance);
    expect(() => GameplayConfigSchema.parse({ fogFarFrac: 1.5 })).toThrow();
  });
});
