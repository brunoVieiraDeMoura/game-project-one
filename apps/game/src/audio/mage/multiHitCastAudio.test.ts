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

/** mesmo shim de `footsteps.test.ts`: precisa de `loop`/`pauseCalls` porque o
 * canal de `cast` agora é um LOOP (`el.loop = true`), não um one-shot. */
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
  aoComecarCastMultiHit,
  aoLiberarCastMultiHit,
  aoConcluirCastDeChao,
  aoRegistrarAcertoDeChao,
  __resetForTests: resetLoop,
} = await import("./multiHitCastAudio");

const COLD_BOLT_CAST = "/assets/audio/combat/mage/skills/cold-bolt/cast.mp3";
const COLD_BOLT_COMPLETE = "/assets/audio/combat/mage/skills/cold-bolt/cast-complete.mp3";
const COLD_BOLT_HIT = "/assets/audio/combat/mage/skills/cold-bolt/hit.mp3";

const FIRE_BOLT_CAST = "/assets/audio/combat/mage/skills/fire-bolt/cast.mp3";
const FIRE_BOLT_COMPLETE = "/assets/audio/combat/mage/skills/fire-bolt/cast-complete.mp3";
const FIRE_BOLT_HIT = "/assets/audio/combat/mage/skills/fire-bolt/hit.mp3";

const THUNDER_STORM_CAST = "/assets/audio/combat/mage/skills/thunder-storm/cast.mp3";
const THUNDER_STORM_HIT = "/assets/audio/combat/mage/skills/thunder-storm/hit.mp3";

const COLD_BOLT_ID = 14;
const FIRE_BOLT_ID = 19;
const THUNDER_STORM_ID = 21;
const HEAL_ID = 28; // skill sem entrada no lookup (não é multi-hit)

function tocou(src: string): boolean {
  return criadas.some((a) => a.src === src && a.playCalls > 0);
}

function playCallsDe(src: string): number {
  return criadas.filter((a) => a.src === src).reduce((n, a) => n + a.playCalls, 0);
}

function elementoDe(src: string): FakeAudio | undefined {
  return criadas.find((a) => a.src === src);
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
      [COLD_BOLT_ID]: {
        id: COLD_BOLT_ID,
        aegisName: "MG_COLDBOLT",
        name: "Cold Bolt",
        target: "enemy",
        areaRadius: 0,
        maxLevel: 10,
        type: "damage",
        element: "water",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
      },
      [FIRE_BOLT_ID]: {
        id: FIRE_BOLT_ID,
        aegisName: "MG_FIREBOLT",
        name: "Fire Bolt",
        target: "enemy",
        areaRadius: 0,
        maxLevel: 10,
        type: "damage",
        element: "fire",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
      },
      [THUNDER_STORM_ID]: {
        id: THUNDER_STORM_ID,
        aegisName: "MG_THUNDERSTORM",
        name: "Thunderstorm",
        target: "enemy",
        areaRadius: 2,
        maxLevel: 10,
        type: "area",
        element: "wind",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
      },
      [HEAL_ID]: {
        id: HEAL_ID,
        aegisName: "AL_HEAL",
        name: "Heal",
        target: "self",
        areaRadius: 0,
        maxLevel: 10,
        type: "support",
        element: "holy",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("aoComecarCastMultiHit — cast entra em LOOP", () => {
  it("Cold Bolt: toca cast.mp3 em loop (el.loop = true)", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    expect(tocou(COLD_BOLT_CAST)).toBe(true);
    expect(elementoDe(COLD_BOLT_CAST)!.loop).toBe(true);
  });

  it("Fire Bolt: toca cast.mp3 do Fire Bolt, não o do Cold Bolt", () => {
    aoComecarCastMultiHit(FIRE_BOLT_ID);
    expect(tocou(FIRE_BOLT_CAST)).toBe(true);
    expect(tocou(COLD_BOLT_CAST)).toBe(false);
  });

  it("Thunder Storm: toca cast.mp3 do Thunder Storm em loop", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    expect(tocou(THUNDER_STORM_CAST)).toBe(true);
    expect(elementoDe(THUNDER_STORM_CAST)!.loop).toBe(true);
  });

  it("skill fora do lookup (Heal, não é multi-hit): não toca nada", () => {
    aoComecarCastMultiHit(HEAL_ID);
    expect(criadas).toHaveLength(0);
  });

  it("skill desconhecida do catálogo: não toca nada, não quebra", () => {
    aoComecarCastMultiHit(999);
    expect(criadas).toHaveLength(0);
  });

  it("cast novo (recast/troca de skill) para o loop anterior antes de começar o novo — nunca dois juntos", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    aoComecarCastMultiHit(FIRE_BOLT_ID);
    expect(elementoDe(COLD_BOLT_CAST)!.paused).toBe(true);
    expect(elementoDe(FIRE_BOLT_CAST)!.paused).toBe(false);
  });

  it("skill fora do lookup ainda assim para um loop anterior pendurado (conjuração interrompida sem skill:cast)", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    aoComecarCastMultiHit(HEAL_ID); // Heal não é multi-hit, mas o Cold Bolt anterior não pode continuar tocando
    expect(elementoDe(COLD_BOLT_CAST)!.paused).toBe(true);
  });
});

