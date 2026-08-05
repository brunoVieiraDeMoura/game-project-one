import { create } from "zustand";

/**
 * O item que o jogador mandou pegar, e onde ele está.
 *
 * Mesma natureza do `attackStore`, e pelo mesmo motivo: o rAthena confere a
 * DISTÂNCIA em `pc_takeitem` (`pc.cpp`) e recusa em silêncio quando o item está
 * longe. Mandar `CZ.ITEM_PICKUP` de longe não fazia absolutamente nada — o
 * clique parecia morto.
 *
 * Aproximar-se é trabalho do cliente. Este store guarda só a INTENÇÃO; quem anda
 * é o `NetPlayer`, que é quem sabe pedir caminhada, e quem decide se o item é
 * seu continua sendo o servidor.
 */

export interface AlvoDeColeta {
  gid: number;
  /** célula do servidor onde o item caiu */
  x: number;
  y: number;
  /** quando começou, para desistir de um item inalcançável */
  desde: number;
}

interface PickupState {
  alvo: AlvoDeColeta | null;
  buscar: (a: Omit<AlvoDeColeta, "desde">) => void;
  parar: () => void;
}

export const usePickupStore = create<PickupState>((set) => ({
  alvo: null,
  buscar: (a) => set({ alvo: { ...a, desde: performance.now() } }),
  parar: () => set({ alvo: null }),
}));
