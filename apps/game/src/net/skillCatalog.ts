import { create } from "zustand";
import { usePlayerStore } from "./playerStore";

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
 * Negativo (`Range: -9` da AC_DOUBLE/Double Strafe, por exemplo) é "alcance
 * FIXO desse valor absoluto" na configuração PADRÃO — confirmado em
 * `skill_get_range2` (rathena/src/map/skill.cpp:328-334): `if (range < 0) {
 * if (battle_config.use_weapon_skill_range & bl->type) return
 * status_get_range(bl); range *= -1; }`. A flag (`skillrange_from_weapon`,
 * battle.cpp:8270) tem padrão DESLIGADO para todo tipo de unidade (`BL_NUL`)
 * e não está religada em `rathena-conf/battle_conf.txt` — então o caminho que
 * roda de verdade neste servidor é sempre o segundo, `abs(range)`, nunca o
 * alcance da arma equipada.
 *
 * Tratar negativo como "sem alcance" (0, que aqui também quer dizer "sem
 * restrição a respeitar") fazia uma skill como Double Strafe lançar na hora,
 * não importa a distância — sem WALK-TO-RANGE nenhum — e o servidor recusava
 * calado (skill de alvo tem a MESMA recusa silenciosa do ataque básico,
 * `battle_check_range`, battle.cpp:8226). Zero numa skill usada no próprio
 * personagem continua ausência de alcance, sem inverter nada.
 *
 * Mora aqui, junto do campo que ela interpreta, porque DOIS lugares dependem de
 * concordar: o aro que o `play/AimPreview` desenha e a distância que o
 * `net/NetPlayer` anda antes de lançar. Divergindo, o personagem pararia num
 * ponto diferente daquele em que o disco deixa de ser vermelho.
 */
export function raioDeAlcance(range: number | undefined): number {
  if (range === undefined || range === 0) return 0;
  return Math.abs(range);
}

/** o alcance da skill que está no catálogo, já em células (0 = sem alcance) */
export function alcanceDaSkill(id: number): number {
  return raioDeAlcance(useSkillCatalog.getState().byId[id]?.range);
}

/**
 * Alcance REAL da skill, para o personagem AGORA — não o número cravado do
 * skill_db.
 *
 * Confirmado no rAthena: quem calcula o alcance de uma skill é
 * `skill_get_range2` (skill.cpp:324-365), e não o `range` cru do banco. Duas
 * coisas ele faz que o `alcanceDaSkill` acima (lê o catálogo estático da
 * nossa API) não sabe:
 *
 *  1. `range` negativo (Double Strafe: `Range: -9`) não é "alcance da arma" a
 *     não ser que `skillrange_from_weapon` esteja ligado
 *     (`battle_config.use_weapon_skill_range`, conf/battle/skill.conf:83 =
 *     `0` por padrão, e não está religado em `rathena-conf/battle_conf.txt`)
 *     — no nosso servidor ele SEMPRE cai no `else` (`skill.cpp:333`,
 *     `range *= -1`), então o alcance-base de Double Strafe é `abs(-9)` = 9.
 *  2. Skill com `INF2_ALTERRANGEVULTURE` (Double Strafe, Arrow Shower — o
 *     `Flags: AlterRangeVulture: true` do skill_db) SOMA o NÍVEL de Vulture's
 *     Eye por cima (`skill.cpp:344`: `range += pc_checkskill(bl,
 *     AC_VULTURE)`) — SEPARADO do bônus que Vulture's Eye já dá ao ataque
 *     básico (`status.cpp:4490`: `rhw.range += skill`, que soma na arma). Os
 *     dois usam o MESMO número (o nível da passiva) mas em bases diferentes
 *     (9 da skill vs 5 do Bow) — não é o mesmo alcance, e por isso Double
 *     Strafe NÃO herda `rhw.range`/`atkRange`: ela tem alcance PRÓPRIO.
 *
 * A boa notícia: o rAthena já manda o resultado final PRONTO. `ZC.
 * SKILLINFO_LIST`/`ZC.ADD_SKILL` carregam `range2` — literalmente
 * `skill_get_range2(&sd, id, lv, false)` (clif.cpp:5736/5790), o MESMO
 * cálculo acima, já resolvido pelo servidor — e o gateway já grava isso em
 * `PlayerSkill.range` (`session.ts: toSkill`, campo `attackRange` do
 * pacote). Não tem cálculo nenhum a duplicar aqui: é só ler o valor que já
 * chegou, em vez do catálogo estático (que só conhece o `-9` cru do banco).
 */
export function alcanceEfetivoDaSkill(id: number): number {
  const viva = usePlayerStore.getState().skills.find((s) => s.id === id);
  if (viva) return Math.max(0, viva.range);
  // skill que o personagem não tem na lista (não deveria acontecer para uma
  // que ele está tentando lançar) — o catálogo estático é o único palpite que
  // sobra, melhor que travar sem alcance nenhum.
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
