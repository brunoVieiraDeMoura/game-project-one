import { describe, expect, it } from "vitest";
import { diffFields } from "./diff";

/**
 * Gate do Audit Log (auditoria 2026-08-13, PARTE 18): a função que decide
 * "isto realmente mudou?" é a peça mais fácil de estragar em silêncio —
 * comparação de referência em vez de valor, ou array reordenado contando
 * como mudança falsa. Testada isolada, sem precisar de rota nem repositório.
 */
describe("diffFields", () => {
  it("campo escalar sem mudança não aparece no diff", () => {
    expect(diffFields({ price: 100 }, { price: 100 })).toEqual([]);
  });

  it("campo escalar alterado aparece com valor antigo e novo", () => {
    expect(diffFields({ price: 100 }, { price: 90 })).toEqual([{ field: "price", oldValue: 100, newValue: 90 }]);
  });

  it("campo ausente no before conta como criado (undefined -> valor)", () => {
    expect(diffFields({}, { price: 100 })).toEqual([{ field: "price", oldValue: null, newValue: 100 }]);
  });

  it("dois campos alterados na mesma edição aparecem os dois, separados", () => {
    const before = { name: "Potion", price: 50, weight: 10 };
    const after = { name: "Red Potion", price: 45, weight: 10 };
    const changes = diffFields(before, after);
    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual({ field: "name", oldValue: "Potion", newValue: "Red Potion" });
    expect(changes).toContainEqual({ field: "price", oldValue: 50, newValue: 45 });
  });

  it("array reordenado (mesmo conjunto) NÃO conta como mudança — não é comparação de índice", () => {
    expect(diffFields({ tags: ["a", "b"] }, { tags: ["b", "a"] })).toEqual([]);
  });

  it("elemento removido de um array aparece em oldValue, resto do array não muda o diff", () => {
    const before = { skills: [{ skillId: 11, maxLevel: 10 }, { skillId: 12, maxLevel: 10 }] };
    const after = { skills: [{ skillId: 12, maxLevel: 10 }] };
    expect(diffFields(before, after)).toEqual([
      { field: "skills", oldValue: [{ skillId: 11, maxLevel: 10 }], newValue: [] },
    ]);
  });

  it("elemento adicionado a um array aparece em newValue", () => {
    const before = { skills: [{ skillId: 12, maxLevel: 10 }] };
    const after = { skills: [{ skillId: 12, maxLevel: 10 }, { skillId: 13, maxLevel: 5 }] };
    expect(diffFields(before, after)).toEqual([
      { field: "skills", oldValue: [], newValue: [{ skillId: 13, maxLevel: 5 }] },
    ]);
  });

  it("objeto aninhado alterado (não comparação de referência) — caso real Safety Wall ItemCost", () => {
    const before = { requirements: { itemsConsumed: [{ itemId: 715, amount: 1 }] } };
    const after = { requirements: { itemsConsumed: [] } };
    expect(diffFields(before, after)).toEqual([
      { field: "requirements", oldValue: { itemsConsumed: [{ itemId: 715, amount: 1 }] }, newValue: { itemsConsumed: [] } },
    ]);
  });

  it("objeto aninhado reescrito com o MESMO conteúdo (nova referência) não conta como mudança", () => {
    const before = { requirements: { itemsConsumed: [{ itemId: 715, amount: 1 }] } };
    const after = { requirements: { itemsConsumed: [{ itemId: 715, amount: 1 }] } };
    expect(diffFields(before, after)).toEqual([]);
  });

  it("before undefined (criação) — todo campo presente conta como alterado", () => {
    expect(diffFields(undefined, { name: "New", price: 10 })).toEqual([
      { field: "name", oldValue: null, newValue: "New" },
      { field: "price", oldValue: null, newValue: 10 },
    ]);
  });

  it("nenhum campo mudou em um objeto com vários campos — diff vazio (não cria log)", () => {
    const obj = { name: "Poring", hp: 50, level: 1, drops: [{ itemId: 909, rate: 7000 }] };
    expect(diffFields({ ...obj }, { ...obj, drops: [{ itemId: 909, rate: 7000 }] })).toEqual([]);
  });
});
