/**
 * Infra genuinamente compartilhada pelas skills de "N projéteis/hits
 * escaláveis por nível" (Cold Bolt, Fire Lance, Thunder Storm, Soul
 * Strike...) — as duas únicas contas que são IDÊNTICAS nas quatro, o resto
 * (visual, trajetória, timing por hit) é próprio de cada uma.
 */

/**
 * Quantidade de projéteis/hits pelo NÍVEL da skill — **achado da auditoria
 * "count real" (2026-08-19): NÃO É MAIS a fonte de verdade pro VFX**. O
 * servidor manda a contagem REAL agregada no próprio pacote
 * (`SkillCast.count`, `dmg.div_` do rAthena, confirmado via
 * `skill_db.yml: HitCount` — Cold Bolt/Fire Lance/Thunder Storm/Light
 * Bolt vão até 10 no nível 10, Soul Strike até 5, nunca 5 fixo como esta
 * função assumia) — `net/useWorldEvents.ts` lê `p.count` diretamente
 * agora. Esta função sobrevive só como FALLBACK pros casos sem `count`
 * de verdade (o helper de teste manual `__testarColdBolt` etc., que não
 * tem pacote de rede nenhum pra ler) — teto corrigido de 5 pra 10 pra não
 * mentir mais que o antigo (era um chute, não um teto real das skills):
 *
 * ```
 * Lv 1  → 1      Lv 6  → 6
 * Lv 2  → 2      Lv 7  → 7
 * Lv 3  → 3      Lv 8  → 8
 * Lv 4  → 4      Lv 9  → 9
 * Lv 5  → 5      Lv 10 → 10
 * ```
 */
export function getSkillProjectileCount(level: number): number {
  return Math.min(10, Math.max(1, Math.round(level)));
}

/**
 * Duração TOTAL que o efeito precisa ficar vivo no `vfxStore` — mesma conta
 * nas quatro skills, só os números de entrada mudam (stagger entre hits,
 * quando dentro do hit o "impacto" acontece, duração do rabo da cascata de
 * número, duração do total amarelo, folga final).
 *
 * Derivação (pra quem for mexer): o último hit "chega" em
 * `(hits-1)*staggerMs + impactAtMs`; dali em diante o que ainda precisa
 * caber é o MAIOR entre o rabo da cascata de número (`damageNumberMs`) e o
 * total amarelo (`totalVisibleMs`) — os dois competem pelo mesmo tempo,
 * nunca somam. `hits<=0` blindado pro raio de teste manual não gerar um
 * `-staggerMs` esquisito.
 */
export function multiHitTotalMs(
  hits: number,
  staggerMs: number,
  impactAtMs: number,
  damageNumberMs: number,
  totalVisibleMs: number,
  buffer = 100,
): number {
  const lastHitAtMs = Math.max(0, hits - 1) * staggerMs + impactAtMs;
  return lastHitAtMs + Math.max(damageNumberMs, totalVisibleMs) + buffer;
}

/**
 * Duração de Thunder Storm — dado de REDE puro (calcula `expiresAt` no
 * `skill:cast`, `net/useWorldEvents.ts` via `multiHitRegistry.ts`), por
 * isso mora aqui (módulo sem efeito colateral) e não em
 * `thunder-storm/thunderStormVfxDef.tsx` (que registra a skill no VFX Core
 * ao ser importado — a rede nunca deveria puxar esse registro só pra ler
 * um número). Constantes duplicadas de propósito (mesmo valor, dois
 * arquivos): a arte também as usa pra desenhar a MESMA cadência, mas os
 * dois lados não devem DEPENDER um do outro.
 */
// pedido 2026-08-19 (sincronizar velocidade da animação/áudio): era 260 —
// manter os DOIS lados em sync ao mudar, ver `thunder-storm/thunderStormVfxDef.tsx`.
const THUNDER_PULSE_STAGGER_MS = 170;
const THUNDER_PULSE_DAMAGE_NUMBER_MS = 1000;
const THUNDER_TOTAL_VISIBLE_MS = 1500;
export function thunderStormTotalMs(pulses: number): number {
  return multiHitTotalMs(pulses, THUNDER_PULSE_STAGGER_MS, 0, THUNDER_PULSE_DAMAGE_NUMBER_MS, THUNDER_TOTAL_VISIBLE_MS, 300);
}
