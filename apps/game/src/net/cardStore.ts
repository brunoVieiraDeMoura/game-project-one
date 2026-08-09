import { create } from "zustand";
import { gateway } from "./gateway";

/**
 * Composição de carta: duplo clique na carta pede a lista de equipamentos
 * compatíveis (`card:list`), escolher um manda o pedido de verdade
 * (`card:insert`). Os DOIS passos são o mesmo protocolo do rAthena
 * (CZ.REQ_ITEMCOMPOSITION_LIST → ZC.ITEMCOMPOSITION_LIST, depois
 * CZ.REQ_ITEMCOMPOSITION → ZC.ACK_ITEMCOMPOSITION — clif.cpp:7070-7142),
 * confirmados no source antes de escrever qualquer coisa nova.
 */

/** quanto esperar por uma resposta antes de considerar "sem opções"/"sem resposta" */
const TIMEOUT_MS = 3000;

type Estado = "esperando" | "pronto" | "vazio" | "aplicando" | "falhou";

interface CardState {
  cardIndex: number | null;
  estado: Estado;
  equipIndexes: number[];
  abrir: (cardIndex: number) => void;
  aplicarOpcoes: (cardIndex: number, equipIndexes: number[]) => void;
  escolher: (equipIndex: number) => void;
  aplicarResultado: (p: { equipIndex: number; cardIndex: number; success: boolean }) => void;
  fechar: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
function limparTimer(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

export const useCardStore = create<CardState>((set, get) => ({
  cardIndex: null,
  estado: "esperando",
  equipIndexes: [],

  abrir: (cardIndex) => {
    limparTimer();
    set({ cardIndex, estado: "esperando", equipIndexes: [] });
    gateway().emit("card:list", { index: cardIndex });
    // o rAthena NÃO manda nada (nem lista vazia) quando não há compatível
    // (clif.cpp: `if(!c) return;`) — silêncio depois do prazo É a resposta,
    // não uma falha de rede
    timer = setTimeout(() => {
      if (get().cardIndex === cardIndex && get().estado === "esperando") set({ estado: "vazio" });
    }, TIMEOUT_MS);
  },

  aplicarOpcoes: (cardIndex, equipIndexes) => {
    if (get().cardIndex !== cardIndex) return; // resposta de um pedido já abandonado
    limparTimer();
    set({ estado: equipIndexes.length > 0 ? "pronto" : "vazio", equipIndexes });
  },

  escolher: (equipIndex) => {
    const { cardIndex } = get();
    if (cardIndex == null) return;
    limparTimer();
    set({ estado: "aplicando" });
    gateway().emit("card:insert", { cardIndex, equipIndex });
    // idem: uma recusa de `pc_insert_card` antes de chamar `pc_delitem` (slot
    // cheio, item certo mas já mudou de estado etc.) não manda pacote nenhum
    timer = setTimeout(() => {
      if (get().cardIndex === cardIndex && get().estado === "aplicando") set({ estado: "falhou" });
    }, TIMEOUT_MS);
  },

  aplicarResultado: (p) => {
    if (get().cardIndex !== p.cardIndex) return;
    limparTimer();
    if (p.success) {
      set({ cardIndex: null, estado: "esperando", equipIndexes: [] });
    } else {
      set({ estado: "falhou" });
    }
  },

  fechar: () => {
    limparTimer();
    set({ cardIndex: null, estado: "esperando", equipIndexes: [] });
  },
}));
