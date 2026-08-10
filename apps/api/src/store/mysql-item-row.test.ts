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

  it("A19: delay_duration na coluna real é SEGUNDOS, não o ms cru (doc/item_db.txt:250) — sem isso o servidor real aplica 1000× o delay pretendido", () => {
    const row = itemToMysqlRow({ ...BASE, delay: { durationMs: 5000 } } as MysqlItem);
    expect(row.delay_duration).toBe(5); // 5000ms == 5s, NUNCA 5000 gravado cru
    const back = mysqlRowToItem(row);
    expect(back.delay?.durationMs).toBe(5000); // volta a bater com o que o admin mostra
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

/**
 * Regressão real (Fase 4→5, achada testando equip no browser): a migração do
 * `item_db` corrigiu `class_all` de NULL para 1 em ~27 mil itens sem
 * restrição de classe — e `/items/by-id` passou a devolver 500 pra TODOS
 * eles. Causa: `class_all` estava dentro de `CLASS_COLUMNS` como se fosse um
 * flag comum (`all: "class_all"`), então `flagsFrom` empurrava a STRING
 * `"all"` pro array `classes` — e `CharacterVariantSchema` (normal/upper/
 * baby/third/...) não tem `"all"` no enum, `ItemSchema.parse` lançava, e o
 * `by-id` derrubava o lote inteiro (inclusive itens que nem tinham
 * `class_all=1`, se estivessem no mesmo pedido). Sintoma no cliente: nome
 * nunca resolvia, ficava `#1601` pra sempre — não porque o catálogo estava
 * vazio, mas porque a resposta HTTP nunca chegava 200.
 */
describe("mysql-item-row: class_all não é um flag comum — regressão do 500 em /items/by-id", () => {
  it("class_all=1 (sem restrição) NÃO joga a string 'all' em classes — vira array vazio", () => {
    const row = itemToMysqlRow({ ...BASE, classes: [] } as MysqlItem);
    expect(row.class_all).toBe(1);
    expect(row.class_upper).toBeNull();

    // é ESTE parse que travava com 500 antes da correção — class_all=1 com os
    // 7 outros nulos é exatamente o estado que ~27 mil itens migrados têm.
    expect(() => mysqlRowToItem(row)).not.toThrow();
    expect(mysqlRowToItem(row).classes).toEqual([]);
  });

  it("item com restrição EXPLÍCITA (Third+Fourth, tipo Golden Rod Shoes) preserva os tiers certos, class_all fica de fora", () => {
    const item: Item = { ...BASE, classes: ["third", "third_upper", "third_baby", "fourth"] };
    const row = itemToMysqlRow(item as MysqlItem);
    expect(row.class_all).toBeNull();
    expect(row.class_third).toBe(1);
    expect(row.class_fourth).toBe(1);
    expect(row.class_normal).toBeNull();

    const back = mysqlRowToItem(row);
    expect(back.classes.sort()).toEqual(["fourth", "third", "third_baby", "third_upper"]);
  });

  it("linha crua com class_all=1 e as 7 colunas de tier NULL (o formato real pós-migração) não lança e não inclui 'all'", () => {
    const row = itemToMysqlRow({ ...BASE, classes: [] } as MysqlItem);
    const parsed = mysqlRowToItem(row);
    expect(parsed.classes).not.toContain("all");
    expect(parsed.classes).toEqual([]);
  });
});
