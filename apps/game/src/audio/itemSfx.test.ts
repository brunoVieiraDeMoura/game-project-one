import { beforeEach, describe, expect, it, vi } from "vitest";

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

/**
 * `dropRateFor` depende de `fetch` real (`net/monsterDropCatalog`) — aqui se
 * testa a REGRA de correlação (proximidade/tempo, `< 0.15%`) de `itemSfx.ts`,
 * não a busca de rede em si (isso pertence a `monsterDropCatalog.test.ts`).
 */
const taxasFalsas = new Map<string, number>();
const ensureChamadas: number[] = [];
vi.mock("../net/monsterDropCatalog", () => ({
  ensureMonsterDrops: (mobId: number) => {
    ensureChamadas.push(mobId);
  },
  dropRateFor: (mobId: number, itemId: number) => taxasFalsas.get(`${mobId}:${itemId}`),
}));

const { useAudioSettings } = await import("./audioSettingsStore");
const { usePlayerStore } = await import("../net/playerStore");
const {
  tocarMoveuItem,
  registrarPedidoDeColeta,
  aoGanharItem,
  registrarMorteDeMonstro,
  aoAparecerItemNoChao,
  __resetForTests: resetItemSfx,
} = await import("./itemSfx");
const { __resetForTests: resetPool } = await import("./oneShotPool");
const { useSkillBar, unbindCharacter } = await import("../hud/skillBarStore");

const MOVE = "/assets/audio/item/move-item.mp3";
const RARE = "/assets/audio/item/rare-drop.mp3";
const TAKE = "/assets/audio/item/take-item.mp3";

function tocou(src: string): number {
  return criadas.filter((a) => a.src === src).reduce((n, a) => n + a.playCalls, 0);
}

beforeEach(() => {
  criadas = [];
  taxasFalsas.clear();
  ensureChamadas.length = 0;
  localStorageShim.clear();
  useAudioSettings.setState({ musicVolume: 0.35, sfxVolume: 0.55 });
  resetPool();
  resetItemSfx();
  unbindCharacter(); // reseta a skillBarStore (slots -> só Ataque Básico)
});

describe("tocarMoveuItem — chamada direta (usada por hud/skillBarStore)", () => {
  it("toca move-item-ivintory", () => {
    tocarMoveuItem();
    expect(tocou(MOVE)).toBe(1);
  });
});

describe("integração real: hud/skillBarStore aciona o som só em movimento de verdade", () => {
  it("Bag → Barra: assignItem toca o som", () => {
    useSkillBar.getState().assignItem(2, 501);
    expect(tocou(MOVE)).toBe(1);
  });

  it("Bag → Barra (munição): assignAmmo também toca", () => {
    useSkillBar.getState().assignAmmo(3, 1750);
    expect(tocou(MOVE)).toBe(1);
  });

  it("Barra → Bag: clear de um slot com ITEM toca o som", () => {
    useSkillBar.getState().assignItem(2, 501);
    // ignora o som do assign, foco no clear — `resetPool` também esvazia o
    // `<audio>` já em cache, senão `playOneShot` reaproveitaria o elemento
    // criado pelo assign e nenhum `new Audio()` novo apareceria em `criadas`
    criadas = [];
    resetPool();
    useSkillBar.getState().clear(2);
    expect(tocou(MOVE)).toBe(1);
  });

  it("soltar o item no MESMO slot que já ocupava não é movimento — não toca", () => {
    useSkillBar.getState().assignItem(2, 501);
    criadas = [];
    resetPool();
    useSkillBar.getState().assignItem(2, 501); // mesmo slot, mesmo item
    expect(tocou(MOVE)).toBe(0);
  });

  it("limpar um slot de SKILL (não item) não toca o som de item", () => {
    useSkillBar.getState().assign(4, 100); // skill, não item
    criadas = [];
    resetPool();
    useSkillBar.getState().clear(4);
    expect(tocou(MOVE)).toBe(0);
  });

  it("limpar um slot já VAZIO não toca nada", () => {
    useSkillBar.getState().clear(6);
    expect(tocou(MOVE)).toBe(0);
  });

  it("hover/seleção (nenhuma chamada às ações da store) nunca toca — é a própria ausência de efeito colateral", () => {
    expect(criadas).toHaveLength(0);
  });
});

describe("take-item-drop — coleta confirmada, não a tentativa", () => {
  it("pedido de coleta seguido de inv:add (aoGanharItem) toca take-item-drop", () => {
    registrarPedidoDeColeta();
    aoGanharItem();
    expect(tocou(TAKE)).toBe(1);
  });

  it("aoGanharItem SEM pedido pendente (ex.: outra origem de inv:add) não toca nada", () => {
    aoGanharItem();
    expect(criadas).toHaveLength(0);
  });

  it("tentativa sem sucesso (só registrarPedidoDeColeta, sem aoGanharItem) não toca nada", () => {
    registrarPedidoDeColeta();
    expect(criadas).toHaveLength(0);
  });

  it("dois pedidos seguidos, dois ganhos: toca duas vezes, não uma", () => {
    registrarPedidoDeColeta();
    registrarPedidoDeColeta();
    aoGanharItem();
    aoGanharItem();
    expect(tocou(TAKE)).toBe(2);
  });

  it("um SEGUNDO aoGanharItem sem pedido novo não repete (já consumiu o pendente)", () => {
    registrarPedidoDeColeta();
    aoGanharItem();
    aoGanharItem(); // nada pendente agora
    expect(tocou(TAKE)).toBe(1);
  });
});

