/**
 * Performance budget (Fase 5, itens 10/13 do pedido) — mecanismo DISTINTO
 * de frustum culling e de LOD (ver `lod.ts`): "CPU/GPU sob pressão → reduz
 * por PRIORIDADE, nunca hardcoded dentro de uma skill".
 *
 * Este módulo é só a ALGORITMO — priorizar e escolher quem cai — puro,
 * sem estado, 100% testável isoladamente. `manager.ts` expõe
 * `computeBudgetPressure()` que usa isto pra DECIDIR quem excluir, mas (ver
 * docblock lá) a APLICAÇÃO dessa decisão no laço de `update()` ainda não
 * está ligada — combinar budget-cull com frustum-cull no mesmo flag por
 * instância sem um bug de "flapping" (as duas razões brigando quadro a
 * quadro sobre quem reativa a instância) precisa de um estado separado por
 * razão, deixado como próximo passo explícito depois que os limiares forem
 * calibrados por benchmark real (pedido do usuário: infra existe, número
 * não é chutado).
 */

export type VfxPriority = "own" | "near" | "far" | "npc-far";

/** menor = mais importante, nunca cai primeiro. */
const PRIORITY_RANK: Record<VfxPriority, number> = { own: 0, near: 1, far: 2, "npc-far": 3 };

export function priorityRank(p: VfxPriority): number {
  return PRIORITY_RANK[p];
}

export interface VfxPriorityInput {
  /** `spawnOptions.sourceGid` de quem lançou o efeito — `undefined` = sem
   * caster conhecido (ex.: efeito de área sem dono claro), tratado como NPC. */
  sourceGid: number | undefined;
  /** gid do jogador local — vem de `net/worldStore`/sessão, nunca adivinhado. */
  localPlayerGid: number | undefined;
  /** o caster é um jogador (não NPC/monstro) — decide "near" vs "npc-far"
   * quando não é o próprio jogador local. */
  sourceIsPlayer: boolean;
  distanceToCamera: number;
  nearDistance: number;
}

/** própria skill do jogador > jogador próximo > jogador distante > NPC
 * distante — ordem exata do item 10 do pedido. Nunca hardcoded numa skill:
 * só este módulo decide, a partir de dados que o `manager` já tem
 * (`sourceGid`, posição, câmera). */
export function priorityFor(input: VfxPriorityInput): VfxPriority {
  if (input.localPlayerGid !== undefined && input.sourceGid === input.localPlayerGid) return "own";
  if (input.sourceIsPlayer) return input.distanceToCamera <= input.nearDistance ? "near" : "far";
  return "npc-far";
}

export interface BudgetCandidate {
  instanceId: number;
  priority: VfxPriority;
}

/**
 * Dado um limite de instâncias simultâneas e a lista de candidatas vivas,
 * devolve o `Set` de `instanceId` que DEVERIAM sair pra caber no limite —
 * as de PIOR prioridade primeiro. `limit === Infinity` (padrão, ver
 * `DEFAULT_BUDGET_LIMITS`) devolve sempre um `Set` vazio — no-op.
 */
export function selectExcluded(candidates: readonly BudgetCandidate[], limit: number): Set<number> {
  const excluded = new Set<number>();
  if (!Number.isFinite(limit) || candidates.length <= limit) return excluded;
  const sorted = [...candidates].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  const excessCount = candidates.length - limit;
  for (let i = 0; i < excessCount; i++) excluded.add(sorted[i]!.instanceId);
  return excluded;
}

export interface VfxBudgetLimits {
  /** instâncias ativas simultâneas — `Infinity` = sem limite (padrão, TBD
   * definir após benchmark real, ver `docs/claude-context/
   * 09-vfx-gpu-migration.md`, seção "Budget inicial"). */
  maxActiveInstances: number;
  /** soma de `particleCount` de TODAS as camadas `particle` ativas ao
   * mesmo tempo — item explícito do pedido (Directive B, "limites
   * globais... partículas simultâneas"). `Infinity` = sem limite. */
  maxActiveParticles: number;
  /** instâncias ativas cuja definição usa (alguma camada) `renderer:"dom"`
   * — item explícito do pedido ("DOM VFX"). `Infinity` = sem limite. */
  maxDomInstances: number;
  /** teto de partículas simultâneas por `vfxId` (uma skill não pode sozinha
   * consumir o orçamento inteiro) — item explícito ("partículas por
   * skill"). Calibrado (não `Infinity`) — ver `PARTICLES_PER_SKILL_
   * CONFIRMED_SAFE` abaixo pro dado real por trás do número. */
  maxParticlesPerSkill: number;
  /** teto de partículas simultâneas por `sourceGid` (um jogador não pode
   * sozinho consumir o orçamento inteiro) — item explícito ("partículas
   * por jogador"). Calibrado — ver `PARTICLES_PER_PLAYER_CONFIRMED_SAFE`
   * abaixo. */
  maxParticlesPerPlayer: number;
}

