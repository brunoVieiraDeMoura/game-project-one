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

class FakeAudio {
  src: string;
  volume = 1;
  paused = true;
  playCalls = 0;
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
    this.paused = true;
  }
}
let criadas: FakeAudio[] = [];
(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;

const { useAudioSettings } = await import("./audioSettingsStore");
const { __resetForTests: resetPool } = await import("./oneShotPool");
const { useSkillCatalog } = await import("../net/skillCatalog");
const { aoComecarCastDeColdBolt, aoLiberarCastDeColdBolt } = await import("./coldBoltCast");

const CAST = "/assets/audio/combat/mage/skills/cold-bolt/cast.mp3";
const CAST_COMPLETE = "/assets/audio/combat/mage/skills/cold-bolt/cast-complete.mp3";
const HIT = "/assets/audio/combat/mage/skills/cold-bolt/hit.mp3";

const COLD_BOLT_ID = 14;
const FIRE_BOLT_ID = 15;

function tocou(src: string): boolean {
  return criadas.some((a) => a.src === src && a.playCalls > 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  criadas = [];
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  resetPool();
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
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("aoComecarCastDeColdBolt — início da conjuração", () => {
  it("Cold Bolt: toca cast.mp3", () => {
    aoComecarCastDeColdBolt(COLD_BOLT_ID);
    expect(tocou(CAST)).toBe(true);
  });

  it("outra skill (Fire Bolt): não toca nada", () => {
    aoComecarCastDeColdBolt(FIRE_BOLT_ID);
    expect(criadas).toHaveLength(0);
  });

  it("skill desconhecida do catálogo: não toca nada, não quebra", () => {
    aoComecarCastDeColdBolt(999);
    expect(criadas).toHaveLength(0);
  });
});

describe("aoLiberarCastDeColdBolt — fim da conjuração + impacto 500ms depois", () => {
  it("Cold Bolt: toca cast-complete.mp3 imediatamente", () => {
    aoLiberarCastDeColdBolt(COLD_BOLT_ID);
    expect(tocou(CAST_COMPLETE)).toBe(true);
    expect(tocou(HIT)).toBe(false);
  });

  it("Cold Bolt: hit.mp3 toca só depois de 500ms, não antes", () => {
    aoLiberarCastDeColdBolt(COLD_BOLT_ID);
    vi.advanceTimersByTime(499);
    expect(tocou(HIT)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tocou(HIT)).toBe(true);
  });

  it("outra skill (Fire Bolt): não toca nada, nem agenda hit", () => {
    aoLiberarCastDeColdBolt(FIRE_BOLT_ID);
    vi.advanceTimersByTime(1000);
    expect(criadas).toHaveLength(0);
  });
});

describe("volume — respeita o SFX global", () => {
  it("cast.mp3 toca no volume de SFX configurado", () => {
    useAudioSettings.getState().setSfxVolume(0.2);
    aoComecarCastDeColdBolt(COLD_BOLT_ID);
    expect(criadas.find((a) => a.src === CAST)!.volume).toBeCloseTo(0.2);
  });
});
