import { create } from "zustand";

/**
 * O alvo que o jogador mandou atacar, e onde ele estava da última vez.
 *
 * Existe porque **o rAthena não persegue por você**. Em `unit_attack_timer_sub`
 * (unit.cpp:3259) o ramo do MONSTRO chama `unit_walktobl` para se aproximar; o
 * ramo do jogador só manda `clif_movetoattack` (ZC_ATTACK_FAILURE_FOR_DISTANCE)
 * e desiste. Aproximar-se é trabalho do cliente — é o que o cliente oficial faz,
 * e é por isso que clicar num monstro longe não fazia nada aqui.
 *
 * O que este store guarda é a INTENÇÃO ("estou indo bater no gid X"), não o
 * combate: quem resolve acerto, dano e morte continua sendo o servidor. A
 * perseguição em si mora no `NetPlayer`, que é quem sabe pedir caminhada.
 */

export interface AlvoDeAtaque {
  gid: number;
  /** onde o servidor disse que ele está (célula do servidor) */
  x: number;
  y: number;
  /** alcance da arma, em células — vem no próprio pacote */
  range: number;
  /**
   * Onde o SERVIDOR diz que o personagem está, no instante da recusa.
   *
   * Vem no mesmo `ZC_ATTACK_FAILURE_FOR_DISTANCE` (`xPos`/`yPos`, clif.cpp:8179)
   * e é a única posição do jogador que não sofre da deriva do desenho. É por ela
   * que se decide se já dá para parar de andar — usar a interpolada faria o
   * cliente se dar por chegado uma célula antes, que foi exatamente o defeito
   * anterior.
   */
  euX: number;
  euY: number;
  /** quando essa posição chegou; velha demais, volta a valer a interpolada */
  euEm: number;
  /** quando a perseguição começou; serve para desistir se ela não terminar */
  desde: number;
  /**
   * O servidor recusou e ainda não foi repedido.
   *
   * É este sinalizador que faz o reenvio CONVERGIR em vez de virar spam: cada
   * `ZC_ATTACK_FAILURE_FOR_DISTANCE` arma um único pedido novo, e enquanto o
   * servidor não recusar de novo nada é reenviado. Se ele aceitou, o silêncio é
   * a resposta — e o ataque contínuo passa a ser dele.
   */
  pendente: boolean;
  /** instante do último `action:attack` que saiu por causa desta ordem */
  pedidoEm: number;
}

interface AttackState {
  alvo: AlvoDeAtaque | null;
  /**
   * Quando o servidor mostrou o personagem batendo pela última vez.
   *
   * É a única prova de que o ataque ENTROU. O `action:attack` não tem resposta
   * de sucesso — o servidor ou bate (e manda `ZC_NOTIFY_ACT`, que vira
   * `entity:action`) ou recusa por distância, ou engole o pedido no
   * `stepaction`. Sem olhar o golpe acontecendo, o cliente não tem como saber
   * em qual dos três caiu.
   */
  atacandoEm: number;
  /** um `entity:action` do PRÓPRIO personagem chegou */
  marcarAtaqueVisto: (agora: number) => void;
  /** o servidor recusou por distância: começa (ou renova) a aproximação */
  perseguir: (a: Pick<AlvoDeAtaque, "gid" | "x" | "y" | "range"> & { euX?: number; euY?: number }) => void;
  /** um `action:attack` acabou de sair; nada mais até o servidor recusar de novo */
  marcarPedido: (agora: number) => void;
  parar: () => void;
}

/**
 * A distância que o rAthena usa para o ataque PEDIDO PELO CLIENTE — portada de
 * `distance_client` (path.cpp:510).
 *
 * Não é Chebyshev. O comentário do próprio rAthena explica:
 *
 * ```c
 * // The client uses a circular distance instead of the square one. The circular
 * // distance is only used by units sending their attack commands via the client
 * temp_dist -= 0.1;  // Bonus factor used by client
 * // This affects even horizontal/vertical lines so they are one cell longer than expected
 * ```
 *
 * O −0,1 é o que faz o alcance 1 chegar a DUAS células na horizontal
 * (`floor(2 − 0,1)` = 1) e à diagonal (`floor(1,414 − 0,1)` = 1), mas não a
 * (2,1) (`floor(2,136 − 0,1)` = 2).
 *
 * Usar Chebyshev aqui era mais rígido que o servidor, e cobrava caro: o cliente
 * insistia em andar uma célula a mais mesmo com o servidor já satisfeito, esse
 * passo extra disparava outro `clif_fixpos` (unit.cpp:2975, mandado ANTES do
 * golpe), e o personagem era puxado para trás e empurrado para frente — o
 * "teleporte de algumas células antes de atacar".
 */
export function distanciaDeAtaque(dx: number, dy: number): number {
  return Math.max(0, Math.trunc(Math.hypot(dx, dy) - 0.1));
}

/**
 * Até onde andar para encostar num alvo — a célula AO LADO, não a dele.
 *
 * Pedir para andar até a célula do próprio monstro faz o personagem SEGUIR o
 * alvo: ele nunca "chega", porque o destino é onde o mob está, e o pedido é
 * refeito a cada volta da fila. Aqui a caminhada mira a célula a `alcance` do
 * mob na direção de quem persegue — e quando o SERVIDOR já se daria por
 * satisfeito, não há caminhada nenhuma a pedir.
 *
 * Devolve `null` quando já dá para bater.
 */
export function celulaParaEncostar(
  eu: { x: number; y: number },
  alvo: { x: number; y: number },
  alcance: number,
): { x: number; y: number } | null {
  const passos = Math.max(1, alcance);
  if (distanciaDeAtaque(alvo.x - eu.x, alvo.y - eu.y) <= passos) return null;
  const passoX = Math.sign(eu.x - alvo.x);
  const passoY = Math.sign(eu.y - alvo.y);
  // em cima dele (sinal 0 nos dois eixos) não há "ao lado" que faça sentido
  if (passoX === 0 && passoY === 0) return { ...alvo };
  return { x: alvo.x + passoX * passos, y: alvo.y + passoY * passos };
}

export const useAttackStore = create<AttackState>((set) => ({
  alvo: null,
  atacandoEm: 0,
  // ver bater é sinal de PROGRESSO: renova o relógio da desistência junto, senão
  // um combate longo seria abandonado no meio pelo teto de tempo
  marcarAtaqueVisto: (agora) =>
    set((s) => ({ atacandoEm: agora, alvo: s.alvo ? { ...s.alvo, desde: agora } : null })),
  perseguir: (a) =>
    set((s) => {
      const mesmo = s.alvo?.gid === a.gid ? s.alvo : null;
      const temPos = a.euX !== undefined && a.euY !== undefined;
      return {
        alvo: {
          gid: a.gid,
          x: a.x,
          y: a.y,
          range: a.range,
          // trocar de alvo reinicia o relógio da desistência; renovar o mesmo, não
          desde: mesmo ? mesmo.desde : performance.now(),
          pendente: true,
          pedidoEm: mesmo ? mesmo.pedidoEm : 0,
          euX: temPos ? a.euX! : (mesmo?.euX ?? 0),
          euY: temPos ? a.euY! : (mesmo?.euY ?? 0),
          euEm: temPos ? performance.now() : (mesmo?.euEm ?? 0),
        },
      };
    }),
  marcarPedido: (agora) => set((s) => (s.alvo ? { alvo: { ...s.alvo, pendente: false, pedidoEm: agora } } : s)),
  parar: () => set({ alvo: null }),
}));
