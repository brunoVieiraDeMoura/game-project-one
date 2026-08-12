import { dropRateFor, ensureMonsterDrops } from "../net/monsterDropCatalog";
import { playOneShot } from "./oneShotPool";

/**
 * SFX de item — GLOBAIS, todas as classes/evoluções, sem portão
 * (`isSwordmanClass` ou qualquer coisa parecida) de propósito: diferente de
 * `audio/combatVoice`/`combatWeapon`, nada aqui lê `playerStore.stats.class`.
 */
const MOVE = "/assets/audio/item/move-item.mp3";
const RARE = "/assets/audio/item/rare-drop.mp3";
const TAKE = "/assets/audio/item/take-item.mp3";

/**
 * Item mudou de container (inventário ↔ barra de atalhos) — chamar da
 * MUTAÇÃO REAL (`hud/skillBarStore.assignItem`/`assignAmmo`/`clear`), nunca
 * do `onDrop` do componente visual: a store já sabe distinguir "arrastei e
 * soltei no MESMO slot que já estava" (não é movimento de verdade) de uma
 * troca real, e é essa distinção — não a UI — que decide se toca.
 *
 * Limitação de arquitetura, investigada antes de implementar (mesmo padrão
 * de `footsteps.ts`/`combatVoice.ts`): "Bag" (`ui/bag.ts`) não é um container
 * — é só o nome do pacote de arte da MESMA janela de Inventário; as três abas
 * (`consumiveis`/`equipamentos`/`outros`) são um `.filter()` client-side
 * sobre o mesmo `playerStore.inventory`. Não existe "mover de Inventário pra
 * Bag" pra tocar som nenhum, porque esse movimento nunca acontece — os dois
 * nomes são a MESMA coisa. O único container realmente distinto é a barra de
 * atalhos (`hud/skillBarStore`), e é nela que este som está ligado, nos dois
 * sentidos (`assignItem`/`assignAmmo` = foi pra barra; `clear` de um slot que
 * tinha item/munição = saiu da barra).
 */
export function tocarMoveuItem(): void {
  playOneShot(MOVE);
}

/**
 * Coleta de item do chão — CONFIRMADA, não a tentativa.
 *
 * Limitação de arquitetura (idem acima): o rAthena não manda um pacote
 * "você pegou o item X" — `ground:item-gone` dispara pra QUALQUER motivo do
 * item sumir do chão (você pegou, outro jogador pegou primeiro, ou ele
 * expirou), sem dizer qual. A única confirmação de verdade que É sua é
 * `inv:add` (o item entrou no SEU inventário — esse pacote só existe na SUA
 * conexão, então já é auto-restrito a você por construção), mas ele também
 * não diz DE ONDE o item veio.
 *
 * A correlação possível com o protocolo de hoje: lembrar que VOCÊ acabou de
 * mandar `item:pickup` (`registrarPedidoDeColeta`, chamado onde o pedido sai
 * de verdade — `net/NetPlayer.buscarItem`) e, se um `inv:add` chegar logo
 * depois, tratar como "aquele pedido deu certo". Não é 100% — um `inv:add`
 * de outra origem (loja, recompensa de quest) DENTRO da janela tocaria o som
 * por engano — mas hoje o único caminho real de `inv:add` no jogo é pegar do
 * chão (sem loja/quest implementadas ainda), e a alternativa (não tocar
 * nunca) seria pior que essa aproximação.
 */
const JANELA_COLETA_MS = 800;
let pedidosPendentes = 0;
let ultimoPedidoEm = 0;

/** chamar onde `item:pickup` é EMITIDO de verdade (não onde o jogador clicou) */
export function registrarPedidoDeColeta(): void {
  pedidosPendentes++;
  ultimoPedidoEm = performance.now();
}

/** chamar no `inv:add` (o item entrou no SEU inventário) */
export function aoGanharItem(): void {
  if (pedidosPendentes <= 0) return;
  if (performance.now() - ultimoPedidoEm > JANELA_COLETA_MS) {
    // pedido velho demais pra ser este ganho — provavelmente falhou (alguém
    // pegou antes, ou expirou) e o jogador ganhou o item por outro caminho
    pedidosPendentes = 0;
    return;
  }
  pedidosPendentes--;
  playOneShot(TAKE);
}

