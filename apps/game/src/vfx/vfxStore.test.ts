import { describe, expect, it, beforeEach, vi } from "vitest";
import "./skillVfxBindings";
import { useVfxStore } from "./vfxStore";
import { useSkillCatalog } from "../net/skillCatalog";

/**
 * Regressão da corrida catálogo×primeiro cast (auditoria "Congelar ainda
 * usa o antigo" 2026-08-18): `vfxStore.spawn()` lia `aegisName` do
 * catálogo SÍNCRONO — no primeiro cast de qualquer `skillId` nunca visto
 * na sessão, o fetch (assíncrono) não tinha como já ter resolvido, e a
 * instância caía pro dispatcher LEGADO (`effects[]`) de forma PERMANENTE,
 * mesmo pra skills com binding migrado real (`skillVfxBindings.ts`) — não
 * era específico de Frost/Congelar, afetava as 11 skills migradas
 * igualmente. Fix: `spawn()` espera o catálogo resolver (retry único,
 * timeout de segurança) antes de decidir, em vez de comprometer a
 * instância com dado incompleto.
 */
describe("vfx/vfxStore — corrida catálogo×primeiro cast (2026-08-18)", () => {
  beforeEach(() => {
    useVfxStore.getState().reset();
    useSkillCatalog.setState({ byId: {} });
    vi.useRealTimers();
  });

  it("skillId nunca visto (catálogo frio): NÃO cai pro array legado imediatamente", () => {
    // MG_FIREBALL:impact tem binding migrado real (skillVfxBindings.test.ts
    // já garante isso) — catálogo vazio pra este skillId simula o cast
    // mais cedo possível na sessão, antes de qualquer `ensure()` resolver.
    useVfxStore.getState().spawn({ kind: "impact", skillId: 999001, gid: 1, expiresAt: performance.now() + 600 });
    expect(useVfxStore.getState().effects).toEqual([]);
  });

  it("catálogo resolve LOGO DEPOIS pra uma skill migrada: nunca aparece no array legado", () => {
    useVfxStore.getState().spawn({ kind: "impact", skillId: 999002, gid: 1, expiresAt: performance.now() + 600 });
    expect(useVfxStore.getState().effects).toEqual([]);

    // catálogo resolve (mesmo efeito de `ensure()` terminando o fetch)
    useSkillCatalog.setState({
      byId: {
        999002: { id: 999002, aegisName: "MG_FIREBALL", hitType: "normal", name: "Fire Ball", target: "enemy", areaRadius: 1.5, maxLevel: 10, type: "damage", element: "fire", spCost: 0, range: 9, cooldownMs: 0, durationMs: 0, duration2Ms: 0 },
      },
    });

    // continua vazio — resolveu pro Core (migrado), NUNCA pro legado, nem
    // depois do catálogo responder (regressão exata pedida: "garantir que
    // uma segunda implementação antiga não volte a renderizar").
    expect(useVfxStore.getState().effects).toEqual([]);
  });

  it("catálogo resolve pra uma skill SEM binding migrado: cai pro legado normalmente (sem falso negativo)", () => {
    useVfxStore.getState().spawn({ kind: "impact", skillId: 999003, gid: 1, expiresAt: performance.now() + 600 });
    expect(useVfxStore.getState().effects).toEqual([]); // ainda esperando o catálogo

    useSkillCatalog.setState({
      byId: {
        999003: { id: 999003, aegisName: "AL_HEAL", hitType: "normal", name: "Heal", target: "enemy", areaRadius: 0, maxLevel: 10, type: "support", element: "neutral", spCost: 0, range: 9, cooldownMs: 0, durationMs: 0, duration2Ms: 0 },
      },
    });

    expect(useVfxStore.getState().effects.length).toBe(1);
    expect(useVfxStore.getState().effects[0]?.skillId).toBe(999003);
  });

  it("catálogo NUNCA resolve (API fora do ar): desiste depois do timeout, cai pro legado, não trava pra sempre", () => {
    vi.useFakeTimers();
    useVfxStore.getState().spawn({ kind: "impact", skillId: 999004, gid: 1, expiresAt: performance.now() + 600 });
    expect(useVfxStore.getState().effects).toEqual([]);

    vi.advanceTimersByTime(2500); // além de VFX_SPAWN_RETRY_TIMEOUT_MS (2000ms)

    expect(useVfxStore.getState().effects.length).toBe(1);
    expect(useVfxStore.getState().effects[0]?.skillId).toBe(999004);
    vi.useRealTimers();
  });
});
