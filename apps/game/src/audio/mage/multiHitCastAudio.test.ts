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
 * canal de `cast` é um LOOP (`el.loop = true`), não um one-shot. */
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
  aoImpactoMultiHit,
  __resetForTests: resetLoop,
} = await import("./multiHitCastAudio");

const BASE = "/assets/audio/combat/mage/skills";
const COLD_BOLT_CAST = `${BASE}/cold-bolt/cast.mp3`;
const COLD_BOLT_HIT = `${BASE}/cold-bolt/hit.mp3`;

const FIRE_BOLT_CAST = `${BASE}/fire-bolt/cast.mp3`;
const FIRE_BOLT_HIT = `${BASE}/fire-bolt/hit.mp3`;

const THUNDER_STORM_CAST = `${BASE}/thunder-storm/cast.mp3`;
const THUNDER_STORM_HIT = `${BASE}/thunder-storm/hit.mp3`;

const LIGHT_BOLT_CAST = `${BASE}/light-bolt/cast.mp3`;
const LIGHT_BOLT_HIT = `${BASE}/light-bolt/hit.mp3`;

const SOUL_STRIKE_HIT = `${BASE}/soul-strike/hit.mp3`;

const COLD_BOLT_ID = 14;
const FIRE_BOLT_ID = 19;
const THUNDER_STORM_ID = 21;
const LIGHT_BOLT_ID = 20;
const SOUL_STRIKE_ID = 13;
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
        hitType: "multi_hit",
        target: "enemy",
        areaRadius: 0,
        maxLevel: 10,
        type: "damage",
        element: "water",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
        durationMs: 0,
        duration2Ms: 0,
      },
      [FIRE_BOLT_ID]: {
        id: FIRE_BOLT_ID,
        aegisName: "MG_FIREBOLT",
        name: "Fire Bolt",
        hitType: "multi_hit",
        target: "enemy",
        areaRadius: 0,
        maxLevel: 10,
        type: "damage",
        element: "fire",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
        durationMs: 0,
        duration2Ms: 0,
      },
      [THUNDER_STORM_ID]: {
        id: THUNDER_STORM_ID,
        aegisName: "MG_THUNDERSTORM",
        name: "Thunderstorm",
        hitType: "multi_hit",
        target: "enemy",
        areaRadius: 2,
        maxLevel: 10,
        type: "area",
        element: "wind",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
        durationMs: 0,
        duration2Ms: 0,
      },
      [LIGHT_BOLT_ID]: {
        id: LIGHT_BOLT_ID,
        aegisName: "MG_LIGHTNINGBOLT",
        name: "Lightning Bolt",
        hitType: "multi_hit",
        target: "enemy",
        areaRadius: 0,
        maxLevel: 10,
        type: "damage",
        element: "wind",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
        durationMs: 0,
        duration2Ms: 0,
      },
      [SOUL_STRIKE_ID]: {
        id: SOUL_STRIKE_ID,
        aegisName: "MG_SOULSTRIKE",
        name: "Soul Strike",
        hitType: "multi_hit",
        target: "enemy",
        areaRadius: 0,
        maxLevel: 10,
        type: "damage",
        element: "ghost",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
        durationMs: 0,
        duration2Ms: 0,
      },
      [HEAL_ID]: {
        id: HEAL_ID,
        aegisName: "AL_HEAL",
        name: "Heal",
        hitType: "normal",
        target: "self",
        areaRadius: 0,
        maxLevel: 10,
        type: "support",
        element: "holy",
        spCost: 0,
        range: 9,
        cooldownMs: 0,
        durationMs: 0,
        duration2Ms: 0,
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

  it("Light Bolt: toca cast.mp3 do Light Bolt em loop", () => {
    aoComecarCastMultiHit(LIGHT_BOLT_ID);
    expect(tocou(LIGHT_BOLT_CAST)).toBe(true);
    expect(elementoDe(LIGHT_BOLT_CAST)!.loop).toBe(true);
  });

  it("Soul Strike: sem arquivo de cast no SFX real — não toca nada, não quebra", () => {
    expect(() => aoComecarCastMultiHit(SOUL_STRIKE_ID)).not.toThrow();
    expect(criadas).toHaveLength(0);
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

  it("Soul Strike (sem cast) também para um loop anterior pendurado", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    aoComecarCastMultiHit(SOUL_STRIKE_ID);
    expect(elementoDe(COLD_BOLT_CAST)!.paused).toBe(true);
  });
});