describe("aoLiberarCastMultiHit — skills de ALVO (Attack): para o loop, toca cast-complete, hit 500ms depois, UMA vez por cast", () => {
  it("Cold Bolt: para o loop de cast, toca cast-complete imediato, hit só 500ms depois", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    aoLiberarCastMultiHit(COLD_BOLT_ID);
    expect(elementoDe(COLD_BOLT_CAST)!.paused).toBe(true);
    expect(tocou(COLD_BOLT_COMPLETE)).toBe(true);
    expect(tocou(COLD_BOLT_HIT)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(tocou(COLD_BOLT_HIT)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tocou(COLD_BOLT_HIT)).toBe(true);
  });

  it("Fire Bolt: mesma cadência, arquivos do Fire Bolt", () => {
    aoComecarCastMultiHit(FIRE_BOLT_ID);
    aoLiberarCastMultiHit(FIRE_BOLT_ID);
    expect(tocou(FIRE_BOLT_COMPLETE)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(tocou(FIRE_BOLT_HIT)).toBe(true);
    expect(playCallsDe(COLD_BOLT_HIT)).toBe(0);
  });

  it("libera sem ter começado (borda): não quebra, não toca nada de loop pra parar", () => {
    expect(() => aoLiberarCastMultiHit(HEAL_ID)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });

  it("Cold Bolt: o cast-complete NUNCA soa sobreposto ao loop — o loop já está pausado quando ele toca", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    const loopEl = elementoDe(COLD_BOLT_CAST)!;
    expect(loopEl.paused).toBe(false);
    aoLiberarCastMultiHit(COLD_BOLT_ID);
    expect(loopEl.paused).toBe(true);
    expect(loopEl.currentTime).toBe(0);
  });
});

describe("Thunder Storm (Ground) — aoConcluirCastDeChao + aoRegistrarAcertoDeChao: sem cast-complete, hit SÓ com acerto real", () => {
  it("conjuração termina e ACERTA: para o loop, hit toca (sem cast-complete, esse estágio não existe pra skill de chão)", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    expect(elementoDe(THUNDER_STORM_CAST)!.paused).toBe(true);
    expect(tocou(THUNDER_STORM_HIT)).toBe(false); // ainda não — só na confirmação
    aoRegistrarAcertoDeChao(THUNDER_STORM_ID);
    expect(tocou(THUNDER_STORM_HIT)).toBe(true);
  });

  it("conjuração termina e NÃO acerta ninguém: para o loop, hit NUNCA toca — silêncio honesto", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    expect(elementoDe(THUNDER_STORM_CAST)!.paused).toBe(true);
    vi.advanceTimersByTime(5000); // nenhum skill:ground-hit nunca chega
    expect(criadas.some((a) => a.src === THUNDER_STORM_HIT)).toBe(false);
  });

  it("Thunder Storm acerta VÁRIAS vezes (HitCount alto): hit.mp3 toca UMA vez só, não uma por acerto", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    aoRegistrarAcertoDeChao(THUNDER_STORM_ID);
    aoRegistrarAcertoDeChao(THUNDER_STORM_ID);
    aoRegistrarAcertoDeChao(THUNDER_STORM_ID);
    expect(playCallsDe(THUNDER_STORM_HIT)).toBe(1);
  });

  it("skill:ground-hit chegando FORA da janela (servidor lento/pacote perdido antes): não toca, já desistiu", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    vi.advanceTimersByTime(301); // passou da janela de 300ms
    aoRegistrarAcertoDeChao(THUNDER_STORM_ID);
    expect(criadas.some((a) => a.src === THUNDER_STORM_HIT)).toBe(false);
  });

  it("acerto de OUTRA skill (aegis diferente) não confunde uma liberação pendente de Thunder Storm", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    aoRegistrarAcertoDeChao(FIRE_BOLT_ID); // aegis diferente, não deveria consumir
    expect(criadas.some((a) => a.src === THUNDER_STORM_HIT)).toBe(false);
    aoRegistrarAcertoDeChao(THUNDER_STORM_ID);
    expect(tocou(THUNDER_STORM_HIT)).toBe(true);
  });

  it("acerto chegando SEM conjuração pendente (borda): não quebra, não toca nada", () => {
    expect(() => aoRegistrarAcertoDeChao(THUNDER_STORM_ID)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });

  it("recast antes do acerto anterior chegar: liberação pendente antiga é descartada, acerto tardio não soa", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    aoComecarCastMultiHit(THUNDER_STORM_ID); // novo cast antes do hit anterior confirmar
    aoRegistrarAcertoDeChao(THUNDER_STORM_ID); // acerto tardio do cast VELHO
    expect(criadas.some((a) => a.src === THUNDER_STORM_HIT)).toBe(false);
  });

  it("skill fora do lookup: aoConcluirCastDeChao não quebra, aoRegistrarAcertoDeChao não toca nada", () => {
    expect(() => aoConcluirCastDeChao(HEAL_ID)).not.toThrow();
    expect(() => aoRegistrarAcertoDeChao(HEAL_ID)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });
});

describe("volume — respeita o SFX global", () => {
  it("loop de cast toca no volume de SFX configurado", () => {
    useAudioSettings.getState().setSfxVolume(0.2);
    aoComecarCastMultiHit(FIRE_BOLT_ID);
    expect(elementoDe(FIRE_BOLT_CAST)!.volume).toBeCloseTo(0.2);
  });

  it("troca de volume nas Configurações aplica no loop TOCANDO agora", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    useAudioSettings.getState().setSfxVolume(0.1);
    expect(elementoDe(COLD_BOLT_CAST)!.volume).toBeCloseTo(0.1);
  });
});
