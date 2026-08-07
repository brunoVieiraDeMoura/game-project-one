import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * `repairWaterBanks` existe para mapas pintados ANTES da distância euclidiana
 * do barranco e do blur da saia (`cornerLevelSaia`) — o degrau/serrilhado da
 * referência `Desktop/ref/agua-bugada.jpg` fica GRAVADO no heightmap, e código
 * novo não recalcula sozinho o que já foi escrito. Estes testes fabricam esse
 * estado "legado" (leito plano, sem barranco) à mão — nunca pelo pincel, que já
 * escava do jeito certo — e conferem que o reparo alcança o mesmo perfil que o
 * pincel produziria hoje.
 */
const W = 20;
const H = 20;
const idx = (col: number, row: number) => row * W + col;

function mapaLegado(): GameMap {
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  const collision = new Array(n).fill("walkable");
  const surface = new Array(n).fill("grass");

  // Lago A: 4×4 (16 células, >= LAGO_MIN_PARA_BLOQUEAR) — leito CHAPADO, sem
  // barranco (degrau seco na borda), como o código antigo deixava.
  for (let r = 12; r <= 15; r++) {
    for (let c = 12; c <= 15; c++) {
      const i = idx(c, r);
      surface[i] = "water";
      collision[i] = "water";
      heightmap[i] = -0.5;
    }
  }

  // Lago B: 3×3 (9 células, < LAGO_MIN_PARA_BLOQUEAR) — longe do A, mesma
  // receita de leito chapado.
  for (let r = 3; r <= 5; r++) {
    for (let c = 3; c <= 5; c++) {
      const i = idx(c, r);
      surface[i] = "water";
      collision[i] = "water";
      heightmap[i] = -0.5;
    }
  }

  // Rio: uma linha de 1 célula de largura, raso, também com degrau seco.
  for (let c = 0; c < W; c++) {
    const i = idx(c, 9);
    surface[i] = "river";
    collision[i] = "water";
    heightmap[i] = -0.25;
  }

  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap,
    collision,
    surface,
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const mapa = () => st().map!;

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
  st().init(mapaLegado());
  st().setEditScope("all");
});

describe("repairWaterBanks", () => {
  it("não move a água: mesmas células continuam river/water", () => {
    const antes = new Set<number>();
    mapa().surface.forEach((s, i) => { if (s === "water" || s === "river") antes.add(i); });

    st().repairWaterBanks();

    const depois = new Set<number>();
    mapa().surface.forEach((s, i) => { if (s === "water" || s === "river") depois.add(i); });
    expect(depois).toEqual(antes);
  });

  it("abre barranco onde antes havia degrau seco (lago grande)", () => {
    // antes: terra imediatamente ao lado do lago está em 0 (degrau contra -0.5)
    expect(mapa().heightmap[idx(11, 13)]).toBe(0);

    st().repairWaterBanks();

    const h = mapa().heightmap[idx(11, 13)]!;
    expect(h).toBeLessThan(-1e-6); // desceu
    expect(h).toBeGreaterThan(-0.85); // mas não abaixo da lâmina: é RAMPA, não degrau só deslocado
  });

  it("o lago vira BACIA: o miolo fica mais fundo que a beira", () => {
    st().repairWaterBanks();
    const beira = mapa().heightmap[idx(12, 13)]!; // encosta na terra
    const miolo = mapa().heightmap[idx(13, 13)]!; // um passo pra dentro
    expect(miolo).toBeLessThan(beira - 1e-6);
  });

  it("rio também abre barranco, com o helper de sempre", () => {
    expect(mapa().heightmap[idx(10, 8)]).toBe(0); // terra acima do rio, intocada
    st().repairWaterBanks();
    expect(mapa().heightmap[idx(10, 8)]!).toBeLessThan(-1e-6);
  });

  it("lagoas SEM relação não se fundem num corpo só (lago pequeno continua andável)", () => {
    st().repairWaterBanks();
    // lago B (9 células, abaixo do piso de bloqueio) tem que continuar
    // atravessável mesmo no centro — se o reparo juntasse A (16 células) e B
    // num corpo só, o tamanho combinado passaria do piso e bloquearia B também.
    expect(mapa().collision[idx(4, 4)]).toBe("water");
  });

  it("lago grande o bastante sozinho continua bloqueando o miolo", () => {
    st().repairWaterBanks();
    // lago A tem 16 células, acima do piso — o miolo (longe da beira) vira parede
    expect(mapa().collision[idx(13, 13)]).toBe("wall");
  });

  /**
   * Reparar de novo NÃO é idempotente byte a byte: a segunda chamada lê o
   * heightmap já ramped da primeira como "campo" (a referência congelada —
   * `campoOriginal` em `escavarBarranco` — só protege DENTRO de uma mesma
   * chamada, não entre um clique e outro). O que se garante é CONVERGÊNCIA: a
   * segunda passada desce menos que a primeira, nunca mais — clicar de novo
   * não é uma corrosão sem fim.
   */
  it("reparar de novo é uma correção MENOR que a primeira, não uma corrosão sem fim", () => {
    const antes = mapa().heightmap[idx(11, 13)]!; // 0, degrau seco original
    st().repairWaterBanks();
    const depois1 = mapa().heightmap[idx(11, 13)]!;
    st().repairWaterBanks();
    const depois2 = mapa().heightmap[idx(11, 13)]!;

    const delta1 = Math.abs(depois1 - antes);
    const delta2 = Math.abs(depois2 - depois1);
    expect(delta1).toBeGreaterThan(1e-6); // a primeira passada de fato abriu o barranco
    expect(delta2).toBeLessThan(delta1); // a segunda mexe menos que a primeira — contrai, não diverge
  });
});
