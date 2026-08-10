import { describe, expect, it } from "vitest";
import type { StatusEffectDef } from "../status";
import { StatusEffectDefSchema } from "../status";
import { CALC_FLAG_READABLE, STATE_READABLE, statusToRawEntry } from "./status-db-mapper";
import { STATUS_CALC_FLAG_OPTIONS, STATUS_STATE_OPTIONS } from "./status-flag-options";

/**
 * Gate da Fase 2c (leia1.txt, aprovação "Opção A" pro achado A1 do
 * risk-report): prova que `STATE_READABLE`/`CALC_FLAG_READABLE` cobrem o
 * enum REAL do rAthena por inteiro — não é só "a UI tem N opções", é
 * "essas N opções são EXATAMENTE o conjunto que `status.hpp` define".
 *
 * As duas listas abaixo (`REAL_SCS`/`REAL_SCB`) foram extraídas de
 * `rathena/src/map/status.hpp` (SCS_: `enum e_state_flag`, linhas
 * 3077-3104; SCB_: `enum e_scb_flag`, linhas 3107-3158), excluindo os
 * terminadores `*_NONE`/`*_MAX` — são o mesmo levantamento já feito na
 * auditoria (docs/audit/risk-report.md, A1), agora travado em teste pra
 * nunca mais dessincronizar em silêncio.
 */

const REAL_SCS = [
  "NOMOVECOND", "NOMOVE", "NOPICKITEMCOND", "NOPICKITEM", "NODROPITEMCOND", "NODROPITEM",
  "NOCASTCOND", "NOCAST", "NOCHAT", "NOCHATCOND", "NOEQUIPITEMCOND", "NOEQUIPITEM",
  "NOUNEQUIPITEMCOND", "NOUNEQUIPITEM", "NOCONSUMEITEMCOND", "NOCONSUMEITEM",
  "NOATTACKCOND", "NOATTACK", "NOWARPCOND", "NOWARP", "NODEATHPENALTYCOND", "NODEATHPENALTY",
  "NOINTERACTCOND", "NOINTERACT",
];

const REAL_SCB = [
  "BASE", "MAXHP", "MAXSP", "STR", "AGI", "VIT", "INT", "DEX", "LUK", "BATK", "WATK", "MATK",
  "HIT", "FLEE", "DEF", "DEF2", "MDEF", "MDEF2", "SPEED", "ASPD", "DSPD", "CRI", "FLEE2",
  "ATK_ELE", "DEF_ELE", "MODE", "SIZE", "RACE", "RANGE", "REGEN", "MAXAP", "POW", "STA", "WIS",
  "SPL", "CON", "CRT", "PATK", "SMATK", "RES", "MRES", "HPLUS", "CRATE", "DYE",
];
/** `All` não é enumerador de `e_scb_flag` — é a chave especial que o
 * loader resolve pra `getSCB_ALL()` (status.cpp), sempre válida além do
 * enum numerado. Faz parte do conjunto GRAVÁVEL, então entra na
 * comparação de opções mas não na de "todo SCB_ numerado tem chave". */
const REAL_SCB_WITH_ALL = [...REAL_SCB, "All"];

describe("Fase 2c — STATE_READABLE/CALC_FLAG_READABLE cobrem o enum real (A1 resolvido)", () => {
  it("STATE_READABLE == SCS_* real, conjunto exato (24)", () => {
    expect(new Set(Object.keys(STATE_READABLE))).toEqual(new Set(REAL_SCS));
    expect(Object.keys(STATE_READABLE)).toHaveLength(24);
  });

  it("CALC_FLAG_READABLE == SCB_* real + All, conjunto exato (45)", () => {
    expect(new Set(Object.keys(CALC_FLAG_READABLE))).toEqual(new Set(REAL_SCB_WITH_ALL));
    expect(Object.keys(CALC_FLAG_READABLE)).toHaveLength(45);
  });

  it("os 11 valores antes ausentes (A1) agora têm opção gravável", () => {
    const newStates = ["no_attack_cond", "no_death_penalty_cond", "no_equip_item_cond", "no_interact_cond", "no_un_equip_item_cond", "no_warp_cond"];
    const newCalcFlags = ["base", "size", "race", "range", "max_ap"];
    const stateValues = STATUS_STATE_OPTIONS.map((o) => o.value);
    const calcFlagValues = STATUS_CALC_FLAG_OPTIONS.map((o) => o.value);
    for (const v of newStates) expect(stateValues).toContain(v);
    for (const v of newCalcFlags) expect(calcFlagValues).toContain(v);
  });

  it("STATUS_STATE_OPTIONS/STATUS_CALC_FLAG_OPTIONS têm o mesmo tamanho das tabelas (nenhuma opção perdida na conversão)", () => {
    expect(STATUS_STATE_OPTIONS).toHaveLength(Object.keys(STATE_READABLE).length);
    expect(STATUS_CALC_FLAG_OPTIONS).toHaveLength(Object.keys(CALC_FLAG_READABLE).length);
  });

  /** Verificação pedida explicitamente (leia1.txt): os 11 valores não
   * podem ser descartados pelo WRITE-PATH de verdade (`statusToRawEntry`,
   * o mesmo `toCanonicalSet`/`fullSmallEnumRecord` que grava o YAML) —
   * não basta a tabela ter a chave, o Mapper precisa RESOLVER e EMITIR. */
  it("write-path real: os 11 valores chegam como true no RawStatus, sem warning de 'não reconhecido'", () => {
    const status: StatusEffectDef = StatusEffectDefSchema.parse({
      id: "teste_a1",
      name: "Teste A1",
      states: [
        "no_attack_cond",
        "no_death_penalty_cond",
        "no_equip_item_cond",
        "no_interact_cond",
        "no_un_equip_item_cond",
        "no_warp_cond",
      ],
      calcFlags: ["base", "size", "race", "range", "max_ap"],
    });

    const { entry, warnings } = statusToRawEntry(status);

    expect(entry.States?.NOATTACKCOND).toBe(true);
    expect(entry.States?.NODEATHPENALTYCOND).toBe(true);
    expect(entry.States?.NOEQUIPITEMCOND).toBe(true);
    expect(entry.States?.NOINTERACTCOND).toBe(true);
    expect(entry.States?.NOUNEQUIPITEMCOND).toBe(true);
    expect(entry.States?.NOWARPCOND).toBe(true);
    expect(entry.CalcFlags?.BASE).toBe(true);
    expect(entry.CalcFlags?.SIZE).toBe(true);
    expect(entry.CalcFlags?.RACE).toBe(true);
    expect(entry.CalcFlags?.RANGE).toBe(true);
    expect(entry.CalcFlags?.MAXAP).toBe(true);

    const dropped = warnings.filter((w) => w.startsWith("states:") || w.startsWith("calcFlags:"));
    expect(dropped).toEqual([]);
  });

  it("write-path real: os outros 13 SCS_*/40 SCB_* continuam false quando não selecionados (conjunto fechado emitido por inteiro)", () => {
    const status: StatusEffectDef = StatusEffectDefSchema.parse({
      id: "teste_a1_vazio",
      name: "Teste A1 vazio",
      states: [],
      calcFlags: [],
    });
    const { entry } = statusToRawEntry(status);
    expect(entry.States?.NOATTACKCOND).toBe(false);
    expect(entry.CalcFlags?.MAXAP).toBe(false);
    expect(Object.keys(entry.States ?? {})).toHaveLength(24);
    expect(Object.keys(entry.CalcFlags ?? {})).toHaveLength(45);
  });
});
