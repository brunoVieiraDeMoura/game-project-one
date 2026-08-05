import { fogDistances, type GameplayConfig } from "@ragnarok/game-data";

/**
 * O que a cena desenha ao redor do jogador — e a regra que amarra isso à névoa.
 *
 * Vive fora do `PlayView` para poder ser TESTADO: a regra "não desenhe o que a
 * névoa já escondeu" foi violada por 116 unidades sem ninguém perceber (medido
 * no jogo: 81% dos triângulos de chão estavam atrás de névoa opaca, 49 das 59
 * malhas), e regra que só existe em comentário volta a ser violada.
 *
 * A ordem é: `renderDistance` é o raio do mundo desenhado, a névoa é uma FRAÇÃO
 * dele e fecha ANTES da malha acabar. Assim a borda do terreno nunca aparece
 * recortada contra o céu — e nada é desenhado depois dela.
 */

/**
 * Folga além da névoa, em unidades: o passo do CENTRO DE VISÃO.
 *
 * O centro é recalculado a cada 16 unidades andadas (`useViewCenter`), não a
 * cada quadro — então o jogador pode estar até um passo à frente do centro que
 * o culling usou. Sem essa folga, a beirada do que ele enxerga abriria buraco
 * enquanto o centro não atualiza.
 *
 * Não é mais preciso somar meia diagonal de chunk: o `SquareTerrain` passou a
 * medir a distância até a CAIXA do chunk, e não até o centro dele.
 */
const FOLGA_DE_CHUNK = 16;

export interface RaiosDeVisao {
  /** raio em que a malha do chão é montada e desenhada */
  terreno: number;
  /** raio em que os props do mapa são desenhados */
  props: number;
  /** onde a névoa começa a desbotar */
  fogNear: number;
  /** onde a névoa fica opaca — além disto não há o que ver */
  fogFar: number;
}

export function raiosDeVisao(cfg: GameplayConfig): RaiosDeVisao {
  const { near, far } = fogDistances(cfg);
  /**
   * O desenho acaba onde a NÉVOA acaba, não onde o raio acaba.
   *
   * O `renderDistance` continua sendo o teto (e o número que se ajusta), mas
   * quem corta é a névoa: como ela é 92% do raio, sobrariam 8% de malha em
   * branco opaco — 10 unidades num raio de 130, mas 56 num raio de 700. O teste
   * de orçamento pegou justamente esse caso.
   */
  const desenhado = Math.min(cfg.renderDistance, far + FOLGA_DE_CHUNK);
  return { terreno: desenhado, props: desenhado, fogNear: near, fogFar: far };
}
