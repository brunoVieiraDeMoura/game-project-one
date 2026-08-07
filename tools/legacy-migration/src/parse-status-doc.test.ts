import { describe, expect, it } from "vitest";
import { parseStatusChangeDoc } from "./parse-status-doc";

const FIXTURE = `//===== rAthena Documentation ================================
//= Status Change Documentation
//===== Format: =========================================
//= <SC_Name>	(<Default_EFST>)
//= 	desc: <any description or info related this status>
//= 	val1: <usage for>
//============================================================

SC_STONE	()
	desc: DEF -50%; if HP>25% lose 1% HP/5 sec; MDEF +25%; change element to Earth Lv 1; ignore Steal & Lex Aeterna; can't move/attack/pick item/use item/use skill/sit/logout
	val1:
	val2: Caster's object ID
	val3: Incubation time
	val4: Remaining tick

SC_COMBO	()
	desc:
	val1:

SC_BLEEDING	(EFST_BLOODING)
	desc: HP Regeneration is disabled; SP Regeneration is disabled; Lose HP overtime
	val1: Skill Level
	val2: Caster's object ID (for mob_log_damage)
	val3:
	val4: Remaining tick
`;

describe("parseStatusChangeDoc", () => {
  it("extrai desc e params indexados por id minúsculo sem o prefixo SC_", () => {
    const result = parseStatusChangeDoc(FIXTURE);
    const stone = result.get("stone");
    expect(stone).toBeDefined();
    expect(stone!.desc).toContain("DEF -50%");
    expect(stone!.params).toEqual(["2: Caster's object ID", "3: Incubation time", "4: Remaining tick"]);
  });

  it("omite val vazio sem deslocar o índice dos outros", () => {
    const bleeding = parseStatusChangeDoc(FIXTURE).get("bleeding");
    expect(bleeding!.params).toEqual(["1: Skill Level", "2: Caster's object ID (for mob_log_damage)", "4: Remaining tick"]);
  });

  it("entrada sem desc nem val preenchido não entra no mapa", () => {
    expect(parseStatusChangeDoc(FIXTURE).has("combo")).toBe(false);
  });

  it("não confunde referência cruzada dentro de outro desc com um header novo", () => {
    // o desc de SC_STONE menciona "Lex Aeterna" sem tab — não pode virar entrada própria
    expect(parseStatusChangeDoc(FIXTURE).has("aeterna")).toBe(false);
  });

  it("id desconhecido no catálogo simplesmente não aparece no mapa (nunca inventa entrada)", () => {
    expect(parseStatusChangeDoc(FIXTURE).has("nao_existe")).toBe(false);
  });
});
