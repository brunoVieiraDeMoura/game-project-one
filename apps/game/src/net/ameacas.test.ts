import { beforeEach, describe, expect, it } from "vitest";
import { AMEACA_VALIDADE_MS, ameacasVivas, estaMeAtacando, limparAmeacas, marcarAmeaca } from "./ameacas";

/**
 * "Quem está me batendo" é o termo que mais muda a sensação da assistência de
 * mira: no meio de três monstros, o que se quer clicar é quase sempre o que está
 * acertando você.
 *
 * O relógio é passado por parâmetro justamente para poder ser testado — o módulo
 * não chama `performance.now()` por conta própria.
 */

beforeEach(() => limparAmeacas());

describe("ameacas", () => {
  it("marca o atacante e o reconhece", () => {
    marcarAmeaca(42, 1000);
    expect(estaMeAtacando(42, 1000)).toBe(true);
    expect(estaMeAtacando(43, 1000)).toBe(false);
  });

  it("expira sozinha — mob que parou de bater deixa de ser prioridade", () => {
    marcarAmeaca(42, 1000);
    expect(estaMeAtacando(42, 1000 + AMEACA_VALIDADE_MS - 1)).toBe(true);
    expect(estaMeAtacando(42, 1000 + AMEACA_VALIDADE_MS)).toBe(false);
  });

  it("cada golpe renova a validade", () => {
    marcarAmeaca(42, 1000);
    marcarAmeaca(42, 1000 + AMEACA_VALIDADE_MS - 1);
    // sem a renovação, aqui já teria expirado
    expect(estaMeAtacando(42, 1000 + AMEACA_VALIDADE_MS + 1)).toBe(true);
  });

  it("limpar esquece tudo — os gids são reciclados pelo servidor", () => {
    marcarAmeaca(1, 1000);
    marcarAmeaca(2, 1000);
    expect(ameacasVivas(1000)).toBe(2);
    limparAmeacas();
    expect(ameacasVivas(1000)).toBe(0);
    // um gid reaproveitado depois da troca de mapa não herda a ameaça velha
    expect(estaMeAtacando(1, 1000)).toBe(false);
  });
});
