import { describe, expect, it } from "vitest";
import type { GameMap, SurfaceType } from "@ragnarok/map-format";
import { INCLINACAO_MAX, inclinacao, podeNascer } from "./podeNascer";

/**
 * ONDE cada asset pode nascer — uma linha de teste por linha da regra pedida em
 * `next-change-editor.txt`.
 *
 * Antes havia UMA regra para todas as categorias, e ela não distinguia árvore de
 * rocha, não olhava inclinação e não conhecia neve nem areia: árvore nascia na
 * duna, no gelo e na encosta.
 */

const W = 9;
const H = 9;
const MEIO = 4;

function campo(surf: SurfaceType, opts: { colisao?: string; altura?: number[] } = {}): GameMap {
  const n = W * H;
  return {
    id: "t",
    name: "t",
    size: { width: W, height: H },
    cellSize: 2,
    terrainMode: "square",
    heightmap: opts.altura ?? new Array(n).fill(0),
    collision: new Array(n).fill(opts.colisao ?? "walkable"),
    surface: new Array(n).fill(surf),
    props: [],
    spawns: [],
  } as unknown as GameMap;
}

/** o asset nasce no meio deste campo? */
const cabe = (cat: string, surf: SurfaceType, opts?: Parameters<typeof campo>[1]) =>
  podeNascer(campo(surf, opts), cat, MEIO, MEIO);

const VEGETACAO = ["tree", "grass", "bush"];
const RELEVO = ["rock", "hill", "mountain"];

describe("vegetação viva: árvore, grama e arbusto", () => {
  it("nasce em grama e em terra", () => {
    for (const cat of VEGETACAO) {
      expect(cabe(cat, "grass"), cat).toBe(true);
      expect(cabe(cat, "dirt"), cat).toBe(true);
    }
  });

  it("NÃO nasce em areia, neve nem pedra", () => {
    // "pedra" e "montanha" são a mesma coisa no dado: `surface === "stone"`
    for (const cat of VEGETACAO) {
      expect(cabe(cat, "sand"), cat).toBe(false);
      expect(cabe(cat, "snow"), cat).toBe(false);
      expect(cabe(cat, "stone"), cat).toBe(false);
    }
  });

  it("NÃO nasce em água de tipo nenhum", () => {
    for (const cat of VEGETACAO) {
      // lago e rio raso são ANDÁVEIS no rAthena e ainda assim são água
      expect(cabe(cat, "water", { colisao: "water" }), cat).toBe(false);
      expect(cabe(cat, "river", { colisao: "water" }), cat).toBe(false);
      // rio fundo é bloqueio
      expect(cabe(cat, "river", { colisao: "wall" }), cat).toBe(false);
    }
  });
});

describe("árvore SECA: o oposto da viva", () => {
  it("nasce em terra e em areia", () => {
    expect(cabe("tree_bare", "dirt")).toBe(true);
    expect(cabe("tree_bare", "sand")).toBe(true);
  });

  it("NÃO nasce em GRAMA", () => {
    // é a regra que a separa da árvore viva: tronco morto num gramado verde lê
    // como erro de geração
    expect(cabe("tree_bare", "grass")).toBe(false);
  });

  it("NÃO nasce em pedra nem em água", () => {
    expect(cabe("tree_bare", "stone")).toBe(false);
    expect(cabe("tree_bare", "water", { colisao: "water" })).toBe(false);
  });

  it("a TERRA é o único chão que as duas dividem", () => {
    /**
     * Vale registrar porque parece contradição e não é: a grama é exclusiva da
     * árvore viva, a areia é exclusiva da seca, e a terra aceita as duas. Terra
     * é chão neutro — é onde a mata rala e o tronco morto convivem.
     *
     * (Eu escrevi este caso primeiro afirmando que elas nunca se cruzam. Estava
     * errado: a regra do arquivo permite terra para ambas.)
     */
    expect(cabe("tree", "grass") && !cabe("tree_bare", "grass")).toBe(true);
    expect(cabe("tree_bare", "sand") && !cabe("tree", "sand")).toBe(true);
    expect(cabe("tree", "dirt") && cabe("tree_bare", "dirt")).toBe(true);
    // e nenhuma das duas em pedra, neve ou água
    for (const s of ["stone", "snow"] as SurfaceType[]) {
      expect(cabe("tree", s) || cabe("tree_bare", s), s).toBe(false);
    }
  });
});

