import { describe, expect, it } from "vitest";
import { celulaNoAlcance, dentroDoAlcance } from "./skillWalkStore";
import { distanciaDeAtaque } from "./attackStore";
import { raioDeAlcance } from "./skillCatalog";

/**
 * "Anda até o alcance e lança" — a ordem que faltava.
 *
 * O rAthena não se aproxima pelo jogador: `unit_skilluse_pos2` (unit.cpp:2690)
 * só GUARDA o pedido quando o personagem JÁ está andando; parado e fora de
 * alcance ele devolve 0, calado. Clicar com o disco vermelho não fazia nada.
 */

const EU = { x: 100, y: 100 };

describe("dentroDoAlcance", () => {
  it("usa a distância do SERVIDOR, não hipotenusa crua", () => {
    /**
     * `distance_client` subtrai 0,1 antes de truncar, então a diagonal (1,1)
     * conta como 1 e não como 1,41. Com `hypot` cru esta célula seria recusada
     * pelo cliente e aceita pelo servidor — o personagem andaria um passo à toa.
     */
    expect(distanciaDeAtaque(1, 1)).toBe(1);
    expect(dentroDoAlcance(EU, { x: 101, y: 101 }, 1)).toBe(true);
  });

  it("alcance 0 é 'sem alcance': vale de qualquer lugar", () => {
    expect(raioDeAlcance(0)).toBe(0);
    expect(dentroDoAlcance(EU, { x: 180, y: 180 }, 0)).toBe(true);
  });

  it("alcance NEGATIVO (convenção do rAthena, Range: -9 da Double Strafe) vira o valor ABSOLUTO, não 'sem alcance'", () => {
    // skill_get_range2 (skill.cpp:328-334): com `skillrange_from_weapon`
    // desligado (padrão, e não religado em battle_conf.txt), `range < 0` vira
    // `range *= -1` — nunca vira 0. Tratar como 0 fazia a skill lançar de
    // qualquer distância, sem nunca andar até o alcance real.
    expect(raioDeAlcance(-9)).toBe(9);
    expect(dentroDoAlcance(EU, { x: 120, y: 100 }, raioDeAlcance(-9))).toBe(false);
  });

  it("longe é longe", () => {
    expect(dentroDoAlcance(EU, { x: 120, y: 100 }, 9)).toBe(false);
  });
});

describe("celulaNoAlcance", () => {
  it("já dá para lançar: não anda", () => {
    expect(celulaNoAlcance(EU, { x: 105, y: 100 }, 9)).toBeNull();
  });

  it("para na BORDA do alcance, não em cima do alvo", () => {
    const alvo = { x: 130, y: 100 };
    const destino = celulaNoAlcance(EU, alvo, 9)!;
    expect(destino).toEqual({ x: 121, y: 100 });
    // e de lá o servidor aceita
    expect(dentroDoAlcance(destino, alvo, 9)).toBe(true);
  });

  it("na diagonal também chega de uma vez — é o que o passo por EIXO não fazia", () => {
    /**
     * `celulaParaEncostar` (o do ataque) anda `sign × alcance` em CADA eixo, e
     * numa diagonal isso cai a `raio × 1,41` do alvo: ainda fora. Com alcance 1
     * ninguém nota; com os 9 de uma Storm Gust o personagem andaria, recalcularia
     * e andaria de novo.
     */
    const alvo = { x: 130, y: 130 };
    const destino = celulaNoAlcance(EU, alvo, 9)!;
    expect(dentroDoAlcance(destino, alvo, 9)).toBe(true);
  });

  it("o destino fica na linha reta entre o personagem e o alvo", () => {
    const alvo = { x: 100, y: 140 };
    const destino = celulaNoAlcance(EU, alvo, 5)!;
    // mesma coluna, e do lado de quem lança
    expect(destino.x).toBe(100);
    expect(destino.y).toBeGreaterThan(EU.y);
    expect(destino.y).toBeLessThan(alvo.y);
  });

  it("converge em UM passo para vários alcances e direções", () => {
    /**
     * A invariante que importa: de onde ele parar, o servidor aceita. Sem isso a
     * ordem viraria uma sequência de aproximações — e cada `move:to` é um
     * redirecionamento, que é justamente o que acumula deriva.
     */
    for (const raio of [1, 3, 5, 9, 14]) {
      for (const alvo of [
        { x: 160, y: 100 },
        { x: 100, y: 40 },
        { x: 160, y: 160 },
        { x: 60, y: 130 },
        { x: 143, y: 111 },
      ]) {
        const destino = celulaNoAlcance(EU, alvo, raio);
        if (!destino) continue;
        expect(dentroDoAlcance(destino, alvo, raio)).toBe(true);
      }
    }
  });

  it("alcance 0 nunca manda andar", () => {
    expect(celulaNoAlcance(EU, { x: 300, y: 300 }, 0)).toBeNull();
  });
});
