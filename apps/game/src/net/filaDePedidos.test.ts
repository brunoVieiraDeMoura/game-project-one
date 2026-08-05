import { describe, expect, it } from "vitest";
import { criarFilaDePedidos } from "./filaDePedidos";

/**
 * O spam de clique não pode virar fila de destinos VELHOS.
 *
 * Sem limite, cada clique vira um `move:to`, e o rAthena AGENDA num timer o que
 * chega enquanto o personagem não pode mover (unit.cpp:876, até 2 s depois).
 * Os timers disparam em ordem e o personagem sai andando para uma célula
 * clicada segundos antes — o "rollback" relatado.
 */

const JANELA = 200;

/** coleta o que saiu, para conferir QUAL alvo foi emitido, não só quantos */
function fila() {
  const saiu: string[] = [];
  const f = criarFilaDePedidos<string>(JANELA);
  return { f, saiu, emitir: (a: string) => saiu.push(a) };
}

describe("fila de pedidos de caminhada", () => {
  it("clique isolado sai NA HORA", () => {
    const { f, saiu, emitir } = fila();
    f.pedir("A", 1000, emitir);
    expect(saiu).toEqual(["A"]);
    expect(f.pendente()).toBeNull();
  });

  it("spam: no máximo um pedido por janela", () => {
    const { f, saiu, emitir } = fila();
    for (let t = 0; t < 200; t += 10) f.pedir(`c${t}`, 1000 + t, emitir);
    expect(saiu).toHaveLength(1);
  });

  it("o que sai depois da janela é o ÚLTIMO clique — nunca um do meio", () => {
    const { f, saiu, emitir } = fila();
    f.pedir("primeiro", 1000, emitir); // sai na hora
    f.pedir("meio", 1050, emitir); // janela fechada: guarda
    f.pedir("meio2", 1100, emitir); // substitui
    f.pedir("ultimo", 1150, emitir); // substitui
    expect(saiu).toEqual(["primeiro"]);

    f.tick(1199, emitir); // janela ainda fechada
    expect(saiu).toEqual(["primeiro"]);

    f.tick(1200, emitir); // abriu
    expect(saiu).toEqual(["primeiro", "ultimo"]);
    // os do meio NUNCA saem — é exatamente o rollback que se está evitando
    expect(saiu).not.toContain("meio");
    expect(saiu).not.toContain("meio2");
  });

  it("depois de esvaziar, o clique seguinte volta a sair na hora", () => {
    const { f, saiu, emitir } = fila();
    f.pedir("A", 1000, emitir);
    f.pedir("B", 1100, emitir);
    f.tick(1200, emitir);
    f.pedir("C", 1500, emitir);
    expect(saiu).toEqual(["A", "B", "C"]);
  });

  it("tick sem pendente não emite nada", () => {
    const { f, saiu, emitir } = fila();
    f.pedir("A", 1000, emitir);
    for (let t = 1200; t < 3000; t += 100) f.tick(t, emitir);
    expect(saiu).toEqual(["A"]);
  });

  it("uma ordem NOVA no meio da janela substitui a pendente", () => {
    /**
     * As quatro origens de caminhada — clique, emenda de trecho, perseguição de
     * ataque, coleta e ida até o alcance da skill — dividem ESTA janela. São o
     * mesmo pacote para o servidor, e janelas separadas dobrariam o ritmo de
     * pedidos, trazendo de volta o agendamento em timer do rAthena
     * (unit.cpp:876) que a fila existe para evitar.
     *
     * (Havia um sexto caminho, o WASD, que usava `imediato`/`reservar` para
     * DESCARTAR em vez de guardar. Ele foi removido do jogo junto com os dois
     * métodos.)
     */
    const { f, saiu, emitir } = fila();
    f.pedir("clique", 1000, emitir);
    f.pedir("perseguir", 1100, emitir); // janela fechada: fica pendente
    f.pedir("coletar", 1150, emitir); // substitui o pendente
    expect(saiu).toEqual(["clique"]);
    f.tick(1300, emitir);
    expect(saiu).toEqual(["clique", "coletar"]);
  });

  it("mil cliques em 1 s cabem em cinco pedidos", () => {
    const { f, saiu, emitir } = fila();
    for (let i = 0; i < 1000; i++) {
      const t = 1000 + i; // 1 ms entre cliques
      f.pedir(`c${i}`, t, emitir);
      f.tick(t, emitir);
    }
    expect(saiu.length).toBeLessThanOrEqual(6);
    // e o último clique não fica preso na fila para sempre
    f.tick(1000 + 1000 + JANELA, emitir);
    expect(saiu[saiu.length - 1]).toBe("c999");
  });
});
