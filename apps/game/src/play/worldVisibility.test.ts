import { describe, expect, it } from "vitest";
import { GameplayConfigSchema } from "@ragnarok/game-data";
import { raiosDeVisao } from "./viewRadius";
import { visibilidadeDoMundo } from "./worldVisibility";

/**
 * Testes de unidade do módulo (a invariante completa, varrida por vários
 * raios, mora em `perf/desempenho.test.ts` — orçamento de desempenho é onde
 * o resto da suíte de raios já vive). Aqui: comportamento local do módulo em
 * si, um caso por vez.
 */
describe("visibilidadeDoMundo", () => {
  it("envolve raiosDeVisao sem alterar nenhum dos 4 raios originais", () => {
    const cfg = GameplayConfigSchema.parse({ renderDistance: 200 });
    const original = raiosDeVisao(cfg, 900);
    const v = visibilidadeDoMundo(cfg, 900);
    expect(v.detalhe).toBe(original.detalhe);
    expect(v.entidades).toBe(original.entidades);
    expect(v.horizonte).toBe(original.horizonte);
    expect(v.fogNear).toBe(original.fogNear);
    expect(v.fogFar).toBe(original.fogFar);
  });

  it("vegetacaoDetalhe é o mesmo raio que a árvore 3D já usava (detalhe)", () => {
    const v = visibilidadeDoMundo(GameplayConfigSchema.parse({ renderDistance: 130 }));
    expect(v.vegetacaoDetalhe).toBe(v.detalhe);
  });

  it("vegetacaoRasteira é 60% de detalhe — mesmo valor que RAIO_RASTEIRA_FRAC tinha em VegetationInstancer", () => {
    const v = visibilidadeDoMundo(GameplayConfigSchema.parse({ renderDistance: 100 }));
    expect(v.vegetacaoRasteira).toBeCloseTo(60, 5);
  });

  it("limiteVegetacao respeita o teto do mapa (mapaMaiorLado) do mesmo jeito que o horizonte", () => {
    // mapa pequeno o bastante para o teto do mapa entrar em jogo (mesmo
    // comportamento de `raiosDeVisao` — ver viewRadius.test caso exista, ou o
    // comentário de `horizonteBruto`/`mapaMaiorLado` em viewRadius.ts)
    const cfg = GameplayConfigSchema.parse({ renderDistance: 130 });
    const semTeto = visibilidadeDoMundo(cfg);
    const comTetoPequeno = visibilidadeDoMundo(cfg, 200);
    expect(comTetoPequeno.horizonte).toBeLessThan(semTeto.horizonte);
    expect(comTetoPequeno.limiteVegetacao).toBeLessThanOrEqual(comTetoPequeno.horizonte);
  });
});
