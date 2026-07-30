import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { cellInScope, scopeCounts } from "./editScope";

/**
 * Mapa 10×10 importado do rAthena, com as três regiões que o editor distingue:
 *  • moldura bloqueada em volta (borda);
 *  • uma ravina de 2 células no miolo (buraco, `cliff`);
 *  • o resto andável (dentro).
 *
 * Tem também uma PAREDE isolada no miolo, que não é buraco nem borda: é
 * obstáculo do campo e cai em "dentro".
 */
function mapaComBuraco(): GameMap {
  const W = 10;
  const H = 10;
  const n = W * H;
  const collision: string[] = new Array(n).fill("walkable");
  const i = (col: number, row: number) => row * W + col;
  for (let c = 0; c < W; c++) {
    collision[i(c, 0)] = "wall";
    collision[i(c, H - 1)] = "wall";
  }
  for (let r = 0; r < H; r++) {
    collision[i(0, r)] = "wall";
    collision[i(W - 1, r)] = "wall";
  }
  collision[i(4, 4)] = "cliff"; // ravina no miolo
  collision[i(5, 4)] = "cliff";
  collision[i(2, 7)] = "wall"; // moita isolada no miolo
  return {
    size: { width: W, height: H },
    collision,
    surface: new Array(n).fill("grass"),
    heightmap: new Array(n).fill(0),
  } as unknown as GameMap;
}

describe("editScope com buraco", () => {
  const map = mapaComBuraco();

  it("as três regiões são disjuntas e cobrem o mapa", () => {
    const { width: W, height: H } = map.size;
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const dentro = cellInScope(map, "inside", col, row);
        const borda = cellInScope(map, "border", col, row);
        const buraco = cellInScope(map, "hole", col, row);
        expect([dentro, borda, buraco].filter(Boolean)).toHaveLength(1);
        expect(cellInScope(map, "all", col, row)).toBe(true);
      }
    }
  });

  it('"Dentro" NÃO alcança o buraco — é o que impede o pincel de apagá-lo', () => {
    expect(cellInScope(map, "inside", 4, 4)).toBe(false);
    expect(cellInScope(map, "hole", 4, 4)).toBe(true);
    expect(cellInScope(map, "hole", 5, 4)).toBe(true);
  });

  it("moita isolada do miolo é 'dentro', não buraco (buraco é cliff)", () => {
    expect(cellInScope(map, "inside", 2, 7)).toBe(true);
    expect(cellInScope(map, "hole", 2, 7)).toBe(false);
  });

  it("cliff DENTRO da moldura ainda é buraco — o tipo vence a localização", () => {
    // Medido em prt_fild08: 7.306 das 7.899 células de buraco (92,5%) tocam o
    // cinturão da borda, porque a mata da beirada cerca as ravinas. Classificando
    // pela localização, o escopo "Buraco" pegava 593 células e parecia quebrado.
    const W = map.size.width;
    const collision = [...(map.collision as string[])];
    collision[0 * W + 5] = "cliff"; // encostado na moldura de cima
    const m2 = { ...map, collision } as unknown as GameMap;
    expect(cellInScope(m2, "hole", 5, 0)).toBe(true);
    expect(cellInScope(m2, "border", 5, 0)).toBe(false);
  });

  it("a contagem do seletor separa os três", () => {
    const { inside, border, hole } = scopeCounts(map);
    expect(hole).toBe(2);
    expect(border).toBe(36); // moldura de 10×10
    expect(inside + border + hole).toBe(100);
  });

  it("ravina cercada pela borda entra INTEIRA no escopo Buraco", () => {
    // reproduz o caso do prt_fild08: mata (wall) em volta da ravina, tudo ligado
    // à moldura — antes só as células de cliff sem contato com a mancha contavam
    const W = map.size.width;
    const collision = [...(map.collision as string[])];
    const i = (c: number, r: number) => r * W + c;
    // a mata começa em r=1, colada na moldura (r=0): é assim que ela vira uma
    // mancha só com o cinturão, que é o caso real do prt_fild08
    for (let r = 1; r <= 5; r++) for (let c = 2; c <= 5; c++) collision[i(c, r)] = "wall";
    for (let r = 3; r <= 4; r++) for (let c = 3; c <= 4; c++) collision[i(c, r)] = "cliff";
    const m2 = { ...map, collision } as unknown as GameMap;
    for (let r = 3; r <= 4; r++)
      for (let c = 3; c <= 4; c++) expect(cellInScope(m2, "hole", c, r), `célula ${c},${r}`).toBe(true);
    // e a mata em volta continua sendo borda
    expect(cellInScope(m2, "border", 2, 2)).toBe(true);
  });
});
