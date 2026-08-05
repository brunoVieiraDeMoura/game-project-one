import { create } from "zustand";

/**
 * Estado do modo jogável que muda raramente (skill-r3f-conventions: zustand
 * pra estado de app, NÃO pra transform por frame). A posição do player vive em
 * refs no componente Player.
 *
 * O campo `mode` ("grid" | "free") saiu junto com o WASD: havia UM caminho de
 * movimento de verdade — o clique-tile — e um segundo, ligado por um botão nas
 * Configurações, que pulava a validação de alcance e disputava a mesma janela de
 * 200 ms. Escolher entre dois caminhos quando só um é mantido é convite a
 * divergência.
 */
interface PlayState {
  /** destino de clique no chão (mundo x/z); null = sem alvo pendente */
  moveTarget: { x: number; z: number } | null;
  setMoveTarget: (t: { x: number; z: number } | null) => void;
  /** teleporte pedido por um gatilho de warp (mundo x/z) + seq p/ o Player
   * consumir 1× no próximo frame. A posição do Player vive num ref interno, então
   * o warp é entregue por este canal e aplicado lá. */
  warp: { x: number; z: number; seq: number } | null;
  requestWarp: (x: number, z: number) => void;
  /** ponto de respawn (save point pisado); usado ao renascer */
  savePoint: { x: number; z: number } | null;
  setSavePoint: (p: { x: number; z: number }) => void;
}

let warpSeq = 1;

export const usePlayStore = create<PlayState>((set) => ({
  moveTarget: null,
  setMoveTarget: (moveTarget) => set({ moveTarget }),
  warp: null,
  requestWarp: (x, z) => set({ warp: { x, z, seq: warpSeq++ }, moveTarget: null }),
  savePoint: null,
  setSavePoint: (savePoint) => set({ savePoint }),
}));

// aux de dev: inspecionar/dirigir o modo jogável no console
if (import.meta.env.DEV) (window as unknown as { __play?: unknown }).__play = usePlayStore;
