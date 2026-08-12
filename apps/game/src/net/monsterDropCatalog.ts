import type { MonsterDrop } from "@ragnarok/game-data";

/**
 * Tabela de drop por monstro, buscada sob demanda — mesma forma do
 * `net/itemCatalog`, só que aqui é UM id por vez (`GET /monsters/:id`; a API
 * não tem `/monsters/by-id?ids=` em lote como itens têm).
 *
 * Existe só para o SFX de drop raro (`audio/itemSfx`): `MonsterDrop.rate` é a
 * chance real (%, 0-100) que o `packages/game-data` já migrou do
 * `mob_db_re` — nenhuma segunda tabela de raridade inventada aqui.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

interface DropsDoMonstro {
  drops: MonsterDrop[];
  mvpDrops: MonsterDrop[];
}

const porMobId: Record<number, DropsDoMonstro> = {};
const pendentes = new Set<number>();

/** pede a tabela de drop de `mobId`, se ainda não tiver — idempotente, uma requisição por id */
export function ensureMonsterDrops(mobId: number): void {
  if (mobId <= 0 || porMobId[mobId] || pendentes.has(mobId)) return;
  pendentes.add(mobId);
  fetch(`${API_URL}/monsters/${mobId}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m: { drops?: MonsterDrop[]; mvpDrops?: MonsterDrop[] } | null) => {
      if (m) porMobId[mobId] = { drops: m.drops ?? [], mvpDrops: m.mvpDrops ?? [] };
    })
    // monstro sem registro (id de player, npc etc. batendo aqui por engano) ou
    // rede fora do ar: não é motivo pra derrubar nada, só fica sem o dado
    .catch(() => undefined)
    .finally(() => pendentes.delete(mobId));
}

/**
 * Chance (%) de `itemId` no drop table de `mobId` — `undefined` quando o
 * monstro ainda não foi catalogado (chamar `ensureMonsterDrops` antes) ou
 * quando esse item não está na tabela dele.
 */
export function dropRateFor(mobId: number, itemId: number): number | undefined {
  const info = porMobId[mobId];
  if (!info) return undefined;
  const entrada = info.drops.find((d) => d.itemId === itemId) ?? info.mvpDrops.find((d) => d.itemId === itemId);
  return entrada?.rate;
}

/** SÓ PARA TESTE — o app de verdade nunca chama isto. */
export function __resetForTests(): void {
  for (const k of Object.keys(porMobId)) delete porMobId[Number(k)];
  pendentes.clear();
}
