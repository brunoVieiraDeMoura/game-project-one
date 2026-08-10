import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `gateway()` abre socket.io de verdade na primeira chamada — em Node isso
 * estoura (mesmo cuidado do `net/ataqueBasico.test.ts`). O que se testa aqui
 * é a REGRA (bitmask, delta, trava de spam), não o pacote.
 */
const emitidos: { evento: string; payload: unknown }[] = [];
vi.mock("./gateway", () => ({
  gateway: () => ({ emit: (evento: string, payload: unknown) => emitidos.push({ evento, payload }) }),
}));

const { equippedBySlot, precheckEquip, requestEquip, requestUnequip, equipPending, clearEquipPending } =
  await import("./equipmentStore");
const { diffStats } = await import("./statusDeltaStore");
const { usePlayerStore } = await import("./playerStore");
import type { InventoryItem } from "./playerStore";

function item(over: Partial<InventoryItem>): InventoryItem {
  return {
    index: 0,
    itemId: 1,
    amount: 1,
    type: 5,
    identified: true,
    refine: 0,
    equipped: true,
    location: 0,
    cards: [0, 0, 0, 0],
    ...over,
  };
}

beforeEach(() => {
  emitidos.length = 0;
});

describe("equippedBySlot — bitmask EQP_* conferido no source do rAthena", () => {
  it("item comum ocupa UM slot", () => {
    const espada = item({ index: 1, location: 0x0002 }); // EQP_HAND_R
    expect(equippedBySlot([espada])).toEqual({ weapon: espada });
  });

  it("arma de DUAS MÃOS ocupa weapon E shield ao mesmo tempo", () => {
    const bastao2m = item({ index: 2, location: 0x0002 | 0x0020 }); // HAND_R|HAND_L
    const out = equippedBySlot([bastao2m]);
    expect(out.weapon).toBe(bastao2m);
    expect(out.shield).toBe(bastao2m);
  });

  it("ACC_R e ACC_L caem em ring1/ring2 distintos, pelo bit — não por ordem", () => {
    const anelDireito = item({ index: 3, location: 0x0008 }); // EQP_ACC_R
    const anelEsquerdo = item({ index: 4, location: 0x0080 }); // EQP_ACC_L
    const out = equippedBySlot([anelEsquerdo, anelDireito]); // ordem invertida de propósito
    expect(out.ring1).toBe(anelDireito);
    expect(out.ring2).toBe(anelEsquerdo);
  });

  it("EQP_AMMO cai no slot ammo (flecha/munição, ao lado do escudo na tela)", () => {
    const flecha = item({ index: 11, type: 10, location: 0x8000 }); // EQP_AMMO
    expect(equippedBySlot([flecha])).toEqual({ ammo: flecha });
  });

  it("location 0 (não equipado) não aparece em slot nenhum", () => {
    const naBolsa = item({ index: 5, location: 0, equipped: false });
    expect(equippedBySlot([naBolsa])).toEqual({});
  });

  it("equipped=false com location remanescente (dado inconsistente) também não conta", () => {
    // defesa contra o próprio protocolo mentir: `equipped` é quem manda
    const esquisito = item({ index: 6, location: 0x0002, equipped: false });
    expect(equippedBySlot([esquisito])).toEqual({});
  });
});

describe("precheckEquip — checagem RASA, só nível", () => {
  const infoBase = {
    id: 1,
    name: "Espada",
    aegisName: "Sword",
    type: "weapon",
    weight: 100,
    slots: 0,
    jobs: ["all"],
    classes: [],
    equipLevelMin: 0,
    equipLevelMax: 0,
    attack: 10,
    magicAttack: 0,
    defense: 0,
    buyPrice: 0,
    sellPrice: 0,
    range: 1,
    gender: "both",
    locations: ["right_hand"],
  };

  it("sem metadata ainda (catálogo não respondeu), não bloqueia", () => {
    expect(precheckEquip(undefined, 1).ok).toBe(true);
  });

  it("nível abaixo do mínimo é bloqueado", () => {
    const r = precheckEquip({ ...infoBase, equipLevelMin: 40 }, 10);
    expect(r.ok).toBe(false);
  });

  it("nível dentro da faixa passa", () => {
    expect(precheckEquip({ ...infoBase, equipLevelMin: 40 }, 40).ok).toBe(true);
  });

  it("acima do teto (equipLevelMax) é bloqueado — itens de baixo nível com teto", () => {
    const r = precheckEquip({ ...infoBase, equipLevelMax: 10 }, 20);
    expect(r.ok).toBe(false);
  });

  it("sem equipLevelMin/Max (0 = sem restrição) sempre passa", () => {
    expect(precheckEquip(infoBase, 1).ok).toBe(true);
  });
});

describe("trava de spam — duplo clique repetido não duplica o pedido", () => {
  it("um segundo request para o MESMO índice não emite de novo enquanto o primeiro está em voo", () => {
    requestEquip(7);
    requestEquip(7);
    expect(emitidos.filter((e) => e.evento === "item:equip").length).toBe(1);
    expect(equipPending(7)).toBe(true);
  });

  it("limpar o pendente libera o próximo pedido", () => {
    requestEquip(8);
    clearEquipPending(8);
    requestUnequip(8);
    expect(emitidos.filter((e) => e.payload && (e.payload as { index: number }).index === 8).length).toBe(2);
  });

  it("índices diferentes não se travam entre si", () => {
    requestEquip(9);
    requestEquip(10);
    expect(emitidos.filter((e) => e.evento === "item:equip").length).toBeGreaterThanOrEqual(2);
  });
});

describe("diffStats — delta entre dois snapshots AUTORITATIVOS", () => {
  const before = usePlayerStore.getState().stats;

  it("só os campos que mudaram entram no resultado", () => {
    const after = { ...before, atk: before.atk + 20, def: before.def }; // DEF igual
    const d = diffStats(before, after);
    expect(d.atk).toBe(20);
    expect(d.def).toBeUndefined();
  });

  it("ATK é a soma base+bônus, como a tela mostra", () => {
    const after = { ...before, atk: before.atk, atkBonus: before.atkBonus + 20 };
    const d = diffStats(before, after);
    expect(d.atk).toBe(20);
  });

  it("desequipar (delta negativo) também aparece", () => {
    const after = { ...before, maxHp: before.maxHp - 200 };
    expect(diffStats(before, after).maxHp).toBe(-200);
  });

  it("nada mudou → objeto vazio", () => {
    expect(diffStats(before, { ...before })).toEqual({});
  });
});
