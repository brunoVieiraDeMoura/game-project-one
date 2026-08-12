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
const { usePlayerStore } = await import("../net/playerStore");
const { vozDeAtaque, vozDeDano, vozDePulo, vozDeConjuracao, __resetForTests: resetVoice } = await import("./combatVoice");

const GRUNT_2 = "/assets/audio/combat/swordman/voice/battle-grunt-2.mp3";
const GRUNT_11 = "/assets/audio/combat/swordman/voice/battle-grunt-11.mp3";
const DAMAGE_3 = "/assets/audio/combat/swordman/voice/damage-grunt-3.mp3";
const DAMAGE_14 = "/assets/audio/combat/swordman/voice/damage-grunt-14.mp3";
const DEATH = "/assets/audio/combat/swordman/voice/death-1.mp3";
const JUMP = "/assets/audio/combat/swordman/voice/jump-1.mp3";

const ARCHER_DAMAGE_3 = "/assets/audio/combat/archer/voice/damage-grunt-3.mp3";
const ARCHER_DAMAGE_14 = "/assets/audio/combat/archer/voice/damage-grunt-14.mp3";
const ARCHER_DEATH = "/assets/audio/combat/archer/voice/death-1.mp3";
const ARCHER_JUMP = "/assets/audio/combat/archer/voice/jump-1.mp3";

const MAGE_ATTACK_1 = "/assets/audio/combat/mage/voice/attack-1.mp3";
const MAGE_ATTACK_2 = "/assets/audio/combat/mage/voice/attack-2.mp3";
const MAGE_DAMAGE_1 = "/assets/audio/combat/mage/voice/damage-1.mp3";
const MAGE_DAMAGE_2 = "/assets/audio/combat/mage/voice/damage-2.mp3";
const MAGE_JUMP = "/assets/audio/combat/mage/voice/jump-1.mp3";
const MAGE_SPELL_CAST = "/assets/audio/combat/mage/voice/spell-cast.mp3";

/** ids reais de `job-classes.json`, mesmos de `entities/classModels.test.ts` */
const KNIGHT = 7; // evolução do Espadachim (1)
const HUNTER = 11; // evolução do Arqueiro (3)
const WIZARD = 9; // evolução do Mago (2)
const THIEF = 6; // não está registrado em nenhuma classe deste módulo — silêncio genuíno

function tocou(src: string): boolean {
  return criadas.some((a) => a.src === src && a.playCalls > 0);
}

function playCallsDe(src: string): number {
  return criadas.filter((a) => a.src === src).reduce((n, a) => n + a.playCalls, 0);
}

function comoEspadachim(hp = 100, maxHp = 100): void {
  usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: KNIGHT, hp, maxHp } }));
}
function comoOutraClasse(): void {
  usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: THIEF, hp: 100, maxHp: 100 } }));
}
function comoMago(hp = 100, maxHp = 100): void {
  usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: WIZARD, hp, maxHp } }));
}

beforeEach(() => {
  criadas = [];
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  resetPool();
  resetVoice();
  usePlayerStore.getState().reset();
});

describe("restrição de classe", () => {
  it("Espadachim (id base 1 via evolução Knight/7): voz de ataque toca", () => {
    comoEspadachim();
    vozDeAtaque();
    expect(tocou(GRUNT_2)).toBe(true);
  });

  it("evolução (Knight, 7) conta como Espadachim — não só o job base", () => {
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: 7 } }));
    vozDeAtaque();
    expect(tocou(GRUNT_2)).toBe(true);
  });

  it("classe que NÃO é Espadachim (Thief, sem entrada neste módulo): nenhum som toca", () => {
    comoOutraClasse();
    vozDeAtaque();
    vozDeDano();
    vozDePulo();
    expect(criadas).toHaveLength(0);
  });
});

