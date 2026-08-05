import { beforeEach, describe, expect, it } from "vitest";
import { LOOT_DURACAO_MS, useLootStore } from "./lootStore";

/**
 * O aviso de loot — UM, e o drop novo substitui o anterior.
 *
 * Já foi uma fila de quatro, para o segundo item não apagar o primeiro antes de
 * ele ser lido. Na prática numa caçada o que se lê é sempre o de cima, e a pilha
 * virava parede no topo da tela; quem quer o histórico abre o Alt+E.
 *
 * O que sobrevive da fila é o AGRUPAMENTO: o rAthena manda um `inv:add` por
 * item, então cinco poções chegam como cinco eventos e têm de aparecer como
 * "×5".
 */

const st = () => useLootStore.getState();

beforeEach(() => useLootStore.setState({ aviso: null }));

describe("substituir", () => {
  it("o drop novo toma o lugar do anterior", () => {
    st().registrar(501, 1, 1000);
    st().registrar(909, 2, 1200);
    expect(st().aviso).toMatchObject({ itemId: 909, amount: 2 });
  });

  it("e o aviso é OUTRO — a chave de render muda", () => {
    st().registrar(501, 1, 1000);
    const antes = st().aviso!.id;
    st().registrar(909, 1, 1200);
    expect(st().aviso!.id).not.toBe(antes);
  });
});

describe("agrupar", () => {
  it("o mesmo item soma em vez de recomeçar do um", () => {
    st().registrar(501, 1, 1000);
    st().registrar(501, 1, 1200);
    st().registrar(501, 3, 1400);
    expect(st().aviso).toMatchObject({ itemId: 501, amount: 5 });
  });

  it("somar NÃO troca a chave de render", () => {
    // remontar o nó reiniciaria qualquer transição de entrada, e o aviso é o
    // mesmo: só o número mudou
    st().registrar(501, 1, 1000);
    const antes = st().aviso!.id;
    st().registrar(501, 1, 1200);
    expect(st().aviso!.id).toBe(antes);
  });

  it("somar RENOVA o relógio — o total não aparece prestes a sumir", () => {
    st().registrar(501, 1, 1000);
    const primeiro = st().aviso!.expiraEm;
    st().registrar(501, 1, 2000);
    expect(st().aviso!.expiraEm).toBe(2000 + LOOT_DURACAO_MS);
    expect(st().aviso!.expiraEm).toBeGreaterThan(primeiro);
  });

  it("o mesmo item DEPOIS de vencer recomeça do um", () => {
    // senão o contador somaria sobre um aviso que ninguém está vendo
    st().registrar(501, 4, 1000);
    st().registrar(501, 1, 1000 + LOOT_DURACAO_MS + 1);
    expect(st().aviso).toMatchObject({ amount: 1 });
  });
});

describe("expiração", () => {
  it("limpar tira o que venceu", () => {
    st().registrar(501, 1, 1000);
    st().limpar(1000 + LOOT_DURACAO_MS + 1);
    expect(st().aviso).toBeNull();
  });

  it("limpar sem nada a tirar NÃO publica estado novo", () => {
    /**
     * Isto é chamado por relógio, várias vezes por segundo. Publicando um objeto
     * novo a cada passada, o HUD repintaria sem nada ter mudado.
     */
    st().registrar(501, 1, 1000);
    const antes = st().aviso;
    st().limpar(1100);
    expect(st().aviso).toBe(antes);
  });

  it("limpar com a tela vazia também não publica", () => {
    const antes = st().aviso;
    st().limpar(9999);
    expect(st().aviso).toBe(antes);
  });
});
