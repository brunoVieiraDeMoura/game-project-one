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
  /**
   * Mensagem de combate que NÃO é um número — "Sem flechas!" e afins. Mesmo
   * mecanismo de texto flutuante, sem inventar um segundo sistema: o rAthena
   * também usa o mesmo canal visual pra "Miss" (que já é texto, não número) e
   * pra avisos de ação recusada (`clif_arrow_fail`/ZC_ACTION_FAILURE, "Please
   * equip the proper ammunition first" — MsgStringTable[242]).
   */
  text?: string;
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

// mesmo espírito do __world em `net/worldStore` — sem isto, depurar "o aviso
// de combate apareceu?" vira adivinhação de screenshot cronometrado.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __dano?: () => NetDamage[] }).__dano = () => useDamageFeed.getState().numbers;
}

/** action do ZC.NOTIFY_ACT → como o número aparece. Valores em clif.cpp (DMG_*). */
export function damageKind(action: number): { crit: boolean } {
  // 10 = crítico, 11 = "lucky" (esquiva perfeita), 13 = multi-hit crítico
  return { crit: action === 10 || action === 13 };
}
