import { describe, expect, it } from "vitest";
import { ItemSchema } from "./item";

const BASE = {
  id: 5001,
  aegisName: "Test_Item",
  name: "Item de Teste",
  type: "etc" as const,
};

/**
 * Achado ao vivo: item custom com id > 65535 (901001/901002) é dropado,
 * armazenado e resolvido certo em TODO lugar do servidor (banco, drop
 * roll, inventário em memória) — mas o protocolo binário do RO manda
 * `nameid` como `uint16` em todo pacote de item enquanto `PACKETVER <
 * 20181121` (`rathena/src/map/clif.cpp: client_nameid()`), e acima de
 * 65535 o rAthena substitui pelo próprio `UNKNOWN_ITEM_ID` (=512=Apple,
 * `rathena/src/map/itemdb.hpp:22`) sem avisar. Quem cria o item nunca vê
 * erro — só descobre quando o item já pego aparece como Apple na bolsa.
 * Este teste trava a entrada: `ItemSchema.safeParse` (usado em
 * `apps/api/src/routes/items.ts` na criação E na edição) rejeita ANTES do
 * item existir no banco, para qualquer id, não só 901001/901002.
 */
describe("ItemSchema: id acima do limite do protocolo (uint16, PACKETVER < 20181121)", () => {
  it("aceita id até 65535", () => {
    expect(ItemSchema.safeParse({ ...BASE, id: 65535 }).success).toBe(true);
  });

  it("rejeita id acima de 65535 — dropa/aparece como Apple (512) no jogo, não como erro", () => {
    const result = ItemSchema.safeParse({ ...BASE, id: 65536 });
    expect(result.success).toBe(false);
  });

  it("rejeita especificamente os ids que geraram o bug ao vivo (901001/901002)", () => {
    expect(ItemSchema.safeParse({ ...BASE, id: 901001 }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...BASE, id: 901002 }).success).toBe(false);
  });

  it("512 (Apple) continua válido — não é o id que está errado, é o intervalo permitido", () => {
    expect(ItemSchema.safeParse({ ...BASE, id: 512, aegisName: "Apple", name: "Apple" }).success).toBe(true);
  });
});
