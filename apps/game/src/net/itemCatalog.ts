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
  /**
   * Metadata estática que a Fase 4 passou a usar (equipar, requisitos): a API
   * já devolve o registro do `packages/game-data` ItemSchema inteiro em
   * `/items/by-id` — só não estava sendo lida. Em vez de copiar o catálogo
   * inteiro para dentro do `InventoryItem` (que é por-instância, vindo do
   * rAthena), o runtime resolve por `InventoryItem.itemId + ItemCatalog[itemId]`.
   */
  slots: number;
  jobs: string[];
  classes: string[];
  equipLevelMin: number;
  equipLevelMax: number;
  attack: number;
  magicAttack: number;
  defense: number;
  locations: string[];
  /** venda da loja padrão do rAthena — 0 é comum (item que não se compra) */
  buyPrice: number;
  sellPrice: number;
  /** alcance de ataque, só relevante em arma */
  range: number;
  /** "male" | "female" | "both" */
  gender: string;
  /**
   * Script CRU do rAthena (`bonus bStr,2;`…) — não há parser de efeito de item
   * no cliente (só existe pro skill_db), então a janela de informação mostra
   * o texto tal como veio em vez de inventar uma tradução.
   */
  rawScript?: string;
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

    // instrumentação temporária (auditoria "glitch ~30s" 2026-08-14) — só
    // DEV, remover/reduzir depois de confirmado em produção que o atraso
    // some. Mede o próprio tempo de ida-e-volta do `/items/by-id`, não um
    // palpite.
    const t0 = import.meta.env.DEV ? performance.now() : 0;
    if (import.meta.env.DEV) {
      console.info(`[ITEM_DATA] request iniciado ids=[${faltam.join(",")}] source=API t=${Math.round(t0)}ms`);
    }

    fetch(`${API_URL}/items/by-id?ids=${faltam.join(",")}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Array<Record<string, unknown>> }) => {
        if (import.meta.env.DEV) {
          const dt = Math.round(performance.now() - t0);
          console.info(
            `[ITEM_DATA] request concluído ids=[${faltam.join(",")}] source=API registros=${data.items?.length ?? 0} tempoRespostaMs=${dt}`,
          );
        }
        set((s) => {
          const byId = { ...s.byId };
          for (const cru of data.items ?? []) {
            // Um id desconhecido no meio do lote pode voltar `null` (a API já
            // filtra, mas isto não custa nada e evita que ISTO aqui vire outro
            // ponto único de falha do lote inteiro — foi assim que um item de
            // drop não catalogado apagava o nome de todo mundo na mesma leva).
            if (!cru) continue;
            const id = Number(cru.id);
            if (!Number.isFinite(id)) continue;
            byId[id] = {
              id,
              // NUNCA cair pra aegisName/id aqui — regra absoluta (auditoria
              // 2026-08-14): `name` vazio é estado terminal (dado incompleto
              // no catálogo), tratado por `getItemDisplayName`, não mascarado
              // na ingestão com um identificador legado.
              name: String(cru.name ?? ""),
              aegisName: String(cru.aegisName ?? ""),
              type: String(cru.type ?? "etc"),
              subType: cru.subType ? String(cru.subType) : undefined,
              weight: Number(cru.weight ?? 0),
              slots: Number(cru.slots ?? 0),
              jobs: Array.isArray(cru.jobs) ? cru.jobs.map(String) : ["all"],
              classes: Array.isArray(cru.classes) ? cru.classes.map(String) : [],
              equipLevelMin: Number(cru.equipLevelMin ?? 0),
              equipLevelMax: Number(cru.equipLevelMax ?? 0),
              attack: Number(cru.attack ?? 0),
              magicAttack: Number(cru.magicAttack ?? 0),
              defense: Number(cru.defense ?? 0),
              locations: Array.isArray(cru.locations) ? cru.locations.map(String) : [],
              buyPrice: Number(cru.buyPrice ?? 0),
              sellPrice: Number(cru.sellPrice ?? 0),
              range: Number(cru.range ?? 0),
              gender: String(cru.gender ?? "both"),
              rawScript: cru.rawScript ? String(cru.rawScript) : undefined,
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
 * Tipos que a HOTBAR aceita: os mesmos quatro que `InventoryWindow` trata
 * como consumível (lá pelo `type` numérico do rAthena — 0/2/11/18; aqui pelo
 * nome do `ItemTypeSchema` de `packages/game-data`, que é o que o catálogo da
 * API devolve). Equipamento, carta, munição e etc não entram — usá-los não é
 * `CZ.USE_ITEM`.
 */
const USABLE_ITEM_TYPES = new Set(["healing", "usable", "delay_consume", "cash"]);

export function isUsableItemType(type: string | undefined): boolean {
  return type != null && USABLE_ITEM_TYPES.has(type);
}

/** Tipos que passam por `CZ.REQ_WEAR_EQUIP` — carta e etc não equipam assim. */
const EQUIPABLE_ITEM_TYPES = new Set(["armor", "weapon", "ammo", "shadow_gear"]);

export function isEquipableItemType(type: string | undefined): boolean {
  return type != null && EQUIPABLE_ITEM_TYPES.has(type);
}

/** item respondido pelo catálogo mas sem nome nenhum lá dentro — dado
 * incompleto (item não seedado com nome no Painel 3000), não "ainda
 * carregando"; ver `getItemDisplayName` */
export const ITEM_NAME_FALLBACK = "Unknown";

/**
 * Nome visual de um item — SEMPRE o `name` atual do catálogo (Painel 3000),
 * NUNCA o id, NUNCA o `aegisName`.
 *
 * Regra absoluta (auditoria 2026-08-14): renderizar ID/Aegis como "nome
 * provisório" enquanto o catálogo carrega foi o próprio bug — o jogador via
 * `#501` na tela achando que era o dado final, não um placeholder.
 *
 * Mesmo contrato de `net/skillCatalog.getSkillDisplayName` (mesmo motivo:
 * dois estados de "sem nome" são coisas diferentes):
 *  • `info === undefined` — o catálogo AINDA NÃO RESPONDEU pra este id.
 *    Retorna `undefined`: quem desenha mostra o loading (`IconSquare
 *    ({loading:true})`/`LoadingRing`), nunca texto, nunca id, nunca aegis.
 *  • `info.name` vazio COM `info` presente — o catálogo respondeu e o item
 *    não tem nome cadastrado (dado incompleto, não vai chegar depois).
 *    Retorna `ITEM_NAME_FALLBACK` ("Unknown") — não é carregamento, é o
 *    valor final.
 */
export function getItemDisplayName(info: Pick<ItemInfo, "name"> | undefined): string | undefined {
  if (info === undefined) return undefined;
  return info.name || ITEM_NAME_FALLBACK;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __itensReset?: () => void }).__itensReset = () => {
    pendentes = new Set();
    useItemCatalog.setState({ byId: {} });
  };
}