describe("aoLiberarCastMultiHit — SÓ skills de ALVO com cast (Cold Bolt/Fire Bolt/Light Bolt): só para o loop, sem cast-complete (removido do fluxo). Impacto NÃO mora mais aqui.", () => {
  it("Cold Bolt: para o loop de cast, não toca NENHUM som (cast → hit direto), e NÃO agenda hit nenhum (isso agora é aoImpactoMultiHit)", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    criadas = []; // só interessa o que aoLiberarCastMultiHit faz a partir daqui
    aoLiberarCastMultiHit(COLD_BOLT_ID, true);
    expect(criadas).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    // nenhum hit-lvl-*.mp3 deveria ter tocado sozinho
    expect(criadas.some((a) => a.src.includes("hit.mp3"))).toBe(false);
  });

  it("Fire Bolt: mesma cadência — só para o loop, nenhum som novo", () => {
    aoComecarCastMultiHit(FIRE_BOLT_ID);
    const loopEl = elementoDe(FIRE_BOLT_CAST)!;
    aoLiberarCastMultiHit(FIRE_BOLT_ID, true);
    expect(loopEl.paused).toBe(true);
  });

  it("Light Bolt: mesma cadência (single target, mesmo grupo de Cold Bolt/Fire Bolt)", () => {
    aoComecarCastMultiHit(LIGHT_BOLT_ID);
    const loopEl = elementoDe(LIGHT_BOLT_CAST)!;
    aoLiberarCastMultiHit(LIGHT_BOLT_ID, true);
    expect(loopEl.paused).toBe(true);
  });

  it("Thunder Storm (chão): não toca nada aqui — o loop já parou em aoConcluirCastDeChao", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    criadas = []; // só interessa o que aoLiberarCastMultiHit faz a partir daqui
    expect(() => aoLiberarCastMultiHit(THUNDER_STORM_ID, false)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });

  it("Soul Strike (sem cast): não toca nada", () => {
    expect(() => aoLiberarCastMultiHit(SOUL_STRIKE_ID, true)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });

  it("libera sem ter começado (borda): não quebra, não toca nada", () => {
    expect(() => aoLiberarCastMultiHit(HEAL_ID, true)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });

  it("Cold Bolt: o loop para de verdade (rebobina) na liberação", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    const loopEl = elementoDe(COLD_BOLT_CAST)!;
    expect(loopEl.paused).toBe(false);
    aoLiberarCastMultiHit(COLD_BOLT_ID, true);
    expect(loopEl.paused).toBe(true);
    expect(loopEl.currentTime).toBe(0);
  });

  it("Cold Bolt com souEu=false (skill:cast de OUTRO jogador perto): NÃO mexe no NOSSO loop — sourceGid é confiável pra skill de alvo, o gate tem que valer", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID); // nosso próprio loop, se houver
    aoLiberarCastMultiHit(COLD_BOLT_ID, false); // Cold Bolt de outro personagem
    // o NOSSO loop não foi mexido por um evento que não é nosso
    expect(elementoDe(COLD_BOLT_CAST)!.paused).toBe(false);
  });
});

describe("aoConcluirCastDeChao (skill:ground-cast, só Thunder Storm) — só para o loop, nunca toca hit", () => {
  it("para o loop de cast", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    expect(elementoDe(THUNDER_STORM_CAST)!.paused).toBe(true);
    expect(criadas.some((a) => a.src.includes("hit.mp3"))).toBe(false);
  });

  it("skill fora do lookup: não quebra", () => {
    expect(() => aoConcluirCastDeChao(HEAL_ID)).not.toThrow();
  });
});