describe("ataque básico — alternância determinística (nunca aleatória)", () => {
  it("primeiro ataque toca Battle_Grunt2", () => {
    comoEspadachim();
    vozDeAtaque();
    expect(tocou(GRUNT_2)).toBe(true);
    expect(tocou(GRUNT_11)).toBe(false);
  });

  it("alterna 2 → 11 → 2 → 11, sempre na mesma ordem", () => {
    comoEspadachim();
    vozDeAtaque();
    vozDeAtaque();
    vozDeAtaque();
    vozDeAtaque();
    expect(playCallsDe(GRUNT_2)).toBe(2);
    expect(playCallsDe(GRUNT_11)).toBe(2);
  });
});

describe("dano recebido — alternância", () => {
  it("alterna Damage_Grunt3 → Damage_Grunt14", () => {
    comoEspadachim();
    vozDeDano();
    vozDeDano();
    expect(playCallsDe(DAMAGE_3)).toBe(1);
    expect(playCallsDe(DAMAGE_14)).toBe(1);
  });
});

describe("morte — evento real (borda hp>0 → hp<=0), não render", () => {
  it("hp indo de 100 pra 0 toca Death 1 exatamente uma vez", () => {
    comoEspadachim(100, 100);
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 0 } }));
    expect(playCallsDe(DEATH)).toBe(1);
  });

  it("permanecer em 0 (outras mudanças de stat) NÃO repete a morte", () => {
    comoEspadachim(100, 100);
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 0 } }));
    // outra mudança qualquer no store, hp continua 0
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, sp: 5 } }));
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, sp: 6 } }));
    expect(playCallsDe(DEATH)).toBe(1);
  });

  it("reviver (hp volta a > 0) e morrer de novo toca Death 1 outra vez", () => {
    comoEspadachim(100, 100);
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 0 } }));
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 50 } })); // reviveu
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 0 } })); // morreu de novo
    expect(playCallsDe(DEATH)).toBe(2);
  });

  it("classe que não é Espadachim: hp indo a 0 não toca nada", () => {
    comoOutraClasse();
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 0 } }));
    expect(criadas).toHaveLength(0);
  });
});

describe("pulo", () => {
  it("Espadachim: chamar vozDePulo toca Jump 1", () => {
    comoEspadachim();
    vozDePulo();
    expect(tocou(JUMP)).toBe(true);
  });
});

describe("volume — respeita o SFX global", () => {
  it("voz de combate toca no volume de SFX configurado", () => {
    comoEspadachim();
    useAudioSettings.getState().setSfxVolume(0.2);
    vozDeAtaque();
    expect(criadas.find((a) => a.src === GRUNT_2)!.volume).toBeCloseTo(0.2);
  });
});

describe("Arqueiro — sem voz de ataque neste lote de assets", () => {
  function comoArqueiro(hp = 100, maxHp = 100): void {
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: HUNTER, hp, maxHp } }));
  }

  it("Arqueiro (evolução Hunter/11): vozDeAtaque NÃO toca nada (sem asset de golpe básico)", () => {
    comoArqueiro();
    vozDeAtaque();
    expect(criadas).toHaveLength(0);
  });

  it("dano recebido alterna Damage_Grunt3 → Damage_Grunt14 do ARQUEIRO, não do Espadachim", () => {
    comoArqueiro();
    vozDeDano();
    vozDeDano();
    expect(playCallsDe(ARCHER_DAMAGE_3)).toBe(1);
    expect(playCallsDe(ARCHER_DAMAGE_14)).toBe(1);
    expect(playCallsDe(DAMAGE_3)).toBe(0);
    expect(playCallsDe(DAMAGE_14)).toBe(0);
  });

  it("morte toca o Death 1 do Arqueiro, uma vez", () => {
    comoArqueiro(100, 100);
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 0 } }));
    expect(playCallsDe(ARCHER_DEATH)).toBe(1);
    expect(playCallsDe(DEATH)).toBe(0);
  });

  it("pulo toca o Jump 1 do Arqueiro", () => {
    comoArqueiro();
    vozDePulo();
    expect(tocou(ARCHER_JUMP)).toBe(true);
    expect(tocou(JUMP)).toBe(false);
  });

  it("job base Archer (3) também conta, não só a evolução", () => {
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: 3 } }));
    vozDeDano();
    expect(playCallsDe(ARCHER_DAMAGE_3)).toBe(1);
  });
});

