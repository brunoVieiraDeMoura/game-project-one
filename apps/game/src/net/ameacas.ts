/**
 * Quem está batendo em VOCÊ, agora.
 *
 * A assistência de mira precisa disso: no meio de três monstros, o que se quer
 * clicar é quase sempre o que está te acertando, não o que está parado ao lado.
 *
 * O dado sai de graça — o `ZC_NOTIFY_ACT` já chega como `entity:action` e traz
 * quem bateu e em quem. Não há evento novo nem custo de rede; o que faltava era
 * guardar.
 *
 * Fora do zustand de propósito: isto é lido no `useFrame`, por candidato, por
 * quadro. Um store publicaria estado a cada golpe e faria a árvore reconciliar
 * por causa de um número que ninguém desenha.
 */

/** gid do atacante → instante do último golpe em você */
const ultimoGolpe = new Map<number, number>();

/**
 * Por quanto tempo um monstro continua contando como ameaça.
 *
 * Tem de cobrir o intervalo entre golpes do bicho mais lento, senão a
 * prioridade piscaria entre um golpe e o seguinte. Quatro segundos também é o
 * tempo em que "ele estava me batendo" ainda descreve a situação — passado
 * isso, ele desistiu ou morreu, e deixa de ser prioridade sozinho, sem ninguém
 * precisar limpar nada.
 */
export const AMEACA_VALIDADE_MS = 4000;

/** um golpe em você: marca o atacante */
export function marcarAmeaca(gid: number, agora: number): void {
  ultimoGolpe.set(gid, agora);
}

/** este monstro está te batendo? */
export function estaMeAtacando(gid: number, agora: number): boolean {
  const t = ultimoGolpe.get(gid);
  return t !== undefined && agora - t < AMEACA_VALIDADE_MS;
}

/**
 * Esquece tudo — fim de sessão ou troca de mapa.
 *
 * Sem isto o `Map` cresceria com o gid de todo mob que já te bateu na sessão. O
 * gid é reciclado pelo servidor, então um gid velho poderia até apontar para
 * outra criatura.
 */
export function limparAmeacas(): void {
  ultimoGolpe.clear();
}

/** só para teste: quantos gids estão guardados */
export function ameacasVivas(agora: number): number {
  let n = 0;
  for (const t of ultimoGolpe.values()) if (agora - t < AMEACA_VALIDADE_MS) n++;
  return n;
}
