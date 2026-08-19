import { create } from "zustand";

/**
 * Conjuração EM ANDAMENTO do próprio personagem.
 *
 * Como no `cooldownStore`, guarda-se o INSTANTE em que termina e não o que
 * falta: o restante muda a cada quadro e passar isso por `setState` repintaria
 * o HUD 60 vezes por segundo. Quem desenha a barra lê o fim e anima sozinho.
 *
 * Só o próprio personagem entra aqui — a conjuração dos outros já vira efeito
 * na cena (`vfx`), e uma barra por monstro no HUD não faria sentido.
 */
export interface CastAtual {
  skillId: number;
  /** performance.now() em que a conjuração acaba */
  fim: number;
  duracaoMs: number;
  /**
   * gid do alvo — só para skill de ENTIDADE (`skill:casting.targetGid > 0`).
   * Ausente em skill de chão/AOE, que não tem "virar para o alvo": o servidor
   * não manda entidade nenhuma para essas, só a célula. `NetPlayer` usa este
   * campo para saber se deve girar o personagem durante o cast.
   */
  alvoGid?: number;
}

interface CastState {
  atual: CastAtual | null;
  comecar: (skillId: number, duracaoMs: number, alvoGid?: number) => void;
  /** conjuração terminou, foi interrompida ou a sessão acabou */
  parar: () => void;
}

export const useCastStore = create<CastState>((set) => ({
  atual: null,
  comecar: (skillId, duracaoMs, alvoGid) =>
    // Skill instantânea chega com duração 0 (e muitas com 1–2 quadros): piscar
    // a barra nesse caso é pior que não mostrar nada.
    set(duracaoMs >= 150 ? { atual: { skillId, fim: performance.now() + duracaoMs, duracaoMs, alvoGid } } : { atual: null }),
  parar: () => set({ atual: null }),
}));

/**
 * CONJURANDO AGORA — e por isso o personagem não pode andar.
 *
 * Não é regra nossa, é a do servidor: `unit_can_move` (unit.cpp:1813) devolve
 * `false` enquanto `ud->skilltimer` está ativo. Sem consultar isto, o cliente
 * PREVIA uma caminhada que o rAthena ia recusar — e recusar do pior jeito, porque
 * `unit_walktoxy` com pedido de cliente não descarta: ele AGENDA
 * (`add_timer(ud->canmove_tick+1, unit_delay_walktoxy_timer, …)`, unit.cpp:876).
 * O clique dado no meio da conjuração ressuscitava depois dela e levava o
 * personagem para um destino de segundos atrás.
 *
 * Compara com `fim` em vez de olhar só `atual !== null`: a conjuração
 * INTERROMPIDA nem sempre traz um `skill:cast` para limpar o store, e um `atual`
 * pendurado travaria a caminhada para sempre. O relógio resolve sozinho.
 *
 * Fora daqui, de propósito: `SA_FREECAST` (o Sage anda conjurando) é a exceção
 * do próprio `unit_can_move` e vai precisar do estado da skill, que o cliente
 * ainda não tem. Enquanto isso, bloquear é o que bate com o servidor.
 */
export function estaCastando(agora: number): boolean {
  const atual = useCastStore.getState().atual;
  return atual !== null && agora < atual.fim;
}