describe("Mago — voz feminina, ataque/dano alternados, sem morte neste lote", () => {
  it("primeiro ataque toca attack-1, alterna com attack-2", () => {
    comoMago();
    vozDeAtaque();
    expect(tocou(MAGE_ATTACK_1)).toBe(true);
    expect(tocou(MAGE_ATTACK_2)).toBe(false);
    vozDeAtaque();
    expect(playCallsDe(MAGE_ATTACK_1)).toBe(1);
    expect(playCallsDe(MAGE_ATTACK_2)).toBe(1);
  });

  it("dano recebido alterna damage-1 → damage-2, não os do Espadachim/Arqueiro", () => {
    comoMago();
    vozDeDano();
    vozDeDano();
    expect(playCallsDe(MAGE_DAMAGE_1)).toBe(1);
    expect(playCallsDe(MAGE_DAMAGE_2)).toBe(1);
    expect(playCallsDe(DAMAGE_3)).toBe(0);
    expect(playCallsDe(ARCHER_DAMAGE_3)).toBe(0);
  });

  it("pulo toca o Jump do Mago", () => {
    comoMago();
    vozDePulo();
    expect(tocou(MAGE_JUMP)).toBe(true);
  });

  it("hp indo a 0 NÃO toca nada — pacote de voz do Mago não trouxe som de morte", () => {
    comoMago(100, 100);
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, hp: 0 } }));
    expect(playCallsDe(DEATH)).toBe(0);
    expect(playCallsDe(ARCHER_DEATH)).toBe(0);
  });

  it("job base Mage (2) também conta, não só a evolução (Wizard)", () => {
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: 2 } }));
    vozDeAtaque();
    expect(tocou(MAGE_ATTACK_1)).toBe(true);
  });
});

describe("vozDeConjuracao — grito de qualquer skill, não só ataque básico", () => {
  it("Mago: toca spell-cast", () => {
    comoMago();
    vozDeConjuracao();
    expect(tocou(MAGE_SPELL_CAST)).toBe(true);
  });

  it("Espadachim: sem asset de conjuração configurado, não toca nada", () => {
    comoEspadachim();
    vozDeConjuracao();
    expect(criadas).toHaveLength(0);
  });

  it("classe sem entrada neste módulo: não toca nada", () => {
    comoOutraClasse();
    vozDeConjuracao();
    expect(criadas).toHaveLength(0);
  });
});

describe("duas classes registradas não vazam uma pra outra", () => {
  it("alternância de ataque do Espadachim não é afetada por chamadas do Arqueiro (contadores por classe)", () => {
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: KNIGHT, hp: 100, maxHp: 100 } }));
    vozDeAtaque(); // Grunt2, contador do Espadachim avança
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: HUNTER } }));
    vozDeDano(); // Arqueiro — não deveria mexer no contador de ATAQUE do Espadachim
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: KNIGHT } }));
    vozDeAtaque(); // deveria ser Grunt11 (segunda chamada do Espadachim)
    expect(playCallsDe(GRUNT_2)).toBe(1);
    expect(playCallsDe(GRUNT_11)).toBe(1);
  });
});

describe("re-render não dispara áudio de novo", () => {
  it("chamar as funções várias vezes SEM evento novo não é o caso — mas religar o módulo (import) não duplica estado: a alternância sobrevive entre chamadas isoladas", () => {
    comoEspadachim();
    vozDeAtaque(); // Grunt2
    // simula um "re-render" que não re-executa o evento de jogo — ou seja,
    // simplesmente não chama vozDeAtaque de novo. O ponto é que NENHUM efeito
    // colateral de render (um useEffect rodando de novo, por exemplo) chamaria
    // isto sozinho: as funções só tocam quando ALGUÉM as chama explicitamente.
    expect(playCallsDe(GRUNT_2)).toBe(1);
    expect(playCallsDe(GRUNT_11)).toBe(0);
  });
});
