import { beforeEach, describe, expect, it } from "vitest";

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
  currentTime = 0;
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
const { playOneShot, __resetForTests } = await import("./oneShotPool");

const SOM_A = "/assets/audio/combat/swordman/voice/battle-grunt-2.mp3";
const SOM_B = "/assets/audio/combat/swordman/voice/battle-grunt-11.mp3";

function porSrc(src: string): FakeAudio | undefined {
  return criadas.find((a) => a.src === src);
}

beforeEach(() => {
  criadas = [];
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  __resetForTests();
});

describe("playOneShot", () => {
  it("toca do início, no volume de SFX", () => {
    playOneShot(SOM_A);
    const el = porSrc(SOM_A)!;
    expect(el.playCalls).toBe(1);
    expect(el.paused).toBe(false);
    expect(el.volume).toBeCloseTo(0.55);
  });

  it("reaproveita o MESMO elemento pro mesmo som — nunca `new Audio()` de novo", () => {
    playOneShot(SOM_A);
    playOneShot(SOM_A);
    playOneShot(SOM_A);
    expect(criadas.filter((a) => a.src === SOM_A)).toHaveLength(1);
    expect(porSrc(SOM_A)!.playCalls).toBe(3); // reinicia, mas é a MESMA instância
  });

  it("sons DIFERENTES tocam ao mesmo tempo — não é exclusivo como o loop de passo", () => {
    playOneShot(SOM_A);
    playOneShot(SOM_B);
    expect(porSrc(SOM_A)!.paused).toBe(false);
    expect(porSrc(SOM_B)!.paused).toBe(false);
  });

  it("mudar sfxVolume aplica em todo o pool imediatamente", () => {
    playOneShot(SOM_A);
    playOneShot(SOM_B);
    useAudioSettings.getState().setSfxVolume(0.1);
    expect(porSrc(SOM_A)!.volume).toBeCloseTo(0.1);
    expect(porSrc(SOM_B)!.volume).toBeCloseTo(0.1);
  });
});
