import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { cornerLevel, cornerLevelSaia, cornerNormal, sampleHeight } from "./heightField";
import { SQUARE_SIZE, squareLevelToY } from "./squareGrid";

/**
 * O relevo tem que ser um CAMPO CONTÍNUO, não uma pilha de blocos.
 *
 * Era o pedido: "não quero um jogo igual Roblox todo quadrado, quero que as
 * montanhas se pareçam montanhas". A altura mora nas células, mas é lida nos
 * CANTOS (média das células que se encontram ali), então duas células vizinhas
 * compartilham dois vértices e a superfície inclina em vez de escalonar.
 */
const W = 12;
const H = 12;
const idx = (col: number, row: number) => row * W + col;

function mapa(patch?: (h: number[], c: string[], s: string[]) => void): GameMap {
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  const collision: string[] = new Array(n).fill("walkable");
  const surface: string[] = new Array(n).fill("grass");
  patch?.(heightmap, collision, surface);
  return {
    size: { width: W, height: H },
    heightmap,
    collision,
    surface,
  } as unknown as GameMap;
}

describe("cornerLevel", () => {
  it("canto entre uma célula alta e o chão fica no MEIO — é a inclinação", () => {
    const m = mapa((h) => {
      h[idx(5, 5)] = 4;
    });
    // canto inferior-direito da célula alta: só ela é alta entre as 4 vizinhas
    expect(cornerLevel(m, 6, 6, "land")).toBeCloseTo(1); // (4+0+0+0)/4
    // canto no meio de duas células altas seria mais alto
    const m2 = mapa((h) => {
      h[idx(5, 5)] = 4;
      h[idx(6, 5)] = 4;
    });
    expect(cornerLevel(m2, 6, 6, "land")).toBeCloseTo(2); // (4+4+0+0)/4
  });

  it("bloqueio NÃO se mistura com chão: a parede não vira rampa", () => {
    const m = mapa((h, c) => {
      c[idx(5, 5)] = "wall";
      h[idx(5, 5)] = 3;
    });
    // pedindo o canto do grupo "chão", a parede de altura 3 é ignorada
    expect(cornerLevel(m, 5, 5, "land")).toBeCloseTo(0);
    // e pedindo o canto do grupo "bloqueio", só a parede conta
    expect(cornerLevel(m, 5, 5, "blocked")).toBeCloseTo(3);
  });

  it("no meio de um platô o canto é o próprio nível (sem afundar a beirada)", () => {
    const m = mapa((h) => {
      for (let r = 2; r <= 8; r++) for (let c = 2; c <= 8; c++) h[idx(c, r)] = 5;
    });
    expect(cornerLevel(m, 5, 5, "land")).toBeCloseTo(5);
  });
});

describe("água RASA nunca se mistura com o chão vizinho, nem autorada", () => {
  /**
   * Relato do usuário: "quando eu subo um terreno do lado da água, a
   * mesclagem da água está subindo, deixando visualmente a água mesclada
   * subindo a montanha". Água rasa (`collision: "water"`) não é bloqueio —
   * antes desta separação ela caía no mesmo grupo "chão" que qualquer célula
   * andável, então erguer o campo do lado dela puxava a altura (e com ela a
   * cor azulada do vértice) do canto compartilhado para cima.
   */
  function mapaComAgua(alturaTerra: number, autorarAgua = false): GameMap {
    return mapa((h, c) => {
      c[idx(6, 5)] = "water"; // célula de água à esquerda do canto (6,5)
      c[idx(5, 5)] = "walkable"; // terra à direita, subida pelo usuário
      h[idx(5, 5)] = alturaTerra;
      if (autorarAgua) h[idx(6, 5)] = 0.5; // água também "autorada" (ex.: barranco)
      h[idx(5, 4)] = alturaTerra;
      h[idx(6, 4)] = autorarAgua ? 0.5 : 0;
    });
  }

  it("erguer a terra do lado NÃO muda a altura do canto de água", () => {
    const rasa = cornerLevel(mapaComAgua(0), 6, 5, "water");
    const alta = cornerLevel(mapaComAgua(8), 6, 5, "water");
    expect(alta).toBeCloseTo(rasa);
  });

  it("o canto do lado da TERRA sobe normalmente (não é a água que trava o chão)", () => {
    const baixo = cornerLevel(mapaComAgua(0), 6, 5, "land");
    const alto = cornerLevel(mapaComAgua(8), 6, 5, "land");
    expect(alto).toBeGreaterThan(baixo);
  });

  it('a exceção de "relevo autorado" (montanha sobre mata) NÃO vale pra água', () => {
    // as 4 células do canto têm heightmap != 0 (autoradas) — se a separação
    // caísse na mesma exceção do bloqueio, a água voltaria a se misturar
    const semSubir = cornerLevel(mapaComAgua(0, true), 6, 5, "water");
    const comSubir = cornerLevel(mapaComAgua(8, true), 6, 5, "water");
    expect(comSubir).toBeCloseTo(semSubir);
  });
});

