/**
 * Tracer de movimento (DEV) — `__mov()` no console.
 *
 * Existe porque "melhorou" não é resposta. O problema que ele mede é a DERIVA:
 * o cliente desenha o personagem a partir da própria posição visual e ignora o
 * `from` que o servidor manda em cada pacote de movimento, então o erro entre os
 * dois nunca é lido de volta — só cresce. Enquanto nada pede correção os dois
 * seguem discordando calados; aí uma skill (que chama `unit_stop_walking` com
 * `USW_FIXPOS`, unit.cpp:2477) força um `clif_fixpos` e o jogador vê o
 * personagem voltar 2 ou 3 células de uma vez.
 *
 * As 2-3 células não são o defeito: são a MEDIDA dele. É isso que este módulo
 * transforma em número, do mesmo jeito que a auditoria do `map_cache` provou a
 * divergência de colisão em vez de deduzi-la.
 *
 * O que se espera depois das correções: `deriva.mediana` abaixo de 1 célula,
 * `semResposta` em 0 e `warps.teleportes` só quando houver `@jump`/Asa de
 * verdade.
 */

/** quantos eventos ficam no anel */
const CAPACIDADE = 200;

export interface EventoMov {
  t: number;
  tipo: "pedido" | "movimento" | "warp" | "sem-resposta" | "predicao" | "recuada";
  /** para "movimento" e "warp": distância entre a posição VISUAL e a do servidor */
  deriva?: number;
  detalhe?: Record<string, unknown>;
}

const anel: EventoMov[] = [];
const derivas: number[] = [];
let pedidos = 0;
let semResposta = 0;
let warpsCorrigidos = 0;
let warpsTeleporte = 0;
let recuadas = 0;
let maiorRecuada = 0;
let recuadaPorCausa: Record<string, number> = {};
let predicoes = 0;
let confirmadas = 0;
let divergentes = 0;

const ativo = import.meta.env.DEV;

function push(e: EventoMov) {
  anel.push(e);
  if (anel.length > CAPACIDADE) anel.shift();
}

export function movPedido(origem: { x: number; y: number }, alvo: { x: number; y: number }, passos: number): void {
  if (!ativo) return;
  pedidos++;
  push({ t: performance.now(), tipo: "pedido", detalhe: { origem, alvo, passos } });
}

/**
 * Um pacote de movimento chegou. `deriva` é o que interessa: a distância entre
 * onde o cliente estava DESENHANDO e a célula de onde o servidor diz que o
 * personagem saiu.
 */
export function movRecebido(deriva: number, detalhe?: Record<string, unknown>): void {
  if (!ativo) return;
  derivas.push(deriva);
  if (derivas.length > CAPACIDADE) derivas.shift();
  push({ t: performance.now(), tipo: "movimento", deriva, detalhe });
}

export function movWarp(deriva: number, teleporte: boolean): void {
  if (!ativo) return;
  if (teleporte) warpsTeleporte++;
  else warpsCorrigidos++;
  push({ t: performance.now(), tipo: "warp", deriva, detalhe: { teleporte } });
}

/** um `move:to` saiu e nenhum `self:move` respondeu — o servidor descartou calado */
export function movSemResposta(alvo: { x: number; y: number }): void {
  if (!ativo) return;
  semResposta++;
  push({ t: performance.now(), tipo: "sem-resposta", detalhe: { alvo } });
}

/**
 * O cliente PREVIU um movimento (começou a andar antes da resposta).
 *
 * A razão `divergentes / predicoes` é o número que diz se a predição é segura.
 * Ela só pode ser baixa porque o cliente recalcula o MESMO A* do servidor
 * (`net/pathfind`, portado de `path.cpp`) com as mesmas regras de alcance — se
 * subir, alguma dessas cópias saiu de sincronia com o rAthena, e aí o defeito é
 * a cópia, não a predição.
 */
export function movPredito(alvo: { x: number; y: number }, passos: number): void {
  if (!ativo) return;
  predicoes++;
  push({ t: performance.now(), tipo: "predicao", detalhe: { alvo, passos } });
}

/** o pacote do servidor bateu com o que foi previsto (nada se move na tela) */
export function movConfirmado(): void {
  if (!ativo) return;
  confirmadas++;
}

/**
 * O DESENHO ANDOU DE RÉ — o defeito que este projeto inteiro persegue.
 *
 * Existe porque "ainda tem algo fazendo retroceder" não é diagnóstico: são
 * quatro ações que escrevem a posição do personagem (predição, pacote do
 * servidor, fixpos e snap) e cada uma recua por um motivo diferente. O `causa`
 * do `SelfMotion` diz QUAL delas escreveu o trecho em que o recuo aconteceu, e
 * é isso que transforma o relato num lugar do código.
 *
 * Em regime tem de ser zero. `porCausa` é onde se olha primeiro.
 */
export function movRecuada(quanto: number, causa: string, detalhe?: Record<string, unknown>): void {
  if (!ativo) return;
  recuadas++;
  maiorRecuada = Math.max(maiorRecuada, quanto);
  recuadaPorCausa[causa] = (recuadaPorCausa[causa] ?? 0) + 1;
  push({ t: performance.now(), tipo: "recuada", deriva: quanto, detalhe: { ...detalhe, causa } });
}

/** o servidor discordou da predição: `deriva` é o tamanho da correção */
export function movDivergente(deriva: number, detalhe?: Record<string, unknown>): void {
  if (!ativo) return;
  divergentes++;
  push({ t: performance.now(), tipo: "predicao", deriva, detalhe: { ...detalhe, divergiu: true } });
}

function resumo() {
  const ordenadas = [...derivas].sort((a, b) => a - b);
  const mediana = ordenadas.length ? ordenadas[Math.floor(ordenadas.length / 2)]! : 0;
  return {
    deriva: {
      mediana: Math.round(mediana * 100) / 100,
      max: Math.round((ordenadas[ordenadas.length - 1] ?? 0) * 100) / 100,
      amostras: ordenadas.length,
    },
    pedidos,
    semResposta,
    warps: { corrigidos: warpsCorrigidos, teleportes: warpsTeleporte },
    /**
     * A saúde da PREDIÇÃO. `taxaDeErro` é o que se olha: alta significa que o
     * cliente está adivinhando errado, e adivinhar errado é pior que não
     * adivinhar — cada erro vira uma correção que o jogador vê.
     */
    predicao: {
      previstas: predicoes,
      confirmadas,
      divergentes,
      taxaDeErro: predicoes > 0 ? Math.round((divergentes / predicoes) * 1000) / 1000 : 0,
    },
    /**
     * O número que fecha o assunto: o desenho andou de ré quantas vezes, e por
     * culpa de QUEM. Em regime tem de ser zero.
     */
    recuadas: { total: recuadas, maior: Math.round(maiorRecuada * 1000) / 1000, porCausa: recuadaPorCausa },
    ultimos: anel.slice(-25),
  };
}

export function movReset(): void {
  anel.length = 0;
  derivas.length = 0;
  pedidos = 0;
  semResposta = 0;
  warpsCorrigidos = 0;
  warpsTeleporte = 0;
  predicoes = 0;
  confirmadas = 0;
  divergentes = 0;
  recuadas = 0;
  maiorRecuada = 0;
  recuadaPorCausa = {};
}

// `typeof window` porque este módulo é importado por TESTE (ambiente node)
if (ativo && typeof window !== "undefined") {
  (window as unknown as { __mov?: () => unknown; __movReset?: () => void }).__mov = resumo;
  (window as unknown as { __mov?: () => unknown; __movReset?: () => void }).__movReset = movReset;
}