describe("rocha e relevo", () => {
  it("nascem em campo, terra, areia e neve", () => {
    for (const cat of RELEVO) {
      for (const s of ["grass", "dirt", "sand", "snow"] as SurfaceType[]) {
        expect(cabe(cat, s), `${cat} em ${s}`).toBe(true);
      }
    }
  });

  it("NÃO nascem em montanha nem em água", () => {
    for (const cat of RELEVO) {
      expect(cabe(cat, "stone"), cat).toBe(false);
      expect(cabe(cat, "water", { colisao: "water" }), cat).toBe(false);
    }
  });

  it("ACEITAM ladeira — pedra em encosta é comum", () => {
    // é o que os separa da vegetação: um matacão numa encosta assenta, uma
    // árvore fica com o tronco no ar
    const emRampa = { altura: rampa() };
    for (const cat of RELEVO) expect(cabe(cat, "grass", emRampa), cat).toBe(true);
  });
});

describe("construção", () => {
  it("nasce em qualquer chão seco, inclusive pedra", () => {
    for (const s of ["grass", "dirt", "sand", "snow", "stone"] as SurfaceType[]) {
      expect(cabe("building", s), s).toBe(true);
    }
  });

  it("NÃO nasce em água nem em ladeira", () => {
    expect(cabe("building", "water", { colisao: "water" })).toBe(false);
    expect(cabe("building", "grass", { altura: rampa() })).toBe(false);
  });
});

describe("inclinação", () => {
  /** um degrau de 2 níveis no meio do campo */
  function rampaLocal(): number[] {
    const h = new Array(W * H).fill(0);
    for (let r = 0; r < H; r++) h[r * W + MEIO + 1] = 2;
    return h;
  }

  it("mede o maior desnível entre as OITO vizinhas", () => {
    // quatro vizinhas não bastam: uma encosta diagonal passaria despercebida, e
    // é onde o modelo fica mais torto
    const m = campo("grass", { altura: rampaLocal() });
    expect(inclinacao(m, MEIO, MEIO)).toBe(2);
  });

  it("chão plano tem inclinação zero", () => {
    expect(inclinacao(campo("grass"), MEIO, MEIO)).toBe(0);
  });

  it("a borda do mapa não conta como ladeira", () => {
    // fora do mapa é o fim do dado, não um penhasco
    expect(inclinacao(campo("grass"), 0, 0)).toBe(0);
  });

  it("no limite ainda cabe; acima dele, não", () => {
    const noLimite = new Array(W * H).fill(0);
    noLimite[MEIO * W + MEIO + 1] = INCLINACAO_MAX;
    expect(podeNascer(campo("grass", { altura: noLimite }), "tree", MEIO, MEIO)).toBe(true);

    const acima = new Array(W * H).fill(0);
    acima[MEIO * W + MEIO + 1] = INCLINACAO_MAX + 0.01;
    expect(podeNascer(campo("grass", { altura: acima }), "tree", MEIO, MEIO)).toBe(false);
  });
});

describe("portas comuns a todos", () => {
  it("célula BLOQUEADA não recebe nada", () => {
    // mata, penhasco ou montanha do mapa importado: plantar ali é plantar dentro
    // de uma parede
    for (const cat of [...VEGETACAO, ...RELEVO, "tree_bare", "building"]) {
      expect(cabe(cat, "grass", { colisao: "wall" }), cat).toBe(false);
      expect(cabe(cat, "grass", { colisao: "cliff" }), cat).toBe(false);
    }
  });

  it("categoria fora da tabela não é espalhável", () => {
    // estrada, rio e ponte nascem de geração conectada, não do scatter aleatório
    for (const cat of ["road", "river", "bridge", "coast", "ramp", "inexistente"]) {
      expect(cabe(cat, "grass"), cat).toBe(false);
    }
  });

  it("mapa SEM superfície ainda gera — a superfície é derivada da colisão", () => {
    /**
     * O caso que quebrou de verdade na primeira versão. Mapa importado do
     * rAthena chega sem `surface`: o `map_cache` guarda colisão e mais nada, e o
     * array só é materializado na primeira pincelada. Lendo `map.surface[i]`
     * cru, tudo dava `undefined` e a tabela recusava o mapa inteiro — o slider
     * de vegetação gerava zero árvore num mapa recém-importado, que é
     * justamente o estado em que ele mais é usado.
     */
    const semSuperficie = { ...campo("grass"), surface: [] } as unknown as GameMap;
    expect(podeNascer(semSuperficie, "tree", MEIO, MEIO)).toBe(true);

    // e a derivação respeita a água: célula de água continua sendo água
    const agua = {
      ...campo("grass", { colisao: "water" }),
      surface: [],
    } as unknown as GameMap;
    expect(podeNascer(agua, "tree", MEIO, MEIO)).toBe(false);
  });
});

/** um campo em rampa: cada coluna um nível acima da anterior */
function rampa(): number[] {
  const h = new Array(W * H).fill(0);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) h[r * W + c] = c;
  return h;
}
