import { describe, expect, it } from "vitest";
import { deveEmendar, respostaDoServidor } from "./emenda";

/**
 * As duas regras que a predição client-side quebrou em silêncio.
 *
 * O sintoma era a caminhada longa: trava, volta algumas células, segue. Estes
 * casos descrevem a SEQUÊNCIA real de quadros — é onde o defeito aparecia, e é
 * o que um teste de valor isolado não pegaria.
 */

describe("respostaDoServidor", () => {
  it("a própria PREDIÇÃO não conta como resposta", () => {
    /**
     * O defeito exato: `emitir` grava a janela de resposta e logo em seguida
     * chama `preverMovimento`, que reescreve `movedAt`. No quadro seguinte a
     * comparação de `movedAt` dizia "o servidor respondeu" — sobre o próprio
     * palpite do cliente.
     */
    expect(respostaDoServidor(500, 100, true)).toBe(false);
  });

  it("o pacote do servidor conta", () => {
    expect(respostaDoServidor(500, 100, false)).toBe(true);
  });

  it("mesmo trecho não conta duas vezes", () => {
    expect(respostaDoServidor(500, 500, false)).toBe(false);
  });

  it("a sequência real: pedido → predição → pacote", () => {
    let ultimo = 0;
    const ver = (movedAt: number, predito: boolean) => {
      const fechou = respostaDoServidor(movedAt, ultimo, predito);
      if (fechou) ultimo = movedAt;
      return fechou;
    };
    // predição do clique: a janela CONTINUA aberta
    expect(ver(100, true)).toBe(false);
    // quadros seguintes, ainda predito
    expect(ver(100, true)).toBe(false);
    // o pacote chega
    expect(ver(240, false)).toBe(true);
    // e não fecha de novo pelo mesmo trecho
    expect(ver(240, false)).toBe(false);
  });
});

describe("deveEmendar", () => {
  const base = { quaseLa: true, temPedidoNoAr: false, movedAt: 100, emendadoDe: null as number | null };

  it("emenda quando falta pouco e não há pedido no ar", () => {
    expect(deveEmendar(base)).toBe(true);
  });

  it("não emenda com pedido no ar", () => {
    expect(deveEmendar({ ...base, temPedidoNoAr: true })).toBe(false);
  });

  it("não emenda longe do fim do trecho", () => {
    expect(deveEmendar({ ...base, quaseLa: false })).toBe(false);
  });

  it("UMA emenda por trecho — o quadro seguinte não repete", () => {
    /**
     * A guarda "pedido no ar" não cobre isto: o pacote do servidor a fecha, e
     * aí `quaseLa` continua verdadeiro no quadro seguinte. Sem o dedupe, cada
     * quadro depois da resposta pedia de novo o mesmo destino final — um
     * redirecionamento por quadro (limitado a 5 Hz pela fila), cada um enchendo
     * a fila de previstos do `worldStore` até a reconciliação parar de aplicar
     * pacote.
     */
    expect(deveEmendar({ ...base, emendadoDe: 100 })).toBe(false);
  });

  it("trecho NOVO libera a emenda seguinte", () => {
    // é assim que a caminhada longa avança: um trecho, uma emenda
    expect(deveEmendar({ ...base, movedAt: 340, emendadoDe: 100 })).toBe(true);
  });

  it("a caminhada longa inteira: um pedido por trecho, nunca dois", () => {
    let emendadoDe: number | null = null;
    let pedidos = 0;
    let movedAt = 100;
    // 4 trechos; em cada um, 30 quadros com `quaseLa` verdadeiro e sem pedido
    // no ar (o pior caso, que era o que produzia o laço)
    for (let trecho = 0; trecho < 4; trecho++) {
      for (let quadro = 0; quadro < 30; quadro++) {
        if (deveEmendar({ quaseLa: true, temPedidoNoAr: false, movedAt, emendadoDe })) {
          emendadoDe = movedAt;
          pedidos++;
        }
      }
      movedAt += 1500; // o servidor respondeu e abriu o trecho seguinte
    }
    expect(pedidos).toBe(4);
  });
});
