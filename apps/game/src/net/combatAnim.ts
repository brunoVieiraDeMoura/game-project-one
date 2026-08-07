/**
 * Pulsos de combate: quando cada entidade bateu, começou a conjurar ou soltou
 * a magia — na hora de tocar a animação certa, não na hora de mostrar dano.
 *
 * Mesmo desenho do `net/ameacas`: os eventos (`entity:action`, `skill:casting`,
 * `skill:cast`) já chegam com o `gid` de quem agiu, então não custa nada
 * GUARDAR o instante. Fora do zustand de propósito — isto é lido no `useFrame`
 * de CADA `NetPlayer`/`NetEntity`, por quadro, e um store publicaria um estado
 * novo a cada golpe só para fazer a árvore reconciliar por um número que a
 * animação lê e esquece.
 */

export type PulsoTipo = "attack" | "castStart" | "castRelease";

interface Pulso {
  tipo: PulsoTipo;
  /** instante do pulso — é ele que diz se já foi CONSUMIDO */
  em: number;
  /** só para `castStart`: por quanto tempo a conjuração deve durar na tela */
  duracaoMs?: number;
}

const ultimoPulso = new Map<number, Pulso>();

function marcar(gid: number, tipo: PulsoTipo, agora: number, duracaoMs?: number): void {
  ultimoPulso.set(gid, { tipo, em: agora, duracaoMs });
}

/** um golpe básico (ou de skill instantânea) saiu de `gid` */
export function marcarAtaque(gid: number, agora: number): void {
  marcar(gid, "attack", agora);
}

/** `gid` começou a carregar uma skill — a barra de cast do servidor mediu `duracaoMs` */
export function marcarCastStart(gid: number, agora: number, duracaoMs: number): void {
  marcar(gid, "castStart", agora, duracaoMs);
}

/** a skill de `gid` SAIU (resolveu no servidor) */
export function marcarCastRelease(gid: number, agora: number): void {
  marcar(gid, "castRelease", agora);
}

/** o último pulso de `gid`, se houver — quem lê decide se já o consumiu (`em`) */
export function pulsoDe(gid: number): Pulso | undefined {
  return ultimoPulso.get(gid);
}

/**
 * Esquece tudo — fim de sessão ou troca de mapa.
 *
 * O gid é reciclado pelo servidor; sem isto, um `gid` velho poderia disparar a
 * animação de combate de outra criatura que nasceu com o mesmo número.
 */
export function limparPulsosDeCombate(): void {
  ultimoPulso.clear();
}
