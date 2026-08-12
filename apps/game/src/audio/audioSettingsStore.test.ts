import { beforeEach, describe, expect, it } from "vitest";

/**
 * `persist` (zustand/middleware) precisa de `localStorage` — ambiente de
 * teste roda em Node puro (sem jsdom), mesmo shim mínimo de
 * `hud/skillBarStore.test.ts`.
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
  raw(key: string): string | null {
    return this.getItem(key);
  }
}
const localStorageShim = new LocalStorageShim();
(globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = localStorageShim;

const { useAudioSettings, getMusicVolume, getSfxVolume } = await import("./audioSettingsStore");

beforeEach(() => {
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
});

describe("valores padrão", () => {
  it("nasce com música 0.35 e sfx 0.55 — os mesmos números que já eram constantes fixas antes deste store existir", () => {
    expect(useAudioSettings.getState().musicVolume).toBe(0.35);
    expect(useAudioSettings.getState().sfxVolume).toBe(0.55);
  });
});

describe("setMusicVolume / setSfxVolume", () => {
  it("aceita e reflete um valor no meio da faixa", () => {
    useAudioSettings.getState().setMusicVolume(0.8);
    expect(useAudioSettings.getState().musicVolume).toBe(0.8);
    expect(getMusicVolume()).toBe(0.8);
  });

  it("as duas categorias são independentes — mudar uma não mexe na outra", () => {
    useAudioSettings.getState().setSfxVolume(0.1);
    expect(useAudioSettings.getState().musicVolume).toBe(0.35);
    expect(getSfxVolume()).toBe(0.1);
  });

  it("clampa acima de 1 e abaixo de 0", () => {
    useAudioSettings.getState().setMusicVolume(5);
    expect(useAudioSettings.getState().musicVolume).toBe(1);
    useAudioSettings.getState().setSfxVolume(-2);
    expect(useAudioSettings.getState().sfxVolume).toBe(0);
  });

  it("NaN/valor inválido vira 0, nunca quebra o slider", () => {
    useAudioSettings.getState().setMusicVolume(Number.NaN);
    expect(useAudioSettings.getState().musicVolume).toBe(0);
  });
});

describe("persistência — sobrevive a F5/reload", () => {
  it("grava no localStorage sob a chave central do áudio", () => {
    useAudioSettings.getState().setMusicVolume(0.2);
    useAudioSettings.getState().setSfxVolume(0.9);
    const cru = localStorageShim.raw("ragnarok:audio-settings");
    expect(cru).not.toBeNull();
    const salvo = JSON.parse(cru!);
    expect(salvo.state).toMatchObject({ musicVolume: 0.2, sfxVolume: 0.9 });
  });

  it("o que está salvo é exatamente o que um reload releria (partialize não perde campo)", () => {
    useAudioSettings.getState().setMusicVolume(0.6);
    const salvo = JSON.parse(localStorageShim.raw("ragnarok:audio-settings")!);
    expect(Object.keys(salvo.state).sort()).toEqual(["musicVolume", "sfxVolume"]);
  });
});
