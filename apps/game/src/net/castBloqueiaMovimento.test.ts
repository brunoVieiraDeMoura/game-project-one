import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { estaCastando, useCastStore } from "./castStore";

/**
 * CONJURANDO NÃO ANDA.
 *
 * Não é regra nossa: `unit_can_move` (unit.cpp:1813) devolve `false` enquanto
 * `ud->skilltimer` está ativo. O cliente estava PREVENDO a caminhada e o
 * personagem saía andando no meio da conjuração.
 *
 * E o pedido não podia nem ser enviado: `unit_walktoxy` não descarta o pedido de
 * quem não pode mover — ele AGENDA (unit.cpp:876), então o clique dado durante a
 * conjuração ressuscitava depois dela e levava o personagem para um destino de
 * segundos atrás.
 *
 * A guarda que o `NetPlayer` usa é esta função; aqui ficam as duas coisas que
 * ela precisa acertar, e a segunda é a que evita travar o jogo.
 */

beforeEach(() => {
  vi.useFakeTimers();
  useCastStore.getState().parar();
});

afterEach(() => vi.useRealTimers());

describe("estaCastando", () => {
  it("sem conjuração, anda", () => {
    expect(estaCastando(performance.now())).toBe(false);
  });

  it("durante a conjuração, não anda", () => {
    useCastStore.getState().comecar(89, 2000);
    expect(estaCastando(performance.now())).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(estaCastando(performance.now())).toBe(true);
  });

  it("acabou o tempo, anda de novo — mesmo sem ninguém limpar o store", () => {
    /**
     * A parte que impede o remédio de virar doença. Conjuração INTERROMPIDA nem
     * sempre traz um `skill:cast` para limpar o store; olhando só
     * `atual !== null`, um `atual` pendurado travaria a caminhada PARA SEMPRE —
     * o pior defeito possível aqui. O relógio resolve sozinho.
     */
    useCastStore.getState().comecar(89, 2000);
    vi.advanceTimersByTime(2001);
    expect(useCastStore.getState().atual).not.toBeNull(); // ninguém limpou
    expect(estaCastando(performance.now())).toBe(false);
  });

  it("a skill saiu antes do fim: libera na hora", () => {
    useCastStore.getState().comecar(89, 2000);
    vi.advanceTimersByTime(300);
    useCastStore.getState().parar(); // `skill:cast` chegou
    expect(estaCastando(performance.now())).toBe(false);
  });

  it("skill instantânea não bloqueia nada", () => {
    // abaixo de 150 ms o store nem registra (piscar a barra seria pior), e
    // bloquear a caminhada por dois quadros seria imperceptível de qualquer forma
    useCastStore.getState().comecar(89, 100);
    expect(estaCastando(performance.now())).toBe(false);
  });
});
