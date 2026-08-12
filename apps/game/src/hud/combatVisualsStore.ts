import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Preferência de VISUAL de combate — mostrar ou não os indicadores de área:
 * o anel de alcance do ataque básico (`play/AttackRangeCircle`, quando a
 * ação pendente é o ataque, não uma skill) e o anel/mancha de skill em mira
 * (`play/AimPreview`, e a mesma `AttackRangeCircle` quando a ação pendente é
 * chegar a alcance para castar). Não muda NADA de mecânica — alcance real,
 * targeting, dano, cooldown e validação de distância continuam sempre os
 * mesmos; só controla se o anel/mancha é DESENHADO.
 *
 * Padrão: `showAttackRange: false` (era sempre visível e virou ruído — pedido
 * explícito pra desligar por padrão), `showSkillArea: true` (continua como
 * sempre foi — avisar "onde a magia cai" antes do clique é o que a mira de
 * área pediu desde `next-change.txt`).
 *
 * Por PERSONAGEM, mesmo padrão de `hud/skillBarStore`: é preferência de
 * jogo, não da aba do navegador — sem isto a config de um personagem vazaria
 * pro próximo que logasse no mesmo navegador, ou pra outra conta.
 */
interface CombatVisualsState {
  showAttackRange: boolean;
  showSkillArea: boolean;
  setShowAttackRange: (v: boolean) => void;
  setShowSkillArea: (v: boolean) => void;
}

const PADRAO: Pick<CombatVisualsState, "showAttackRange" | "showSkillArea"> = {
  showAttackRange: false,
  showSkillArea: true,
};

/**
 * Personagem dono do store agora, ou `null` fora de sessão — mesma variável-
 * -módulo de `hud/skillBarStore.charAtual`. É a única fonte de identidade que
 * o storage adapter consulta.
 */
let charAtual: number | null = null;

/** chave de `localStorage` composta com o personagem ativo NO MOMENTO DA
 * CHAMADA (`ragnarok:combat-visuals:<charId>`) — mesmo padrão de
 * `hud/skillBarStore.storage`. Com `charAtual === null` não lê nem escreve. */
const storage = createJSONStorage<Pick<CombatVisualsState, "showAttackRange" | "showSkillArea">>(() => ({
  getItem: (name) => (charAtual === null ? null : localStorage.getItem(`${name}:${charAtual}`)),
  setItem: (name, value) => {
    if (charAtual !== null) localStorage.setItem(`${name}:${charAtual}`, value);
  },
  removeItem: (name) => {
    if (charAtual !== null) localStorage.removeItem(`${name}:${charAtual}`);
  },
}));

export const useCombatVisuals = create<CombatVisualsState>()(
  persist(
    (set) => ({
      ...PADRAO,
      setShowAttackRange: (v) => set({ showAttackRange: v }),
      setShowSkillArea: (v) => set({ showSkillArea: v }),
    }),
    {
      name: "ragnarok:combat-visuals",
      storage,
      // mesma razão de `skillBarStore`: ninguém está vinculado no `create()` —
      // a reidratação automática rodaria antes de qualquer personagem existir.
      // `bindToCharacter` chama `persist.rehydrate()` explicitamente depois.
      skipHydration: true,
      version: 1,
      partialize: (s) => ({ showAttackRange: s.showAttackRange, showSkillArea: s.showSkillArea }),
    },
  ),
);

/**
 * Personagem passa a ser dono do store — chamar junto de
 * `skillBarStore.bindToCharacter`, no `world:enter` (`net/useGatewayEvents`).
 *
 * Mesma ordem cuidadosa de `skillBarStore.bindToCharacter`: zera com
 * `charAtual` ainda `null` (o storage adapter recusa escrever sem dono, então
 * o reset não pisa no que o personagem já tinha salvo) e só then aponta pro
 * personagem novo e reidrata.
 */
export function bindToCharacter(charId: number): void {
  if (charId === charAtual) return;
  charAtual = null;
  useCombatVisuals.setState({ ...PADRAO });
  charAtual = charId;
  void useCombatVisuals.persist.rehydrate();
}

/** Fim de sessão — chamar junto de `skillBarStore.unbindCharacter`. */
export function unbindCharacter(): void {
  charAtual = null;
  useCombatVisuals.setState({ ...PADRAO });
}
