import { describe, expect, it } from "vitest";
import {
  priorityFor,
  priorityRank,
  selectExcluded,
  selectExcludedByWeight,
  selectExcludedGrouped,
  DEFAULT_BUDGET_LIMITS,
  type BudgetCandidate,
  type WeightedBudgetCandidate,
} from "./budget";

describe("vfx/core budget — priorityFor", () => {
  it("caster é o próprio jogador local: \"own\"", () => {
    expect(priorityFor({ sourceGid: 7, localPlayerGid: 7, sourceIsPlayer: true, distanceToCamera: 999, nearDistance: 10 })).toBe("own");
  });

  it("caster é outro jogador, dentro do raio \"near\": \"near\"", () => {
    expect(priorityFor({ sourceGid: 8, localPlayerGid: 7, sourceIsPlayer: true, distanceToCamera: 5, nearDistance: 10 })).toBe("near");
  });

  it("caster é outro jogador, fora do raio \"near\": \"far\"", () => {
    expect(priorityFor({ sourceGid: 8, localPlayerGid: 7, sourceIsPlayer: true, distanceToCamera: 50, nearDistance: 10 })).toBe("far");
  });

  it("caster é NPC/monstro (não jogador): \"npc-far\", mesmo perto", () => {
    expect(priorityFor({ sourceGid: 8, localPlayerGid: 7, sourceIsPlayer: false, distanceToCamera: 1, nearDistance: 10 })).toBe("npc-far");
  });

  it("sem sourceGid conhecido: trata como NPC", () => {
    expect(priorityFor({ sourceGid: undefined, localPlayerGid: 7, sourceIsPlayer: false, distanceToCamera: 1, nearDistance: 10 })).toBe("npc-far");
  });
});

describe("vfx/core budget — priorityRank ordering", () => {
  it("own < near < far < npc-far (menor = mais importante)", () => {
    expect(priorityRank("own")).toBeLessThan(priorityRank("near"));
    expect(priorityRank("near")).toBeLessThan(priorityRank("far"));
    expect(priorityRank("far")).toBeLessThan(priorityRank("npc-far"));
  });
});

describe("vfx/core budget — selectExcluded", () => {
  it("limit Infinity (padrão): nunca exclui nada", () => {
    const candidates: BudgetCandidate[] = [{ instanceId: 1, priority: "npc-far" }];
    expect(selectExcluded(candidates, Infinity).size).toBe(0);
  });

  it("dentro do limite: não exclui ninguém", () => {
    const candidates: BudgetCandidate[] = [
      { instanceId: 1, priority: "own" },
      { instanceId: 2, priority: "npc-far" },
    ];
    expect(selectExcluded(candidates, 5).size).toBe(0);
  });

  it("acima do limite: exclui as de PIOR prioridade primeiro, nunca \"own\"", () => {
    const candidates: BudgetCandidate[] = [
      { instanceId: 1, priority: "own" },
      { instanceId: 2, priority: "near" },
      { instanceId: 3, priority: "far" },
      { instanceId: 4, priority: "npc-far" },
      { instanceId: 5, priority: "npc-far" },
    ];
    const excluded = selectExcluded(candidates, 3);
    expect(excluded.size).toBe(2);
    expect(excluded.has(4)).toBe(true);
    expect(excluded.has(5)).toBe(true);
    expect(excluded.has(1)).toBe(false); // "own" nunca é a primeira a cair
  });
});

function weighted(instanceId: number, priority: BudgetCandidate["priority"], extra: Partial<WeightedBudgetCandidate> = {}): WeightedBudgetCandidate {
  return { instanceId, priority, vfxId: "x", sourceGid: undefined, particleCount: 0, isDom: false, ...extra };
}

