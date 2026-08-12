import { beforeEach, describe, expect, it } from "vitest";

/**
 * `persist` (zustand/middleware) precisa de `localStorage` — mesmo shim de
 * `hud/skillBarStore.test.ts` (ambiente Node puro, sem jsdom).
 */
class LocalStorageShim {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}
const localStorageShim = new LocalStorageShim();
(globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = localStorageShim;

const { useCombatVisuals, bindToCharacter, unbindCharacter } = await import("./combatVisualsStore");

beforeEach(() => {
  localStorageShim.clear();
  unbindCharacter();
});

describe("Caso 1 — padrão, sem preferência salva", () => {
  it("showAttackRange nasce false, showSkillArea nasce true", () => {
    expect(useCombatVisuals.getState().showAttackRange).toBe(false);
    expect(useCombatVisuals.getState().showSkillArea).toBe(true);
  });

  it("padrão continua o mesmo depois de vincular um personagem sem histórico salvo", () => {
    bindToCharacter(1);
    expect(useCombatVisuals.getState().showAttackRange).toBe(false);
    expect(useCombatVisuals.getState().showSkillArea).toBe(true);
  });
});

describe("Caso 2 — ligar o alcance de ataque não mexe na área de skill", () => {
  it("showAttackRange=true, showSkillArea continua true", () => {
    bindToCharacter(1);
    useCombatVisuals.getState().setShowAttackRange(true);
    expect(useCombatVisuals.getState().showAttackRange).toBe(true);
    expect(useCombatVisuals.getState().showSkillArea).toBe(true);
  });
});

describe("Caso 3 — desligar a área de skill não mexe no alcance de ataque", () => {
  it("showSkillArea=false, showAttackRange segue como estava (true, setado antes)", () => {
    bindToCharacter(1);
    useCombatVisuals.getState().setShowAttackRange(true);
    useCombatVisuals.getState().setShowSkillArea(false);
    expect(useCombatVisuals.getState().showAttackRange).toBe(true);
    expect(useCombatVisuals.getState().showSkillArea).toBe(false);
  });

  it("showSkillArea=false com showAttackRange ainda no padrão (false) — os dois OFF ao mesmo tempo é válido", () => {
    bindToCharacter(1);
    useCombatVisuals.getState().setShowSkillArea(false);
    expect(useCombatVisuals.getState().showAttackRange).toBe(false);
    expect(useCombatVisuals.getState().showSkillArea).toBe(false);
  });
});

describe("Caso 4 — os dois ON ao mesmo tempo também é válido", () => {
  it("showAttackRange=true e showSkillArea=true simultaneamente", () => {
    bindToCharacter(1);
    useCombatVisuals.getState().setShowAttackRange(true);
    useCombatVisuals.getState().setShowSkillArea(true);
    expect(useCombatVisuals.getState().showAttackRange).toBe(true);
    expect(useCombatVisuals.getState().showSkillArea).toBe(true);
  });
});

describe("Caso 6 — persistência sobrevive a troca de tela/personagem", () => {
  it("alterar os dois toggles e voltar pro mesmo personagem preserva os dois", () => {
    bindToCharacter(42);
    useCombatVisuals.getState().setShowAttackRange(true);
    useCombatVisuals.getState().setShowSkillArea(false);

    bindToCharacter(43); // troca de personagem — outro dono
    expect(useCombatVisuals.getState().showAttackRange).toBe(false); // padrão do novo dono
    expect(useCombatVisuals.getState().showSkillArea).toBe(true);

    bindToCharacter(42); // volta — o "recarregar" do jogo
    expect(useCombatVisuals.getState().showAttackRange).toBe(true);
    expect(useCombatVisuals.getState().showSkillArea).toBe(false);
  });

  it("logout completo e login de novo no mesmo personagem preserva a preferência", () => {
    bindToCharacter(9);
    useCombatVisuals.getState().setShowAttackRange(true);
    unbindCharacter(); // logout — como encerrar() faz em useGatewayEvents

    bindToCharacter(9);
    expect(useCombatVisuals.getState().showAttackRange).toBe(true);
  });

  it("bindToCharacter pro MESMO personagem é no-op — warp de mesmo mapa não reseta a preferência", () => {
    bindToCharacter(55);
    useCombatVisuals.getState().setShowSkillArea(false);
    bindToCharacter(55); // @jump, Asa de Borboleta, respawn: mesmo char de novo
    expect(useCombatVisuals.getState().showSkillArea).toBe(false);
  });
});

describe("isolamento por personagem/conta — a preferência nunca vaza", () => {
  it("personagem A liga o alcance de ataque; personagem B continua no padrão (false)", () => {
    bindToCharacter(100);
    useCombatVisuals.getState().setShowAttackRange(true);

    bindToCharacter(200);
    expect(useCombatVisuals.getState().showAttackRange).toBe(false);
  });

  it("dois personagens da mesma conta têm preferências independentes", () => {
    bindToCharacter(301);
    useCombatVisuals.getState().setShowSkillArea(false);
    bindToCharacter(302);
    useCombatVisuals.getState().setShowSkillArea(true);

    bindToCharacter(301);
    expect(useCombatVisuals.getState().showSkillArea).toBe(false);
    bindToCharacter(302);
    expect(useCombatVisuals.getState().showSkillArea).toBe(true);
  });

  it("personagens de contas diferentes têm preferências independentes, mesmo com logout completo entre elas", () => {
    bindToCharacter(401);
    useCombatVisuals.getState().setShowAttackRange(true);
    unbindCharacter();

    bindToCharacter(999); // outra conta
    expect(useCombatVisuals.getState().showAttackRange).toBe(false);
    useCombatVisuals.getState().setShowAttackRange(true);
    unbindCharacter();

    bindToCharacter(401);
    expect(useCombatVisuals.getState().showAttackRange).toBe(true);
  });

  it("chaves de localStorage não colidem entre personagens", () => {
    bindToCharacter(71);
    useCombatVisuals.getState().setShowAttackRange(true);
    bindToCharacter(72);
    useCombatVisuals.getState().setShowAttackRange(true);

    const chaves = localStorageShim.keys().filter((k) => k.startsWith("ragnarok:combat-visuals"));
    expect(chaves).toEqual(expect.arrayContaining(["ragnarok:combat-visuals:71", "ragnarok:combat-visuals:72"]));
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("sem personagem vinculado (fora de sessão), nada é gravado no localStorage", () => {
    unbindCharacter();
    useCombatVisuals.getState().setShowAttackRange(true);
    expect(localStorageShim.keys().filter((k) => k.startsWith("ragnarok:combat-visuals"))).toHaveLength(0);
  });
});
