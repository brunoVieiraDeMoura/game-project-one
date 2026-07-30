import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Pincéis de escultura, no espírito do Sculpt Mode:
 *
 *  • Puxar (grab)   — a altura vem do TAMANHO do gesto, e voltar desfaz;
 *  • Inflar         — volume ao longo da normal: plano sobe mais que encosta;
 *  • Raspar (scrape) — corta o que passa do centro, sem preencher depressão.
 */
const W = 40;
const H = 40;
const idx = (col: number, row: number) => row * W + col;

function mapaPlano(patch?: (h: number[]) => void): GameMap {
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  patch?.(heightmap);
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 1,
    terrainMode: "square",
    heightmap,
    collision: new Array(n).fill("walkable"),
    surface: [],
    ramps: [],
    props: [],
    spawns: [],
    triggers: [],
  } as unknown as GameMap;
}

const st = () => useEditorStore.getState();
const alt = (col: number, row: number) => st().map!.heightmap[idx(col, row)] ?? 0;

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [], rampAnchor: null, rampBase: null });
  st().setEditScope("all");
  st().setBrushSize(5);
  st().setBrushStrength(0.5);
});

describe("Puxar (grab)", () => {
  beforeEach(() => {
    st().init(mapaPlano());
    st().setBrush("grab");
  });

  it("quanto mais longe se arrasta, mais alto fica", () => {
    st().beginStroke();
    st().beginRamp(20, 20);
    st().paintCell(22, 20); // 2 células de gesto
    const perto = alt(20, 20);
    st().paintCell(28, 20); // 8 células
    expect(alt(20, 20)).toBeGreaterThan(perto);
    expect(perto).toBeGreaterThan(0);
  });

  it("voltar ao ponto de partida desfaz (a base é o relevo de antes)", () => {
    st().beginStroke();
    st().beginRamp(20, 20);
    st().paintCell(28, 20);
    expect(alt(20, 20)).toBeGreaterThan(0);
    st().paintCell(20, 20); // gesto de comprimento zero
    expect(alt(20, 20)).toBeCloseTo(0);
  });

  it("puxa a REGIÃO, com o centro subindo mais que a periferia", () => {
    st().beginStroke();
    st().beginRamp(20, 20);
    st().paintCell(26, 20);
    expect(alt(20, 20)).toBeGreaterThan(alt(23, 20));
    expect(alt(23, 20)).toBeGreaterThan(alt(25, 20));
  });

  it("um undo desfaz o gesto inteiro", () => {
    st().beginStroke();
    st().beginRamp(20, 20);
    st().paintCell(28, 20);
    st().undo();
    expect(alt(20, 20)).toBe(0);
  });
});

describe("Inflar", () => {
  it("o topo plano sobe mais que a encosta inclinada", () => {
    // Encosta inclinada mas dentro do clamp (−6..12): com rampa forte demais a
    // altura satura no teto e o "ganho" viraria negativo, medindo o clamp em vez
    // do pincel.
    st().init(mapaPlano((h) => {
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) h[idx(c, r)] = (c - 20) * 0.8;
    }));
    st().setBrush("inflate");
    st().setBrushSize(0);
    st().setBrushStrength(1);
    const antesEncosta = alt(20, 20);
    st().paintCell(20, 20);
    const ganhoEncosta = alt(20, 20) - antesEncosta;

    // agora numa região plana
    st().init(mapaPlano());
    st().setBrush("inflate");
    st().setBrushSize(0);
    st().setBrushStrength(1);
    st().paintCell(20, 20);
    const ganhoPlano = alt(20, 20);

    expect(ganhoPlano).toBeGreaterThan(ganhoEncosta);
    expect(ganhoEncosta).toBeGreaterThan(0); // ainda infla, só menos
  });

  it("não desce nada (só adiciona volume)", () => {
    st().init(mapaPlano((h) => {
      h[idx(20, 20)] = 2;
    }));
    st().setBrush("inflate");
    st().setBrushStrength(0.5);
    const antes = st().map!.heightmap.slice();
    st().paintCell(20, 20);
    for (let i = 0; i < antes.length; i++) {
      expect(st().map!.heightmap[i]!).toBeGreaterThanOrEqual(antes[i]! - 1e-9);
    }
  });
});

describe("Raspar (scrape)", () => {
  beforeEach(() => {
    // morro no meio: pico 6, descendo em volta
    st().init(mapaPlano((h) => {
      for (let r = 15; r <= 25; r++)
        for (let c = 15; c <= 25; c++) {
          const d = Math.hypot(c - 20, r - 20);
          h[idx(c, r)] = Math.max(0, 6 - d);
        }
    }));
    st().setBrush("scrape");
    st().setBrushSize(6);
    st().setBrushStrength(1);
  });

  it("corta o que está acima do centro, e insistindo chega no platô", () => {
    // centro do pincel numa encosta de altura ~3: o pico de 6 tem que descer
    const picoAntes = alt(20, 20);
    const alvo = alt(23, 20);
    st().paintCell(23, 20);
    // uma passada só desce PARCIALMENTE fora do centro (o peso do falloff é menor
    // lá) — o pico não pula direto para a altura do plano
    expect(alt(20, 20)).toBeLessThan(picoAntes);
    expect(alt(20, 20)).toBeGreaterThan(alvo);
    // insistindo, converge para o plano do centro: é o platô
    for (let k = 0; k < 12; k++) st().paintCell(23, 20);
    expect(alt(20, 20)).toBeCloseTo(alvo, 1);
  });

  it("NÃO preenche depressão — é a diferença em relação ao Nivelar", () => {
    st().init(mapaPlano((h) => {
      h[idx(20, 20)] = -3; // buraco no chão plano
    }));
    st().setBrush("scrape");
    st().setBrushSize(4);
    st().setBrushStrength(1);
    st().paintCell(24, 20); // alvo no nível 0, o buraco está abaixo
    expect(alt(20, 20)).toBe(-3);

    // com Nivelar, o mesmo gesto SUBIRIA o fundo do buraco
    st().init(mapaPlano((h) => {
      h[idx(20, 20)] = -3;
    }));
    st().setBrush("flatten");
    st().setBrushSize(4);
    st().setBrushStrength(1);
    st().paintCell(24, 20);
    expect(alt(20, 20)).toBeGreaterThan(-3);
  });
});