describe("rare — chance real do drop, correlação por morte de monstro próxima", () => {
  const MOB_COMUM = 1002;
  const MOB_RARO = 1003;
  const ITEM = 501;

  it("drop com chance 0,149% (abaixo de 0,15%) toca rare", () => {
    taxasFalsas.set(`${MOB_RARO}:${ITEM}`, 0.149);
    registrarMorteDeMonstro(MOB_RARO, 100, 100);
    aoAparecerItemNoChao(ITEM, 100, 100);
    expect(tocou(RARE)).toBe(1);
  });

  it("drop com chance exatamente 0,15% NÃO toca (regra é < 0.15, não <=)", () => {
    taxasFalsas.set(`${MOB_COMUM}:${ITEM}`, 0.15);
    registrarMorteDeMonstro(MOB_COMUM, 100, 100);
    aoAparecerItemNoChao(ITEM, 100, 100);
    expect(tocou(RARE)).toBe(0);
  });

  it("drop com chance 1% não toca", () => {
    taxasFalsas.set(`${MOB_COMUM}:${ITEM}`, 1);
    registrarMorteDeMonstro(MOB_COMUM, 100, 100);
    aoAparecerItemNoChao(ITEM, 100, 100);
    expect(tocou(RARE)).toBe(0);
  });

  it("sem morte recente por perto: não toca, mesmo que o item seja raro em algum monstro", () => {
    taxasFalsas.set(`${MOB_RARO}:${ITEM}`, 0.01);
    aoAparecerItemNoChao(ITEM, 100, 100); // nenhuma morte registrada
    expect(tocou(RARE)).toBe(0);
  });

  it("morte longe demais (> 1.5 células) não correlaciona", () => {
    taxasFalsas.set(`${MOB_RARO}:${ITEM}`, 0.01);
    registrarMorteDeMonstro(MOB_RARO, 100, 100);
    aoAparecerItemNoChao(ITEM, 110, 110); // muito longe
    expect(tocou(RARE)).toBe(0);
  });

  it("nunca usa nome/preço/categoria — só a taxa numérica: item 'raro' sem taxa conhecida não toca", () => {
    registrarMorteDeMonstro(MOB_RARO, 100, 100);
    aoAparecerItemNoChao(999999, 100, 100); // sem entrada em taxasFalsas → dropRateFor undefined
    expect(tocou(RARE)).toBe(0);
  });

  it("morte de monstro pede a tabela de drop dele (ensureMonsterDrops)", () => {
    registrarMorteDeMonstro(MOB_RARO, 100, 100);
    expect(ensureChamadas).toContain(MOB_RARO);
  });

  it("re-render/sincronização não duplica: chamar aoAparecerItemNoChao de novo pro MESMO evento (mesmo x,y) sem nova morte ainda correlaciona à mesma (comportamento idempotente por natureza — não há estado 'já tocado' a limpar)", () => {
    taxasFalsas.set(`${MOB_RARO}:${ITEM}`, 0.01);
    registrarMorteDeMonstro(MOB_RARO, 100, 100);
    aoAparecerItemNoChao(ITEM, 100, 100);
    // uma segunda invocação real só aconteceria se o SERVIDOR mandasse
    // `ground:item` de novo — o que semanticamente é OUTRO item aparecendo,
    // não um replay do mesmo evento (o gateway não reemite o mesmo `ground:item`)
    expect(tocou(RARE)).toBe(1);
  });
});

describe("global — funciona pra qualquer classe, sem filtro nenhum", () => {
  it("Swordman (1), Mage (2), Novice (0): mesmo comportamento nos três casos", () => {
    for (const classe of [1, 2, 0]) {
      criadas = [];
      resetPool();
      resetItemSfx();
      unbindCharacter();
      usePlayerStore.setState((s) => ({ stats: { ...s.stats, class: classe } }));

      useSkillBar.getState().assignItem(2, 501);
      expect(tocou(MOVE)).toBe(1);

      registrarPedidoDeColeta();
      aoGanharItem();
      expect(tocou(TAKE)).toBe(1);
    }
  });
});

describe("volume — respeita o SFX global", () => {
  it("som de item toca no volume de SFX configurado", () => {
    useAudioSettings.getState().setSfxVolume(0.25);
    tocarMoveuItem();
    expect(criadas.find((a) => a.src === MOVE)!.volume).toBeCloseTo(0.25);
  });
});
