import { create } from "zustand";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * O que a API sabe do monstro por trás de um `job` numérico (mob_db id) —
 * espelha `net/skillCatalog.ts`/`net/statusCatalog.ts` (mesmo formato de
 * `ensure()`/`pending`, mesma tolerância a API fora do ar). Mostra
 * nome/nível/elemento/raça/tamanho na `TargetFrame` — combate nunca lê isto,
 * é sempre o servidor quem decide dano/resistência.
 *
 * Sem `by-id` em lote: a rota de monstros (`apps/api/src/routes/monsters.ts`)
 * só tem `GET /:id`, então `ensure` dispara um fetch por id que falta — cabe
 * bem porque só as ESPÉCIES de mob realmente vistas numa sessão entram aqui
 * (uma vez cada, cacheado pra sempre, igual ao resto dos catálogos).
 *
 * `ensure` é chamado a cada `entity:spawn` de mob (`net/useWorldEvents.ts`),
 * não só quando o jogador mira — pré-carrega por ESPÉCIE assim que a
 * primeira instância dela entra em vista, então trocar de alvo entre mobs
 * da mesma espécie nunca refaz o request.
 */
export interface MonsterInfo {
  id: number;
  /** nome amigável (`Monster.name`) — NUNCA `aegisName`; UI não deve ter
   * outro jeito de mostrar o monstro a não ser por este campo */
  name: string;
  level: number;
  /** HP base do mob_db (referência de espécie) — o HP AO VIVO do alvo
   * (atual/máximo daquela instância) continua vindo só do REQNAME por gid
   * (`worldStore`/`fatiaDeRender`), nunca deste catálogo */
  baseHp: number;
  race: string;
  element: string;
  elementLevel: number;
  size: string;
}

interface CatalogState {
  byId: Record<number, MonsterInfo>;
  ensure: (ids: number[]) => void;
}

let pending = new Set<number>();

export const useMonsterCatalog = create<CatalogState>((set, get) => ({
  byId: {},

  ensure: (ids) => {
    const known = get().byId;
    const missing = [...new Set(ids)].filter((id) => !known[id] && !pending.has(id));
    if (missing.length === 0) return;
    for (const id of missing) pending.add(id);

    for (const id of missing) {
      fetch(`${API_URL}/monsters/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((cru: Record<string, unknown> | null) => {
          if (!cru) return;
          const element = cru.element as { type?: string; level?: number } | undefined;
          const nome = String(cru.name ?? "");
          if (!nome) return; // sem nome amigável, o catálogo não guarda entrada — nunca vira fallback de id
          set((s) => ({
            byId: {
              ...s.byId,
              [id]: {
                id,
                name: nome,
                level: Number(cru.level ?? 0),
                baseHp: Number(cru.hp ?? 0),
                race: String(cru.race ?? ""),
                element: String(element?.type ?? ""),
                elementLevel: Number(element?.level ?? 1),
                size: String(cru.size ?? ""),
              },
            },
          }));
        })
        .catch(() => {
          // API fora do ar ou id sem cadastro (mob de demo/QA sem entrada no
          // catálogo real): fica sem os 3 slots até resolver — nunca inventa
          // elemento/raça/tamanho.
        })
        .finally(() => {
          pending.delete(id);
        });
    }
  },
}));
