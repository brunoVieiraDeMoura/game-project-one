import { create } from "zustand";

/**
 * Quem o clique acertaria AGORA, se saísse deste ponto.
 *
 * O pedido original era puxar o cursor até o monstro. O navegador não deixa:
 * não existe API que MOVA o ponteiro do sistema — o Pointer Lock só o esconde e
 * entrega deslocamentos relativos, e adotá-lo obrigaria a desenhar o cursor
 * inteiro em DOM e a inventar um modo de saída para usar menu e chat.
 *
 * O que dá para fazer — e resolve o propósito, que era "auxiliar no clique" — é
 * mostrar a trava: o mob que a assistência escolheu acende enquanto o mouse
 * passa perto dele. O jogador vê em quem vai bater ANTES de clicar, que é a
 * informação que o puxão do cursor daria.
 *
 * Mora num store porque quem CALCULA (o `PlayView`, que tem o mundo e a
 * conversão de célula) e quem DESENHA (cada `NetEntity`) não se conhecem.
 */

/**
 * O que o clique faria com o alvo travado.
 *
 * O clique LÊ isto em vez de refazer a conta — ver `PlayView.AssistenciaDeMira`.
 * Antes havia duas execuções da mesma função em instantes diferentes (uma por
 * quadro para acender, outra no clique para agir), e o mouse podia ter andado
 * entre elas: acendia um monstro e o clique pegava outro.
 */
export type AlvoTravado =
  | { gid: number; tipo: "mob" }
  | { gid: number; tipo: "item" }
  | null;

interface SoftLockState {
  alvo: AlvoTravado;
  apontar: (alvo: AlvoTravado) => void;
}

export const useSoftLockStore = create<SoftLockState>((set) => ({
  alvo: null,
  // só publica na TROCA: isto é alimentado por quadro, e um `set` com o mesmo
  // valor faria o zustand avaliar o seletor de toda entidade montada 60×/s
  apontar: (alvo) =>
    set((s) => {
      const igual = s.alvo?.gid === alvo?.gid && s.alvo?.tipo === alvo?.tipo;
      return igual ? s : { alvo };
    }),
}));
