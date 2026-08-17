/**
 * "Vire para o alvo" — registrado a partir de fora, mesmo padrão do
 * `net/pararMovimentoDeAcao.ts` e do `net/visao.ts`.
 *
 * Toda skill de ALVO passa por `acoes.castarEmAlvo` antes de sair — é o ponto
 * central do fluxo de cast (ver o comentário do próprio arquivo). Girar o
 * personagem para o alvo pertence ali, não a cada skill: só o `NetPlayer` tem
 * o grupo do modelo e a posição interpolada das entidades, então o registro é
 * a mesma ponte de sempre.
 */

let olharFn: ((gid: number) => void) | null = null;

export function registrarOlharParaAlvo(fn: ((gid: number) => void) | null): void {
  olharFn = fn;
}

export function olharParaAlvo(gid: number): void {
  olharFn?.(gid);
}