/**
 * Drop raro (`rate < 0,15%`) — correlação por PROXIMIDADE+TEMPO, não um
 * palpite por nome/preço/categoria.
 *
 * Limitação de arquitetura (idem acima, mesma investigação): `ground:item`
 * não carrega QUEM dropou (`apps/gateway/src/protocol.ts: GroundItem` não tem
 * `sourceGid`/`mobId` — é um relay quase cru do `ZC_ITEM_FALL`, que o próprio
 * rAthena não anota com a origem). A chance real (`MonsterDrop.rate`) só
 * existe por MONSTRO, então sem saber qual monstro dropou, não dá pra ler a
 * chance de verdade.
 *
 * A melhor aproximação com o protocolo de hoje: `entity:vanish` com
 * `reason === 1` (`CLR_DEAD`, `rathena/src/map/clif.hpp`) é a morte de
 * verdade de um monstro, e ela chega com o `gid` — a partir daí ainda se
 * sabe o `job` (mobId) e a célula onde ele morreu (`registrarMorteDeMonstro`,
 * chamado do `entity:vanish`, ANTES de `worldStore.vanish` apagar a
 * entidade). Quando um `ground:item` aparece pertinho (≤ 1,5 célula) e
 * pouco depois (`JANELA_CORRELACAO_MS`) de uma dessas mortes, a chance de
 * verdade daquele monstro pro item dropado é o melhor dado disponível — não
 * é garantido (duas mortes simultâneas bem próximas podem confundir), mas é
 * a chance REAL de algum monstro que morreu ali, nunca um palpite por nome.
 * Sem correspondência, o som simplesmente NÃO toca — silêncio honesto é
 * melhor que adivinhar.
 */
const RARE_RATE_MAX = 0.15;
const JANELA_CORRELACAO_MS = 400;
const DISTANCIA_MAX_CELULAS = 1.5;
const MAX_MORTES_GUARDADAS = 12;

interface MorteDeMonstro {
  mobId: number;
  x: number;
  y: number;
  em: number;
}
let mortesRecentes: MorteDeMonstro[] = [];

/** chamar no `entity:vanish` de um MOB com `reason === 1` (CLR_DEAD) */
export function registrarMorteDeMonstro(mobId: number, x: number, y: number): void {
  mortesRecentes.push({ mobId, x, y, em: performance.now() });
  if (mortesRecentes.length > MAX_MORTES_GUARDADAS) mortesRecentes.shift();
  ensureMonsterDrops(mobId); // já pede a tabela agora — o item some poucos ms depois
}

function mobDaMorteMaisProxima(x: number, y: number, agora: number): number | undefined {
  let melhorMobId: number | undefined;
  let melhorDist = Number.POSITIVE_INFINITY;
  for (const m of mortesRecentes) {
    if (agora - m.em > JANELA_CORRELACAO_MS) continue;
    const dist = Math.hypot(m.x - x, m.y - y);
    if (dist <= DISTANCIA_MAX_CELULAS && dist < melhorDist) {
      melhorDist = dist;
      melhorMobId = m.mobId;
    }
  }
  return melhorMobId;
}

/** chamar no `ground:item` (um item apareceu no chão) */
export function aoAparecerItemNoChao(itemId: number, x: number, y: number): void {
  const mobId = mobDaMorteMaisProxima(x, y, performance.now());
  if (mobId === undefined) return; // nenhuma morte recente por perto — sem dado, sem som
  const rate = dropRateFor(mobId, itemId);
  if (rate !== undefined && rate < RARE_RATE_MAX) playOneShot(RARE);
}

/** SÓ PARA TESTE — o app de verdade nunca chama isto. */
export function __resetForTests(): void {
  pedidosPendentes = 0;
  ultimoPedidoEm = 0;
  mortesRecentes = [];
}
