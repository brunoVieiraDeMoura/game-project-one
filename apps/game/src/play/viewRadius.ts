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
 * por um número que não escolheu. O mesmo ganho absoluto vale em qualquer raio.
 *
 * **260, não mais 470** (otimização de renderização, prioridade 6-7): com
 * 470 o default (130) chegava a ~600 — o horizonte (e portanto a névoa,
 * `fogFar = horizonte × fogFarFrac`) fechava tarde demais, e a malha
 * decimada (`grid/HorizonMesh`) cobria o mapa quase inteiro sempre visível,
 * bem além de onde ela realmente precisa aparecer. Com 260: horizonte≈390,
 * `fogFar≈359` — o mundo simplificado ainda tem ~260 unidades pra existir
 * ANTES da névoa fechar (o espaço que os dois anéis de `HorizonMesh`, médio e
 * distante, usam — ver `grid/HorizonMesh.tsx`), só que a névoa esconde o fim
 * do mapa bem mais cedo, sem cortar geometria — é a fog fazendo o trabalho de
 * "aproximar a distância efetiva" sem criar um corte abrupto no horizonte.
 */
const ADICIONAL_DE_HORIZONTE = 260;

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

export function raiosDeVisao(cfg: GameplayConfig, mapaMaiorLado?: number): RaiosDeVisao {
  /**
   * O detalhe não é mais limitado pela névoa: a névoa agora fecha lá no
   * horizonte, bem depois de `renderDistance`. O raio de detalhe É
   * `renderDistance` — continua sendo o número que o admin ajusta.
   */
  const detalhe = cfg.renderDistance;
  /**
   * `mapaMaiorLado` (opcional) — maior lado do mapa em unidades de mundo
   * (`Math.max(largura, profundidade)`, ver `grid.extent(map)`). Sem isso a
   * névoa fecha a ~390 unidades sempre, calibrado pros mapas de 400×400 do
   * rAthena real — num mapa pequeno autorado (128 células = 256 unidades,
   * caso do showcase `gpqa01`) o fogFar nunca chegava, e a névoa
   * simplesmente NUNCA aparecia: o mapa inteiro cabia bem antes de onde ela
   * começava a desbotar. O teto por mapa resolve os dois tamanhos com a
   * MESMA fórmula, sem campo novo pro admin mexer.
   */
  const horizonteBruto = detalhe + ADICIONAL_DE_HORIZONTE;
  const horizonte = mapaMaiorLado ? Math.min(horizonteBruto, mapaMaiorLado) : horizonteBruto;
  // reaproveita as MESMAS frações (fogNearFrac/fogFarFrac) que antes eram
  // aplicadas a `renderDistance` — só o raio-base delas muda, de `detalhe`
  // para `horizonte`, então o admin não ganha campo novo para configurar
  const { near, far } = fogDistances({ ...cfg, renderDistance: horizonte });
  return { detalhe, entidades: detalhe, horizonte, fogNear: near, fogFar: far };
}
