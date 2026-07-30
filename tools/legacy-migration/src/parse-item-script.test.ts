import { describe, expect, it } from "vitest";
import { parseItemScript } from "./parse-item-script";
import { convertRawItem } from "./migrate-items";
import { ItemSchema } from "@ragnarok/game-data";

describe("parseItemScript", () => {
  it("parses itemheal rand into typed heal effect", () => {
    const r = parseItemScript("itemheal rand(45,65),0;");
    expect(r?.effects).toEqual([{ kind: "heal", resource: "hp", min: 45, max: 65 }]);
    expect(r?.unmappedEffects).toEqual([]);
  });

  it("parses percentheal for hp and sp", () => {
    const r = parseItemScript("percentheal 100,100;");
    expect(r?.effects).toHaveLength(2);
    expect(r?.effects[0]).toMatchObject({ kind: "heal", percent: true });
  });

  it("parses known bonus keys and flags unknown statements", () => {
    const r = parseItemScript("bonus bStr,3; bonus bUnbreakableWeapon; .@r = getrefine();");
    expect(r?.effects).toEqual([{ kind: "statBonus", stat: "str", value: 3 }]);
    expect(r?.unmappedEffects).toHaveLength(2); // never dropped silently
  });

  it("parses sc_start into grantStatus", () => {
    const r = parseItemScript("sc_start SC_Blessing,120000,10;");
    expect(r?.effects[0]).toMatchObject({ kind: "grantStatus", statusId: "blessing", durationMs: 120000 });
  });

  it("returns undefined for empty script", () => {
    expect(parseItemScript(undefined)).toBeUndefined();
    expect(parseItemScript("")).toBeUndefined();
  });
});

describe("convertRawItem", () => {
  it("converts a weapon entry with rAthena pricing rule (missing Sell = Buy/2)", () => {
    const warnings: string[] = [];
    const item = ItemSchema.parse(
      convertRawItem(
        {
          Id: 1101,
          AegisName: "Sword",
          Name: "Sword",
          Type: "Weapon",
          SubType: "1hSword",
          Buy: 100,
          Weight: 500,
          Attack: 25,
          Range: 1,
          Slots: 3,
          Jobs: { All: true, Novice: false },
          Locations: { Right_Hand: true },
          Refineable: true,
        },
        warnings,
      ),
    );
    expect(item.sellPrice).toBe(50);
    expect(item.subType).toBe("1h_sword");
    expect(item.jobs).toEqual(["all", "-novice"]);
    expect(item.locations).toEqual(["right_hand"]);
    expect(item.weaponLevel).toBe(1); // rAthena default for weapons
    expect(warnings).toEqual([]);
  });

  it("maps case-insensitive type names (Petegg)", () => {
    const warnings: string[] = [];
    const item = ItemSchema.parse(
      convertRawItem({ Id: 9001, AegisName: "Poring_Egg", Name: "Poring Egg", Type: "Petegg" }, warnings),
    );
    expect(item.type).toBe("pet_egg");
    expect(warnings).toEqual([]);
  });
});
