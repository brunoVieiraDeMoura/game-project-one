import { create } from "zustand";
import type { CharSummary, WorldEnter } from "./gateway";

/**
 * Estado da sessão com o servidor (conta → personagem → mundo).
 *
 * Separado do combatStore/characterStore de propósito: aqui é ligação de rede,
 * lá é o que a cena desenha. Quem escreve neste store é só o listener do
 * gateway (net/useGatewayEvents).
 */

export type SessionPhase = "offline" | "connecting" | "chars" | "entering" | "playing";

interface SessionState {
  phase: SessionPhase;
  accountId: number;
  sex: number;
  chars: CharSummary[];
  slots: number;
  selectedSlot: number | null;
  world: WorldEnter | null;
  error: string | null;

  setPhase: (phase: SessionPhase) => void;
  setAccount: (accountId: number, sex: number) => void;
  setChars: (chars: CharSummary[], slots: number) => void;
  selectSlot: (slot: number) => void;
  setWorld: (world: WorldEnter) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  phase: "offline",
  accountId: 0,
  sex: 0,
  chars: [],
  slots: 0,
  selectedSlot: null,
  world: null,
  error: null,

  setPhase: (phase) => set({ phase }),
  setAccount: (accountId, sex) => set({ accountId, sex, error: null }),
  setChars: (chars, slots) => set({ chars, slots, phase: "chars", error: null }),
  selectSlot: (selectedSlot) => set({ selectedSlot, phase: "entering" }),
  setWorld: (world) => set({ world, phase: "playing", error: null }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      phase: "offline",
      accountId: 0,
      sex: 0,
      chars: [],
      slots: 0,
      selectedSlot: null,
      world: null,
      error: null,
    }),
}));

/** Personagem escolhido (ou null antes de escolher). */
export function selectedChar(): CharSummary | null {
  const { chars, selectedSlot } = useSessionStore.getState();
  if (selectedSlot === null) return null;
  return chars.find((c) => c.slot === selectedSlot) ?? null;
}
