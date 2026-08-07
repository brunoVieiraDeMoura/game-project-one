import { create } from "zustand";

/**
 * "Vou até o alcance e lanço a magia NELE" — a quarta ordem de vários quadros,
 * ao lado de `attackStore` (bater), `pickupStore` (pegar) e `skillWalkStore`
 * (lançar numa célula).
 *
 * Existe pelo mesmo motivo das outras três: o rAthena confere a distância
 * (`battle_check_range`, battle.cpp:8226) e RECUSA — não se aproxima por você.
 * Uma skill de ALVO (Bash, Firebolt, Cold Bolt…) escolhida longe demais
 * simplesmente não fazia nada: o clique na criatura mandava `CZ.USE_SKILL` na
 * hora, sem olhar a distância, e o pedido morria calado no servidor.
 *
 * Diferente do `attackStore`, aqui não há golpe contínuo: chegando ao alcance,
 * lança UMA vez e a ordem acaba — é o "anda até dar e casta" que a skill de
 * alvo pede, não um combate reaberto a cada recusa.
 */

export interface SkillAlvoPendente {
  skillId: number;
  level: number;
  /** só para mensagem/depuração — o servidor não usa */
  name: string;
  /** gid da criatura mirada — ela pode andar, então a célula é lida a cada quadro */
  gid: number;
  /** alcance em células, já resolvido por `raioDeAlcance` */
  raio: number;
  /** quando a ordem começou; serve para desistir de um alvo inalcançável */
  desde: number;
}

interface SkillTargetState {
  pendente: SkillAlvoPendente | null;
  /** começa (ou substitui) a ida até o alcance */
  irLancar: (p: Omit<SkillAlvoPendente, "desde">) => void;
  /** cancela: ESC, clique para andar noutro lugar, alvo sumiu, ou a magia saiu */
  parar: () => void;
}

export const useSkillTargetStore = create<SkillTargetState>((set) => ({
  pendente: null,
  irLancar: (p) => set({ pendente: { ...p, desde: performance.now() } }),
  parar: () => set({ pendente: null }),
}));
