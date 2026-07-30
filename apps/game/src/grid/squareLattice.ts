import type { CellLattice } from "@ragnarok/engine-core";
import { squareToWorld, worldToSquare } from "./squareGrid";

/**
 * Lattice quadrada do tamanho da célula do mundo (2.0), com os OITO vizinhos.
 *
 * O `engine-core` já anda em grade quadrada quando nenhuma lattice é passada
 * (`grid.ts` dá o passo por `Math.sign` nos dois eixos), mas ali a célula é o
 * `map.cellSize` do GameMap — que vale 5 e não tem relação com o tamanho do
 * mundo desenhado. Passar esta lattice amarra o passo do movimento à MESMA
 * célula que o terreno usa para desenhar.
 *
 * Os vizinhos são declarados de propósito, em vez de deixar o controller cair no
 * caminho do `sign`: com a lista, ele testa o segundo melhor candidato quando o
 * primeiro está bloqueado (`pickNeighbor` em engine-core/movement/grid.ts), que
 * é o que faz o personagem contornar a quina de uma parede em vez de parar
 * colado nela.
 */
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

export const SQUARE_LATTICE: CellLattice = {
  toCell(x, z) {
    const { col, row } = worldToSquare(x, z);
    return { cx: col, cz: row };
  },
  center(cx, cz) {
    return squareToWorld(cx, cz);
  },
  neighbors(cx, cz) {
    return OFFSETS.map(([dx, dz]) => ({ cx: cx + dx, cz: cz + dz }));
  },
};