describe("aoImpactoMultiHit — o som de CADA hit real, chamado do onHit do VFX (nunca de timer)", () => {
  it("1 hit: chamar 1 vez toca hit.mp3 1 vez", () => {
    aoImpactoMultiHit(COLD_BOLT_ID);
    expect(playCallsDe(COLD_BOLT_HIT)).toBe(1);
  });

  it("3 hits reais: chamar 3 vezes (uma por onHit real) toca hit.mp3 3 vezes, nunca 1 vez só", () => {
    aoImpactoMultiHit(COLD_BOLT_ID);
    aoImpactoMultiHit(COLD_BOLT_ID);
    aoImpactoMultiHit(COLD_BOLT_ID);
    expect(playCallsDe(COLD_BOLT_HIT)).toBe(3);
  });

  it("10 hits reais (nível 10): 10 chamadas tocam hit.mp3 10 vezes", () => {
    for (let i = 0; i < 10; i++) aoImpactoMultiHit(FIRE_BOLT_ID);
    expect(playCallsDe(FIRE_BOLT_HIT)).toBe(10);
  });

  it("Fire Bolt e Cold Bolt nunca se cruzam — cada um só toca o próprio arquivo", () => {
    aoImpactoMultiHit(COLD_BOLT_ID);
    aoImpactoMultiHit(FIRE_BOLT_ID);
    expect(playCallsDe(COLD_BOLT_HIT)).toBe(1);
    expect(playCallsDe(FIRE_BOLT_HIT)).toBe(1);
  });

  it("Thunder Storm: mesmo arquivo fixo que as outras (aoImpactoMultiHit não distingue alvo×chão)", () => {
    aoImpactoMultiHit(THUNDER_STORM_ID);
    expect(playCallsDe(THUNDER_STORM_HIT)).toBe(1);
  });

  it("Light Bolt: resolve pro próprio arquivo", () => {
    aoImpactoMultiHit(LIGHT_BOLT_ID);
    expect(playCallsDe(LIGHT_BOLT_HIT)).toBe(1);
  });

  it("Soul Strike: resolve pro próprio arquivo mesmo sem cast", () => {
    aoImpactoMultiHit(SOUL_STRIKE_ID);
    expect(playCallsDe(SOUL_STRIKE_HIT)).toBe(1);
  });

  it("chamada rápida seguinte REINICIA o mesmo elemento (playOneShot) — golpe anterior é cortado", () => {
    aoImpactoMultiHit(COLD_BOLT_ID);
    const el = elementoDe(COLD_BOLT_HIT)!;
    el.currentTime = 0.2; // "tocando" quando o próximo golpe chega
    aoImpactoMultiHit(COLD_BOLT_ID);
    expect(el.currentTime).toBe(0);
    expect(el.playCalls).toBe(2);
  });

  it("skill fora do lookup: silêncio, não quebra", () => {
    expect(() => aoImpactoMultiHit(HEAL_ID)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });

  it("skill desconhecida do catálogo: silêncio, não quebra", () => {
    expect(() => aoImpactoMultiHit(999)).not.toThrow();
    expect(criadas).toHaveLength(0);
  });
});

describe("fluxo completo — cast + N impactos reais, por skill", () => {
  it("Cold Bolt nível baixo (1 hit): cast, libera (só para o loop, sem cast-complete), 1 impacto", () => {
    aoComecarCastMultiHit(COLD_BOLT_ID);
    const loopEl = elementoDe(COLD_BOLT_CAST)!;
    aoLiberarCastMultiHit(COLD_BOLT_ID, true);
    aoImpactoMultiHit(COLD_BOLT_ID);
    expect(loopEl.paused).toBe(true);
    expect(playCallsDe(COLD_BOLT_HIT)).toBe(1);
  });

  it("Thunder Storm nível máximo (10 hits AoE): cast, ground-cast, 10 impactos — nunca um som só, cada pulso toca o próprio golpe", () => {
    aoComecarCastMultiHit(THUNDER_STORM_ID);
    aoConcluirCastDeChao(THUNDER_STORM_ID);
    for (let i = 0; i < 10; i++) aoImpactoMultiHit(THUNDER_STORM_ID);
    expect(playCallsDe(THUNDER_STORM_CAST)).toBe(1); // loop tocou 1 vez só
    expect(playCallsDe(THUNDER_STORM_HIT)).toBe(10);
  });

  it("Soul Strike nível 8 (4 almas): 4 impactos espirituais, sem cast", () => {
    for (let i = 0; i < 4; i++) aoImpactoMultiHit(SOUL_STRIKE_ID);
    expect(playCallsDe(SOUL_STRIKE_HIT)).toBe(4);
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
