import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `gateway()` abre socket.io de verdade na primeira chamada — mesmo cuidado
 * de `net/equipmentStore.test.ts`. O que se testa aqui é a REGRA de
 * sincronização (quando manda, o que NUNCA manda, hidratação do servidor),
 * não o pacote em si (isso já é `packages/ro-protocol/test/protocol.test.js`
 * + `apps/gateway/src/ro/session.integration.test.ts`).
 *
 * `persist` (zustand/middleware) precisa de `localStorage` — este ambiente
 * de teste roda em Node puro (sem jsdom), então um shim mínimo em memória
 * substitui o que o navegador daria de graça.
 */
class LocalStorageShim {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  /** só pra teste inspecionar quais chaves existem — nunca usado pelo store */
  keys(): string[] {
    return [...this.map.keys()];
  }
  raw(key: string): string | null {
    return this.getItem(key);
  }
}
const localStorageShim = new LocalStorageShim();
(globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = localStorageShim;

const emitidos: { evento: string; payload: unknown }[] = [];
vi.mock("../net/gateway", () => ({
  gateway: () => ({ emit: (evento: string, payload: unknown) => emitidos.push({ evento, payload }) }),
}));

const { useSkillBar, bindToCharacter, unbindCharacter, SERVER_HOTKEY_SLOTS, SKILL_SLOTS } = await import(
  "./skillBarStore"
);
const { ATAQUE_BASICO_ID } = await import("../net/ataqueBasico");

beforeEach(() => {
  emitidos.length = 0;
  localStorageShim.clear();
  // Estado real de "fora de sessão": nenhum personagem vinculado. Os testes
  // que precisam sincronizar chamam `bindToCharacter` explicitamente.
  unbindCharacter();
});

describe("estrutura de 38 slots (MAX_HOTKEYS do rAthena), sem mexer nos 27 da UI", () => {
  it("SKILL_SLOTS continua 27 — a UI não muda nesta fase", () => {
    expect(SKILL_SLOTS).toBe(27);
  });

  it("o store carrega com 38 posições, mesmo a UI só desenhando 27", () => {
    expect(useSkillBar.getState().slots).toHaveLength(SERVER_HOTKEY_SLOTS);
    expect(SERVER_HOTKEY_SLOTS).toBe(38);
  });

  it("um slot além dos 27 (ex.: 30) é lido/escrito normalmente pelo store, mesmo sem UI pra ele", () => {
    useSkillBar.getState().assign(30, 555);
    expect(useSkillBar.getState().slots[30]).toEqual({ kind: "skill", id: 555 });
  });
});

describe("hydrateFromServer — servidor vira fonte de verdade", () => {
  it("antes do primeiro evento, serverSynced é false e o store usa o estado local (fallback)", () => {
    expect(useSkillBar.getState().serverSynced).toBe(false);
  });

  it("substitui os 38 slots inteiros pelo que o servidor mandou, marca serverSynced=true", () => {
    useSkillBar.getState().assign(0, 999); // estado local "sujo" antes do sync
    useSkillBar.getState().hydrateFromServer([
      { slot: 0, kind: "skill", id: 111, count: 5 },
      { slot: 1, kind: "item", id: 501, count: 3 },
    ]);
    const { slots, serverSynced } = useSkillBar.getState();
    expect(serverSynced).toBe(true);
    expect(slots[0]).toEqual({ kind: "skill", id: 111 });
    expect(slots[1]).toEqual({ kind: "item", id: 501 });
    // slots não mencionados pelo servidor viram vazio — é a lista INTEIRA, nunca incremental
    expect(slots[2]).toEqual({ kind: "skill", id: 0 });
  });

  it("hidrata os 38 slots, incluindo os 11 além da UI (ex.: 37)", () => {
    useSkillBar.getState().hydrateFromServer([{ slot: 37, kind: "skill", id: 222, count: 1 }]);
    expect(useSkillBar.getState().slots[37]).toEqual({ kind: "skill", id: 222 });
    expect(useSkillBar.getState().slots).toHaveLength(38);
  });

  it("kind:'empty' do servidor vira o vazio local convencional (id 0)", () => {
    useSkillBar.getState().assign(0, 5);
    useSkillBar.getState().hydrateFromServer([{ slot: 0, kind: "empty", id: 0, count: 0 }]);
    expect(useSkillBar.getState().slots[0]).toEqual({ kind: "skill", id: 0 });
  });

  it("ignora slot fora de 0..37 mandado pelo servidor, sem quebrar o resto", () => {
    useSkillBar.getState().hydrateFromServer([
      { slot: 99, kind: "skill", id: 1, count: 1 },
      { slot: 2, kind: "item", id: 501, count: 1 },
    ]);
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "item", id: 501 });
    expect(useSkillBar.getState().slots).toHaveLength(38);
  });
});

