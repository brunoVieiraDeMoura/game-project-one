import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O socket fica FORA: `net/acoes` emite de verdade, e `gateway()` abre uma
 * conexão socket.io na primeira chamada — em Node isso estoura. O que se testa
 * aqui é o MODO, não o pacote.
 */
const emitidos: { evento: string; payload: unknown }[] = [];
vi.mock("./gateway", () => ({
  gateway: () => ({ emit: (evento: string, payload: unknown) => emitidos.push({ evento, payload }) }),
}));

const { ATAQUE_BASICO, ATAQUE_BASICO_ID, baterNoAlvo, useAtaqueBasico } = await import("./ataqueBasico");
const { useWorldStore } = await import("./worldStore");
const { useAttackStore } = await import("./attackStore");

/**
 * ATAQUE BÁSICO — o modo de auto-ataque.
 *
 * Ligado, o personagem vai até o alvo e bate até uma de três coisas: o alvo
 * MORRER, o jogador CLICAR FORA, ou a skill ser DESLIGADA. As três desligam.
 *
 * O clique fora mora no `NetPlayer` (é ele que recebe o clique no chão); os
 * outros dois são estes testes.
 */

const mundo = () => useWorldStore.getState();

function nascerMob(gid: number) {
  mundo().spawn({ gid, kind: "mob", job: 1002, x: 20, y: 20, dir: 0, speed: 150 });
}

beforeEach(() => {
  emitidos.length = 0;
  mundo().clear();
  useAttackStore.getState().parar();
  useAtaqueBasico.setState({ ativo: false });
});

describe("a skill", () => {
  it("tem id NEGATIVO — não colide com skill do rAthena", () => {
    // o rAthena usa ids positivos; um negativo não colide agora nem depois, e
    // deixa a origem óbvia na leitura da barra
    expect(ATAQUE_BASICO_ID).toBeLessThan(0);
    expect(ATAQUE_BASICO.id).toBe(ATAQUE_BASICO_ID);
  });

  it("não custa SP — não é uma skill do servidor", () => {
    expect(ATAQUE_BASICO.spCost).toBe(0);
    expect(ATAQUE_BASICO.upgradable).toBe(false);
  });
});

describe("ligado, trocar de alvo já ataca", () => {
  it("alvo novo vira ordem de ataque", () => {
    nascerMob(77);
    useAtaqueBasico.setState({ ativo: true });
    mundo().setTarget(77);
    expect(useAttackStore.getState().alvo).toMatchObject({ gid: 77 });
    expect(emitidos.some((e) => e.evento === "action:attack")).toBe(true);
  });

  it("DESLIGADO, trocar de alvo não ataca nada", () => {
    // selecionar não é atacar: é o que deixa o jogador mirar antes de decidir
    nascerMob(77);
    mundo().setTarget(77);
    expect(useAttackStore.getState().alvo).toBeNull();
    expect(emitidos.some((e) => e.evento === "action:attack")).toBe(false);
  });

  it("Tab para o próximo alvo troca a briga junto", () => {
    nascerMob(77);
    nascerMob(78);
    useAtaqueBasico.setState({ ativo: true });
    mundo().setTarget(77);
    mundo().setTarget(78);
    expect(useAttackStore.getState().alvo).toMatchObject({ gid: 78 });
  });

  it("NPC não vira alvo de ataque", () => {
    mundo().spawn({ gid: 90, kind: "npc", job: 0, x: 5, y: 5, dir: 0, speed: 150 });
    useAtaqueBasico.setState({ ativo: true });
    mundo().setTarget(90);
    expect(useAttackStore.getState().alvo).toBeNull();
  });
});

describe("o alvo morreu: a skill se desliga sozinha", () => {
  it("vanish do alvo limpa o modo e a ordem", () => {
    /**
     * É a regra "até matar o alvo". Quem limpa o alvo quando o mob some é o
     * `vanish` do `worldStore`, então não há evento novo a escutar — a reação
     * mora na troca de alvo, que é a mesma porta do caso de cima.
     */
    nascerMob(77);
    useAtaqueBasico.setState({ ativo: true });
    mundo().setTarget(77);
    expect(useAtaqueBasico.getState().ativo).toBe(true);

    mundo().vanish(77);
    expect(mundo().target).toBeNull();
    expect(useAtaqueBasico.getState().ativo).toBe(false);
    expect(useAttackStore.getState().alvo).toBeNull();
  });
});

describe("baterNoAlvo", () => {
  it("sem alvo, não faz nada", () => {
    baterNoAlvo();
    expect(useAttackStore.getState().alvo).toBeNull();
  });

  it("com alvo vivo, abre a ordem — é o que liga a skill com o alvo já escolhido", () => {
    nascerMob(77);
    mundo().setTarget(77);
    baterNoAlvo();
    expect(useAttackStore.getState().alvo).toMatchObject({ gid: 77 });
  });
});
