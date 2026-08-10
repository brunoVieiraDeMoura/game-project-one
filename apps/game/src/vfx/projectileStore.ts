import { create } from "zustand";

/**
 * Projétil de ataque à distância — irmão do `vfxStore` (skill), mas mais
 * simples: nasce de UM golpe (`entity:action`), viaja em linha reta do
 * atacante até o alvo e some. Sem arte de flecha ainda (change pediu
 * explicitamente "retinha retangular colorida" para validar o pipeline, não
 * um modelo 3D) — o formato mora no componente que desenha, não aqui.
 *
 * Não reaproveita o `VfxInstance` do `vfxStore`: aquele guarda uma célula OU
 * um gid fixo (a origem nunca se move), e um projétil tem DOIS pontos —
 * origem e destino — capturados uma vez no instante do golpe. Forçar isso na
 * forma existente exigiria um campo a mais que os outros três tipos (área,
 * conjuração, impacto, buff) nunca usariam.
 */

export interface ProjectileInstance {
  id: number;
  /** célula do SERVIDOR de quem atirou, capturada no instante do golpe — não segue */
  fromCell: { x: number; y: number };
  /** célula do SERVIDOR de quem foi atingido, capturada no instante do golpe — não segue */
  toCell: { x: number; y: number };
  startedAt: number;
  durationMs: number;
}

interface ProjectileState {
  effects: ProjectileInstance[];
  spawn: (p: Omit<ProjectileInstance, "id">) => void;
  prune: (now: number) => void;
  reset: () => void;
}

let nextId = 1;

export const useProjectileStore = create<ProjectileState>((set) => ({
  effects: [],

  spawn: (p) => set((s) => ({ effects: [...s.effects, { ...p, id: nextId++ }] })),

  prune: (now) =>
    set((s) => {
      const alive = s.effects.filter((e) => now < e.startedAt + e.durationMs);
      return alive.length === s.effects.length ? s : { effects: alive };
    }),

  reset: () => set({ effects: [] }),
}));

/**
 * Velocidade do projétil, em células/segundo — não há valor do rAthena para
 * isto (ele resolve o golpe no instante do pacote, sem simular voo). É só
 * ritmo visual: rápido o bastante para não atrasar o combate, devagar o
 * bastante para dar tempo de VER a flecha viajando, que é o objetivo do
 * pedido ("validar o pipeline visual").
 */
export const CELULAS_POR_SEGUNDO_PROJETIL = 26;

/** teto de duração — um alvo muito longe não pode prender o projétil na tela por segundos */
export const DURACAO_MAX_MS = 500;
/** piso — mesmo colado (corpo a corpo por engano) o traço precisa aparecer por um instante */
export const DURACAO_MIN_MS = 90;

export function duracaoDoProjetil(distanciaCelulas: number): number {
  const ms = (distanciaCelulas / CELULAS_POR_SEGUNDO_PROJETIL) * 1000;
  return Math.min(DURACAO_MAX_MS, Math.max(DURACAO_MIN_MS, ms));
}
