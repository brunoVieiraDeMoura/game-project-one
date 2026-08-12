import { beforeEach, describe, expect, it } from "vitest";

/**
 * `persist` precisa de `localStorage` — Node puro, sem jsdom (mesmo shim de
 * `hud/skillBarStore.test.ts`).
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
}
const localStorageShim = new LocalStorageShim();
(globalThis as unknown as { localStorage: LocalStorageShim }).localStorage = localStorageShim;

/** `<audio>` mínimo — `src` rastreado por contador pra provar "nunca recriado". */
class FakeAudio {
  private _src = "";
  setSrcCalls = 0;
  loop = false;
  volume = 0;
  currentTime = 0;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.setSrcCalls++;
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
const audiosCriados: FakeAudio[] = [];
(globalThis as unknown as { Audio: new () => FakeAudio }).Audio = class extends FakeAudio {
  constructor() {
    super();
    audiosCriados.push(this);
  }
};

/**
 * `requestAnimationFrame`/`performance.now` controlados pelo teste — sem
 * isto, o fade de 700 ms de `mapAmbience` exigiria esperar 700 ms de
 * verdade por caso de teste.
 */
let fakeNow = 0;
(globalThis as unknown as { performance: { now: () => number } }).performance = { now: () => fakeNow };
type RafCb = (t: number) => void;
let rafQueue: RafCb[] = [];
(globalThis as unknown as { requestAnimationFrame: (cb: RafCb) => number }).requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
/** avança o relógio além de qualquer `FADE_MS` e drena a fila até esvaziar */
function completarFade(): void {
  fakeNow += 5000;
  let guard = 0;
  while (rafQueue.length > 0 && guard++ < 50) {
    const fila = rafQueue;
    rafQueue = [];
    fila.forEach((cb) => cb(fakeNow));
  }
}

const { useAudioSettings } = await import("./audioSettingsStore");
const { __test, __resetForTests } = await import("./mapAmbience");

const MUSICA_PRT = "/assets/audio/music/prt_fild08.mp3";
const AMBIENTE_PRT = "/assets/audio/ambient/prt_fild08.mp3";

beforeEach(() => {
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  __resetForTests();
  fakeNow = 0;
  rafQueue = [];
});

describe("entrar no mapa", () => {
  it("carrega a faixa, entra em loop e sobe pro volume de música das configurações", () => {
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    completarFade();
    const el = __test.musica.el as unknown as FakeAudio;
    expect(el.src).toBe(MUSICA_PRT);
    expect(el.loop).toBe(true);
    expect(el.paused).toBe(false);
    expect(el.volume).toBeCloseTo(0.35);
  });

  it("natureza/ambiente sobe pro volume de SFX, não pro de música", () => {
    __test.definirFaixa(__test.ambiente, "prt_fild08", AMBIENTE_PRT);
    completarFade();
    expect((__test.ambiente.el as unknown as FakeAudio).volume).toBeCloseTo(0.55);
  });
});

describe("permanecer no mapa — nunca duplica nem reinicia", () => {
  it("chamar definirFaixa várias vezes com a MESMA faixa não troca `src` de novo", () => {
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    completarFade();
    const el = __test.musica.el as unknown as FakeAudio;
    const chamadasAntes = el.setSrcCalls;
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    completarFade();
    expect(el.setSrcCalls).toBe(chamadasAntes); // nenhuma troca de faixa nova
  });

  it("só existe UM elemento de música e UM de natureza pra sessão inteira — nunca um `new Audio()` por entrada de mapa", () => {
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    __test.definirFaixa(__test.ambiente, "prt_fild08", AMBIENTE_PRT);
    completarFade();
    // os dois canais já existiam antes do 1º teste rodar (módulo importado
    // uma vez só) — `audiosCriados` tem exatamente os 2 do módulo inteiro
    expect(audiosCriados).toHaveLength(2);
  });
});

describe("sair do mapa", () => {
  it("fade-out até 0 e pausa — não fica tocando fora do mapa", () => {
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    completarFade();
    const el = __test.musica.el as unknown as FakeAudio;
    expect(el.paused).toBe(false);

    __test.definirFaixa(__test.musica, undefined, undefined);
    completarFade();
    expect(el.volume).toBeCloseTo(0);
    expect(el.paused).toBe(true);
  });

  it("voltar ao MESMO mapa depois retoma sem recarregar (sem novo `src`)", () => {
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    completarFade();
    const el = __test.musica.el as unknown as FakeAudio;
    el.currentTime = 12.5; // "tocando no meio da faixa"
    const chamadasAntes = el.setSrcCalls;

    __test.definirFaixa(__test.musica, undefined, undefined); // saiu
    completarFade();
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT); // voltou
    completarFade();

    expect(el.setSrcCalls).toBe(chamadasAntes); // mesma faixa, nunca recarregada
    expect(el.currentTime).toBe(12.5); // não voltou pro início
    expect(el.paused).toBe(false);
    expect(el.volume).toBeCloseTo(0.35);
  });
});

describe("volume — aplica imediatamente, sem reload", () => {
  it("mudar musicVolume enquanto a música toca atualiza o volume NA HORA (sem esperar o próximo fade)", () => {
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    completarFade();
    const el = __test.musica.el as unknown as FakeAudio;
    expect(el.volume).toBeCloseTo(0.35);

    useAudioSettings.getState().setMusicVolume(0.9);
    expect(el.volume).toBeCloseTo(0.9); // sem chamar completarFade — é síncrono
  });

  it("mudar sfxVolume atualiza a natureza tocando, não a música", () => {
    __test.definirFaixa(__test.musica, "prt_fild08", MUSICA_PRT);
    __test.definirFaixa(__test.ambiente, "prt_fild08", AMBIENTE_PRT);
    completarFade();
    const musicaEl = __test.musica.el as unknown as FakeAudio;
    const ambienteEl = __test.ambiente.el as unknown as FakeAudio;

    useAudioSettings.getState().setSfxVolume(0.05);
    expect(ambienteEl.volume).toBeCloseTo(0.05);
    expect(musicaEl.volume).toBeCloseTo(0.35); // música não mexeu
  });
});
