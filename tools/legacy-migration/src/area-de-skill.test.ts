import { describe, expect, it } from "vitest";
import { raioDaUnidade, semNegativos } from "./migrate-skills";

/**
 * De onde sai a ÁREA de uma skill.
 *
 * A migração lia só o `SplashArea`, e com isso TODA skill de chão saía com área
 * zero — Storm Gust, Thunderstorm, Meteor Storm, armadilha, todas. A prévia de
 * mira não tinha o que desenhar justamente nas skills em que ela existe para
 * servir.
 *
 * A área dessas skills mora no bloco `Unit`, em dois campos que são mecanismos
 * DIFERENTES:
 *
 *  • `Unit.Layout` — quantas CÉLULAS de unidade se planta, e é o RAIO:
 *    `skill_init_unit_layout` (skill.cpp:14122) monta o quadrado de lado `2i+1`
 *    com deslocamentos de `−i` a `+i`;
 *  • `Unit.Range` — quão longe CADA célula plantada bate.
 *
 * Storm Gust usa o primeiro (Layout 4 = 9×9); Thunderstorm, que não tem Layout
 * nenhum, usa o segundo (Range 2 = 5×5).
 */

describe("raio da área a partir do bloco Unit", () => {
  it("Layout é o RAIO — Storm Gust (Layout 4) é o 9×9 conhecido", () => {
    expect(raioDaUnidade({ Layout: 4 }, 10)).toBe(4);
  });

  it("sem Layout, vale o Range da unidade — é o caso da Thunderstorm", () => {
    const porNivel = Array.from({ length: 10 }, (_, i) => ({ Level: i + 1, Size: 2 }));
    expect(raioDaUnidade({ Range: porNivel }, 10)).toBe(2);
  });

  it("Layout GANHA do Range quando os dois existem", () => {
    // Storm Gust tem Layout 4 e Unit.Range 1: quem descreve a pegada é o layout
    expect(raioDaUnidade({ Layout: 4, Range: 1 }, 10)).toBe(4);
  });

  it("skill sem bloco Unit não inventa área", () => {
    expect(raioDaUnidade(undefined, 10)).toBeUndefined();
    expect(raioDaUnidade({}, 10)).toBeUndefined();
  });

  it("Layout por NÍVEL vira array — Fire Pillar cresce no nível 6", () => {
    const porNivel = Array.from({ length: 10 }, (_, i) => ({ Level: i + 1, Size: i < 5 ? 1 : 2 }));
    expect(raioDaUnidade({ Layout: porNivel }, 10)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  });

  it("Layout 0 é área de UMA célula, e isso é um valor legítimo", () => {
    // não pode virar `undefined`: zero é resposta, não ausência
    expect(raioDaUnidade({ Layout: 0 }, 5)).toBe(0);
  });
});

describe("layout especial não vira raio", () => {
  /**
   * `-1` são as formas montadas à mão em `skill_init_unit_layout` — parede,
   * linha, cruz. Ali não existe raio, e devolver um número faria a prévia
   * desenhar um quadrado que não é o que a skill pega. Melhor não desenhar nada
   * do que desenhar errado.
   */
  it("escalar -1 vira ausência", () => {
    expect(semNegativos(-1)).toBeUndefined();
    expect(raioDaUnidade({ Layout: -1 }, 5)).toBeUndefined();
  });

  it("-1 no meio de um array vira 0 naquele nível, não ausência no resto", () => {
    expect(semNegativos([2, -1, 3])).toEqual([2, 0, 3]);
  });

  it("Layout -1 cai para o Range da unidade, se houver", () => {
    expect(raioDaUnidade({ Layout: -1, Range: 3 }, 5)).toBe(3);
  });

  it("zero e positivos passam intactos", () => {
    expect(semNegativos(0)).toBe(0);
    expect(semNegativos(4)).toBe(4);
    expect(semNegativos([0, 1, 2])).toEqual([0, 1, 2]);
    expect(semNegativos(undefined)).toBeUndefined();
  });
});
