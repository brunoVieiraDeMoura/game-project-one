import { describe, expect, it } from "vitest";
import type { Item } from "@ragnarok/game-data";
import { itemToMysqlRow, mysqlRowToItem, type MysqlItem } from "./mysql-item-row";

/**
 * Achado da auditoria de reliability (2026-08-07): `flags`/`delay`/`stack`/
 * `trade`/`noUse` nunca eram lidos nem escritos aqui — as 5 seções
 * correspondentes do ItemForm (Flags, Delay de uso, Empilhamento, Condições
 * de não-uso, Restrições de troca) salvavam 200 OK e o dado sumia em
 * silêncio no backend MySQL, que é o ativo em produção. Este teste trava a
 * correção: ida e volta completa por `item_db_re`.
 */

const BASE: Item = {
  id: 5001,
  aegisName: "Test_Item",
  name: "Item de Teste",
  type: "etc",
  buyPrice: 0,
  sellPrice: 0,
  weight: 0,
  attack: 0,
  magicAttack: 0,
  defense: 0,
  range: 0,
  slots: 0,
  jobs: ["all"],
  classes: [],
  gender: "both",
  locations: [],
  equipLevelMin: 0,
  equipLevelMax: 0,
  refineable: false,
  gradable: false,
  viewSprite: 0,
};

describe("mysql-item-row: flags/delay/stack/trade/noUse sobrevivem ao round-trip", () => {
  it("item SEM nenhum dos 5 sub-objetos: colunas ficam NULL, campos voltam undefined", () => {
    const row = itemToMysqlRow(BASE as MysqlItem);
    expect(row.flag_buyingstore).toBeNull();
    expect(row.delay_duration).toBeNull();
    expect(row.stack_amount).toBeNull();
    expect(row.nouse_override).toBeNull();
    expect(row.trade_override).toBeNull();

    const back = mysqlRowToItem(row);
    expect(back.flags).toBeUndefined();
    expect(back.delay).toBeUndefined();
    expect(back.stack).toBeUndefined();
    expect(back.noUse).toBeUndefined();
    expect(back.trade).toBeUndefined();
  });

  it("flags: grava cada coluna e lê de volta o mesmo objeto", () => {
    const item: Item = {
      ...BASE,
      flags: {
        buyingStore: true,
        deadBranch: false,
        container: true,
        uniqueId: false,
        bindOnEquip: true,
        dropAnnounce: false,
        noConsume: true,
        dropEffect: "cherryblossom",
      },
    };
    const row = itemToMysqlRow(item as MysqlItem);
    expect(row.flag_buyingstore).toBe(1);
    expect(row.flag_container).toBe(1);
    expect(row.flag_bindonequip).toBe(1);
    expect(row.flag_noconsume).toBe(1);
    expect(row.flag_deadbranch).toBe(0);
    expect(row.flag_dropeffect).toBe("cherryblossom");

    const back = mysqlRowToItem(row);
    expect(back.flags).toEqual(item.flags);
  });

  it("delay: duração + status sobrevivem", () => {
    const item: Item = { ...BASE, delay: { durationMs: 5000, statusId: "postponed" } };
    const back = mysqlRowToItem(itemToMysqlRow(item as MysqlItem));
    expect(back.delay).toEqual({ durationMs: 5000, statusId: "postponed" });
  });

  it("stack: quantidade e os 4 destinos (inventário/carrinho/armazém/guilda)", () => {
    const item: Item = {
      ...BASE,
      stack: { amount: 20, inventory: true, cart: false, storage: true, guildStorage: false },
    };
    const back = mysqlRowToItem(itemToMysqlRow(item as MysqlItem));
    expect(back.stack).toEqual(item.stack);
  });

  it("noUse: nível de grupo + bloqueado sentado", () => {
    const item: Item = { ...BASE, noUse: { overrideGroupLevel: 60, sitting: true } };
    const back = mysqlRowToItem(itemToMysqlRow(item as MysqlItem));
    expect(back.noUse).toEqual({ overrideGroupLevel: 60, sitting: true });
  });

  it("trade: as 9 restrições + nível de grupo", () => {
    const item: Item = {
      ...BASE,
      trade: {
        overrideGroupLevel: 40,
        noDrop: true,
        noTrade: false,
        tradePartnerOnly: true,
        noSell: false,
        noCart: true,
        noStorage: false,
        noGuildStorage: true,
        noMail: false,
        noAuction: true,
      },
    };
    const back = mysqlRowToItem(itemToMysqlRow(item as MysqlItem));
    expect(back.trade).toEqual(item.trade);
  });
});
