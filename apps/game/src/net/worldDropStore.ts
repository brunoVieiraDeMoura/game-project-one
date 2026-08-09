import { create } from "zustand";

/**
 * Pedido de "jogar item no chão" vindo do arraste inventário→mundo
 * (`play/WorldDropZone`), aguardando confirmação em `hud/WorldDropDialog`.
 *
 * Só guarda o ÍNDICE — quantidade, nome e ícone continuam vindo do
 * `playerStore`/`itemCatalog` na hora de desenhar, para nunca divergir do que
 * o inventário mostra (o mesmo motivo do `net/equipmentStore` ser projeção).
 */
interface WorldDropState {
  index: number | null;
  abrir: (index: number) => void;
  fechar: () => void;
}

export const useWorldDropStore = create<WorldDropState>((set) => ({
  index: null,
  abrir: (index) => set({ index }),
  fechar: () => set({ index: null }),
}));
