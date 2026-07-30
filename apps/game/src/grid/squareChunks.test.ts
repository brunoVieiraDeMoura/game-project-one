import { describe, expect, it } from "vitest";
import type { GameMap } from "@ragnarok/map-format";
import { chunksSujos, CHUNK_CELLS, chunkCounts } from "./squareChunks";

/**
 * Mapa mínimo de 96×96 (3×3 chunks) só com o que a geometria do chão consome.
 * Não vale a pena um GameMap completo: `chunksSujos` lê `size` e os três arrays.
 */
function mapaFake(width = 96, height = 96): GameMap {
  const n = width * height;
  return {
    size: { width, height },
    collision: Array.from({ length: n }, () => "walkable"),
    surface: Array.from({ length: n }, () => "grass"),
    heightmap: Array.from({ length: n }, () => 0),
  } as unknown as GameMap;
}

/** cópia com uma célula trocada, como o editorStore imutável faria */
function editar(map: GameMap, campo: "collision" | "surface" | "heightmap", col: number, row: number, valor: unknown) {
  const arr = [...(map[campo] as unknown[])];
  arr[row * map.size.width + col] = valor;
  return { ...map, [campo]: arr } as GameMap;
}

describe("chunksSujos", () => {
  it("uma célula editada suja UM chunk — não os 9", () => {
    const antes = mapaFake();
    // célula (40, 40) cai no chunk (1,1) com CHUNK_CELLS = 32
    const depois = editar(antes, "collision", 40, 40, "wall");
    expect(chunksSujos(depois, antes, depois)).toEqual(["1,1"]);
  });

  it("acha o chunk certo em cada canto", () => {
    const antes = mapaFake();
    const casos: Array<[number, number, string]> = [
      [0, 0, "0,0"],
      [CHUNK_CELLS, 0, "1,0"],
      [0, CHUNK_CELLS, "0,1"],
      [95, 95, "2,2"],
    ];
    for (const [col, row, esperado] of casos) {
      const depois = editar(antes, "heightmap", col, row, 3);
      expect(chunksSujos(depois, antes, depois)).toEqual([esperado]);
    }
  });

  it("duas edições distantes sujam dois chunks", () => {
    const antes = mapaFake();
    const um = editar(antes, "collision", 5, 5, "wall");
    const dois = editar(um, "surface", 90, 90, "sand");
    expect(chunksSujos(dois, antes, dois).sort()).toEqual(["0,0", "2,2"]);
  });

  it("array intocado não suja nada (é o que evita reconstruir tudo)", () => {
    const map = mapaFake();
    expect(chunksSujos(map, map, map)).toEqual([]);
  });

  it("mapa de outro tamanho suja todos os chunks", () => {
    const antes = mapaFake();
    const depois = mapaFake(128, 128);
    const { cols, rows } = chunkCounts(depois);
    expect(chunksSujos(depois, antes, depois)).toHaveLength(cols * rows);
  });

  it("superfície vazia (mapa importado do rAthena) não quebra a varredura", () => {
    const antes = { ...mapaFake(), surface: [] } as unknown as GameMap;
    const depois = editar(antes, "collision", 33, 1, "wall");
    expect(chunksSujos(depois, antes, depois)).toEqual(["1,0"]);
  });
});
