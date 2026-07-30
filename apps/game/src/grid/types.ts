import type { GameMap } from "@ragnarok/map-format";
import type { CellLattice, TerrainQuery } from "@ragnarok/engine-core";

/**
 * A forma da grade de um mapa — o contrato que apaga os `if (isHex)` espalhados
 * pela cena.
 *
 * Existem duas geometrias no projeto e elas não vão se fundir:
 *  • hexagonal, dos mapas autorados no editor (`terrainMode: "blocks"`), com
 *    peças KayKit de 6 lados;
 *  • quadrada, dos mapas do rAthena (`terrainMode: "square"`), onde uma célula
 *    do servidor é uma célula do mundo.
 *
 * Quem desenha, quem move e quem converte célula↔mundo pede a grade do mapa e
 * não pergunta qual é. Antes disso, o mesmo `map.terrainMode === "blocks"` era
 * decidido em treze lugares — e dois deles (culling de props e névoa) só valiam
 * para o hex, o que só se descobria lendo linha a linha.
 */
export interface WorldGrid {
  /** identifica a implementação (debug e escolhas de render) */
  readonly kind: "hex" | "square";
  /** centro da célula no mundo XZ; aceita col/row FRACIONÁRIOS (interpolação) */
  cellToWorld(col: number, row: number): { x: number; z: number };
  /** célula que contém o ponto de mundo */
  worldToCell(x: number, z: number): { col: number; row: number };
  /** largura/profundidade de uma célula em unidades de mundo */
  cellWidth(): number;
  cellDepth(): number;
  /** topo do chão (y) para um nível do heightmap */
  levelToY(level: number): number;
  /** lattice do movimento em grade (engine-core) */
  readonly lattice: CellLattice;
  /**
   * Células vizinhas de (col,row) — 6 no hexágono, 4 no quadrado.
   *
   * É a vizinhança de PINTURA e de propagação (pincel, flood fill, margem de
   * rio), não a do movimento: andar em diagonal é coisa do `lattice`.
   */
  neighbors(col: number, row: number): Array<[number, number]>;
  /**
   * Colisão + altura deste mapa.
   *
   * `includeProps: false` ignora os objetos do mapa e devolve só o terreno — é
   * o que o modo ONLINE precisa, porque lá quem decide passagem é o servidor,
   * que não conhece os props autorados no editor.
   */
  terrainQuery(map: GameMap, opts?: { includeProps?: boolean }): TerrainQuery;
  /** extensão do mundo para o plano de clique e a névoa */
  extent(map: GameMap): { width: number; depth: number; cx: number; cz: number };
  /** meia-largura do marcador de destino no chão */
  markerRadius(): number;
}
