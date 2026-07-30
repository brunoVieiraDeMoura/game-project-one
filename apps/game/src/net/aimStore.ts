import { create } from "zustand";

/**
 * Modo de mira: a skill escolhida está esperando o jogador apontar.
 *
 * É o comportamento do Ragnarok — ao escolher uma skill que precisa de alvo, o
 * cursor vira uma mira e o PRÓXIMO clique decide onde ela cai, em vez de andar
 * até lá. Sem isso, clicar na skill só acendia o ícone e nada acontecia (o
 * servidor espera uma célula em `CZ.USE_SKILL_TOGROUND`, ou um GID em
 * `CZ.USE_SKILL`).
 *
 * Dois modos, porque o RO tem dois cursores:
 *  • `ground` — clique no chão define a célula (Storm Gust, armadilha, warp);
 *  • `entity` — clique na criatura define o alvo (Bash num mob que ainda não
 *    está selecionado).
 */
export interface AimingSkill {
  id: number;
  level: number;
  name: string;
  mode: "ground" | "entity";
}

interface AimState {
  skill: AimingSkill | null;
  aim: (skill: AimingSkill) => void;
  cancel: () => void;
}

export const useAimStore = create<AimState>((set) => ({
  skill: null,
  aim: (skill) => set({ skill }),
  cancel: () => set({ skill: null }),
}));
