import { create } from "zustand";

/**
 * O que acabou de entrar na bolsa — a fila do aviso de loot.
 *
 * O rAthena manda `ZC_ITEM_PICKUP_ACK` quando o item é pego, e é ele que vira
 * `inv:add`. Sem um aviso, pegar coisa no chão não tinha retorno nenhum: o
 * jogador só descobria abrindo o Alt+E.
 *
 * É UM aviso, não uma fila: o drop novo SUBSTITUI o anterior. A pilha existia
 * para o segundo item não apagar o primeiro antes de ele ser lido, mas numa
 * caçada o que se lê é sempre o de cima — e quatro linhas empilhadas no meio do
 * topo da tela viram parede. Quem quer o histórico abre o Alt+E.
 */

export interface AvisoDeLoot {
  /** chave de render — o índice da bolsa se repete quando o item é usado */
  id: number;
  itemId: number;
  amount: number;
  /** quando expira (performance.now) */
  expiraEm: number;
}

/**
 * Quanto tempo cada aviso fica na tela.
 *
 * Tem de dar para ler um nome longo sem o jogador parar de jogar; menos que
 * isso e o aviso vira um piscar que não informa nada.
 */
export const LOOT_DURACAO_MS = 3200;

interface LootState {
  /** o aviso corrente; `null` = nada na tela */
  aviso: AvisoDeLoot | null;
  registrar: (itemId: number, amount: number, agora: number) => void;
  /** tira o que venceu; chamado por relógio curto, não por quadro */
  limpar: (agora: number) => void;
}

let seq = 0;

export const useLootStore = create<LootState>((set) => ({
  aviso: null,
  registrar: (itemId, amount, agora) =>
    set((s) => {
      /**
       * Pegar mais do MESMO item soma, em vez de recomeçar do um.
       *
       * O rAthena manda um `inv:add` por vez, então cinco poções chegam como
       * cinco eventos. Somando, a leitura é "Red Potion ×5" — que é o que o
       * jogador quer saber — e o relógio é renovado, senão o total apareceria já
       * prestes a sumir. Item DIFERENTE substitui, que é o pedido.
       */
      const atual = s.aviso;
      const mesmo = atual !== null && atual.itemId === itemId && atual.expiraEm > agora;
      return {
        aviso: {
          // a chave de render só muda quando o aviso é OUTRO: somando no mesmo
          // item, remontar o nó reiniciaria qualquer transição de entrada
          id: mesmo ? atual.id : ++seq,
          itemId,
          amount: mesmo ? atual.amount + amount : amount,
          expiraEm: agora + LOOT_DURACAO_MS,
        },
      };
    }),
  limpar: (agora) =>
    set((s) => (s.aviso !== null && s.aviso.expiraEm <= agora ? { aviso: null } : s)),
}));