describe("alteração local envia ao servidor SOMENTE depois do primeiro sync", () => {
  it("assign ANTES do sync: atualiza local, mas não emite nada pro servidor", () => {
    useSkillBar.getState().assign(2, 100);
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: 100 });
    expect(emitidos).toHaveLength(0);
  });

  it("assign DEPOIS do sync: atualiza local IMEDIATAMENTE e manda hotkey:set", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assign(2, 100);
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: 100 }); // resposta visual imediata
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 2, kind: "skill", id: 100 } }]);
  });

  it("assignItem depois do sync manda kind:'item'", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assignItem(3, 501);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 3, kind: "item", id: 501 } }]);
  });

  it("mover a mesma skill de slot (assign de novo) limpa o slot antigo NO SERVIDOR também", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assign(2, 100);
    emitidos.length = 0;
    useSkillBar.getState().assign(5, 100); // mesma skill, slot novo
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: 0 }); // esvaziado local
    expect(emitidos).toEqual([
      { evento: "hotkey:set", payload: { slot: 2, kind: "empty", id: 0 } },
      { evento: "hotkey:set", payload: { slot: 5, kind: "skill", id: 100 } },
    ]);
  });

  it("clear depois do sync manda kind:'empty'", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([{ slot: 4, kind: "skill", id: 9, count: 1 }]);
    emitidos.length = 0;
    useSkillBar.getState().clear(4);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 4, kind: "empty", id: 0 } }]);
  });

  it("swap depois do sync manda hotkey:set pros DOIS slots envolvidos", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([
      { slot: 1, kind: "skill", id: 10, count: 1 },
      { slot: 2, kind: "item", id: 501, count: 1 },
    ]);
    emitidos.length = 0;
    useSkillBar.getState().swap(1, 2);
    expect(useSkillBar.getState().slots[1]).toEqual({ kind: "item", id: 501 });
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: 10 });
    expect(emitidos).toEqual(
      expect.arrayContaining([
        { evento: "hotkey:set", payload: { slot: 1, kind: "item", id: 501 } },
        { evento: "hotkey:set", payload: { slot: 2, kind: "skill", id: 10 } },
      ]),
    );
    expect(emitidos).toHaveLength(2);
  });
});

describe("ammo NUNCA vira hotkey de servidor — isolado como legado local", () => {
  it("assignAmmo nunca emite, mesmo depois do sync", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assignAmmo(6, 1750);
    expect(useSkillBar.getState().slots[6]).toEqual({ kind: "ammo", id: 1750 });
    expect(emitidos).toHaveLength(0);
  });

  it("um slot 'ammo' local nunca aparece num hotkey:set mesmo quando outro slot muda", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assignAmmo(6, 1750);
    emitidos.length = 0;
    useSkillBar.getState().assign(7, 50);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 7, kind: "skill", id: 50 } }]);
  });
});

