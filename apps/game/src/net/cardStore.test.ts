import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useCardStore } from "./cardStore";

/**
 * O rAthena não manda NADA (nem pacote vazio) quando não há equipamento
 * compatível (`clif_use_card`, clif.cpp: `if(!c) return;`) e também não
 * manda nada quando `pc_insert_card` recusa ANTES de tentar consumir a
 * carta (slot cheio, item errado etc). Os dois casos só existem porque o
 * cliente trata "silêncio depois do prazo" como resposta — não como erro de
 * rede — e é isso que este arquivo trava.
 */
describe("cardStore — silêncio do rAthena é resposta, não falha de rede", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCardStore.getState().fechar();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("abrir() começa esperando e vira 'vazio' sozinho se ninguém responder", () => {
    useCardStore.getState().abrir(5);
    expect(useCardStore.getState().estado).toBe("esperando");
    vi.advanceTimersByTime(3000);
    expect(useCardStore.getState().estado).toBe("vazio");
  });

  it("resposta real com opções cancela o timeout e vira 'pronto'", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().aplicarOpcoes(5, [10, 11]);
    expect(useCardStore.getState().estado).toBe("pronto");
    expect(useCardStore.getState().equipIndexes).toEqual([10, 11]);
    // o timeout já foi limpo — avançar o relógio não pode reverter pra "vazio"
    vi.advanceTimersByTime(5000);
    expect(useCardStore.getState().estado).toBe("pronto");
  });

  it("resposta VAZIA explícita também vira 'vazio' (equivalente ao silêncio)", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().aplicarOpcoes(5, []);
    expect(useCardStore.getState().estado).toBe("vazio");
  });

  it("resposta de um cardIndex ABANDONADO (usuário já fechou/trocou de carta) é ignorada", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().fechar();
    useCardStore.getState().aplicarOpcoes(5, [10]);
    // continua fechado — a resposta tardia não reabre o diálogo
    expect(useCardStore.getState().cardIndex).toBeNull();
  });

  it("escolher() manda pro estado 'aplicando' e vira 'falhou' sozinho sem resposta", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().aplicarOpcoes(5, [10]);
    useCardStore.getState().escolher(10);
    expect(useCardStore.getState().estado).toBe("aplicando");
    vi.advanceTimersByTime(3000);
    expect(useCardStore.getState().estado).toBe("falhou");
  });

  it("aplicarResultado com success fecha o diálogo inteiro", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().aplicarOpcoes(5, [10]);
    useCardStore.getState().escolher(10);
    useCardStore.getState().aplicarResultado({ equipIndex: 10, cardIndex: 5, success: true });
    expect(useCardStore.getState().cardIndex).toBeNull();
  });

  it("aplicarResultado com falha mantém o diálogo aberto pra tentar outro item", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().aplicarOpcoes(5, [10]);
    useCardStore.getState().escolher(10);
    useCardStore.getState().aplicarResultado({ equipIndex: 10, cardIndex: 5, success: false });
    expect(useCardStore.getState().cardIndex).toBe(5);
    expect(useCardStore.getState().estado).toBe("falhou");
  });

  it("resultado de um cardIndex diferente do aberto é ignorado", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().aplicarOpcoes(5, [10]);
    useCardStore.getState().escolher(10);
    useCardStore.getState().aplicarResultado({ equipIndex: 99, cardIndex: 999, success: true });
    // continua aplicando — a resposta não era pra este pedido
    expect(useCardStore.getState().cardIndex).toBe(5);
    expect(useCardStore.getState().estado).toBe("aplicando");
  });

  it("fechar() limpa o timeout pendente — não vaza pra o próximo abrir()", () => {
    useCardStore.getState().abrir(5);
    useCardStore.getState().fechar();
    useCardStore.getState().abrir(6);
    vi.advanceTimersByTime(3000);
    // só o timeout do card 6 deve estar valendo, e ele vira "vazio" corretamente
    expect(useCardStore.getState().cardIndex).toBe(6);
    expect(useCardStore.getState().estado).toBe("vazio");
  });
});
