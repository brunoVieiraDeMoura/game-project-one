import { create } from "zustand";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * O que a API sabe das skills que o personagem tem.
 *
 * O map-server manda a LISTA de skills (ZC.SKILLINFO_LIST) com a constante do
 * rAthena — "SM_BASH", "KN_BOWLINGBASH" —, que é o que o servidor usa
 * internamente e não o que o jogador leu a vida toda ("Bash", "Bowling Bash").
 * O nome bonito e o TIPO DE ALVO vivem no skill_db, e o skill_db é o catálogo
 * que a API já serve.
 *
 * O tipo de alvo importa além da estética: era ele que faltava para saber se a
 * skill se usa no chão. Antes isso era adivinhado pelo alcance (`range === 0 &&
 * spCost > 0`), que classifica errado toda skill de auto-buff.
 */
export interface SkillInfo {
  id: number;
  name: string;
  target: "self" | "enemy" | "ground";
  areaRadius: number;
}

interface CatalogState {
  byId: Record<number, SkillInfo>;
  /** busca os ids que ainda não estão no catálogo (uma requisição só) */
  ensure: (ids: number[]) => void;
}

let pending = new Set<number>();

export const useSkillCatalog = create<CatalogState>((set, get) => ({
  byId: {},

  ensure: (ids) => {
    const known = get().byId;
    const missing = ids.filter((id) => !known[id] && !pending.has(id));
    if (missing.length === 0) return;
    for (const id of missing) pending.add(id);

    fetch(`${API_URL}/skills/by-id?ids=${missing.join(",")}`)
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((data: { skills: Array<SkillInfo & { aegisName: string }> }) => {
        set((s) => {
          const byId = { ...s.byId };
          for (const sk of data.skills ?? []) {
            byId[sk.id] = { id: sk.id, name: sk.name, target: sk.target, areaRadius: sk.areaRadius ?? 0 };
          }
          return { byId };
        });
      })
      .catch(() => {
        // API fora do ar: fica com o nome cru do servidor. Não é motivo para
        // quebrar a janela de habilidades.
      })
      .finally(() => {
        for (const id of missing) pending.delete(id);
      });
  },
}));

/** nome de exibição: o do catálogo quando existe, senão a constante do servidor */
export function skillLabel(id: number, fallback: string): string {
  return useSkillCatalog.getState().byId[id]?.name ?? fallback;
}