describe("Ataque Básico (id negativo, só do cliente) nunca vira hotkey de servidor", () => {
  it("comAtaqueBasico nasce no slot 0; assign nesse slot depois do sync nunca manda id negativo", () => {
    bindToCharacter(1);
    useSkillBar.getState().reset(); // slot 0 = ATAQUE_BASICO_ID
    useSkillBar.getState().hydrateFromServer([]);
    emitidos.length = 0;
    // reatribuir o mesmo slot pra outra skill não deveria tentar "limpar" um
    // slot anterior com id negativo mandando -1 pro servidor
    useSkillBar.getState().assign(0, 999);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 0, kind: "skill", id: 999 } }]);
  });

  it("assign de um id negativo nunca é chamado pela UI, mas se acontecer, sendToServer não deixa passar (paraServidor retorna null)", () => {
    bindToCharacter(1);
    useSkillBar.getState().hydrateFromServer([]);
    // isola o teste: sem isto, o Ataque Básico continuaria no slot 0 (agora
    // sobrevive ao hydrateFromServer de propósito — ver o comentário em
    // `hydrateFromServer`), e o assign abaixo teria um "previous" de verdade
    // pra limpar, o que emitiria um hotkey:set legítimo pro slot 0 e
    // confundiria com o que este teste quer isolar: o id negativo do slot 1.
    useSkillBar.getState().clear(0);
    emitidos.length = 0;
    useSkillBar.getState().assign(1, ATAQUE_BASICO_ID);
    expect(emitidos).toHaveLength(0); // nada saiu — nem o slot com id negativo
  });
});

/**
 * Regressão do bug real: Auto Attack (Ataque Básico) some da barra depois de
 * salvar e recarregar.
 *
 * Causa raiz: `hydrateFromServer` fazia SUBSTITUIÇÃO TOTAL dos 38 slots pelo
 * que o servidor mandasse — e o servidor SEMPRE manda os 38 índices
 * (`toHotkeys` no gateway, `apps/gateway/src/ro/session.ts`), a maioria
 * `kind:"empty"`. Como o Ataque Básico NUNCA é mandado ao servidor (id
 * negativo, sem contraparte no rAthena — `paraServidor`), o índice dele no
 * payload do servidor É SEMPRE "empty". O primeiro `hotkey:list` da sessão
 * (que chega uma vez por conexão, sempre) apagava o slot incondicionalmente
 * — mesmo ele tendo acabado de vir corretamente do `localStorage`.
 *
 * Os testes abaixo reproduzem o payload REAL do gateway: 38 entradas
 * completas, a maioria vazia — não o atalho `hydrateFromServer([])` usado
 * nos testes acima (que também expõe o bug, mas de forma menos fiel ao que
 * realmente trafega).
 */
function payloadVazio(): { slot: number; kind: "empty"; id: number; count: number }[] {
  return Array.from({ length: SERVER_HOTKEY_SLOTS }, (_, slot) => ({ slot, kind: "empty" as const, id: 0, count: 0 }));
}

function payloadServidor(
  entradas: Record<number, { kind: "skill" | "item"; id: number }>,
): { slot: number; kind: "empty" | "skill" | "item"; id: number; count: number }[] {
  return payloadVazio().map((s) => (entradas[s.slot] ? { ...s, ...entradas[s.slot] } : s));
}

