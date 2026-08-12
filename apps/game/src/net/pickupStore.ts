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

/**
 * Por quanto tempo DEPOIS de mandar `item:pickup` ainda se engole o pulso de
 * combate (animação em `NetPlayer`, voz/SFX de arma em `useWorldEvents`).
 *
 * `parar()` limpa `alvo` NO MESMO INSTANTE em que o pedido sai — antes mesmo
 * do servidor responder. Um `action:attack` que já estava em voo (`stepaction`,
 * unit.cpp:2959) resolve DEPOIS: o `entity:action` chega com `alvo` já nulo, e
 * sem esta janela ele tocava a animação/som de ataque (inclusive "erro", se o
 * golpe atrasado deu `damage === 0`) no meio do caminho até o item — o
 * jogador clicou pra PEGAR, não pra bater. Ver o uso em `NetPlayer.tsx` e
 * `useWorldEvents.ts`. 1 s é generoso sobre um round-trip de rede + o tick do
 * servidor.
 */
export const PICKUP_ENGOLE_PULSO_MS = 1000;

interface PickupState {
  alvo: AlvoDeColeta | null;
  /** quando o último `item:pickup` saiu — ver `PICKUP_ENGOLE_PULSO_MS` */
  ultimoPedidoEm: number;
  buscar: (a: Omit<AlvoDeColeta, "desde">) => void;
  parar: () => void;
  /** chamar onde `item:pickup` é EMITIDO de verdade (`NetPlayer.buscarItem`) */
  marcarPedido: (now: number) => void;
}

export const usePickupStore = create<PickupState>((set) => ({
  alvo: null,
  ultimoPedidoEm: 0,
  buscar: (a) => set({ alvo: { ...a, desde: performance.now() } }),
  parar: () => set({ alvo: null }),
  marcarPedido: (now) => set({ ultimoPedidoEm: now }),
}));

/** true enquanto um pulso de combate atrasado deve ser engolido (ver acima) */
export function pegandoItem(now: number): boolean {
  const s = usePickupStore.getState();
  return s.alvo !== null || now - s.ultimoPedidoEm < PICKUP_ENGOLE_PULSO_MS;
}
