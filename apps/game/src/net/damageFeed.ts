import { create } from "zustand";

/**
 * Números de dano vindos do servidor.
 *
 * Store próprio, separado do `combatStore`: aquele é do mundo simulado local
 * (que sai de cena junto com a IA do cliente) e o dano aqui já vem calculado
 * pelo rAthena — não há o que decidir, só desenhar em cima de quem apanhou.
 */

export interface NetDamage {
  id: number;
  /** quem apanhou */
  gid: number;
  value: number;
  /** action do ZC.NOTIFY_ACT: 10/11/13 = crítico/lucky/multi-crítico */
  crit: boolean;
  /** true = esquiva/erro (o RO mostra "Miss") */
  miss: boolean;
  /** true = o alvo é o próprio jogador (número vermelho) */
  onSelf: boolean;
}

interface DamageFeedState {
  numbers: NetDamage[];
  push: (d: Omit<NetDamage, "id">) => void;
  clear: (id: number) => void;
  reset: () => void;
}

let nextId = 1;

export const useDamageFeed = create<DamageFeedState>((set) => ({
  numbers: [],
  push: (d) => set((s) => ({ numbers: [...s.numbers, { ...d, id: nextId++ }] })),
  clear: (id) => set((s) => ({ numbers: s.numbers.filter((n) => n.id !== id) })),
  reset: () => set({ numbers: [] }),
}));

/** action do ZC.NOTIFY_ACT → como o número aparece. Valores em clif.cpp (DMG_*). */
export function damageKind(action: number): { crit: boolean } {
  // 10 = crítico, 11 = "lucky" (esquiva perfeita), 13 = multi-hit crítico
  return { crit: action === 10 || action === 13 };
}
