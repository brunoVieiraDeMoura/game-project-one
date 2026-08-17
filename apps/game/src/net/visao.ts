/**
 * "Dá para ver o alvo?" — registrado a partir de fora, mesmo padrão do
 * `net/pararMovimentoDeAcao.ts`.
 *
 * `acoes.ts` (atacar/castarEmAlvo) decide SE dispara, mas quem tem mapa,
 * mapping e a posição interpolada de cada entidade é o `NetPlayer` — sem essa
 * ponte, checar linha de visão de fora do componente exigiria duplicar
 * `cellToWorld`/`interpolatedCell` num módulo que não deveria saber de cena.
 *
 * Sem registro (fora de sessão, ou o instante entre montar e registrar), a
 * checagem cai aberta (`true`) — mesma filosofia de `temPathfinder()`: não
 * travar o jogo por falta de um dado opcional.
 */

let checarFn: ((gid: number) => boolean) | null = null;

export function registrarChecagemDeVisao(fn: ((gid: number) => boolean) | null): void {
  checarFn = fn;
}

export function temLinhaDeVisao(gid: number): boolean {
  return checarFn ? checarFn(gid) : true;
}
