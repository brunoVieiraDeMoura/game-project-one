import { fogDistances, type GameplayConfig } from "@ragnarok/game-data";

/**
 * O que a cena desenha ao redor do jogador — QUATRO raios com responsabilidade
 * separada (Fase G da auditoria de render, `docs/claude-context/02-terrain-
 * rendering.md`).
 *
 * Antes da Fase G havia só dois números (`terreno`/`props`, sempre iguais, e a
 * névoa amarrada a ELES): o mundo "acabava" onde a névoa fechava — ~130
 * unidades de um mapa de 400 células — porque não existia nada depois da
 * névoa para o olho encontrar. Agora:
 *
 *  • `detalhe` — chunks completos e props do mundo PRÓXIMO. É o raio antigo,
 *    sem mudança de valor: continua sendo o teto de geometria cara.
 *  • `entidades` — visibilidade de mob/player/npc. **Antes disto, `NetEntity`/
 *    `AlvoPorTab`/`AssistenciaDeMira` liam `fogFar` direto** — e esticar a
 *    névoa para o horizonte sem separar os dois faria entidade renderizar (e
 *    ser alvejável) a centenas de unidades de distância, uma regressão de
 *    custo disfarçada de melhoria visual. Vale SEMPRE `detalhe`, nunca
 *    `horizonte`.
 *  • `horizonte` — até onde a malha decimada (`grid/HorizonMesh`) cobre. Ela
 *    cobre o MAPA INTEIRO sempre (é 1 malha, ~5k triângulos, construída uma
 *    vez), então este número não limita o que ela desenha — ele só ancora
 *    onde a névoa deve fechar, para o horizonte desbotar na cor do céu em vez
 *    de aparecer como um degrau.
 *  • `fogNear`/`fogFar` — agora fração do HORIZONTE, não do detalhe: é o que
 *    dá lugar para o mundo simplificado existir ANTES da névoa ficar opaca.
 */

/**
 * Quanto o horizonte estende ALÉM do raio de detalhe, em unidades.
 *
 * Aditivo, não multiplicativo: um fator fixo (`detalhe × K`) dispararia junto
 * com `renderDistance` — um admin pedindo raio 1000 (o teto testado em
 * `perf/desempenho.test.ts`) ganharia um horizonte de milhares de unidades
 * por um número que não escolheu. Com 470, o default (130) chega a ~600 —
 * a referência usada no resto desta auditoria — e o mesmo ganho absoluto
 * vale em qualquer raio.
 */
const ADICIONAL_DE_HORIZONTE = 470;

export interface RaiosDeVisao {
  /** raio em que chão detalhado (chunk completo) e props do mapa desenham */
  detalhe: number;
  /** raio em que mob/player/npc desenham e podem ser alvejados — NUNCA `horizonte` */
  entidades: number;
  /** até onde a malha decimada do horizonte serve de âncora para a névoa */
  horizonte: number;
  /** onde a névoa começa a desbotar */
  fogNear: number;
  /** onde a névoa fica opaca — depois disto só a malha do horizonte, sem "parede" */
  fogFar: number;
}

export function raiosDeVisao(cfg: GameplayConfig): RaiosDeVisao {
  /**
   * O detalhe não é mais limitado pela névoa: a névoa agora fecha lá no
   * horizonte, bem depois de `renderDistance`. O raio de detalhe É
   * `renderDistance` — continua sendo o número que o admin ajusta.
   */
  const detalhe = cfg.renderDistance;
  const horizonte = detalhe + ADICIONAL_DE_HORIZONTE;
  // reaproveita as MESMAS frações (fogNearFrac/fogFarFrac) que antes eram
  // aplicadas a `renderDistance` — só o raio-base delas muda, de `detalhe`
  // para `horizonte`, então o admin não ganha campo novo para configurar
  const { near, far } = fogDistances({ ...cfg, renderDistance: horizonte });
  return { detalhe, entidades: detalhe, horizonte, fogNear: near, fogFar: far };
}