/**
 * `Desktop/ref/agua-bugada.jpg` (captura NOVA, tirada depois da 1ª correção
 * desta mesma sessão — o serrilhado continuava, sem montanha nenhuma no
 * quadro). Rio FUNDO tem `collision: "wall"`, então o GRUPO dele é
 * `"blocked"` — igual montanha — e a exceção "água nunca mistura" só
 * verificava `grupo === "water"`, que rio fundo nunca é. O barranco
 * (`escavarBarranco`) grava altura nas duas pontas da margem, então um canto
 * junto ao rio tem as 4 células autoradas (rio + barranco) MUITO mais vezes
 * que um canto vizinho um passo adiante — a exceção "todasAutoradas" piscava
 * ligada/desligada de canto a canto ao longo do MESMO rio, e essa alternância
 * (canto misturado, canto puro, canto misturado…) é o dente de serra.
 */
describe("rio FUNDO (blocked, não water) também não mistura com barranco autorado", () => {
  function mapaComRioFundo(alturaBarranco: number): GameMap {
    return mapa((h, c, s) => {
      // (6,5) é rio fundo — as 4 células do canto (6,5) são a própria célula
      c[idx(6, 5)] = "wall";
      s[idx(6, 5)] = "river";
      h[idx(6, 5)] = -3; // RIVER_DEEP_Y-like
      // as outras 3 são barranco (grama), autoradas por escavarBarranco
      c[idx(5, 5)] = "walkable";
      h[idx(5, 5)] = alturaBarranco;
      c[idx(5, 4)] = "walkable";
      h[idx(5, 4)] = alturaBarranco;
      c[idx(6, 4)] = "walkable";
      h[idx(6, 4)] = alturaBarranco;
    });
  }

  it("canto do rio (grupo blocked) fica na profundidade PURA do rio, não numa média com o barranco", () => {
    // se a exceção "autorada" tivesse pego este canto, o resultado seria a
    // média de [-3 (rio), alturaBarranco×3] — bem mais raso que -3 puro
    const semBarranco = cornerLevel(mapaComRioFundo(0), 6, 5, "blocked");
    const comBarranco = cornerLevel(mapaComRioFundo(1.5), 6, 5, "blocked");
    expect(semBarranco).toBeCloseTo(-3);
    expect(comBarranco).toBeCloseTo(-3); // o barranco ao lado NÃO muda a profundidade do rio
  });

  it("dois cantos vizinhos do MESMO rio (um com barranco nos 4, outro sem) dão a MESMA profundidade — sem alternância", () => {
    const m = mapa((h, c, s) => {
      // canal de rio reto na linha 5, colunas 4..8
      for (let col = 4; col <= 8; col++) {
        c[idx(col, 5)] = "wall";
        s[idx(col, 5)] = "river";
        h[idx(col, 5)] = -3;
      }
      // barranco só de UM lado (linha 4), deixando a linha 6 sem altura autorada —
      // exatamente o padrão que fazia a exceção piscar canto a canto
      for (let col = 3; col <= 9; col++) h[idx(col, 4)] = 1.2;
    });
    const cantoComBarrancoNosQuatro = cornerLevel(m, 6, 5, "blocked");
    const cantoSemBarrancoAoLado = cornerLevel(m, 6, 6, "blocked");
    expect(cantoComBarrancoNosQuatro).toBeCloseTo(-3);
    expect(cantoSemBarrancoAoLado).toBeCloseTo(-3);
  });
});

/**
 * `Desktop/ref/agua-bugada.jpg`, item 2: a fronteira montanha↔rio serrilhada.
 * `cornerLevel("blocked")` já suaviza a montanha por dentro, mas ao longo de
 * uma margem DIAGONAL o número de células "blocked" que tocam cada canto
 * alterna (1, 2, 3...) conforme o zigue-zague cai — essa oscilação de canto a
 * canto é o que `cornerLevelSaia` borra, só perto de água e só dentro do
 * próprio grupo "blocked" (nunca puxando o canto de água pra dentro da
 * conta).
 */
