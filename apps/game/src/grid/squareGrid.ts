/**
 * Grade QUADRADA — a geometria do Ragnarok, em 3D.
 *
 * No RO o mundo é uma matriz de células quadradas e o personagem anda de célula
 * em célula, oito direções, diagonal contando como um passo. É exatamente o que
 * o servidor manda (`worldStore` já usa distância de Chebyshev e passo de rei);
 * o que faltava era o MUNDO ser desenhado nessa mesma grade.
 *
 * Este módulo é o espelho quadrado de `hex/hexGrid.ts`, com duas diferenças que
 * são o motivo dele existir:
 *
 *  1. **Sem termo de paridade.** `hexToWorld` faz `x = W * (col + 0.5*(row & 1))`,
 *     e `&` trunca para inteiro. Como a célula interpolada é FRACIONÁRIA, ao
 *     cruzar `row = 3.0` o X saltava meia célula num único frame — o zigue-zague
 *     que se sentia andando para o norte. Aqui a conta é linear em col e row,
 *     então célula fracionária vira posição contínua por construção.
 *  2. **Célula isotrópica.** O hexágono anda 2.0 na horizontal e 1.732 na
 *     vertical; como o rAthena cobra o mesmo tempo por célula em qualquer
 *     direção, andar para o norte parecia 13% mais lento. Aqui X e Z medem o
 *     mesmo.
 *
 * O tamanho é FIXO em 2.0 unidades por célula — o mesmo passo horizontal do
 * hexágono de hoje, para a sensação de escala não mudar, e o mesmo valor em que
 * câmera, névoa e alcance de render já estão calibrados. Com `charScale = 1` e
 * o modelo KayKit de ~1,8 de altura, o personagem ocupa uma célula: a proporção
 * do Ragnarok. Diferente do hex, esta grade NÃO passa por `hexScale` — um
 * `hexScale: 10` viraria um mapa 400×400 de 8.000 unidades de lado, além do
 * `camera.far`, e desafinaria toda a config de distância de uma vez.
 */

/** lado da célula em unidades de mundo (igual ao passo horizontal do hexágono) */
export const SQUARE_SIZE = 2.0;

/** altura de um nível do heightmap, em unidades de mundo */
export const SQUARE_LEVEL_HEIGHT = 1.0;

export function SQUARE_W(): number {
  return SQUARE_SIZE;
}
export function SQUARE_V(): number {
  return SQUARE_SIZE;
}

/**
 * Centro da célula (col,row) no mundo XZ.
 *
 * Linear nos dois argumentos: `col`/`row` fracionários — que é como a
 * interpolação de movimento chega aqui — devolvem posição contínua, sem degrau.
 */
export function squareToWorld(col: number, row: number): { x: number; z: number } {
  return { x: (col + 0.5) * SQUARE_SIZE, z: (row + 0.5) * SQUARE_SIZE };
}

/** célula que contém o ponto de mundo (inverso exato de `squareToWorld`) */
export function worldToSquare(x: number, z: number): { col: number; row: number } {
  return { col: Math.floor(x / SQUARE_SIZE), row: Math.floor(z / SQUARE_SIZE) };
}

/** topo do chão no mundo (y) para um dado nível do heightmap */
export function squareLevelToY(level: number): number {
  return level * SQUARE_LEVEL_HEIGHT;
}
