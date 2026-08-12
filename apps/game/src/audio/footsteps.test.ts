import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import type { LegacyMapping } from "../net/legacyCells";

/**
 * `persist` (zustand/middleware, usado por `audioSettingsStore` que
 * `footsteps.ts` importa) precisa de `localStorage` — Node puro, sem jsdom,
 * mesmo shim de `hud/skillBarStore.test.ts`.
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

/**
 * `HTMLAudioElement` não existe em Node puro — um `Audio` mínimo o bastante
 * pra `footsteps.ts` funcionar: `src`/`loop`/`volume`/`currentTime`, `play()`
 * (resolve, marca `paused=false`) e `pause()` (`paused=true`). Cada instância
 * fica em `criadas[]` pra teste inspecionar QUANTAS foram feitas — é o que
 * prova "pool reaproveitado", não instância nova por passo.
 */
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

const { useAudioSettings } = await import("./audioSettingsStore");
const { surfaceAt, footstepFrame, __resetForTests } = await import("./footsteps");

/** mapa 2×2 mínimo — só o que `surfaceAt`/`footstepFrame` leem */
function mapaFake(collision: string[], surface: string[] = []): GameMap {
  return {
    size: { width: 2, height: collision.length / 2 },
    collision,
    surface,
    heightmap: collision.map(() => 0),
  } as unknown as GameMap;
}

/** janela local = servidor (origin 0,0) — mesma identidade de `prt_fild08` sem crop */
const mapping: LegacyMapping = { mapName: "teste", originX: 0, originY: 0, width: 2, height: 2 };

function porSrc(src: string): FakeAudio | undefined {
  return criadas.find((a) => a.src === src);
}

const GRAMA = "/assets/audio/footsteps/grama-run-walk.mp3";
const TERRA = "/assets/audio/footsteps/terra-running-walk.mp3";
const AGUA = "/assets/audio/footsteps/water-running-walk.mp3";

beforeEach(() => {
  criadas = [];
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  // `pool`/`tocando` de `footsteps.ts` são módulo-singleton — sem zerar o
  // pool aqui, o `<audio>` de GRAMA do teste anterior sobreviveria e os
  // `playCalls` deste teste começariam contando do teste passado.
  __resetForTests();
});

describe("surfaceAt", () => {
  it("sem superfície autorada, colisão walkable vira grass (mapa recém-importado do rAthena)", () => {
    const map = mapaFake(["walkable", "walkable"], []);
    expect(surfaceAt(map, 0)).toBe("grass");
  });

  it("sem superfície autorada, colisão water vira water", () => {
    const map = mapaFake(["walkable", "water"], []);
    expect(surfaceAt(map, 1)).toBe("water");
  });

  it("sem superfície autorada, colisão cliff vira dirt", () => {
    const map = mapaFake(["cliff", "walkable"], []);
    expect(surfaceAt(map, 0)).toBe("dirt");
  });

  it("superfície autorada manda, menos quando é 'grass' (valor de preenchimento)", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"], ["stone", "sand", "snow", "grass"]);
    expect(surfaceAt(map, 0)).toBe("stone");
    expect(surfaceAt(map, 1)).toBe("sand");
    expect(surfaceAt(map, 2)).toBe("snow");
    expect(surfaceAt(map, 3)).toBe("grass");
  });

  it("rio autorado vira river, não water genérico", () => {
    const map = mapaFake(["walkable"], ["river"]);
    expect(surfaceAt(map, 0)).toBe("river");
  });

  it("água autorada sem colisão water ainda conta como água (ehCelulaDeAgua)", () => {
    const map = mapaFake(["walkable"], ["water"]);
    expect(surfaceAt(map, 0)).toBe("water");
  });
});

