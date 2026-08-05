import { beforeEach, describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { useEditorStore } from "./editorStore";
import { setHexScale } from "../hex/hexGrid";

/**
 * Dois defeitos do `next-change-editor.txt`, no mesmo arquivo porque os dois são
 * sobre o ENCONTRO de uma coisa autorada com o campo em volta:
 *
 *  • o LAGO parecia rio fundo e ainda assim se andava em cima dele;
 *  • a MONTANHA nascia num degrau seco, sem sopé.
 */
const W = 40;
const H = 40;
const idx = (col: number, row: number) => row * W + col;

function campoPlano(): GameMap {
  const n = W * H;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
    surface: new Array(n).fill("grass"),
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
const h = (col: number, row: number) => mapa().heightmap[idx(col, row)] ?? 0;
const col_ = (c: number, r: number) => mapa().collision[idx(c, r)];
const surf = (c: number, r: number) => mapa().surface[idx(c, r)];

beforeEach(() => {
  setHexScale(1);
  useEditorStore.setState({ past: [], future: [] });
  st().init(campoPlano());
  st().setEditScope("all");
});

describe("o lago: beira se atravessa, meio não", () => {
  /**
   * Água do rAthena é ANDÁVEL (tipo 3), e o lago gravava andável na BACIA
   * INTEIRA. Como a lâmina lê o leito para escolher a cor, um lago grande ficava
   * azul escuro no meio — igual a rio fundo — e mesmo assim deixava o personagem
   * passar por cima. Era o relato: "o lago está com a textura do rio fundo, mas
   * continua andável".
   */
  function pintarLago(raio: number) {
    st().setBrush("water");
    st().setBrushSize(raio);
    st().beginStroke();
    st().paintCell(20, 20);
  }

  it("o meio do lago BLOQUEIA", () => {
    pintarLago(6);
    expect(col_(20, 20)).toBe("wall");
  });

  it("a beira continua andável", () => {
    pintarLago(6);
    // procura uma célula de água que encoste em terra
    let beira: [number, number] | null = null;
    for (let r = 0; r < H && !beira; r++)
      for (let c = 0; c < W; c++) {
        if (surf(c, r) !== "water") continue;
        const vizinhoSeco = [
          [c + 1, r],
          [c - 1, r],
          [c, r + 1],
          [c, r - 1],
        ].some(([nc, nr]) => surf(nc!, nr!) !== "water");
        if (vizinhoSeco) {
          beira = [c, r];
          break;
        }
      }
    expect(beira).not.toBeNull();
    expect(col_(beira![0], beira![1])).toBe("water");
  });

  it("o fundo é mais BAIXO que a beira — a cor e a passagem dizem o mesmo", () => {
    /**
     * É o que torna a regra legível sem tutorial: onde a lâmina escurece, não se
     * passa. Se a profundidade e a colisão discordassem, o jogador tentaria
     * atravessar o azul claro e ficaria preso no escuro sem entender.
     */
    pintarLago(6);
    let maisFundo = 0;
    let beiraH = 0;
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        if (surf(c, r) !== "water") continue;
        const alt = h(c, r);
        maisFundo = Math.min(maisFundo, alt);
        if (col_(c, r) === "water") beiraH = Math.min(beiraH, alt);
      }
    expect(maisFundo).toBeLessThan(beiraH);
  });

  it("charco pequeno fica TODO atravessável", () => {
    // poucas células: tudo no primeiro anel, e um charco que bloqueia seria pior
    // que não existir — o jogador contornaria uma poça
    pintarLago(1);
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        if (surf(c, r) === "water") expect(col_(c, r)).toBe("water");
      }
  });
});

describe("a raiz da montanha encosta no campo em rampa", () => {
  function pintarMontanha() {
    st().setBrush("mountain");
    st().setBrushSize(5);
    st().setBrushStrength(1);
    st().beginStroke();
    st().paintCell(20, 20);
  }

  it("o campo ao lado SOBE na direção da montanha", () => {
    pintarMontanha();
    // varre para fora do maciço até achar campo andável
    const linha: { c: number; h: number; col: string }[] = [];
    for (let c = 20; c < 34; c++) linha.push({ c, h: h(c, 20), col: col_(c, 20)! });
    const raiz = linha.filter((x) => x.col === "walkable" && x.h > 0);
    expect(raiz.length).toBeGreaterThan(0);
  });

  it("a raiz DESCE conforme se afasta", () => {
    pintarMontanha();
    const raiz: number[] = [];
    for (let c = 20; c < 34; c++) {
      if (col_(c, 20) === "walkable" && h(c, 20) > 0) raiz.push(h(c, 20));
    }
    // do mais perto da montanha para o mais longe, nunca sobe
    for (let i = 1; i < raiz.length; i++) expect(raiz[i]!).toBeLessThanOrEqual(raiz[i - 1]! + 1e-9);
  });

  it("a raiz NÃO fecha passagem — ela é chão", () => {
    /**
     * É o que a separa da montanha. Quem fecha passagem é o pincel, gravando
     * `wall`; a raiz é relevo e mais nada — se ela bloqueasse, uma montanha
     * pequena viraria um tampão de raio bem maior que o desenhado.
     */
    pintarMontanha();
    for (let c = 20; c < 34; c++) {
      if (surf(c, 20) === "stone") continue;
      expect(col_(c, 20)).toBe("walkable");
    }
  });

  it("a raiz nunca CAVA o que já era mais alto", () => {
    // erguer um platô antes e pôr a montanha ao lado: nada pode descer
    st().setBrush("raise");
    st().setBrushSize(6);
    st().setBrushStrength(3);
    st().beginStroke();
    st().paintCell(30, 20);
    const antes = [...mapa().heightmap];

    pintarMontanha();
    for (let c = 26; c < 34; c++) {
      if (surf(c, 20) === "stone") continue;
      expect(h(c, 20)).toBeGreaterThanOrEqual(antes[idx(c, 20)]! - 1e-9);
    }
  });
});
