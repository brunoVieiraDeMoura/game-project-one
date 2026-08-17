import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}
const localStorageShim = new LocalStorageShim();
(globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = localStorageShim;

/** mesmo shim de `multiHitCastAudio.test.ts` — `loop`/`pauseCalls` porque os
 * canais de `cast`/`duration`/`buff` são LOOP (`el.loop = true`). */
class FakeAudio {
  src: string;
  loop = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  constructor(src: string) {
    this.src = src;
    criadas.push(this);
  }
  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }
}
let criadas: FakeAudio[] = [];
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

const { useAudioSettings } = await import("../audioSettingsStore");
const { __resetForTests: resetPool } = await import("../oneShotPool");
const { useSkillCatalog } = await import("../../net/skillCatalog");
const {
  aoComecarCastProjetil,
  aoLiberarCastProjetil,
  aoImpactoProjetilAtrasado,
  aoAparecerAreaDeChao,
  aoPararAreaDeChao,
  aoIniciarBuffComDuracao,
  __resetForTests: resetLoop,
} = await import("./otherSkillsAudio");

const BASE = "/assets/audio/combat/mage/skills";

const FIREBALL_CAST = `${BASE}/fire-ball/cast.mp3`;
const FIREBALL_HIT = `${BASE}/fire-ball/hit.mp3`;
const FROSTDIVER_CAST = `${BASE}/frost-diver/cast.mp3`;
const FROSTDIVER_HIT = `${BASE}/frost-diver/hit.mp3`;
const STONECURSE_HIT = `${BASE}/stone-curse/hit.mp3`;

const FIREWALL_CAST = `${BASE}/fire-wall/cast.mp3`;
const FIREWALL_DURATION = `${BASE}/fire-wall/duration.mp3`;
const GHOSTDOME_CAST = `${BASE}/ghost-dome/cast.mp3`;

const ORACLE_DURATION = `${BASE}/oracle/duration.mp3`;

const FIREBALL_ID = 17;
const FROSTDIVER_ID = 30;
const STONECURSE_ID = 31;
const FIREWALL_ID = 25;
const SAFETYWALL_ID = 26;
const SIGHT_ID = 8;
const HEAL_ID = 28; // fora dos 3 grupos

function tocou(src: string): boolean {
  return criadas.some((a) => a.src === src && a.playCalls > 0);
}

function playCallsDe(src: string): number {
  return criadas.filter((a) => a.src === src).reduce((n, a) => n + a.playCalls, 0);
}

function elementoDe(src: string): FakeAudio | undefined {
  return criadas.find((a) => a.src === src);
}

