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
}
(globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = new LocalStorageShim();

const emitidos: { evento: string; payload: unknown }[] = [];
vi.mock("../net/gateway", () => ({
  gateway: () => ({ emit: (evento: string, payload: unknown) => emitidos.push({ evento, payload }) }),
}));

const { useSkillBar, SERVER_HOTKEY_SLOTS, SKILL_SLOTS } = await import("./skillBarStore");
const { ATAQUE_BASICO_ID } = await import("../net/ataqueBasico");

function slotsVazios() {
  useSkillBar.setState({ slots: useSkillBar.getState().slots.map(() => ({ kind: "skill" as const, id: 0 })), serverSynced: false });
}

beforeEach(() => {
  emitidos.length = 0;
  slotsVazios();
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
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assign(2, 100);
    expect(useSkillBar.getState().slots[2]).toEqual({ kind: "skill", id: 100 }); // resposta visual imediata
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 2, kind: "skill", id: 100 } }]);
  });

  it("assignItem depois do sync manda kind:'item'", () => {
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assignItem(3, 501);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 3, kind: "item", id: 501 } }]);
  });

  it("mover a mesma skill de slot (assign de novo) limpa o slot antigo NO SERVIDOR também", () => {
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
    useSkillBar.getState().hydrateFromServer([{ slot: 4, kind: "skill", id: 9, count: 1 }]);
    emitidos.length = 0;
    useSkillBar.getState().clear(4);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 4, kind: "empty", id: 0 } }]);
  });

  it("swap depois do sync manda hotkey:set pros DOIS slots envolvidos", () => {
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
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assignAmmo(6, 1750);
    expect(useSkillBar.getState().slots[6]).toEqual({ kind: "ammo", id: 1750 });
    expect(emitidos).toHaveLength(0);
  });

  it("um slot 'ammo' local nunca aparece num hotkey:set mesmo quando outro slot muda", () => {
    useSkillBar.getState().hydrateFromServer([]);
    useSkillBar.getState().assignAmmo(6, 1750);
    emitidos.length = 0;
    useSkillBar.getState().assign(7, 50);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 7, kind: "skill", id: 50 } }]);
  });
});

describe("Ataque Básico (id negativo, só do cliente) nunca vira hotkey de servidor", () => {
  it("comAtaqueBasico nasce no slot 0; assign nesse slot depois do sync nunca manda id negativo", () => {
    useSkillBar.getState().reset(); // slot 0 = ATAQUE_BASICO_ID
    useSkillBar.getState().hydrateFromServer([]);
    emitidos.length = 0;
    // reatribuir o mesmo slot pra outra skill não deveria tentar "limpar" um
    // slot anterior com id negativo mandando -1 pro servidor
    useSkillBar.getState().assign(0, 999);
    expect(emitidos).toEqual([{ evento: "hotkey:set", payload: { slot: 0, kind: "skill", id: 999 } }]);
  });

  it("assign de um id negativo nunca é chamado pela UI, mas se acontecer, sendToServer não deixa passar (paraServidor retorna null)", () => {
    useSkillBar.getState().hydrateFromServer([]);
    emitidos.length = 0;
    useSkillBar.getState().assign(1, ATAQUE_BASICO_ID);
    expect(emitidos).toHaveLength(0); // nada saiu — nem o slot com id negativo
  });
});
