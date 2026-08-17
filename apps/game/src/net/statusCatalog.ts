import { create } from "zustand";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * O que a API sabe do status por trás de um id EFST numérico.
 *
 * Espelha `net/skillCatalog.ts` (mesmo formato de `ensure()`/`pending`, mesma
 * tolerância a API fora do ar) — só troca `/skills/by-id` por `/statuses/
 * by-efst` (Fase B da auditoria "buffs/debuffs" 2026-08-14).
 *
 * Sem campo de imagem: o catálogo migrado (`statuses.json`) guarda `icon`
 * como o NOME do enum EFST (`"EFST_PROVOKE"`), não um arquivo — não existe
 * acervo de ícone de status hoje (só 18 skills têm arte, nenhum status). O
 * `IconSquare` (`ui/rpg.tsx`) já resolve isso sozinho com um placeholder por
 * semente quando não recebe `imageSrc`.
 */
export interface StatusInfo {
  efstId: number;
  /** id do catálogo (nome SC minúsculo, ex. "provoke") */
  id: string;
  name: string;
  description?: string;
  category: "buff" | "debuff" | "neutral";
}

interface CatalogState {
  byEfstId: Record<number, StatusInfo>;
  ensure: (efstIds: number[]) => void;
}

let pending = new Set<number>();

export const useStatusCatalog = create<CatalogState>((set, get) => ({
  byEfstId: {},

  ensure: (efstIds) => {
    const known = get().byEfstId;
    const missing = [...new Set(efstIds)].filter((id) => !known[id] && !pending.has(id));
    if (missing.length === 0) return;
    for (const id of missing) pending.add(id);

    fetch(`${API_URL}/statuses/by-efst?ids=${missing.join(",")}`)
      .then((r) => (r.ok ? r.json() : { statuses: [] }))
      .then((data: { statuses: Array<Record<string, unknown>> }) => {
        set((s) => {
          const byEfstId = { ...s.byEfstId };
          for (const cru of data.statuses ?? []) {
            const efstId = Number(cru.efstId);
            byEfstId[efstId] = {
              efstId,
              id: String(cru.id ?? ""),
              name: String(cru.name ?? ""),
              description: cru.description ? String(cru.description) : undefined,
              category: (cru.category as StatusInfo["category"]) ?? "neutral",
            };
          }
          return { byEfstId };
        });
      })
      .catch(() => {
        // API fora do ar: fica sem nome/descrição — o ícone cai no
        // placeholder por semente, não é motivo pra quebrar a UI.
      })
      .finally(() => {
        for (const id of missing) pending.delete(id);
      });
  },
}));
