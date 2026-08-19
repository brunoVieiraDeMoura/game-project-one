import { beforeEach, describe, expect, it } from "vitest";
import { useCastStore } from "./castStore";

/**
 * `alvoGid` no `castStore`: o dado que `NetPlayer` usa para saber SE deve
 * girar o personagem durante o cast (skill de entidade) ou não (skill de
 * chão/AOE, sem alvo nenhum). Nasce de `skill:casting.targetGid` — ver
 * `useWorldEvents.onSkillCasting`.
 */

beforeEach(() => {
  useCastStore.getState().parar();
});

describe("castStore.atual.alvoGid", () => {
  it("skill de ALVO: guarda o gid do alvo", () => {
    useCastStore.getState().comecar(89, 2000, 42);
    expect(useCastStore.getState().atual?.alvoGid).toBe(42);
  });

  it("skill de CHÃO/AOE: sem alvo, nada para o personagem seguir", () => {
    useCastStore.getState().comecar(89, 2000);
    expect(useCastStore.getState().atual?.alvoGid).toBeUndefined();
  });

  it("skill instantânea (< 150ms): nem chega a registrar — nada para seguir", () => {
    useCastStore.getState().comecar(89, 100, 42);
    expect(useCastStore.getState().atual).toBeNull();
  });

  it("parar() limpa o alvo junto — o tracking some com o resto do cast", () => {
    useCastStore.getState().comecar(89, 2000, 42);
    useCastStore.getState().parar();
    expect(useCastStore.getState().atual).toBeNull();
  });

  it("cast seguinte sem alvo substitui um anterior COM alvo (nunca herda gid velho)", () => {
    useCastStore.getState().comecar(89, 2000, 42);
    useCastStore.getState().comecar(90, 2000); // outra skill, de chão
    expect(useCastStore.getState().atual?.alvoGid).toBeUndefined();
  });
});
