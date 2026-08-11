import { describe, expect, it } from "vitest";
import {
  generateSpawnLine,
  generateSpawnBlock,
  spawnMarkerLine,
  parseSpawnMarker,
  isSpawnDataLine,
  isSafeMonsterSpawnName,
} from "./monster-spawn-generate";
import type { MonsterSpawn } from "../monster";

/**
 * Formato conferido byte a byte contra `rathena/doc/script_commands.txt`
 * ("Create a permanent monster spawn") e `npc-idle/mobs/{prontera,gpqa01}.txt`.
 */

function spawn(overrides: Partial<MonsterSpawn> = {}): MonsterSpawn {
  return {
    mapId: "prt_fild00",
    amount: 10,
    respawnTimeMs: 5000,
    respawnVarianceMs: 0,
    boss: false,
    ...overrides,
  };
}

describe("generateSpawnLine", () => {
  it("spawn de mapa inteiro (sem area) vira 'mapa,0,0' — mesma forma de prt_fild00,0,0 no corpus real", () => {
    const r = generateSpawnLine(spawn(), { id: 1012, name: "Roda Frog" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("prt_fild00,0,0\tmonster\tRoda Frog\t1012,10,5000");
  });

  it("spawn com area vira 'mapa,x,y,xs,ys' — 4 campos sempre juntos", () => {
    const r = generateSpawnLine(spawn({ area: { x: 64, y: 64, xs: 10, ys: 10 } }), { id: 25001, name: "QA Slime Novo" });
    expect(r.ok).toBe(true);
    expect(r.text).toBe("prt_fild00,64,64,10,10\tmonster\tQA Slime Novo\t25001,10,5000");
  });

  it("respawnVarianceMs > 0 vira o 4º campo (delay2); == 0 é omitido", () => {
    const withVariance = generateSpawnLine(spawn({ respawnVarianceMs: 900000 }), { id: 1083, name: "Shining Plant" });
    expect(withVariance.text).toBe("prt_fild00,0,0\tmonster\tShining Plant\t1083,10,5000,900000");

    const withoutVariance = generateSpawnLine(spawn({ respawnVarianceMs: 0 }), { id: 1083, name: "Shining Plant" });
    expect(withoutVariance.text).toBe("prt_fild00,0,0\tmonster\tShining Plant\t1083,10,5000");
  });

  it("boss:true usa 'boss_monster' no lugar de 'monster'", () => {
    const r = generateSpawnLine(spawn({ boss: true }), { id: 1038, name: "Osiris" });
    expect(r.text).toContain("\tboss_monster\t");
    expect(r.text).not.toContain("\tmonster\t");
  });

  it("nome de monstro com tab/quebra de linha é recusado (quebraria a coluna)", () => {
    const r = generateSpawnLine(spawn(), { id: 1, name: "Nome\tRuim" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("unsafe-name");
  });
});

describe("marcador de identidade (spawnId)", () => {
  it("spawnMarkerLine / parseSpawnMarker fazem round-trip", () => {
    const line = spawnMarkerLine("abc-123");
    expect(line).toBe("// spawnId:abc-123");
    expect(parseSpawnMarker(line)).toBe("abc-123");
  });

  it("parseSpawnMarker devolve undefined pra linha que não é marcador", () => {
    expect(parseSpawnMarker('prt_fild00,0,0\tmonster\tPoring\t1002,10,5000')).toBeUndefined();
    expect(parseSpawnMarker("// comentário qualquer")).toBeUndefined();
  });

  it("isSpawnDataLine reconhece monster/boss_monster e recusa qualquer outra coisa", () => {
    expect(isSpawnDataLine('prt_fild00,0,0\tmonster\tPoring\t1002,10,5000')).toBe(true);
    expect(isSpawnDataLine('prt_fild00,0,0\tboss_monster\tOsiris\t1038,1,7200000')).toBe(true);
    expect(isSpawnDataLine("// spawnId:abc")).toBe(false);
    expect(isSpawnDataLine("")).toBe(false);
  });

  it("generateSpawnBlock produz marcador + linha de dados, nessa ordem", () => {
    const r = generateSpawnBlock(spawn(), { id: 1002, name: "Poring" }, "sp-1");
    expect(r.ok).toBe(true);
    expect(r.text).toBe("// spawnId:sp-1\nprt_fild00,0,0\tmonster\tPoring\t1002,10,5000");
  });
});

describe("isSafeMonsterSpawnName", () => {
  it("aceita nomes normais, recusa tab/CR/LF", () => {
    expect(isSafeMonsterSpawnName("Poring")).toBe(true);
    expect(isSafeMonsterSpawnName("QA Slime Novo")).toBe(true);
    expect(isSafeMonsterSpawnName("a\tb")).toBe(false);
    expect(isSafeMonsterSpawnName("a\nb")).toBe(false);
    expect(isSafeMonsterSpawnName("a\rb")).toBe(false);
  });
});
