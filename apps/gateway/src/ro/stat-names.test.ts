import { describe, expect, it } from "vitest";
import { STAT_NAMES, statName } from "./stat-names";

/**
 * Trava de regressão: SP_ATK2/DEF2/MDEF2 (varID 42/46/48) são o BÔNUS de
 * equipamento (`pc_rightside_atk`/`_def`/`_mdef`, rathena/src/map/clif.cpp:
 * 3705-3719) mandado como PAR_CHANGE isolado — SEM o par base+bônus que o
 * COUPLESTATUS (0xbd) manda junto. Nomear como "atk2"/"def2"/"mdef2" (nomes
 * que não existem em `ServerStats`) faz `playerStore.applyStat` descartar o
 * valor em silêncio: foi assim que "equipar arma não muda o ATK ao vivo"
 * passou despercebido até o teste real no browser da Fase 4.
 */
describe("statName — varID do rAthena → campo de ServerStats", () => {
  it("ATK1 (41) é a base, ATK2 (42) é o bônus de equipamento — nunca 'atk2'", () => {
    expect(statName(41)).toBe("atk");
    expect(statName(42)).toBe("atkBonus");
  });

  it("DEF1 (45) é a base, DEF2 (46) é o bônus — nunca 'def2'", () => {
    expect(statName(45)).toBe("def");
    expect(statName(46)).toBe("defBonus");
  });

  it("MDEF1 (47) é a base, MDEF2 (48) é o bônus — nunca 'mdef2'", () => {
    expect(statName(47)).toBe("mdef");
    expect(statName(48)).toBe("mdefBonus");
  });

  it("MATK1 (43) é matkMax e MATK2 (44) é matkMin — invertido de propósito (pc.hpp:1245-1267, pc_rightside_matk é o MAX)", () => {
    expect(statName(43)).toBe("matkMax");
    expect(statName(44)).toBe("matkMin");
  });

  it("FLEE2 (51) é 'perfectDodge', não bônus de FLEE1 (clif.cpp:3672, battle_status.flee2/10 — stat PRÓPRIO)", () => {
    expect(statName(51)).toBe("perfectDodge");
    expect(STAT_NAMES).not.toHaveProperty("51", "fleeBonus");
  });

  it("varID desconhecido cai no nome feio sp_<id>, nunca é jogado fora", () => {
    expect(statName(9999)).toBe("sp_9999");
  });
});
