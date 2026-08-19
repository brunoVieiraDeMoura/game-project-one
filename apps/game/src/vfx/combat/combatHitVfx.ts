import { defineVfx } from "../core/registry";
import type { VfxDefinition } from "../core/types";
import { vfxManager } from "../core/manager";
import { criticalScaleFor } from "../core/hitVfxResolver";
import { spawnHitImpacts, shardColorForElement } from "../mage/multiHitShardImpact";

/**
 * Combat Hit VFX (auditoria "fechar Normal/Single/Critical", 2026-08-19) —
 * feedback de impacto GENÉRICO pra QUALQUER hit sem receita própria: hoje,
 * na prática, isso É o ataque básico (`entity:action`, sem `skillId`, sem
 * elemento) — toda skill de mago já tem composição própria registrada
 * (`vfx/skillVfxBindings.ts`), então o caminho "skill sem receita própria"
 * (regra 8 do pedido) fica pronto/exportado mas SEM chamador real hoje —
 * `resolveMigratedVfxId` continua decidindo skill-por-skill, este módulo
 * não mexe nisso.
 *
 * DELIBERADAMENTE mais barato e mais discreto que `GENERIC_HIT_SHARD_ID`
 * (o losango de Cold Bolt/Fire Lance): um golpe de espada não pode parecer
 * uma magia caindo do céu ("o objetivo NÃO é fazer o ataque básico parecer
 * skill mágica" — pedido explícito). Por isso: SEM queda (`payload.fallMs`
 * nunca setado — `computeDropOffset` devolve zero), SEM rotação, 1 sprite
 * pequeno (flash no ponto de impacto) + partícula NULA por padrão
 * (`particleCount:0`, custo zero — `ParticleRenderer` com 0 specs não
 * aloca slot nenhum) que só ganha corpo no crítico (`CRITICAL_BURST_
 * PARTICLES`, "pequeno burst adicional", nunca uma composição nova).
 */
export const COMBAT_HIT_VFX_ID = "combat_hit_vfx";

/**
 * VFX de hit básico por TIPO DE ARMA (pedido "VFX de Hit Básico por Tipo de
 * Arma", 2026-08-19) — `COMBAT_HIT_VFX_ID` acima é a família CIRCULAR
 * (impacto/onda de choque); esta é a família SLASH (corte rápido). Mesmo
 * mecanismo (`freezeAnchorAfterMs:0`, `criticalScaleFor`, sem `ring`/atlas
 * novo) — só a composição do sprite muda (achatado via `stretchFrom/To`,
 * ver `dropStretch.ts`, reaproveitado SEM `fallHeight` pra esticar sem
 * cair) e a rotação varia por golpe (`randomSlashRotation`) pra não repetir
 * sempre o mesmo ângulo de corte.
 */
export const SLASH_IMPACT_VFX_ID = "slash_impact_vfx";

const HIT_FLASH_MS = 180;
const HIT_TAIL_MS = 80;
const HIT_SPRITE_SCALE = 0.4;
const HIT_PARTICLE_SCALE = 0.1;
const HIT_PARTICLE_RADIUS = 0.28;
/** só existe no crítico — "pequena diferença visual, sem exagero" (pedido
 * explícito); comparar com Oracle (66/instância) ou mesmo o burst das
 * skills migradas (12-30/instância) — isto é uma fração pequena disso. */
const CRITICAL_BURST_PARTICLES = 6;
/** cadência pro fallback MULTI_HIT de ataque físico (regra 4/5) — sem dado
 * real de cadência hoje (nenhuma classe física multi-hit implementada
 * neste cliente, achado da auditoria "Hit VFX genérico"/Rodada 11): valor
 * conservador, mais rápido que a cadência mágica (200-260ms nas 5 skills
 * reais) porque golpes físicos consecutivos tendem a ser mais rápidos no
 * RO — ajustar quando uma classe física multi-hit existir de verdade.
 */
export const BASIC_ATTACK_MULTI_STAGGER_MS = 90;

const COMBAT_HIT_VFX_DEF: VfxDefinition = {
  id: COMBAT_HIT_VFX_ID,
  renderer: "sprite",
  anchor: "entity",
  // congela no spawn — mesma razão de todo impacto pontual desta
  // investigação (auditoria multi-hit 2026-08-17): pousa onde o alvo
  // estava no instante do hit, nunca reconsulta depois.
  freezeAnchorAfterMs: 0,
  lifetimeMs: HIT_FLASH_MS + HIT_TAIL_MS,
  scale: { base: HIT_SPRITE_SCALE },
  layers: [
    // camada 1: flash — cor vem de `payload.color` por CHAMADA (elemento
    // real quando existir, neutro quando não), sem fall/rotação.
    { renderer: "sprite", params: { opacity: 0.85 } },
    // camada 2: burst — `particleCount` DELIBERADAMENTE fora de `params`
    // aqui (layer.params vence sobre o payload da chamada — ver
    // `manager.ts: buildLayerRuntime` — setar aqui clobbaria o valor
    // por-chamada); vem inteiro de `spawnCombatHitVfx`/`spawnHitImpacts`
    // (0 no hit normal, `CRITICAL_BURST_PARTICLES` no crítico).
    { renderer: "particle", scale: { base: HIT_PARTICLE_SCALE }, params: { radius: HIT_PARTICLE_RADIUS } },
  ],
};
defineVfx(COMBAT_HIT_VFX_DEF);

export interface SpawnCombatHitVfxOptions {
  targetGid: number;
  /** cor — `shardColorForElement(element)`; ataque básico não tem
   * elemento (`shardColorForElement(undefined)` = neutro, nunca
   * inventado), skill sem receita própria usaria o `element` real dela. */
  color: string;
  critical: boolean;
}

/** hit ÚNICO (NORMAL/SINGLE_HIT/CRITICAL — `multiplicity==="single"` do
 * `hitVfxResolver`) — um `play()` só, sem loop/timeout nenhum. */
export function spawnCombatHitVfx(opts: SpawnCombatHitVfxOptions): void {
  vfxManager.play(COMBAT_HIT_VFX_ID, {
    targetGid: opts.targetGid,
    scale: criticalScaleFor(opts.critical),
    payload: { color: opts.color, particleCount: opts.critical ? CRITICAL_BURST_PARTICLES : 0 },
  });
}

export interface SpawnCombatHitImpactsOptions {
  targetGid: number;
  hits: number;
  color: string;
  critical: boolean;
}

/** MULTI_HIT/MULTI_HIT_CRITICAL sem receita própria — mesma mecânica de N
 * `play()` staggered + posição explícita que `spawnMultiHitShards` já usa
 * (`spawnHitImpacts`, generalizada nesta auditoria), só com o `vfxId`
 * genérico de combate em vez do losango mágico. */
export function spawnCombatHitImpacts(opts: SpawnCombatHitImpactsOptions): void {
  spawnHitImpacts({
    vfxId: COMBAT_HIT_VFX_ID,
    targetGid: opts.targetGid,
    hits: opts.hits,
    staggerMs: BASIC_ATTACK_MULTI_STAGGER_MS,
    color: opts.color,
    critical: opts.critical,
  });
}

/** cor pra hit SEM elemento conhecido (ataque básico) — reexportado por
 * conveniência, mesma paleta real (`ELEMENT_PALETTE`) que as skills usam;
 * `undefined` sempre cai no neutro, nunca inventa elemento de arma. */
export { shardColorForElement };
