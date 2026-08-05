import { create } from "zustand";

/**
 * Nome legível dos itens, buscado da API sob demanda.
 *
 * O rAthena manda só o ID em tudo que envolve item — inventário
 * (ZC_NORMAL_ITEMLIST), drop no chão (ZC_ITEM_ENTRY), pegar, soltar. Sem uma
 * tradução, a bolsa mostrava `#501` e o chão, um cubo colorido sem nome.
 *
 * Mesma forma do `net/skillCatalog`, e pelos mesmos motivos: um pedido em lote
 * (a bolsa abre com dezenas de ids de uma vez), só do que ainda falta, e cache
 * de módulo — o nome de um item não muda com o jogo aberto.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export interface ItemInfo {
  id: number;
  name: string;
  /** nome interno do rAthena (`Red_Potion`) — serve de reserva e de chave de arte */
  aegisName: string;
  /** healing | usable | etc — é por ele que o ícone genérico é escolhido */
  type: string;
  subType?: string;
  weight: number;
}

interface CatalogState {
  byId: Record<number, ItemInfo>;
  /** busca os ids que ainda não estão no catálogo (uma requisição só) */
  ensure: (ids: number[]) => void;
}

/**
 * Ids já pedidos e ainda sem resposta.
 *
 * Fora do store de propósito: dois componentes montando no mesmo quadro (a
 * bolsa e o item no chão) pediriam os mesmos ids duas vezes, e o segundo pedido
 * sairia antes de o primeiro voltar — o `byId` ainda estaria vazio.
 */
let pendentes = new Set<number>();

export const useItemCatalog = create<CatalogState>((set, get) => ({
  byId: {},

  ensure: (ids) => {
    const conhecidos = get().byId;
    const faltam = [...new Set(ids)].filter((id) => id > 0 && !conhecidos[id] && !pendentes.has(id));
    if (faltam.length === 0) return;
    for (const id of faltam) pendentes.add(id);

    fetch(`${API_URL}/items/by-id?ids=${faltam.join(",")}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Array<Record<string, unknown>> }) => {
        set((s) => {
          const byId = { ...s.byId };
          for (const cru of data.items ?? []) {
            const id = Number(cru.id);
            if (!Number.isFinite(id)) continue;
            byId[id] = {
              id,
              name: String(cru.name ?? cru.aegisName ?? `#${id}`),
              aegisName: String(cru.aegisName ?? ""),
              type: String(cru.type ?? "etc"),
              subType: cru.subType ? String(cru.subType) : undefined,
              weight: Number(cru.weight ?? 0),
            };
          }
          return { byId };
        });
      })
      // item sem nome é uma lacuna na tela, não um motivo para derrubar a bolsa
      .catch(() => undefined)
      .finally(() => {
        for (const id of faltam) pendentes.delete(id);
      });
  },
}));

/**
 * Nome para mostrar.
 *
 * Enquanto a busca não volta, `#501` — a lacuna honesta. Inventar um nome
 * genérico ("Item") seria pior: o jogador não saberia que está esperando.
 */
export function itemLabel(id: number): string {
  return useItemCatalog.getState().byId[id]?.name ?? `#${id}`;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __itensReset?: () => void }).__itensReset = () => {
    pendentes = new Set();
    useItemCatalog.setState({ byId: {} });
  };
}
