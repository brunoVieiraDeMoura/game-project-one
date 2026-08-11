import { describe, expect, it } from "vitest";
import { mobModel, NPC_MODEL } from "./mobModels";

/**
 * `mobModel()` é pura (sem gateway/store) — não precisa de mock nenhum.
 * Fase "Modelo por monstro": os 6 ids originais (demo/QA) + os 35 esqueletos
 * reais (`race:"undead"` + nome batendo skeleton, `tools/legacy-migration/
 * output/monsters.json`) precisam continuar resolvendo certo, e qualquer
 * mobId sem entrada precisa cair no fallback sem quebrar.
 */
describe("mobModel", () => {
  it("mobId explicitamente mapeado (Poring, conjunto original) devolve o modelo certo", () => {
    expect(mobModel(1002)).toEqual({ character: "skeleton_minion", scale: 0.7 });
  });

  it("esqueleto 'guerreiro' real (Soldier Skeleton, id 1028) devolve skeleton_warrior", () => {
    expect(mobModel(1028)).toEqual({ character: "skeleton_warrior", scale: 1.0 });
  });

  it("outro id da MESMA família guerreira (Skeleton General, id 1290) também é skeleton_warrior, com escala própria", () => {
    expect(mobModel(1290)).toEqual({ character: "skeleton_warrior", scale: 1.15 });
  });

  it("esqueleto 'menor' pelo nome (Skeleton Worker, id 1169) devolve skeleton_minion", () => {
    expect(mobModel(1169)).toEqual({ character: "skeleton_minion", scale: 0.85 });
  });

  it("variante de evento do mesmo monstro base (G_SKEL_WORKER, id 1469) segue o mesmo grupo do original", () => {
    expect(mobModel(1469)).toEqual(mobModel(1169));
  });

  it("mobId desconhecido cai no fallback (skeleton_warrior), nunca quebra", () => {
    expect(mobModel(999999)).toEqual({ character: "skeleton_warrior", scale: 1 });
  });

  it("mobId 0 (inválido) cai no fallback com segurança", () => {
    expect(mobModel(0)).toEqual({ character: "skeleton_warrior", scale: 1 });
  });

  it("mobId negativo (nunca deveria acontecer, mas não pode travar o resolver) também cai no fallback", () => {
    expect(mobModel(-1)).toEqual({ character: "skeleton_warrior", scale: 1 });
  });

  it("NPC_MODEL continua fixo em knight — não fazia parte do escopo desta fase", () => {
    expect(NPC_MODEL).toEqual({ character: "knight", scale: 1 });
  });
});