function skill(id: number, aegisName: string, overrides: Partial<{ durationMs: number }> = {}) {
  return {
    id,
    aegisName,
    name: aegisName,
    hitType: "normal" as const,
    target: "enemy" as const,
    areaRadius: 0,
    maxLevel: 10,
    type: "damage" as const,
    element: "neutral" as const,
    spCost: 0,
    range: 9,
    cooldownMs: 0,
    durationMs: 0,
    duration2Ms: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  criadas = [];
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  resetPool();
  resetLoop();
  useSkillCatalog.setState({
    byId: {
      [FIREBALL_ID]: skill(FIREBALL_ID, "MG_FIREBALL"),
      [FROSTDIVER_ID]: skill(FROSTDIVER_ID, "MG_FROSTDIVER"),
      [STONECURSE_ID]: skill(STONECURSE_ID, "MG_STONECURSE"),
      [FIREWALL_ID]: skill(FIREWALL_ID, "MG_FIREWALL"),
      [SAFETYWALL_ID]: skill(SAFETYWALL_ID, "MG_SAFETYWALL"),
      [SIGHT_ID]: skill(SIGHT_ID, "MG_SIGHT"),
      [HEAL_ID]: skill(HEAL_ID, "AL_HEAL"),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("grupo 1 — Fire Ball/Frost Diver/Stone Curse: cast em loop", () => {
  it("Fire Ball: toca cast.mp3 em loop", () => {
    aoComecarCastProjetil(FIREBALL_ID);
    expect(tocou(FIREBALL_CAST)).toBe(true);
    expect(elementoDe(FIREBALL_CAST)!.loop).toBe(true);
  });

  it("skill fora do grupo (Heal): não toca nada", () => {
    aoComecarCastProjetil(HEAL_ID);
    expect(criadas).toHaveLength(0);
  });

  it("recast troca de skill para o loop anterior — nunca dois juntos", () => {
    aoComecarCastProjetil(FIREBALL_ID);
    aoComecarCastProjetil(FROSTDIVER_ID);
    expect(elementoDe(FIREBALL_CAST)!.paused).toBe(true);
    expect(elementoDe(FROSTDIVER_CAST)!.paused).toBe(false);
  });

  it("aoLiberarCastProjetil(souEu=true) para o loop", () => {
    aoComecarCastProjetil(FIREBALL_ID);
    aoLiberarCastProjetil(FIREBALL_ID, true);
    expect(elementoDe(FIREBALL_CAST)!.paused).toBe(true);
  });

  it("aoLiberarCastProjetil(souEu=false) NÃO mexe no loop próprio", () => {
    aoComecarCastProjetil(FIREBALL_ID);
    aoLiberarCastProjetil(FIREBALL_ID, false);
    expect(elementoDe(FIREBALL_CAST)!.paused).toBe(false);
  });
});

describe("grupo 1 — impacto atrasado", () => {
  it("Fire Ball: NÃO toca na hora, toca só depois de 446ms (IMPACT_AT_MS do VFX)", () => {
    aoImpactoProjetilAtrasado(FIREBALL_ID);
    expect(tocou(FIREBALL_HIT)).toBe(false);
    vi.advanceTimersByTime(445);
    expect(tocou(FIREBALL_HIT)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tocou(FIREBALL_HIT)).toBe(true);
  });

  it("Frost Diver: atraso de 580ms (TRAIL_MS + 60)", () => {
    aoImpactoProjetilAtrasado(FROSTDIVER_ID);
    vi.advanceTimersByTime(579);
    expect(tocou(FROSTDIVER_HIT)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tocou(FROSTDIVER_HIT)).toBe(true);
  });

  it("Stone Curse: atraso de 380ms (BEAM_MS + 40)", () => {
    aoImpactoProjetilAtrasado(STONECURSE_ID);
    vi.advanceTimersByTime(379);
    expect(tocou(STONECURSE_HIT)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tocou(STONECURSE_HIT)).toBe(true);
  });

  it("N chamadas tocam N vezes, cada uma no seu próprio atraso — nunca duplica dentro de UMA chamada", () => {
    aoImpactoProjetilAtrasado(FIREBALL_ID);
    aoImpactoProjetilAtrasado(FIREBALL_ID);
    vi.advanceTimersByTime(446);
    expect(playCallsDe(FIREBALL_HIT)).toBe(2);
  });

  it("skill fora do grupo: não agenda nada", () => {
    aoImpactoProjetilAtrasado(HEAL_ID);
    vi.advanceTimersByTime(5000);
    expect(criadas).toHaveLength(0);
  });
});

describe("grupo 2 — Fire Wall/Ghost Dome: área do servidor", () => {
  it("Fire Wall: toca cast.mp3 uma vez e entra duration.mp3 em loop", () => {
    aoAparecerAreaDeChao(FIREWALL_ID);
    expect(playCallsDe(FIREWALL_CAST)).toBe(1);
    expect(tocou(FIREWALL_DURATION)).toBe(true);
    expect(elementoDe(FIREWALL_DURATION)!.loop).toBe(true);
  });

  it("Ghost Dome: só toca cast.mp3 uma vez, sem loop (sem arquivo de duration)", () => {
    aoAparecerAreaDeChao(SAFETYWALL_ID);
    expect(playCallsDe(GHOSTDOME_CAST)).toBe(1);
    expect(criadas.some((a) => a.loop)).toBe(false);
  });

  it("Fire Wall: aoPararAreaDeChao para o loop de duration", () => {
    aoAparecerAreaDeChao(FIREWALL_ID);
    aoPararAreaDeChao(FIREWALL_ID);
    expect(elementoDe(FIREWALL_DURATION)!.paused).toBe(true);
  });

  it("Ghost Dome: aoPararAreaDeChao não quebra mesmo sem loop pra parar", () => {
    aoAparecerAreaDeChao(SAFETYWALL_ID);
    expect(() => aoPararAreaDeChao(SAFETYWALL_ID)).not.toThrow();
  });

  it("skill fora do grupo (área genérica): não toca nada, não quebra", () => {
    expect(() => aoAparecerAreaDeChao(HEAL_ID)).not.toThrow();
    expect(criadas).toHaveLength(0);
    expect(() => aoPararAreaDeChao(HEAL_ID)).not.toThrow();
  });

  it("dois Fire Wall seguidos: cast toca de novo a cada aparição", () => {
    aoAparecerAreaDeChao(FIREWALL_ID);
    aoAparecerAreaDeChao(FIREWALL_ID);
    expect(playCallsDe(FIREWALL_CAST)).toBe(2);
  });
});

describe("grupo 3 — Oráculo/Sight: buff com duração real", () => {
  it("entra em loop com a duração recebida e para sozinho ao expirar", () => {
    aoIniciarBuffComDuracao(SIGHT_ID, 5000);
    expect(tocou(ORACLE_DURATION)).toBe(true);
    expect(elementoDe(ORACLE_DURATION)!.loop).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(elementoDe(ORACLE_DURATION)!.paused).toBe(false);
    vi.advanceTimersByTime(1);
    expect(elementoDe(ORACLE_DURATION)!.paused).toBe(true);
  });

  it("durationMs <= 0: não toca nada (sem duração real não inventa uma)", () => {
    aoIniciarBuffComDuracao(SIGHT_ID, 0);
    expect(criadas).toHaveLength(0);
  });

  it("skill fora do grupo: não toca nada", () => {
    aoIniciarBuffComDuracao(HEAL_ID, 5000);
    expect(criadas).toHaveLength(0);
  });

  it("recast antes de expirar reinicia o loop (não deixa dois timers pendurados)", () => {
    aoIniciarBuffComDuracao(SIGHT_ID, 5000);
    vi.advanceTimersByTime(2000);
    aoIniciarBuffComDuracao(SIGHT_ID, 5000);
    vi.advanceTimersByTime(3000); // total 5000 desde o 1º, 3000 desde o 2º
    expect(elementoDe(ORACLE_DURATION)!.paused).toBe(false);
    vi.advanceTimersByTime(2000); // completa os 5000 do 2º
    expect(elementoDe(ORACLE_DURATION)!.paused).toBe(true);
  });
});

describe("volume — respeita o SFX global", () => {
  it("loop de cast (grupo 1) toca no volume configurado", () => {
    useAudioSettings.getState().setSfxVolume(0.2);
    aoComecarCastProjetil(FIREBALL_ID);
    expect(elementoDe(FIREBALL_CAST)!.volume).toBeCloseTo(0.2);
  });

  it("troca de volume aplica no loop de duration (grupo 2) tocando agora", () => {
    aoAparecerAreaDeChao(FIREWALL_ID);
    useAudioSettings.getState().setSfxVolume(0.1);
    expect(elementoDe(FIREWALL_DURATION)!.volume).toBeCloseTo(0.1);
  });

  it("troca de volume aplica no loop de buff (grupo 3) tocando agora", () => {
    aoIniciarBuffComDuracao(SIGHT_ID, 5000);
    useAudioSettings.getState().setSfxVolume(0.7);
    expect(elementoDe(ORACLE_DURATION)!.volume).toBeCloseTo(0.7);
  });
});