/**
 * Calibração real (Directive B, "fecha os limites globais por-player/
 * por-skill com os números reais") — os dois únicos limites com dado de
 * benchmark GPU real (headed, `NVIDIA GTX 1660 Ti`) suficiente pra
 * calibrar sem chutar; os outros 3 (`maxActiveInstances`/
 * `maxActiveParticles`/`maxDomInstances`) continuam `Infinity`, sem dado
 * equivalente ainda.
 *
 * `PARTICLES_PER_SKILL_CONFIRMED_SAFE = 1980`: maior total de partícula
 * de UMA skill só, confirmado 60fps sólido em GPU real — Oracle tier
 * "high" (66 partículas/instância) × 30 jogadores simultâneos, curva de
 * escala isolada (`docs/claude-context/09-vfx-gpu-migration.md`, Fase
 * AR). Nenhuma outra skill migrada chega perto (Fire Lance/Cold Bolt
 * ficam em 30/instância, a maior depois de Oracle).
 *
 * `PARTICLES_PER_PLAYER_CONFIRMED_SAFE = 334`: soma de `particleCount`
 * de TODAS as 11 skills disparadas ao mesmo tempo pelo MESMO jogador
 * (FireBall 16 + ThunderStorm 24 + FireWall 12×8 células + Oracle 66 +
 * ColdBolt 30 + SoulStrike 18 + FireLance 30 + LightBolt 16 + FrostDiver
 * 16 + StoneCurse 12 + GhostDome 10 = 334) — o combo caótico completo,
 * confirmado 57-60fps em GPU real nos 6 pontos medidos (10/20/30
 * players × tight/spread, seção W do mesmo relatório).
 *
 * Os DEFAULTS abaixo ficam ~25% ACIMA desses números confirmados-seguros
 * — não é "o ponto onde quebra" (GPU real nunca quebrou em nenhum teste
 * desta investigação, nem no cenário mais extremo medido), é uma trava
 * de segurança além de tudo que já foi validado — protege contra um caso
 * futuro nunca testado (skill nova com MUITAS partículas, nível/hits
 * maior que o testado), sem apertar nada que já está confirmado seguro.
 */
const PARTICLES_PER_SKILL_CONFIRMED_SAFE = 1980;
const PARTICLES_PER_PLAYER_CONFIRMED_SAFE = 334;

export const DEFAULT_BUDGET_LIMITS: VfxBudgetLimits = {
  maxActiveInstances: Infinity,
  maxActiveParticles: Infinity,
  maxDomInstances: Infinity,
  maxParticlesPerSkill: Math.ceil(PARTICLES_PER_SKILL_CONFIRMED_SAFE * 1.25),
  maxParticlesPerPlayer: Math.ceil(PARTICLES_PER_PLAYER_CONFIRMED_SAFE * 1.25),
};

/**
 * Candidato "pesado" — extensão de `BudgetCandidate` com os dados que os
 * limites GRANULARES (Directive B) precisam pra decidir. Tipo SEPARADO de
 * propósito: `BudgetCandidate`/`selectExcluded` (acima) continuam exatamente
 * como estavam — `maxActiveInstances` é o único limite que só precisa de
 * `instanceId`/`priority`; os 4 limites novos precisam de mais contexto por
 * instância, então ganham seu próprio tipo em vez de inflar o antigo (evita
 * quebrar os testes/call sites que já constroem `BudgetCandidate` mínimo).
 */
export interface WeightedBudgetCandidate extends BudgetCandidate {
  vfxId: string;
  /** `spawnOptions.sourceGid` — mesma semântica de `VfxPriorityInput.
   * sourceGid`; `undefined` = sem dono conhecido, nunca agrupado com outra
   * instância no limite "por jogador" (ver `selectExcludedGrouped`). */
  sourceGid: number | undefined;
  /** soma de `particleCount` de toda camada `particle` desta instância —
   * `0` pra instância sem nenhuma camada `particle` (nunca conta pra
   * `maxActiveParticles`/`maxParticlesPerSkill`/`maxParticlesPerPlayer`,
   * mas ainda conta pra `maxActiveInstances`/`maxDomInstances`). */
  particleCount: number;
  /** alguma camada desta instância renderiza via `renderer:"dom"`. */
  isDom: boolean;
}

/**
 * Generalização de `selectExcluded()`: em vez de contar 1 por instância,
 * soma `weightOf(candidate)` — permite o MESMO algoritmo de prioridade
 * (pior primeiro, `own` nunca cai primeiro) decidir por PESO (partículas)
 * em vez de só por CONTAGEM (instâncias). `selectExcluded(candidates,
 * limit)` é o caso particular `weightOf = () => 1`.
 */
export function selectExcludedByWeight<T extends BudgetCandidate>(
  candidates: readonly T[],
  limit: number,
  weightOf: (candidate: T) => number,
): Set<number> {
  const excluded = new Set<number>();
  if (!Number.isFinite(limit)) return excluded;
  let total = 0;
  for (const c of candidates) total += weightOf(c);
  if (total <= limit) return excluded;
  const sorted = [...candidates].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  for (const c of sorted) {
    if (total <= limit) break;
    const w = weightOf(c);
    if (w <= 0) continue; // peso zero nunca ajuda a caber no limite — não teria por que cair
    excluded.add(c.instanceId);
    total -= w;
  }
  return excluded;
}

/**
 * `selectExcludedByWeight`, mas o limite vale POR GRUPO (`keyOf`), não pro
 * total geral — usado pelos limites "por skill"/"por jogador" (item
 * explícito do pedido: um jogador/skill não pode sozinho estourar o
 * orçamento de outro). Candidato sem chave (`keyOf` devolve `undefined`,
 * ex.: efeito de área sem `sourceGid`) nunca é excluído por ESTE limite —
 * "por jogador" não se aplica a quem não tem jogador dono conhecido.
 */
export function selectExcludedGrouped<T extends BudgetCandidate>(
  candidates: readonly T[],
  limit: number,
  weightOf: (candidate: T) => number,
  keyOf: (candidate: T) => string | number | undefined,
): Set<number> {
  const excluded = new Set<number>();
  if (!Number.isFinite(limit)) return excluded;
  const groups = new Map<string | number, T[]>();
  for (const c of candidates) {
    const key = keyOf(c);
    if (key === undefined) continue;
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }
  for (const group of groups.values()) {
    for (const id of selectExcludedByWeight(group, limit, weightOf)) excluded.add(id);
  }
  return excluded;
}