describe("cornerLevelSaia", () => {
  const N = 24;
  const i2 = (col: number, row: number) => row * N + col;

  /** montanha (wall) acima da diagonal, água abaixo — altura variando por
   * célula pra criar oscilação de canto a canto ao longo da margem */
  function fronteiraDiagonal(): GameMap {
    const n = N * N;
    const heightmap = new Array(n).fill(0);
    const collision: string[] = new Array(n).fill("walkable");
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (c > r) {
          collision[i2(c, r)] = "wall";
          heightmap[i2(c, r)] = 4 + ((c + r) % 3); // 4,5,6 alternando — a fonte da oscilação
        } else if (c < r) {
          collision[i2(c, r)] = "water";
        }
      }
    }
    return { size: { width: N, height: N }, heightmap, collision, surface: [] } as unknown as GameMap;
  }

  it("longe de água é IDÊNTICO ao cornerLevel — zero mudança de comportamento fora do caso", () => {
    const m = fronteiraDiagonal();
    // cantos bem dentro do maciço de montanha, longe da margem com água
    for (const [c, r] of [
      [20, 2],
      [22, 4],
      [18, 1],
    ]) {
      expect(cornerLevelSaia(m, c!, r!, "blocked")).toBeCloseTo(cornerLevel(m, c!, r!, "blocked"));
    }
  });

  it("perto de água, a variação de canto a canto ao longo da margem encolhe (não cresce)", () => {
    const m = fronteiraDiagonal();
    const cantosDaMargem = Array.from({ length: N - 2 }, (_, k) => [k + 1, k + 1] as const);

    const brutos = cantosDaMargem.map(([c, r]) => cornerLevel(m, c, r, "blocked"));
    const suaves = cantosDaMargem.map(([c, r]) => cornerLevelSaia(m, c, r, "blocked"));

    const maiorSalto = (vs: number[]) => {
      let max = 0;
      for (let k = 1; k < vs.length; k++) max = Math.max(max, Math.abs(vs[k]! - vs[k - 1]!));
      return max;
    };
    expect(maiorSalto(suaves)).toBeLessThanOrEqual(maiorSalto(brutos) + 1e-9);
    // e o suave não é uma cópia disfarçada — realmente borrou alguma coisa
    expect(suaves).not.toEqual(brutos);
  });

  it("nunca mistura o grupo água na conta — canto de água não muda", () => {
    const m = fronteiraDiagonal();
    // corner (10,10) tem células de água tocando; pedir grupo "water" não pode
    // ser afetado pelo blur (que só existe para "blocked")
    expect(cornerLevelSaia(m, 10, 10, "water")).toBeCloseTo(cornerLevel(m, 10, 10, "water"));
  });
});

describe("sampleHeight", () => {
  it("é contínuo: andar meia célula não pula de nível", () => {
    const m = mapa((h) => {
      for (let r = 0; r < H; r++) for (let c = 6; c < W; c++) h[idx(c, r)] = 6;
    });
    let maiorSalto = 0;
    let anterior = sampleHeight(m, 4 * SQUARE_SIZE, 5 * SQUARE_SIZE);
    for (let x = 4; x <= 9; x += 0.1) {
      const y = sampleHeight(m, x * SQUARE_SIZE, 5 * SQUARE_SIZE);
      maiorSalto = Math.max(maiorSalto, Math.abs(y - anterior));
      anterior = y;
    }
    // um degrau de 6 níveis daria um salto do tamanho de squareLevelToY(6);
    // no campo contínuo cada passo de 0,1 célula sobe uma fração disso
    expect(maiorSalto).toBeLessThan(squareLevelToY(1));
  });

  it("terreno plano dá altura plana", () => {
    const m = mapa();
    for (const [x, z] of [
      [0, 0],
      [7.3, 2.9],
      [11.9, 11.9],
    ]) {
      expect(sampleHeight(m, x! * SQUARE_SIZE, z! * SQUARE_SIZE)).toBeCloseTo(0);
    }
  });

  it("fora dos limites não explode (prende na borda)", () => {
    const m = mapa((h) => {
      h[idx(0, 0)] = 2;
    });
    expect(Number.isFinite(sampleHeight(m, -50, -50))).toBe(true);
    expect(Number.isFinite(sampleHeight(m, 1e6, 1e6))).toBe(true);
  });
});

describe("cornerNormal", () => {
  it("terreno plano aponta para cima", () => {
    const [nx, ny, nz] = cornerNormal(mapa(), 5, 5, "land");
    expect(ny).toBeCloseTo(1);
    expect(nx).toBeCloseTo(0);
    expect(nz).toBeCloseTo(0);
  });

  it("na encosta a normal se inclina para o lado da descida", () => {
    // rampa subindo no eixo X
    const m = mapa((h) => {
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) h[idx(c, r)] = c;
    });
    const [nx, ny, nz] = cornerNormal(m, 6, 6, "land");
    expect(nx).toBeLessThan(0); // aponta contra a subida
    expect(ny).toBeGreaterThan(0);
    expect(Math.abs(nz)).toBeLessThan(1e-6);
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1);
  });

  it("é sempre unitária, em qualquer relevo", () => {
    const m = mapa((h) => {
      for (let i = 0; i < h.length; i++) h[i] = Math.sin(i) * 4;
    });
    for (const [c, r] of [
      [1, 1],
      [6, 3],
      [11, 11],
    ]) {
      const n = cornerNormal(m, c!, r!, "land");
      expect(Math.hypot(...n)).toBeCloseTo(1);
    }
  });
});
