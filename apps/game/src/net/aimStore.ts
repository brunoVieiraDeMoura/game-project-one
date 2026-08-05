import { create } from "zustand";
import { useCursorStore } from "../ui/cursorStore";
import { useAttackStore } from "./attackStore";
import { useSkillWalkStore } from "./skillWalkStore";

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

/**
 * Com esta mira, o clique pertence ao CHÃO — nem monstro nem NPC o recebem.
 *
 * Uma skill de área tem por alvo a CÉLULA, e o caso normal é mirar justamente em
 * cima de um monstro. Enquanto a entidade capturava o clique (`stopPropagation`),
 * mirar num mob ou não fazia nada, ou virava ataque normal; o evento nunca
 * chegava ao plano do `GroundInteract`, que é quem manda o `skill:use-ground`.
 *
 * Vale para o desenho também: com ela ligada, o monstro não acende o realce
 * vermelho nem troca o cursor para a espada — os dois prometeriam um ataque que
 * o clique não vai fazer.
 */
export function cliqueVaiParaOChao(skill: AimingSkill | null): boolean {
  return skill?.mode === "ground";
}

export const useAimStore = create<AimState>((set) => ({
  skill: null,
  aim: (skill) => set({ skill }),
  cancel: () => set({ skill: null }),
}));

/**
 * Enquanto houver skill mirando, o cursor é o anel de área.
 *
 * Mora aqui e não em cada tela porque a mira é um MODO global: a barra de
 * skills liga, o clique na cena desliga, e quem estiver montado no meio não
 * precisa saber de nada. É um `subscribe` puro, fora do React — a mira muda por
 * clique, não por quadro.
 */
useAimStore.subscribe((estado, anterior) => {
  const agora = estado.skill !== null;
  const antes = anterior.skill !== null;
  if (agora === antes) return;
  useCursorStore.getState().pedir("skillshot", agora);
  /**
   * Escolher uma skill CANCELA a ida até o alvo.
   *
   * Quem vai lançar magia não está indo bater — deixar a perseguição de pé fazia
   * o personagem sair correndo atrás do monstro no meio da mira, e o clique que
   * deveria escolher o lugar da skill chegava com ele já em movimento. O ALVO
   * continua selecionado; o que morre é a ordem de caminhar.
   */
  if (agora) {
    useAttackStore.getState().parar();
    // e cancela a magia que estava a caminho: escolher outra skill é trocar de
    // ordem, não empilhar duas. Sem isto, o personagem chegaria ao alcance da
    // ANTERIOR e a lançaria no meio da mira da nova.
    useSkillWalkStore.getState().parar();
  }
});