describe("footstepFrame — loop contínuo, não um disparo por célula", () => {
  it("começou a andar: toca IMEDIATAMENTE o loop da superfície atual", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"]); // tudo grass
    footstepFrame(true, map, mapping, 0, 0);
    const el = porSrc(GRAMA);
    expect(el).toBeDefined();
    expect(el!.loop).toBe(true);
    expect(el!.paused).toBe(false);
    expect(el!.playCalls).toBe(1);
  });

  it("continua andando na mesma superfície, mesmo cruzando célula: NÃO cria nova instância nem reinicia", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"]);
    footstepFrame(true, map, mapping, 0, 0);
    const el = porSrc(GRAMA)!;
    el.currentTime = 3.2; // "tempo decorrido" de um loop de verdade

    // cruza pra outra célula, mesma superfície (grass em todo o mapa)
    footstepFrame(true, map, mapping, 1, 1);
    footstepFrame(true, map, mapping, 0, 1);

    expect(criadas.filter((a) => a.src === GRAMA)).toHaveLength(1); // só UMA instância
    expect(el.playCalls).toBe(1); // play() não foi chamado de novo
    expect(el.currentTime).toBe(3.2); // não reiniciou (currentTime não foi zerado)
  });

  it("chamar footstepFrame todo quadro (sem mudar célula/superfície) não faz nada de novo", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"]);
    footstepFrame(true, map, mapping, 0, 0);
    for (let i = 0; i < 30; i++) footstepFrame(true, map, mapping, 0, 0); // ~30 "quadros"
    const el = porSrc(GRAMA)!;
    expect(el.playCalls).toBe(1);
    expect(el.pauseCalls).toBe(0);
  });

  it("parou de andar: interrompe IMEDIATAMENTE (pause), não espera o áudio acabar", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"]);
    footstepFrame(true, map, mapping, 0, 0);
    const el = porSrc(GRAMA)!;
    footstepFrame(false, map, mapping, 0, 0);
    expect(el.paused).toBe(true);
    expect(el.pauseCalls).toBe(1);
  });

  it("parou: reseta currentTime — o próximo passo (mesma superfície) toca do início, não do meio", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"]);
    footstepFrame(true, map, mapping, 0, 0);
    const el = porSrc(GRAMA)!;
    el.currentTime = 1.8;
    footstepFrame(false, map, mapping, 0, 0);
    expect(el.currentTime).toBe(0);
  });

  it("voltar a andar depois de parar: toca de novo (nova chamada de play, mesma instância reaproveitada)", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"]);
    footstepFrame(true, map, mapping, 0, 0);
    footstepFrame(false, map, mapping, 0, 0);
    footstepFrame(true, map, mapping, 0, 0);
    const el = porSrc(GRAMA)!;
    expect(criadas.filter((a) => a.src === GRAMA)).toHaveLength(1); // mesma instância, não uma nova
    expect(el.paused).toBe(false);
    expect(el.playCalls).toBe(2);
  });

  it("mudou de superfície andando (grama → terra): troca o loop sem os dois tocando juntos", () => {
    // coluna 0 = grass (walkable), coluna 1 = dirt (cliff)
    const map = mapaFake(["walkable", "cliff", "walkable", "cliff"]);
    footstepFrame(true, map, mapping, 0, 0); // (0,0) col par → grass
    const grama = porSrc(GRAMA)!;
    expect(grama.paused).toBe(false);

    footstepFrame(true, map, mapping, 1, 0); // (1,0) col ímpar → cliff → dirt
    const terra = porSrc(TERRA)!;

    expect(grama.paused).toBe(true); // o antigo parou
    expect(terra.paused).toBe(false); // o novo toca
    expect(criadas.filter((a) => !a.paused)).toHaveLength(1); // nunca dois tocando ao mesmo tempo
  });

  it("grama → terra → pedra: cada troca usa o som certo, uma superfície de cada vez", () => {
    const grama = mapaFake(["walkable", "walkable", "walkable", "walkable"]);
    const terra = mapaFake(["cliff", "cliff", "cliff", "cliff"]);
    const pedra = mapaFake(["walkable", "walkable", "walkable", "walkable"], ["stone", "stone", "stone", "stone"]);

    footstepFrame(true, grama, mapping, 0, 0);
    expect(porSrc(GRAMA)!.paused).toBe(false);

    footstepFrame(true, terra, mapping, 0, 0);
    expect(porSrc(GRAMA)!.paused).toBe(true);
    expect(porSrc(TERRA)!.paused).toBe(false);

    footstepFrame(true, pedra, mapping, 0, 0);
    expect(porSrc(TERRA)!.paused).toBe(true);
    expect(porSrc("/assets/audio/footsteps/concrete-floor-running-walk.mp3")!.paused).toBe(false);

    expect(criadas.filter((a) => !a.paused)).toHaveLength(1);
  });

  it("célula de água: usa o loop de água, não o de grama", () => {
    const map = mapaFake(["water", "water", "water", "water"]);
    footstepFrame(true, map, mapping, 0, 0);
    expect(porSrc(AGUA)!.paused).toBe(false);
  });
});

describe("volume ao vivo — SFX", () => {
  it("mudar sfxVolume enquanto o passo toca aplica no loop ATUAL, sem esperar trocar de superfície", () => {
    const map = mapaFake(["walkable", "walkable", "walkable", "walkable"]);
    footstepFrame(true, map, mapping, 0, 0);
    const el = porSrc(GRAMA)!;
    expect(el.volume).toBeCloseTo(0.55);

    useAudioSettings.getState().setSfxVolume(0.1);
    expect(el.volume).toBeCloseTo(0.1);
  });

  it("mudar sfxVolume sem nenhum passo tocando não cria/mexe em elemento nenhum", () => {
    useAudioSettings.getState().setSfxVolume(0.9);
    expect(criadas).toHaveLength(0);
  });
});