describe("vfx/core budget — selectExcludedByWeight (Directive B: limites por PESO, não por contagem)", () => {
  it("limit Infinity: nunca exclui, mesmo com peso alto", () => {
    const candidates = [weighted(1, "npc-far", { particleCount: 1000 })];
    expect(selectExcludedByWeight(candidates, Infinity, (c) => c.particleCount).size).toBe(0);
  });

  it("peso total dentro do limite: não exclui ninguém", () => {
    const candidates = [weighted(1, "own", { particleCount: 10 }), weighted(2, "npc-far", { particleCount: 10 })];
    expect(selectExcludedByWeight(candidates, 50, (c) => c.particleCount).size).toBe(0);
  });

  it("peso total acima do limite: exclui por PESO (partículas), não por contagem de instância — 1 instância cara pode bastar", () => {
    const candidates = [
      weighted(1, "own", { particleCount: 5 }),
      weighted(2, "npc-far", { particleCount: 50 }), // sozinha já estoura o limite de 40
    ];
    const excluded = selectExcludedByWeight(candidates, 40, (c) => c.particleCount);
    expect(excluded.size).toBe(1);
    expect(excluded.has(2)).toBe(true);
    expect(excluded.has(1)).toBe(false);
  });

  it("peso zero nunca é excluído (excluir não ajudaria a caber no limite)", () => {
    const candidates = [weighted(1, "npc-far", { particleCount: 0 }), weighted(2, "npc-far", { particleCount: 999 })];
    const excluded = selectExcludedByWeight(candidates, 10, (c) => c.particleCount);
    expect(excluded.has(1)).toBe(false);
    expect(excluded.has(2)).toBe(true);
  });
});

describe("vfx/core budget — DEFAULT_BUDGET_LIMITS (Directive B: calibração real)", () => {
  it("maxParticlesPerSkill/maxParticlesPerPlayer NÃO são Infinity — calibrados com dado real de benchmark headed", () => {
    // regressão: se alguém reverter a calibração pra Infinity sem querer,
    // este teste falha (a intenção documentada é ~25% acima do maior total
    // confirmado seguro em GPU real — 1980 partículas/skill, 334/jogador —
    // ver docblock de `PARTICLES_PER_SKILL_CONFIRMED_SAFE` em budget.ts).
    expect(DEFAULT_BUDGET_LIMITS.maxParticlesPerSkill).toBeGreaterThan(1980);
    expect(DEFAULT_BUDGET_LIMITS.maxParticlesPerSkill).toBeLessThan(1980 * 2);
    expect(DEFAULT_BUDGET_LIMITS.maxParticlesPerPlayer).toBeGreaterThan(334);
    expect(DEFAULT_BUDGET_LIMITS.maxParticlesPerPlayer).toBeLessThan(334 * 2);
  });

  it("os 3 limites SEM dado real de benchmark ainda ficam Infinity — nunca calibrados no chute", () => {
    expect(DEFAULT_BUDGET_LIMITS.maxActiveInstances).toBe(Infinity);
    expect(DEFAULT_BUDGET_LIMITS.maxActiveParticles).toBe(Infinity);
    expect(DEFAULT_BUDGET_LIMITS.maxDomInstances).toBe(Infinity);
  });
});

describe("vfx/core budget — selectExcludedGrouped (Directive B: limite POR skill/POR jogador)", () => {
  it("cada grupo (chave de `keyOf`) tem seu PRÓPRIO limite — um grupo cheio não afeta outro", () => {
    const candidates = [
      weighted(1, "own", { particleCount: 30, vfxId: "a" }),
      weighted(2, "own", { particleCount: 30, vfxId: "a" }), // grupo "a": 60 > 40, 1 cai
      weighted(3, "own", { particleCount: 30, vfxId: "b" }), // grupo "b": 30 < 40, sozinho, ninguém cai
    ];
    const excluded = selectExcludedGrouped(candidates, 40, (c) => c.particleCount, (c) => c.vfxId);
    expect(excluded.size).toBe(1);
    expect(excluded.has(3)).toBe(false);
  });

  it("candidato sem chave (`keyOf` undefined) nunca é excluído por este limite", () => {
    const candidates = [weighted(1, "npc-far", { particleCount: 999, sourceGid: undefined })];
    const excluded = selectExcludedGrouped(candidates, 10, (c) => c.particleCount, (c) => c.sourceGid);
    expect(excluded.size).toBe(0);
  });

  it("limit Infinity: nunca exclui nenhum grupo", () => {
    const candidates = [weighted(1, "npc-far", { particleCount: 999, vfxId: "a" })];
    expect(selectExcludedGrouped(candidates, Infinity, (c) => c.particleCount, (c) => c.vfxId).size).toBe(0);
  });
});
