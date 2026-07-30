import { create } from "zustand";
import type { MovementMode } from "@ragnarok/engine-core";

/**
 * Estado do modo jogável que muda raramente (skill-r3f-conventions: zustand
 * pra estado de app, NÃO pra transform por frame). Modo de movimento + destino
 * de clique-pra-andar. A posição do player vive em refs no componente Player.
 */
interface PlayState {
  mode: MovementMode;
  setMode: (m: MovementMode) => void;
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
  mode: "grid",
  setMode: (mode) => set({ mode }),
  moveTarget: null,
  setMoveTarget: (moveTarget) => set({ moveTarget }),
  warp: null,
  requestWarp: (x, z) => set({ warp: { x, z, seq: warpSeq++ }, moveTarget: null }),
  savePoint: null,
  setSavePoint: (savePoint) => set({ savePoint }),
}));

// aux de dev: inspecionar/dirigir o modo jogável no console
if (import.meta.env.DEV) (window as unknown as { __play?: unknown }).__play = usePlayStore;
