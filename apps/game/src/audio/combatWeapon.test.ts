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
const { useItemCatalog } = await import("../net/itemCatalog");
const { efeitoDeAtaqueBasico, efeitoDeSkill } = await import("./combatWeapon");

const ONE_HAND = "/assets/audio/combat/swordman/weapon/basic-attack-one-hand-sword.mp3";
const TWO_HAND = "/assets/audio/combat/swordman/weapon/basic-attack-two-hand-sword.mp3";
const CRITICAL = "/assets/audio/combat/swordman/weapon/critical-hit.mp3";
const MISS = "/assets/audio/combat/swordman/weapon/miss.mp3";
const BUFF = "/assets/audio/combat/swordman/weapon/buff-damage-1.mp3";
const SKILL_DANO = "/assets/audio/combat/swordman/weapon/skill-aoe-1.mp3";

const ARCHER_BOW = "/assets/audio/combat/archer/weapon/basic-attack-bow.mp3";
const ARCHER_MISS = "/assets/audio/combat/archer/weapon/miss.mp3";

const KNIGHT = 7; // evolução do Espadachim
const HUNTER = 11; // evolução do Arqueiro
const MAGE = 2;
const ARMA_ITEM_ID = 1201;

function tocou(src: string): boolean {
  return criadas.some((a) => a.src === src && a.playCalls > 0);
}

function comoEspadachim(): void {
  usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: KNIGHT } }));
}
function comoOutraClasse(): void {
  usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: MAGE } }));
}

function equiparArma(subType: string): void {
  usePlayerStore.setState({
    inventory: [
      {
        index: 0,
        itemId: ARMA_ITEM_ID,
        amount: 1,
        type: 4,
        identified: true,
        refine: 0,
        equipped: true,
        location: 0x0002, // EQP_HAND_R
        cards: [0, 0, 0, 0],
      },
    ],
  });
  useItemCatalog.setState({
    byId: {
      [ARMA_ITEM_ID]: {
        id: ARMA_ITEM_ID,
        name: "Espada de Teste",
        aegisName: "Test_Sword",
        type: "weapon",
        subType,
        weight: 0,
        slots: 0,
        jobs: ["all"],
        classes: [],
        equipLevelMin: 0,
        equipLevelMax: 0,
        attack: 0,
        magicAttack: 0,
        defense: 0,
        locations: [],
        buyPrice: 0,
        sellPrice: 0,
        range: 1,
        gender: "both",
      },
    },
  });
}

beforeEach(() => {
  criadas = [];
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  resetPool();
  usePlayerStore.getState().reset();
  useItemCatalog.setState({ byId: {} });
});

describe("restrição de classe", () => {
  it("classe que não é Espadachim: nenhum efeito de arma/skill toca", () => {
    comoOutraClasse();
    equiparArma("2h_sword");
    efeitoDeAtaqueBasico(10, false);
    efeitoDeSkill("buff", 1);
    expect(criadas).toHaveLength(0);
  });
});

describe("ataque básico — espada de uma mão / duas mãos", () => {
  it("espada de UMA mão toca basic_atack_one_hand_sword", () => {
    comoEspadachim();
    equiparArma("1h_sword");
    efeitoDeAtaqueBasico(15, false);
    expect(tocou(ONE_HAND)).toBe(true);
    expect(tocou(TWO_HAND)).toBe(false);
  });

  it("espada de DUAS mãos toca basic_atack_two_hand_sword", () => {
    comoEspadachim();
    equiparArma("2h_sword");
    efeitoDeAtaqueBasico(15, false);
    expect(tocou(TWO_HAND)).toBe(true);
    expect(tocou(ONE_HAND)).toBe(false);
  });
});

describe("prioridade do ataque básico", () => {
  it("crítico toca critical_hit, NUNCA o efeito normal da espada junto", () => {
    comoEspadachim();
    equiparArma("2h_sword");
    efeitoDeAtaqueBasico(40, true);
    expect(tocou(CRITICAL)).toBe(true);
    expect(tocou(TWO_HAND)).toBe(false);
  });

  it("erro (damage 0) toca miss, nunca o efeito de hit normal", () => {
    comoEspadachim();
    equiparArma("2h_sword");
    efeitoDeAtaqueBasico(0, false);
    expect(tocou(MISS)).toBe(true);
    expect(tocou(TWO_HAND)).toBe(false);
    expect(tocou(CRITICAL)).toBe(false);
  });

  it("erro tem prioridade sobre crítico (dano 0 nunca é crítico de verdade)", () => {
    comoEspadachim();
    equiparArma("2h_sword");
    efeitoDeAtaqueBasico(0, true);
    expect(tocou(MISS)).toBe(true);
    expect(tocou(CRITICAL)).toBe(false);
  });
});

describe("skills", () => {
  it("skill de buff toca buff_damage_1", () => {
    comoEspadachim();
    efeitoDeSkill("buff", 999);
    expect(tocou(BUFF)).toBe(true);
    expect(tocou(SKILL_DANO)).toBe(false);
  });

  it("skill de dano (single-target ou AOE) toca skill_aoe_1", () => {
    comoEspadachim();
    efeitoDeSkill("target", 999);
    expect(tocou(SKILL_DANO)).toBe(true);
    expect(tocou(BUFF)).toBe(false);
  });
});

describe("volume — respeita o SFX global", () => {
  it("efeito de arma toca no volume de SFX configurado", () => {
    comoEspadachim();
    equiparArma("2h_sword");
    useAudioSettings.getState().setSfxVolume(0.15);
    efeitoDeAtaqueBasico(10, false);
    expect(criadas.find((a) => a.src === TWO_HAND)!.volume).toBeCloseTo(0.15);
  });
});

describe("Arqueiro", () => {
  function comoArqueiro(): void {
    usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: HUNTER } }));
  }

  it("acerto normal toca atack_basic_bow, sem depender de subtipo de arma (só existe arco)", () => {
    comoArqueiro();
    equiparArma("bow");
    efeitoDeAtaqueBasico(12, false);
    expect(tocou(ARCHER_BOW)).toBe(true);
  });

  it("sem arma catalogada ainda: continua tocando o som de arco (não depende do catálogo)", () => {
    comoArqueiro();
    efeitoDeAtaqueBasico(12, false); // nenhum equiparArma() chamado
    expect(tocou(ARCHER_BOW)).toBe(true);
  });

  it("crítico SEM asset de crítico: cai no acerto normal, não fica mudo", () => {
    comoArqueiro();
    equiparArma("bow");
    efeitoDeAtaqueBasico(40, true);
    expect(tocou(ARCHER_BOW)).toBe(true);
    expect(tocou(CRITICAL)).toBe(false); // nunca o som de crítico do Espadachim
  });

  it("erro toca o miss do PRÓPRIO Arqueiro, não o do Espadachim", () => {
    comoArqueiro();
    efeitoDeAtaqueBasico(0, false);
    expect(tocou(ARCHER_MISS)).toBe(true);
    expect(tocou(MISS)).toBe(false);
  });

  it("skill de buff SEM asset: não toca nada (não empresta o buff do Espadachim)", () => {
    comoArqueiro();
    efeitoDeSkill("buff", 1);
    expect(criadas).toHaveLength(0);
  });

  it("skill de dano SEM asset: não toca nada", () => {
    comoArqueiro();
    efeitoDeSkill("target", 1);
    expect(criadas).toHaveLength(0);
  });
});
