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
  /** constante do rAthena ("MG_FIREBOLT") — o prefixo dela dá a classe */
  aegisName: string;
  name: string;
  target: "self" | "enemy" | "ground";
  areaRadius: number;
  /** teto de nível: o ZC.SKILLINFO_LIST NÃO manda, o skill_db manda */
  maxLevel: number;
  /** damage | support | area | self_buff | passive */
  type: string;
  /** já resolvido para o nível pedido (o schema guarda por nível) */
  element: string;
  spCost: number;
  range: number;
  cooldownMs: number;
}

/**
 * Campo `perLevel` do schema: um valor só vale para todos os níveis, um array
 * tem índice 0 = nível 1 (packages/game-data/src/common.ts).
 *
 * Resolver aqui, e não na tela, é o que impede a janela de mostrar o custo do
 * nível 1 para uma skill que o personagem tem no 10.
 */
function noNivel<T>(valor: T | T[] | undefined, nivel: number, padrao: T): T {
  if (valor === undefined) return padrao;
  if (!Array.isArray(valor)) return valor;
  if (valor.length === 0) return padrao;
  return valor[Math.min(Math.max(nivel, 1), valor.length) - 1] ?? padrao;
}

interface CatalogState {
  byId: Record<number, SkillInfo>;
  /**
   * Busca os ids que ainda não estão no catálogo (uma requisição só).
   *
   * `niveis` diz em que nível o personagem tem cada skill, para resolver os
   * campos `perLevel` na hora de guardar. Sem ele, tudo cai no nível 1.
   */
  ensure: (ids: number[], niveis?: Record<number, number>) => void;
}

let pending = new Set<number>();

export const useSkillCatalog = create<CatalogState>((set, get) => ({
  byId: {},

  ensure: (ids, niveis) => {
    const known = get().byId;
    const missing = ids.filter((id) => !known[id] && !pending.has(id));
    if (missing.length === 0) return;
    for (const id of missing) pending.add(id);

    fetch(`${API_URL}/skills/by-id?ids=${missing.join(",")}`)
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((data: { skills: Array<Record<string, unknown>> }) => {
        set((s) => {
          const byId = { ...s.byId };
          for (const cru of data.skills ?? []) {
            const id = Number(cru.id);
            const nivel = niveis?.[id] ?? 1;
            byId[id] = {
              id,
              aegisName: String(cru.aegisName ?? ""),
              name: String(cru.name ?? ""),
              target: (cru.target as SkillInfo["target"]) ?? "enemy",
              areaRadius: noNivel(cru.areaRadius as number | number[], nivel, 0),
              maxLevel: Number(cru.maxLevel ?? 0),
              type: String(cru.type ?? ""),
              element: String(noNivel(cru.element as string | string[], nivel, "weapon")),
              spCost: noNivel(cru.spCost as number | number[], nivel, 0),
              range: noNivel(cru.range as number | number[], nivel, 0),
              cooldownMs: noNivel(cru.cooldownMs as number | number[], nivel, 0),
            };
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

/**
 * Alcance da skill em CÉLULAS, tratando as duas convenções do rAthena.
 *
 * Negativo quer dizer "o alcance da arma" e não uma distância; zero, numa skill
 * usada no próprio personagem, é ausência de alcance. Nos dois casos não há
 * fronteira a desenhar nem distância a percorrer — inventar uma seria mentir
 * sobre o que o servidor aceita.
 *
 * Mora aqui, junto do campo que ela interpreta, porque DOIS lugares dependem de
 * concordar: o aro que o `play/AimPreview` desenha e a distância que o
 * `net/NetPlayer` anda antes de lançar. Divergindo, o personagem pararia num
 * ponto diferente daquele em que o disco deixa de ser vermelho.
 */
export function raioDeAlcance(range: number | undefined): number {
  return range !== undefined && range > 0 ? range : 0;
}

/** o alcance da skill que está no catálogo, já em células (0 = sem alcance) */
export function alcanceDaSkill(id: number): number {
  return raioDeAlcance(useSkillCatalog.getState().byId[id]?.range);
}

/**
 * Esvazia o catálogo para ele ser buscado de novo (DEV).
 *
 * O `ensure` só pede o que ainda não tem — é o certo em produção, onde o
 * skill_db não muda com o jogo aberto. No desenvolvimento muda: re-migrar e
 * re-semear as skills não chega ao navegador, porque o estado do zustand
 * SOBREVIVE ao hot-reload do Vite (o módulo do store não é reexecutado quando
 * outro arquivo muda). O sintoma é insidioso — a API já devolve o valor novo e a
 * tela continua com o velho, sem erro nenhum.
 *
 * `__skillsReset()` no console resolve sem recarregar a página.
 */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __skillsReset?: () => void; __skills?: () => unknown }).__skillsReset = () =>
    useSkillCatalog.setState({ byId: {} });
  (window as unknown as { __skillsReset?: () => void; __skills?: () => unknown }).__skills = () =>
    useSkillCatalog.getState().byId;
}
