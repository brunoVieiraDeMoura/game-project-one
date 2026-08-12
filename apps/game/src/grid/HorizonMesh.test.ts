import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { buildHorizonGeometry, nivelMinimoNaVizinhanca, JANELA_NIVEL_MINIMO, PASSO_HORIZONTE } from "./HorizonMesh";
import { SQUARE_SIZE } from "./squareGrid";
import { COLOR_WATER } from "./squareChunks";

/** mesmo molde do `squareChunks.test.ts`: só o que a geometria consome */
function mapaFake(width: number, height: number): GameMap {
  const n = width * height;
  return {
    size: { width, height },
    collision: Array.from({ length: n }, () => "walkable"),
    surface: Array.from({ length: n }, () => "grass"),
    heightmap: Array.from({ length: n }, () => 0),
  } as unknown as GameMap;
}

describe("buildHorizonGeometry", () => {
  it("prt_fild08 (400×400): 71×71 vértices, 9.800 triângulos, 1 geometria", () => {
    const map = mapaFake(400, 400);
    const b = buildHorizonGeometry(map);
    // cols/rows = floor(400/8)+1 (51) + 2×padSteps (10, de PADDING_MUNDO=160/16) = 71
    expect(b.vertices).toBe(71 * 71);
    expect(b.triangulos).toBe(70 * 70 * 2);
    expect(b.geometry.getAttribute("position")).toBeDefined();
    expect(b.geometry.getAttribute("color")).toBeDefined();
    expect(b.geometry.getAttribute("normal")).toBeDefined();
    expect(b.geometry.index).not.toBeNull();
    b.geometry.dispose();
  });

  it("passo de amostragem é o documentado (8 células)", () => {
    expect(PASSO_HORIZONTE).toBe(8);
  });

  it("vértice acompanha o RELEVO real, não fica plano", () => {
    const map = mapaFake(64, 64);
    // parede sobe um nível (visualLevel) numa faixa inteira de células — larga
    // o bastante (> 2×JANELA_NIVEL_MINIMO+1 = 17) para que algum vértice
    // decimado tenha a JANELA inteira dentro da parede: BUG 1 usa o MÍNIMO da
    // vizinhança, então uma faixa mais estreita que a janela é sempre
    // "achatada" pelo vizinho baixo de fora dela — não é defeito do teste, é o
    // próprio comportamento do fix, então a faixa aqui tem de refletir isso
    for (let row = 0; row < 64; row++) {
      for (let col = 16; col < 48; col++) map.collision[row * 64 + col] = "wall";
    }
    const plano = buildHorizonGeometry(mapaFake(64, 64));
    const comMuro = buildHorizonGeometry(map);
    const pos1 = plano.geometry.getAttribute("position");
    const pos2 = comMuro.geometry.getAttribute("position");
    let algumDiferente = false;
    for (let i = 0; i < pos1.count; i++) {
      if (Math.abs(pos1.getY(i) - pos2.getY(i)) > 1e-6) algumDiferente = true;
    }
    expect(algumDiferente).toBe(true);
    plano.geometry.dispose();
    comMuro.geometry.dispose();
  });

  it("cor do vértice muda com a superfície autorada (mesma paleta de terrainTextures)", () => {
    const grama = mapaFake(32, 32);
    const pedra = mapaFake(32, 32);
    for (let i = 0; i < pedra.surface.length; i++) (pedra.surface as string[])[i] = "stone";
    const bGrama = buildHorizonGeometry(grama);
    const bPedra = buildHorizonGeometry(pedra);
    const cGrama = bGrama.geometry.getAttribute("color");
    const cPedra = bPedra.geometry.getAttribute("color");
    expect(cGrama.getX(0)).not.toBeCloseTo(cPedra.getX(0), 3);
    bGrama.geometry.dispose();
    bPedra.geometry.dispose();
  });

  it("o vão mundial da malha cobre o mapa inteiro MAIS a franja (não um recorte)", () => {
    const map = mapaFake(400, 400);
    const b = buildHorizonGeometry(map);
    b.geometry.computeBoundingBox();
    const box = b.geometry.boundingBox!;
    const vaoX = box.max.x - box.min.x;
    const vaoZ = box.max.z - box.min.z;
    // 50 passos de 8 células × 2 unidades = 800 (o mapa inteiro, não o raio
    // de detalhe ~130) + 160 de cada lado (franja do BUG 3) = 1120
    const esperado = 50 * PASSO_HORIZONTE * SQUARE_SIZE + 2 * 160;
    expect(vaoX).toBeCloseTo(esperado, 1);
    expect(vaoZ).toBeCloseTo(esperado, 1);
    b.geometry.dispose();
  });

  it("o vão fica no MESMO referencial de mundo que buildChunkGeometry (-160..960, não -400..400)", () => {
    // regressão: `localX`/`localZ` eram calculados certo (para achar a
    // célula) mas nunca escritos de volta no vértice — a malha ficava com o
    // X/Z NATIVO do PlaneGeometry (centrado na origem). Span (teste acima)
    // não pega isso: um deslocamento uniforme não muda a LARGURA da caixa,
    // só a posição dela. É preciso checar min/max absolutos. -160/960 (não
    // 0/800) porque a franja do BUG 3 estende 160 unidades além da borda real.
    const map = mapaFake(400, 400);
    const b = buildHorizonGeometry(map);
    b.geometry.computeBoundingBox();
    const box = b.geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(-160, 1);
    expect(box.min.z).toBeCloseTo(-160, 1);
    expect(box.max.x).toBeCloseTo(50 * PASSO_HORIZONTE * SQUARE_SIZE + 160, 1);
    expect(box.max.z).toBeCloseTo(50 * PASSO_HORIZONTE * SQUARE_SIZE + 160, 1);
    b.geometry.dispose();
  });

  it("BUG 3 — a franja além da borda REPETE a célula de borda, não inventa relevo", () => {
    const map = mapaFake(64, 64);
    // uma FAIXA da borda oeste (não só col=0) marcada como parede — larga o
    // bastante para preencher a janela do nível mínimo (BUG 1) inteira, senão
    // o mínimo pega uma célula baixa vizinha e o teste não prova mais nada
    // sobre a franja em si
    for (let row = 0; row < 64; row++) {
      for (let col = 0; col <= JANELA_NIVEL_MINIMO; col++) map.collision[row * 64 + col] = "wall";
    }
    const b = buildHorizonGeometry(map);
    const pos = b.geometry.getAttribute("position");
    let achouFranja = false;
    for (let i = 0; i < pos.count; i++) {
      // vértice na franja oeste (X negativo) cuja LINHA (Z) cai dentro do
      // mapa real: a altura ali tem de ser a MESMA da célula de borda
      // (nível 1 → squareLevelToY(1)), não zero (que seria "inventar" chão
      // plano em vez de esticar o relevo real)
      if (pos.getX(i) < -1 && pos.getZ(i) >= 0 && pos.getZ(i) <= 128) {
        achouFranja = true;
        expect(pos.getY(i)).toBeGreaterThan(0.2);
      }
    }
    expect(achouFranja).toBe(true);
    b.geometry.dispose();
  });

  describe("BUG 1 — nivelMinimoNaVizinhanca (poke-through)", () => {
    it("acha um vale no meio de uma região alta — não fica preso no nível ao redor", () => {
      const map = mapaFake(64, 64);
      for (let i = 0; i < map.collision.length; i++) map.collision[i] = "wall"; // tudo nível 1
      map.collision[32 * 64 + 32] = "walkable"; // um vale (nível 0) no centro da janela
      expect(nivelMinimoNaVizinhanca(map, 32, 32, 64, 64)).toBe(0);
    });

    it("é LOCAL — um vale fora da janela não é visto", () => {
      const map = mapaFake(64, 64);
      for (let i = 0; i < map.collision.length; i++) map.collision[i] = "wall";
      map.collision[0] = "walkable"; // vale bem longe do centro pedido
      expect(nivelMinimoNaVizinhanca(map, 32, 32, 64, 64)).toBe(1);
    });

    it("regressão do defeito medido ao vivo: vértice decimado perto de um DEGRAU nunca fica acima do lado baixo", () => {
      // reproduz a forma real do rAthena: um degrau (parede = +1 nível
      // instantâneo), não uma rampa — exatamente o padrão que fazia a malha
      // decimada (amostrando só o ponto exato) flutuar até 5,73 unidades
      // acima do chão real num raycast ao vivo em `prt_fild08`
      const map = mapaFake(80, 80);
      for (let row = 0; row < 80; row++) {
        for (let col = 40; col < 80; col++) map.collision[row * 80 + col] = "wall";
      }
      const b = buildHorizonGeometry(map);
      const pos = b.geometry.getAttribute("position");
      // qualquer vértice ainda do LADO BAIXO real (mundo x < 80, a borda do
      // degrau em unidades de mundo) não pode ter sido puxado para cima pelo
      // vizinho alto — sem a correção, o vértice decimado bem antes do
      // degrau (mas cuja janela de amostragem já alcança o lado alto) subia
      // junto
      let algumChecado = false;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        if (x >= 0 && x < 64) {
          algumChecado = true;
          // nível 0 → squareLevelToY(0) + OFFSET_Y = -0.3; nível 1 daria +0.7.
          // Com a correção, nenhum vértice do lado baixo passa de -0.2
          expect(pos.getY(i)).toBeLessThan(-0.2);
        }
      }
      expect(algumChecado).toBe(true);
      b.geometry.dispose();
    });
  });

  describe("BUG 2 — água distante não vira terra", () => {
    it("surface 'water' usa COLOR_WATER, não a paleta de terreno", () => {
      const map = mapaFake(32, 32);
      for (let i = 0; i < map.surface.length; i++) (map.surface as string[])[i] = "water";
      const b = buildHorizonGeometry(map);
      const cor = b.geometry.getAttribute("color");
      expect(cor.getX(0)).toBeCloseTo(COLOR_WATER.r, 4);
      expect(cor.getY(0)).toBeCloseTo(COLOR_WATER.g, 4);
      expect(cor.getZ(0)).toBeCloseTo(COLOR_WATER.b, 4);
      b.geometry.dispose();
    });

    it("surface 'river' também conta como água", () => {
      const map = mapaFake(32, 32);
      for (let i = 0; i < map.surface.length; i++) (map.surface as string[])[i] = "river";
      const b = buildHorizonGeometry(map);
      const cor = b.geometry.getAttribute("color");
      expect(cor.getX(0)).toBeCloseTo(COLOR_WATER.r, 4);
      b.geometry.dispose();
    });

    it("mapa sem superfície autorada (recém-importado) usa a COLISÃO para achar água — mesma regra de `ehCelulaDeAgua`", () => {
      const map = mapaFake(32, 32);
      for (let i = 0; i < map.surface.length; i++) (map.surface as string[])[i] = ""; // sem autoria
      for (let i = 0; i < map.collision.length; i++) (map.collision as string[])[i] = "water";
      const b = buildHorizonGeometry(map);
      const cor = b.geometry.getAttribute("color");
      expect(cor.getX(0)).toBeCloseTo(COLOR_WATER.r, 4);
      b.geometry.dispose();
    });

    it("terra normal continua com a paleta de terreno, não azul", () => {
      const map = mapaFake(32, 32);
      const b = buildHorizonGeometry(map);
      const cor = b.geometry.getAttribute("color");
      expect(cor.getX(0)).not.toBeCloseTo(COLOR_WATER.r, 2);
      b.geometry.dispose();
    });
  });

  it("um vértice sabidamente no canto (col=0,row=0) fica em X=0,Z=0 no mundo", () => {
    // mesma referência que `buildChunkGeometry` usa: col×SQUARE_SIZE a
    // partir da origem — não centrado, não espelhado
    const map = mapaFake(400, 400);
    const b = buildHorizonGeometry(map);
    const pos = b.geometry.getAttribute("position");
    let melhor = 0;
    let melhorDist = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = pos.getX(i) * pos.getX(i) + pos.getZ(i) * pos.getZ(i);
      if (d < melhorDist) { melhorDist = d; melhor = i; }
    }
    expect(pos.getX(melhor)).toBeCloseTo(0, 1);
    expect(pos.getZ(melhor)).toBeCloseTo(0, 1);
    b.geometry.dispose();
  });
});
