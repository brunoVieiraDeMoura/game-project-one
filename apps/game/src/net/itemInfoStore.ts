import { create } from "zustand";

/**
 * Janela de informação do item — abre no BOTÃO DIREITO de um slot do
 * inventário (`hud/InventoryWindow`), no lugar de jogar o item no chão como
 * era antes (agora é o arraste pro mundo, `net/worldDropStore`).
 *
 * Mesmo padrão do `worldDropStore`: só o índice, nunca uma cópia do item —
 * nome, ícone e atributos continuam vindo do `playerStore`/`itemCatalog` na
 * hora de desenhar.
 */
interface ItemInfoState {
  index: number | null;
  abrir: (index: number) => void;
  fechar: () => void;
}

export const useItemInfoStore = create<ItemInfoState>((set) => ({
  index: null,
  abrir: (index) => set({ index }),
  fechar: () => set({ index: null }),
}));
