import type { GameplayConfig } from "@ragnarok/game-data";
import { raiosDeVisao, type RaiosDeVisao } from "./viewRadius";

/**
 * WORLD VISIBILITY BUDGET — a hierarquia central de visibilidade (seção 23 de
 * `render-tecnic.txt`).
 *
 * `viewRadius.ts` já resolve QUATRO raios (`detalhe`/`entidades`/`horizonte`/
 * `fogNear`/`fogFar`) a partir de `renderDistance` — este módulo NÃO troca
 * aquela função por outra: ele a ENVOLVE e acrescenta os raios de VEGETAÇÃO,
 * que antes de existir moravam espalhados em cada consumidor (`0,6 × detalhe`
 * dentro de `VegetationInstancer`, e o impostor de árvore SEM teto nenhum
 * dentro de `TreeImpostors` — a causa raiz documentada em `render-tecnic.txt`
 * seção 25).
 *
 * A regra que este módulo EXISTE para garantir, travada por teste
 * (`worldVisibility.test.ts`):
 *
 *   vegetacaoRasteira ≤ vegetacaoDetalhe ≤ limiteVegetacao ≤ fogFar < horizonte
 *
 * Ou seja: nenhuma representação de vegetação (rasteira, 3D ou impostor) pode
 * ficar visível além de onde a névoa já fechou — que por sua vez nunca
 * ultrapassa a malha do horizonte. É a versão em código do §48 do pedido
 * ("vegetação nunca pode ter alcance maior que a superfície que a sustenta").
 */
export interface VisibilidadeDoMundo extends RaiosDeVisao {
  /**
   * Teto ABSOLUTO de qualquer representação de vegetação (hoje só o
   * impostor de árvore/arbusto lê isto — árvore 3D e vegetação rasteira já
   * são mais curtas que isto por natureza). Antes desta Fase, `TreeImpostors`
   * desenhava toda instância fora do raio de detalhe SEM teto — instâncias na
   * diagonal de um mapa grande chegavam a 3× `fogFar`, desenhadas 100% atrás
   * de névoa opaca (medido: `_medirCoerencia.test.ts`, causa B).
   *
   * Igual a `fogFar`, não um número novo: além de `fogFar` o fragmento já é
   * 100% cor-de-névoa — desenhar ali é trabalho jogado fora, nunca visual.
   */
  limiteVegetacao: number;
  /** raio em que a árvore/arbusto 3D real desenha — hoje igual a `detalhe` (a troca pro impostor acontece aqui) */
  vegetacaoDetalhe: number;
  /** raio de corte da vegetação RASTEIRA (grama/flor/planta) — fração de `detalhe`, ver `FRACAO_VEGETACAO_RASTEIRA` */
  vegetacaoRasteira: number;
}

/**
 * Fração de `detalhe` em que grama/flor/planta somem — migrado de
 * `props/VegetationInstancer.tsx` (`RAIO_RASTEIRA_FRAC`) para cá: é uma
 * decisão de VISIBILIDADE (quando algo para de ser desenhado), não de
 * INSTANCING (como algo é desenhado) — pertence ao orçamento central, não ao
 * módulo que só sabe reescrever `instanceMatrix`.
 *
 * Valor inalterado (0,6): grama/flor/planta são rasteiras o bastante para
 * ficarem imperceptíveis bem antes do raio de detalhe acabar — ver o
 * raciocínio original em `render-tecnic.txt` seção 11.
 */
const FRACAO_VEGETACAO_RASTEIRA = 0.6;

export function visibilidadeDoMundo(cfg: GameplayConfig, mapaMaiorLado?: number): VisibilidadeDoMundo {
  const visao = raiosDeVisao(cfg, mapaMaiorLado);
  return {
    ...visao,
    limiteVegetacao: visao.fogFar,
    vegetacaoDetalhe: visao.detalhe,
    vegetacaoRasteira: visao.detalhe * FRACAO_VEGETACAO_RASTEIRA,
  };
}
