import { describe, expect, it, vi } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { findPath, type Cell } from "./pathfind";
import { destinoAlcancavel, limitarAlcance } from "./moveTarget";

/** mesmo desenho do pathfind.test: '.' andável, '#' parede, '~' água */
function mapaDe(linhas: string[]): GameMap {
  const width = linhas[0]!.length;
  const height = linhas.length;
  const collision: GameMap["collision"] = [];
  for (let row = 0; row < height; row++) {
    const linha = linhas[height - 1 - row]!;
    for (let col = 0; col < width; col++) {
      const c = linha[col];
      collision.push(c === "#" ? "wall" : c === "~" ? "water" : "walkable");
    }
  }
  return {
    id: "teste",
    name: "teste",
    size: { width, height },
    cellSize: 2,
    terrainMode: "square",
    heightmap: new Array(width * height).fill(0),
    collision,
    surface: [],
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns: [],
    triggers: [],
    ramps: [],
    lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
    authoredHexScale: 1,
    metadata: { version: 5, generatedAt: new Date().toISOString() },
  } as GameMap;
}

const rotaDe = (map: GameMap) => (from: Cell, to: Cell) => findPath(map, from, to);

describe("destinoAlcancavel", () => {
  it("destino livre volta ele mesmo, sem varrer anel", () => {
    const map = mapaDe([".....", ".....", ".....", ".....", "....."]);
    const rota = vi.fn(rotaDe(map));
    expect(destinoAlcancavel({ x: 0, y: 0 }, { x: 4, y: 4 }, rota)?.destino).toEqual({ x: 4, y: 4 });
    expect(rota).toHaveBeenCalledTimes(1);
  });

  it("devolve o CAMINHO junto — quem chama não recalcula o A*", () => {
    // sem isso, `pedirMovimento` rodava um segundo A* em todo clique só para
    // quebrar o pedido em trechos de 16 células
    const map = mapaDe([".....", ".....", ".....", ".....", "....."]);
    const r = destinoAlcancavel({ x: 0, y: 0 }, { x: 4, y: 4 }, rotaDe(map));
    expect(r!.caminho).toEqual(findPath(map, { x: 0, y: 0 }, { x: 4, y: 4 }));
    expect(r!.caminho.at(-1)).toEqual({ x: 4, y: 4 });
  });

  it("clique no MIOLO de um bloco de parede leva até a beira", () => {
    // montanha 5×5 no meio de um campo 11×11 — o centro está a 3 células da
    // borda dela, longe demais para os 4 anéis que o GroundInteract varre
    const map = mapaDe([
      "...........",
      "...........",
      "...........",
      "...#####...",
      "...#####...",
      "...#####...",
      "...#####...",
      "...#####...",
      "...........",
      "...........",
      "...........",
    ]);
    const alvo = destinoAlcancavel({ x: 0, y: 0 }, { x: 5, y: 5 }, rotaDe(map))?.destino;
    expect(alvo).not.toBeUndefined();
    // caiu FORA da montanha (colunas/linhas 3..7 são parede)
    const dentro = alvo!.x >= 3 && alvo!.x <= 7 && alvo!.y >= 3 && alvo!.y <= 7;
    expect(dentro, `alvo ${alvo!.x},${alvo!.y} continua dentro da montanha`).toBe(false);
    // e é uma célula ENCOSTADA nela (o pé da montanha), não qualquer chão
    expect(Math.max(Math.abs(alvo!.x - 5), Math.abs(alvo!.y - 5))).toBe(3);
  });

  it("ilha andável cercada de parede leva até a borda de fora dela", () => {
    // o alvo é inalcançável, mas há chão logo ao lado — mesma regra da montanha
    const map = mapaDe([
      ".......",
      ".......",
      "..###..",
      "..#.#..",
      "..###..",
      ".......",
      ".......",
    ]);
    const alvo = destinoAlcancavel({ x: 0, y: 0 }, { x: 3, y: 3 }, rotaDe(map))?.destino;
    expect(alvo).not.toBeUndefined();
    // fora do anel de parede (colunas/linhas 2..4)
    const dentro = alvo!.x >= 2 && alvo!.x <= 4 && alvo!.y >= 2 && alvo!.y <= 4;
    expect(dentro, `alvo ${alvo!.x},${alvo!.y}`).toBe(false);
  });

  it("nada alcançável em volta devolve null — o clique não pede nada", () => {
    // é o que acontece quando quem está cercado é o PRÓPRIO jogador
    const rota = () => null;
    expect(destinoAlcancavel({ x: 0, y: 0 }, { x: 20, y: 20 }, rota, { aneis: 3 })).toBeNull();
  });

  it("água continua sendo destino válido (tipo 3 do rAthena anda)", () => {
    const map = mapaDe([".....", ".~~~.", ".~~~.", ".~~~.", "....."]);
    expect(destinoAlcancavel({ x: 0, y: 0 }, { x: 2, y: 2 }, rotaDe(map))?.destino).toEqual({ x: 2, y: 2 });
  });

  it("origem igual ao destino não chama o A*", () => {
    const rota = vi.fn(() => null);
    expect(destinoAlcancavel({ x: 3, y: 3 }, { x: 3, y: 3 }, rota)?.destino).toEqual({ x: 3, y: 3 });
    expect(rota).not.toHaveBeenCalled();
  });

  it("fora do mapa cai no chão mais próximo dentro dele", () => {
    const map = mapaDe(["....", "....", "....", "...."]);
    const alvo = destinoAlcancavel({ x: 0, y: 0 }, { x: 8, y: 8 }, rotaDe(map));
    expect(alvo?.destino).toEqual({ x: 3, y: 3 });
  });

  it("respeita o teto de tentativas do A*", () => {
    const rota = vi.fn(() => null);
    destinoAlcancavel({ x: 0, y: 0 }, { x: 50, y: 50 }, rota, { maxTentativas: 5 });
    expect(rota.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("varre anel por anel: não pula uma célula perto por uma longe", () => {
    // só (6,5) e (0,0) são alcançáveis; (6,5) está a 1 célula do destino
    const livres = new Set(["6,5", "0,0"]);
    const rota = (_from: Cell, to: Cell) => (livres.has(`${to.x},${to.y}`) ? [] : null);
    expect(destinoAlcancavel({ x: 0, y: 0 }, { x: 5, y: 5 }, rota)?.destino).toEqual({ x: 6, y: 5 });
  });
});

describe("limitarAlcance", () => {
  it("destino perto passa intacto", () => {
    expect(limitarAlcance({ x: 10, y: 10 }, { x: 20, y: 14 }, 60)).toEqual({ x: 20, y: 14 });
  });

  it("destino longe encurta NA MESMA DIREÇÃO", () => {
    // 200 células ao norte, teto de 60: anda 60 para o norte
    const alvo = limitarAlcance({ x: 10, y: 10 }, { x: 10, y: 210 }, 60);
    expect(alvo).toEqual({ x: 10, y: 70 });
  });

  it("mantém a direção na diagonal", () => {
    const alvo = limitarAlcance({ x: 0, y: 0 }, { x: 300, y: 150 }, 60);
    // Chebyshev = 60 no eixo dominante, e a proporção do outro eixo se preserva
    expect(Math.max(Math.abs(alvo.x), Math.abs(alvo.y))).toBe(60);
    expect(alvo.y / alvo.x).toBeCloseTo(0.5, 5);
  });

  it("distância é de CHEBYSHEV, como o passo do rAthena", () => {
    // 60 em x e 60 em y é UM passo diagonal de 60, não 120
    expect(limitarAlcance({ x: 0, y: 0 }, { x: 60, y: 60 }, 60)).toEqual({ x: 60, y: 60 });
  });

  it("origem igual ao destino não divide por zero", () => {
    expect(limitarAlcance({ x: 7, y: 7 }, { x: 7, y: 7 }, 60)).toEqual({ x: 7, y: 7 });
  });
});
