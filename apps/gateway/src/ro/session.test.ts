import { describe, expect, it, vi } from "vitest";
import type { HotkeySlot } from "../protocol.js";

/**
 * Unitário, sem TCP nenhum — `session.integration.test.ts` já prova o
 * pacote real contra o rAthena vivo (duas `RoSession` com conexões
 * separadas). O que falta cobrir é a TROCA DE PERSONAGEM dentro do MESMO
 * objeto `RoSession` (`char:select` duas vezes no mesmo socket) — cenário
 * que a integração nunca exercita, e onde vazamento de estado entre
 * personagens no gateway apareceria primeiro.
 *
 * `RoConnection` é trocado por um stub que nunca abre socket de verdade:
 * `connectMap()` (privado, chamado via cast) só precisa "terminar" sem rede
 * pra este teste valer, já que o que se verifica é o campo `hotkeys` em
 * memória, não o handshake do map-server.
 */
vi.mock("@ragnarok/ro-protocol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ragnarok/ro-protocol")>();
  const { EventEmitter } = await import("node:events");
  class RoConnectionStub extends EventEmitter {
    hook(): this {
      return this;
    }
    readRaw(): void {}
    send(): void {}
    startPing(): this {
      return this;
    }
    connect(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { ...actual, RoConnection: RoConnectionStub };
});

const { RoSession } = await import("./session.js");

function novaSessao() {
  return new RoSession({ host: "test-host", loginPort: 1, packetver: 20130618 });
}

function hotkey(slot: number, id: number): HotkeySlot {
  return { slot, kind: "skill", id, count: 1 };
}

describe("RoSession — hotkeys sobrevivem a notifyReady, mas não a uma troca de personagem", () => {
  it("notifyReady() reemite os últimos hotkeys guardados", () => {
    const session = novaSessao();
    const guardados = [hotkey(0, 111), hotkey(1, 222)];
    (session as unknown as { hotkeys: HotkeySlot[] }).hotkeys = guardados;

    const recebidos: HotkeySlot[][] = [];
    session.on("hotkeys", (payload) => recebidos.push(payload));

    session.notifyReady();

    expect(recebidos).toEqual([guardados]);
  });

  it("notifyReady() não emite 'hotkeys' quando não há nenhum guardado ainda", () => {
    const session = novaSessao();
    const recebidos: HotkeySlot[][] = [];
    session.on("hotkeys", (payload) => recebidos.push(payload));

    session.notifyReady();

    expect(recebidos).toHaveLength(0);
  });

  it("entrar no map-server de um personagem novo limpa os hotkeys do personagem anterior", async () => {
    const session = novaSessao();
    (session as unknown as { hotkeys: HotkeySlot[] }).hotkeys = [hotkey(0, 999)];

    // Mesmo caminho de `char:select` -> NOTIFY_ZONESVR -> connectMap: este é
    // o ponto real onde "este personagem está entrando no mapa" acontece.
    await (
      session as unknown as {
        connectMap(addr: { ip: number; port: number }, mapName: string): Promise<void>;
      }
    ).connectMap({ ip: 0, port: 1 }, "prontera");

    const recebidos: HotkeySlot[][] = [];
    session.on("hotkeys", (payload) => recebidos.push(payload));
    session.notifyReady();

    // Sem isto, um socket que faz char:select duas vezes (voltar pra seleção
    // e entrar com outro personagem) reentregaria a barra do personagem
    // ANTERIOR como se fosse a do personagem novo.
    expect(recebidos).toHaveLength(0);
  });
});
