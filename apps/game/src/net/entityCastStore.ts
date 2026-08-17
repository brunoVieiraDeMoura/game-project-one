import { create } from "zustand";

/**
 * Conjuração em andamento de QUALQUER entidade (mob, outro jogador — o
 * próprio personagem também entra, sem custo extra), pra UI mostrar "está
 * castando X" na `TargetFrame`. Reativo (zustand) DE PROPÓSITO, ao contrário
 * de `net/combatAnim.ts` (que guarda o mesmo tipo de pulso fora do zustand
 * porque é lido no `useFrame` de CADA entidade, por quadro) — aqui é UMA
 * leitura por render da placa do alvo, não custa reconciliar.
 *
 * Espelha os MESMOS dois eventos que já alimentam `net/castStore.ts` (só
 * pro próprio personagem) e `net/combatAnim.ts` (a animação 3D, qualquer
 * entidade): `skill:casting` começa, `skill:cast` termina
 * (`net/useWorldEvents.ts`). Sem sinal de INTERRUPÇÃO no protocolo — mesma
 * limitação aceita em `castStore.estaCastando`: o relógio (`fim`) resolve
 * sozinho se o servidor nunca mandar a confirmação de saída (skill de chão
 * que caiu em célula vazia, ou uma interrupção real que o rAthena não
 * anuncia de volta pro cliente).
 */
export interface CastAtual {
  skillId: number;
  /** performance.now() em que a conjuração deveria acabar */
  fim: number;
  /** duração total anunciada — só pra desenhar progresso (`fim - duracaoMs`
   * já dá o instante de início); a decisão de quando acaba continua sendo
   * `fim`, nunca recalculada a partir disto. */
  duracaoMs: number;
}

interface EntityCastState {
  byGid: Record<number, CastAtual>;
  start: (gid: number, skillId: number, duracaoMs: number) => void;
  release: (gid: number) => void;
  /** entidade sumiu (morreu/saiu de vista) — sem isto o mapa vaza um `gid`
   * reciclável pra sempre (ver `net/useWorldEvents.ts: onVanish`, mesmo
   * cuidado que `statusStore.clearGid` já tem) */
  clearGid: (gid: number) => void;
  reset: () => void;
}

export const useEntityCastStore = create<EntityCastState>((set) => ({
  byGid: {},

  start: (gid, skillId, duracaoMs) =>
    set((s) => {
      // skill instantânea (0 ou poucos quadros): nada pra mostrar, mesmo
      // piso que `net/castStore.ts` usa pra não piscar a UI à toa.
      if (duracaoMs < 150) {
        if (!(gid in s.byGid)) return s;
        const { [gid]: _drop, ...rest } = s.byGid;
        return { byGid: rest };
      }
      return { byGid: { ...s.byGid, [gid]: { skillId, fim: performance.now() + duracaoMs, duracaoMs } } };
    }),

  release: (gid) =>
    set((s) => {
      if (!(gid in s.byGid)) return s;
      const { [gid]: _drop, ...rest } = s.byGid;
      return { byGid: rest };
    }),

  clearGid: (gid) =>
    set((s) => {
      if (!(gid in s.byGid)) return s;
      const { [gid]: _drop, ...rest } = s.byGid;
      return { byGid: rest };
    }),

  reset: () => set({ byGid: {} }),
}));

/**
 * Conjuração ativa de `gid` agora, ou `null`.
 *
 * Compara com `fim` (não só "existe entrada"), mesma razão de
 * `castStore.estaCastando`: uma entrada pendurada por falta de sinal de
 * interrupção se auto-limpa pelo relógio em vez de ficar presa na UI pra
 * sempre.
 */
export function castAtivoDe(gid: number, agora: number): CastAtual | null {
  const atual = useEntityCastStore.getState().byGid[gid];
  if (!atual || agora >= atual.fim) return null;
  return atual;
}