describe("Auto Attack sobrevive ao ciclo completo de persistência (salvar → sync do servidor → reload → troca de personagem)", () => {
  it("Teste 1 — Auto Attack é salvo e continua presente depois do load", () => {
    bindToCharacter(500);
    useSkillBar.getState().assign(2, ATAQUE_BASICO_ID);
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: ATAQUE_BASICO_ID });

    // "recarregar": sai da sessão e volta pro MESMO personagem — localStorage
    // sobrevive, e o primeiro sync do servidor chega (como em toda sessão
    // real), sem NADA registrado pro Auto Attack (nunca foi mandado).
    unbindCharacter();
    bindToCharacter(500);
    useSkillBar.getState().hydrateFromServer(payloadVazio());

    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: ATAQUE_BASICO_ID });
  });

  it("Teste 2 — a posição do Auto Attack é preservada, em qualquer slot válido", () => {
    for (const slotAlvo of [0, 5, 26, 37]) {
      const charId = 600 + slotAlvo;
      bindToCharacter(charId);
      useSkillBar.getState().assign(slotAlvo, ATAQUE_BASICO_ID);

      unbindCharacter();
      bindToCharacter(charId);
      useSkillBar.getState().hydrateFromServer(payloadVazio());

      expect(useSkillBar.getState().slots[slotAlvo]).toEqual({ kind: "skill", id: ATAQUE_BASICO_ID });
    }
  });

  it("Teste 3 — Auto Attack + skills normais + slots vazios sobrevivem juntos ao save/load", () => {
    bindToCharacter(701);
    useSkillBar.getState().hydrateFromServer(payloadVazio()); // primeiro sync, serverSynced=true
    useSkillBar.getState().assign(0, ATAQUE_BASICO_ID);
    useSkillBar.getState().assign(3, 111); // skill normal
    useSkillBar.getState().assign(7, 222); // outra skill normal
    // slot 10 fica vazio de propósito

    unbindCharacter();
    bindToCharacter(701);
    // segundo sync: o servidor confirma as skills normais que foram
    // mandadas pelos `assign` acima (via `sendToServer`), e continua sem
    // nada pro Auto Attack, como sempre.
    useSkillBar.getState().hydrateFromServer(payloadServidor({ 3: { kind: "skill", id: 111 }, 7: { kind: "skill", id: 222 } }));

    const { slots } = useSkillBar.getState();
    expect(slots[0]).toEqual({ kind: "skill", id: ATAQUE_BASICO_ID });
    expect(slots[3]).toEqual({ kind: "skill", id: 111 });
    expect(slots[7]).toEqual({ kind: "skill", id: 222 });
    expect(slots[10]).toEqual({ kind: "skill", id: 0 }); // vazio continua vazio
  });

  it("Teste 4 — F5/reload não remove o Auto Attack", () => {
    bindToCharacter(800);
    useSkillBar.getState().assign(1, ATAQUE_BASICO_ID);

    // O reload de página real destrói e recria o módulo inteiro; o que
    // importa testar é o CICLO que sobrevive a isso: sair e voltar pro mesmo
    // personagem, reidratando do localStorage e depois do `hotkey:list` real.
    unbindCharacter();
    bindToCharacter(800);
    useSkillBar.getState().hydrateFromServer(payloadVazio());

    expect(useSkillBar.getState().slots[1]).toEqual({ kind: "skill", id: ATAQUE_BASICO_ID });
  });

  it("Teste 5 — a barra com Auto Attack pertence só ao personagem certo", () => {
    bindToCharacter(901);
    useSkillBar.getState().assign(4, ATAQUE_BASICO_ID);
    useSkillBar.getState().hydrateFromServer(payloadVazio());

    bindToCharacter(902); // outro personagem, mesma aba
    expect(useSkillBar.getState().slots[4]).toEqual({ kind: "skill", id: 0 }); // não vaza

    bindToCharacter(901); // volta pro dono de verdade
    expect(useSkillBar.getState().slots[4]).toEqual({ kind: "skill", id: ATAQUE_BASICO_ID });
  });

  it("Teste 6 (regressão) — skills normais continuam cedendo pra verdade do servidor, sem exceção", () => {
    bindToCharacter(1001);
    useSkillBar.getState().hydrateFromServer(payloadVazio());
    useSkillBar.getState().assign(5, 50);
    expect(useSkillBar.getState().slots[5]).toEqual({ kind: "skill", id: 50 });

    // servidor manda outra coisa nesse MESMO índice — skill normal (ao
    // contrário do Auto Attack) SEMPRE cede pro servidor, sem exceção: a
    // preservação só vale pra slot client-only (`paraServidor` retorna null).
    useSkillBar.getState().hydrateFromServer(payloadServidor({ 5: { kind: "skill", id: 999 } }));
    expect(useSkillBar.getState().slots[5]).toEqual({ kind: "skill", id: 999 });
  });

  it("Auto Attack não duplica sozinho nem aparece em slot que estava vazio, mesmo com syncs repetidos", () => {
    bindToCharacter(1100);
    useSkillBar.getState().assign(0, ATAQUE_BASICO_ID);
    useSkillBar.getState().hydrateFromServer(payloadVazio());
    useSkillBar.getState().hydrateFromServer(payloadVazio()); // segundo sync, ex.: reconexão

    const { slots } = useSkillBar.getState();
    const ocorrencias = slots.filter((s) => s.kind === "skill" && s.id === ATAQUE_BASICO_ID).length;
    expect(ocorrencias).toBe(1);
    expect(slots[1]).toEqual({ kind: "skill", id: 0 }); // vizinho não "herdou" nada
  });
});

