import { describe, expect, it } from "vitest";
import { custoDeAlvo, ordenarAlvos, PESO_CAMERA, proximoAlvo, type AlvoCandidato } from "./cicloDeAlvo";

/**
 * TAB — o inimigo mais próximo, com a direção da CÂMERA pesando.
 *
 * O peso da câmera é o pedido explícito, e é o que separa este ciclo de um
 * "ordena por distância": num campo com mobs em volta, o que o jogador quer é o
 * que está na tela à frente dele, não o que está dois passos mais perto às
 * costas.
 */

const cand = (gid: number, p: Partial<AlvoCandidato> = {}): AlvoCandidato => ({
  gid,
  distancia: 10,
  alinhamento: 1,
  visivel: true,
  ...p,
});

describe("a ordem", () => {
  it("mais perto primeiro, tudo igual no resto", () => {
    const ordem = ordenarAlvos([cand(1, { distancia: 20 }), cand(2, { distancia: 5 })]);
    expect(ordem.map((c) => c.gid)).toEqual([2, 1]);
  });

  it("a câmera GANHA de uma diferença pequena de distância", () => {
    // 3 células mais perto, mas às costas; o peso da câmera vale mais
    const atras = cand(1, { distancia: 7, alinhamento: -1 });
    const frente = cand(2, { distancia: 10, alinhamento: 1 });
    expect(ordenarAlvos([atras, frente])[0]!.gid).toBe(2);
  });

  it("...e PERDE de uma diferença grande", () => {
    /**
     * O peso não pode virar trava: um bicho do outro lado do mapa não ganha só
     * por estar centralizado na tela. O teto é o próprio `PESO_CAMERA` — dois
     * alvos separados por mais que ele nunca trocam de posição pelo ângulo.
     */
    const perto = cand(1, { distancia: 4, alinhamento: -1 });
    const longe = cand(2, { distancia: 4 + PESO_CAMERA * 2 + 1, alinhamento: 1 });
    expect(ordenarAlvos([perto, longe])[0]!.gid).toBe(1);
  });

  it("o que não se vê não entra no ciclo", () => {
    // atrás da névoa: selecionar algo invisível deixaria a placa do alvo
    // apontando para o nada
    const ordem = ordenarAlvos([cand(1, { visivel: false, distancia: 1 }), cand(2, { distancia: 30 })]);
    expect(ordem.map((c) => c.gid)).toEqual([2]);
  });

  it("empate resolve pelo gid — a ordem não pode dançar entre uma tecla e outra", () => {
    const a = cand(7);
    const b = cand(3);
    expect(custoDeAlvo(a)).toBe(custoDeAlvo(b));
    expect(ordenarAlvos([a, b]).map((c) => c.gid)).toEqual([3, 7]);
  });
});

describe("o ciclo", () => {
  const campo = [
    cand(1, { distancia: 5 }),
    cand(2, { distancia: 10 }),
    cand(3, { distancia: 15 }),
  ];

  it("sem alvo, o primeiro Tab pega o melhor", () => {
    expect(proximoAlvo(campo, null)).toBe(1);
  });

  it("Tab de novo vai para o seguinte", () => {
    expect(proximoAlvo(campo, 1)).toBe(2);
    expect(proximoAlvo(campo, 2)).toBe(3);
  });

  it("no fim, dá a volta", () => {
    expect(proximoAlvo(campo, 3)).toBe(1);
  });

  it("percorre TODOS sem repetir antes de fechar a volta", () => {
    const vistos: number[] = [];
    let atual: number | null = null;
    for (let i = 0; i < campo.length; i++) {
      atual = proximoAlvo(campo, atual);
      vistos.push(atual!);
    }
    expect(new Set(vistos).size).toBe(campo.length);
  });

  it("alvo que saiu de vista recomeça do melhor", () => {
    // o mob morreu ou sumiu: o gid não está mais na lista
    expect(proximoAlvo(campo, 999)).toBe(1);
  });

  it("campo vazio devolve null — o chamador MANTÉM o alvo atual", () => {
    // apertar Tab num campo limpo não é motivo para largar o mob já mirado
    expect(proximoAlvo([], 5)).toBeNull();
    expect(proximoAlvo([cand(1, { visivel: false })], null)).toBeNull();
  });
});
