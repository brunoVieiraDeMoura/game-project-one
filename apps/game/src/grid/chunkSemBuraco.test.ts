import { describe, expect, it } from "vitest";
import { chunkCounts, chunksSujos, CHUNK_CELLS } from "./squareChunks";
import type { GameMap } from "@ragnarok/map-format";

/**
 * EDITAR NÃO ABRE BURACO NO CHÃO.
 *
 * O relato: "um quadrado cinza ao criar algo grande ou desfazer algo grande". A
 * causa era a ORDEM — o `SquareTerrain` descartava e apagava do cache todos os
 * chunks sujos de uma vez, e a reconstrução tem orçamento por quadro. Entre o
 * descarte e a reconstrução o chunk não existia, e o que aparecia no lugar dele
 * era o vazio.
 *
 * Desfazer é o pior caso porque troca os três arrays de uma vez: TODO chunk fica
 * sujo. É esse número que estes testes fixam — não para impedir que ele seja
 * grande (ele é), mas para deixar registrado que grande é o normal, e que por
 * isso descartar antes de reconstruir nunca poderia funcionar.
 */

function mapaPlano(w: number, h: number): GameMap {
  const n = w * h;
  return {
    id: "t",
    name: "t",
    size: { width: w, height: h },
    cellSize: 5,
    terrainMode: "square",
    collision: Array.from({ length: n }, () => "walkable"),
    surface: Array.from({ length: n }, () => "grass"),
    heightmap: Array.from({ length: n }, () => 0),
    props: [],
    spawns: [],
  } as unknown as GameMap;
}

describe("o tamanho da invalidação", () => {
  it("uma pincelada suja um punhado de chunks", () => {
    const map = mapaPlano(128, 128);
    const antes = { collision: map.collision, surface: map.surface, heightmap: map.heightmap };
    const surface = [...map.surface];
    // um disco de raio 3 no meio de um chunk
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) surface[(64 + dy) * 128 + (64 + dx)] = "dirt";
    const sujos = chunksSujos(map, antes, { ...antes, surface });
    expect(sujos.length).toBeLessThanOrEqual(4);
  });

  it("array NOVO com os mesmos valores não suja nada", () => {
    /**
     * Vale registrar porque é contraintuitivo e eu errei na primeira tentativa:
     * o editor é imutável e recria os arrays a cada gesto, mas `chunksSujos`
     * compara VALOR (`a[i] !== b[i]`), não identidade. Quem olha identidade é só
     * o chamador, para decidir se vale a pena varrer.
     *
     * Ou seja: desfazer não suja "tudo" por ser desfazer — suja o que a edição
     * desfeita tinha mudado.
     */
    const map = mapaPlano(128, 128);
    const antes = { collision: map.collision, surface: map.surface, heightmap: map.heightmap };
    const depois = {
      collision: map.collision.map((c) => c),
      surface: map.surface.map((s) => s),
      heightmap: map.heightmap.map((h) => h),
    };
    expect(chunksSujos(map, antes, depois)).toHaveLength(0);
  });

  it("desfazer uma GERAÇÃO suja o mapa quase inteiro — e é por isso que a ordem importa", () => {
    /**
     * Este é o caso do relato. Uma geração procedural (colinas, vegetação,
     * relevo) escreve em boa parte do mapa; desfazê-la escreve de volta na mesma
     * área, e aí a diferença de valor está em toda parte.
     *
     * Com o descarte imediato isso era o mapa inteiro saindo do desenho e
     * voltando aos poucos, a 6 ms por quadro — o "quadrado cinza". Com a troca,
     * o mesmo número de chunks é reconstruído sem nenhum deles sair da tela.
     */
    const map = mapaPlano(128, 128);
    const antes = { collision: map.collision, surface: map.surface, heightmap: map.heightmap };
    const heightmap = map.heightmap.map((_, i) => (i % 7 === 0 ? 2 : 0));
    const sujos = chunksSujos(map, antes, { ...antes, heightmap });
    const { cols, rows } = chunkCounts(map);
    expect(sujos).toHaveLength(cols * rows);
    // e são muitos: 128/32 = 4 → 16 chunks, ~200 KB de geometria cada
    expect(cols * rows).toBeGreaterThan(8);
    expect(CHUNK_CELLS).toBe(32);
  });

  it("mapa de outro tamanho suja tudo sem comparar célula a célula", () => {
    // trocar de mapa: os arrays têm comprimento diferente, e aí não há
    // correspondência de índice que signifique alguma coisa
    const map = mapaPlano(64, 64);
    const antes = { collision: map.collision, surface: map.surface, heightmap: map.heightmap };
    const outro = mapaPlano(128, 128);
    const { cols, rows } = chunkCounts(map);
    const sujos = chunksSujos(map, antes, {
      collision: outro.collision,
      surface: outro.surface,
      heightmap: outro.heightmap,
    });
    expect(sujos).toHaveLength(cols * rows);
  });
});