describe("isolamento por personagem — a barra nunca vaza pra outro dono", () => {
  it("personagem A altera a barra; personagem B não vê a mudança", () => {
    bindToCharacter(100);
    useSkillBar.getState().assign(2, 777);
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: 777 });

    bindToCharacter(200);
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: 0 });
    expect(useSkillBar.getState().serverSynced).toBe(false);
  });

  it("dois personagens da mesma conta têm barras independentes — o store nunca consulta accountId", () => {
    bindToCharacter(301);
    useSkillBar.getState().assign(5, 111);
    bindToCharacter(302);
    useSkillBar.getState().assign(5, 222);

    bindToCharacter(301);
    expect(useSkillBar.getState().slots[5]).toEqual({ kind: "skill", id: 111 });
    bindToCharacter(302);
    expect(useSkillBar.getState().slots[5]).toEqual({ kind: "skill", id: 222 });
  });

  it("personagens de contas diferentes têm barras independentes, mesmo com logout completo entre elas", () => {
    bindToCharacter(401);
    useSkillBar.getState().assign(3, 900);
    unbindCharacter(); // logout de verdade — como encerrar() faz em useGatewayEvents

    bindToCharacter(999); // outra conta
    expect(useSkillBar.getState().slots[3]).toEqual({ kind: "skill", id: 0 });
    useSkillBar.getState().assign(3, 111);
    unbindCharacter();

    bindToCharacter(401);
    expect(useSkillBar.getState().slots[3]).toEqual({ kind: "skill", id: 900 });
  });

  it("sair e entrar de novo recupera exclusivamente a própria barra de cada personagem", () => {
    bindToCharacter(11);
    useSkillBar.getState().assign(0, 500);
    unbindCharacter();

    bindToCharacter(22);
    useSkillBar.getState().assign(0, 600);
    unbindCharacter();

    bindToCharacter(11);
    expect(useSkillBar.getState().slots[0]).toEqual({ kind: "skill", id: 500 });

    bindToCharacter(22);
    expect(useSkillBar.getState().slots[0]).toEqual({ kind: "skill", id: 600 });
  });

  it("bindToCharacter pro MESMO personagem é no-op — warp de mesmo mapa não reinicia serverSynced", () => {
    bindToCharacter(55);
    useSkillBar.getState().hydrateFromServer([{ slot: 0, kind: "skill", id: 42, count: 1 }]);
    bindToCharacter(55); // @jump, Asa de Borboleta, respawn: mesmo char de novo
    expect(useSkillBar.getState().serverSynced).toBe(true);
    expect(useSkillBar.getState().slots[0]).toEqual({ kind: "skill", id: 42 });
  });

  it("não existe chave de persistência nem estado global colidindo entre personagens", () => {
    bindToCharacter(71);
    useSkillBar.getState().assign(0, 1);
    bindToCharacter(72);
    useSkillBar.getState().assign(0, 2);

    const chaves = localStorageShim.keys().filter((k) => k.startsWith("ragnarok:skillbar"));
    expect(chaves).toEqual(expect.arrayContaining(["ragnarok:skillbar:71", "ragnarok:skillbar:72"]));
    expect(new Set(chaves).size).toBe(chaves.length); // nenhuma colisão de chave

    // só `slots` atravessa pro localStorage — `serverSynced` nunca é persistido
    for (const chave of chaves) {
      expect(localStorageShim.raw(chave)).not.toContain("serverSynced");
    }
  });

  it("sem personagem vinculado (fora de sessão), nada é lido, gravado ou emitido ao servidor", () => {
    unbindCharacter();
    useSkillBar.setState({ serverSynced: true }); // simula estado indevido, se algo escapasse
    useSkillBar.getState().assign(0, 999);
    expect(emitidos).toHaveLength(0);
    expect(localStorageShim.keys().filter((k) => k.startsWith("ragnarok:skillbar"))).toHaveLength(0);
  });
});
