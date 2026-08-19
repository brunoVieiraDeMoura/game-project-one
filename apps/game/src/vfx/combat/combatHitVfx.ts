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
/**
 * Escala/posição (rodada 2 — "não gostei do efeito", 2026-08-19): dois
 * problemas reais achados no `/play`, não mais escala pura:
 *
 * 1) SEM offset vertical, `anchor:"entity"` pousa no PÉ do alvo
 *    (`resolveEntityOrCellPosition` → `interpolatedCell`/`cellToWorld`,
 *    nunca centro de massa) — o próprio corpo do alvo (geometria opaca,
 *    escreve profundidade) ocultava o flash por trás/dentro das pernas.
 *    `offset:[0,HIT_OFFSET_Y,0]` é o MESMO mecanismo que
 *    `freezeBodyVfxDefGpu.tsx`/`FREEZE_SHATTER_GPU_DEF` já usam pra pousar
 *    no torso em vez do chão — reaproveitado, não um offset novo.
 * 2) Um sprite só (disco radial suave) nunca ia LER como "impacto" —
 *    `HIT_HALO_SCALE` adiciona uma segunda camada maior/mais fraca
 *    concêntrica (núcleo denso + halo largo, ambas placeholder-circle),
 *    a mesma técnica de "duas camadas concêntricas" que
 *    `freezeBodyVfxDefGpu.tsx` já usa (corpo + núcleo, linhas 38-39) —
 *    sem inventar renderer novo.
 */
const HIT_OFFSET_Y = 1.0;
const HIT_SPRITE_SCALE = 1.3;
const HIT_HALO_SCALE = 2.3;
const HIT_HALO_OPACITY = 0.3;
const HIT_PARTICLE_SCALE = 0.18;
const HIT_PARTICLE_RADIUS = 0.45;
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
  scale: { base: HIT_SPRITE_SCALE, byTarget: true },
  layers: [
    // camada 1: núcleo — denso, opaco, lê como o "estouro" do impacto.
    // cor vem de `payload.color` por CHAMADA (elemento real quando
    // existir, neutro quando não), sem fall/rotação. `offset` é POR
    // CAMADA (`manager.ts: buildLayerRuntime`/`applyOffsetInto` só lê
    // `layer.offset`, o campo `offset` no nível de `VfxDefinition` não é
    // aplicado a posição nenhuma — achado desta rodada, repetir em
    // TODA camada em vez de setar uma vez no topo).
    { renderer: "sprite", offset: [0, HIT_OFFSET_Y, 0], params: { opacity: 0.95 } },
    // camada 2: halo — MAIOR e mais fraco, concêntrico ao núcleo (mesma
    // técnica de 2 camadas de `freezeBodyVfxDefGpu.tsx: buildFreezeBodyLayers`,
    // linhas 38-39) — é o que faz o disco único parar de ler como "um
    // ponto" e virar "uma onda de choque".
    {
      renderer: "sprite",
      scale: { base: HIT_HALO_SCALE, byTarget: true },
      offset: [0, HIT_OFFSET_Y, 0],
      params: { opacity: HIT_HALO_OPACITY },
    },
    // camada 3: burst — `particleCount` DELIBERADAMENTE fora de `params`
    // aqui (layer.params vence sobre o payload da chamada — ver
    // `manager.ts: buildLayerRuntime` — setar aqui clobbaria o valor
    // por-chamada); vem inteiro de `spawnCombatHitVfx`/`spawnHitImpacts`
    // (0 no hit normal, `CRITICAL_BURST_PARTICLES` no crítico).
    { renderer: "particle", scale: { base: HIT_PARTICLE_SCALE }, offset: [0, HIT_OFFSET_Y, 0], params: { radius: HIT_PARTICLE_RADIUS } },
  ],
};
defineVfx(COMBAT_HIT_VFX_DEF);

/**
 * Achatamento fixo (`stretchFrom===stretchTo`, sem animação) — vira uma
 * "lâmina" alongada em vez de flash redondo. Rodada 2 ("tem que parecer
 * um corte", 2026-08-19): largura ENCOLHIDA (`SLASH_SPRITE_SCALE` desceu
 * de 0.85→0.6) e `SLASH_STRETCH` subiu (3.0→4.8) — mais fino e mais
 * comprido lê como LÂMINA, largo+curto lia como blob esticado. Comprimento
 * aparente é `SLASH_SPRITE_SCALE * SLASH_STRETCH * targetScale` (~2.9
 * unidades no alvo padrão), largura só `SLASH_SPRITE_SCALE * targetScale`
 * (~0.6) — mesmo `byTarget:true` de `freezeBodyVfxDefGpu.tsx`. `offset`
 * sobe pro torso pelo MESMO motivo/mecanismo do circular acima (ver
 * `HIT_OFFSET_Y`) — sem ele o corte nascia no pé do alvo, atrás/dentro da
 * própria geometria do corpo.
 */
const SLASH_FLASH_MS = 160;
const SLASH_TAIL_MS = 90;
const SLASH_OFFSET_Y = 1.0;
const SLASH_SPRITE_SCALE = 0.6;
const SLASH_PARTICLE_SCALE = 0.14;
const SLASH_PARTICLE_RADIUS = 0.35;
const SLASH_STRETCH = 4.8;
/** mesma ideia de `CRITICAL_BURST_PARTICLES`, fração menor (o corte já é
 * visualmente maior por causa do `SLASH_STRETCH`, não precisa do mesmo
 * burst do impacto circular pra "ler" como crítico). */
const SLASH_CRITICAL_BURST_PARTICLES = 4;
/** ângulo-base do corte (mesmo espírito de `SHARD_ROTATION` em
 * `multiHitShardImpact.ts`: diagonal, não alinhado aos eixos) + faixa de
 * variação aleatória por golpe (pedido explícito: "permitir variação de
 * rotação para evitar que todos os cortes tenham exatamente a mesma
 * orientação"). */
const SLASH_BASE_ROTATION = Math.PI / 4;
const SLASH_ROTATION_JITTER = Math.PI / 3;

function randomSlashRotation(): number {
  return SLASH_BASE_ROTATION + (Math.random() - 0.5) * SLASH_ROTATION_JITTER;
}

const SLASH_IMPACT_VFX_DEF: VfxDefinition = {
  id: SLASH_IMPACT_VFX_ID,
  renderer: "sprite",
  anchor: "entity",
  // congela no spawn — mesma razão de `COMBAT_HIT_VFX_DEF` acima.
  freezeAnchorAfterMs: 0,
  lifetimeMs: SLASH_FLASH_MS + SLASH_TAIL_MS,
  scale: { base: SLASH_SPRITE_SCALE, byTarget: true },
  layers: [
    {
      renderer: "sprite",
      // `offset` — mesmo mecanismo/motivo de `COMBAT_HIT_VFX_DEF` acima
      // (`layer.offset`, nunca o campo no nível de `VfxDefinition`, que o
      // manager não lê pra posição).
      offset: [0, SLASH_OFFSET_Y, 0],
      // `fallMs` SEM `fallHeight` — `computeDropOffset` continua devolvendo
      // zero (não cai), mas `computeDropStretch` já lê só `fallMs` pra
      // habilitar o alongamento (`dropStretch.ts`); `stretchFrom===stretchTo`
      // deixa o valor CONSTANTE pela vida inteira do sprite, sem animar.
      params: {
        opacity: 0.95,
        fallMs: SLASH_FLASH_MS + SLASH_TAIL_MS,
        stretchFrom: SLASH_STRETCH,
        stretchTo: SLASH_STRETCH,
      },
    },
    // burst PEQUENO só no crítico — mesmo padrão de `COMBAT_HIT_VFX_DEF`
    // (`particleCount` fora de `params`, vem por chamada).
    { renderer: "particle", scale: { base: SLASH_PARTICLE_SCALE }, offset: [0, SLASH_OFFSET_Y, 0], params: { radius: SLASH_PARTICLE_RADIUS } },
  ],
};
defineVfx(SLASH_IMPACT_VFX_DEF);

/**
 * Classificação CENTRALIZADA arma → família de VFX (pedido explícito:
 * "não espalhar if/else de tipos de armas por vários arquivos" — este é o
 * ÚNICO lugar que sabe a lista). `weaponType` é o `ItemSubType` real do
 * catálogo (`net/itemCatalog.ts: ItemInfo.subType`, migrado do `item_db`
 * `SubType`) — nunca o nome textual do item.
 *
 * Regra de fallback (pedido explícito): qualquer arma fora da lista SLASH
 * — incluindo `undefined` (arma desconhecida, sem arma, ou dono cujo
 * inventário o cliente não enxerga: só o PRÓPRIO jogador tem `subType`
 * resolvido, ver `audio/combatWeapon.ts: subtipoDaArmaEquipada`) — cai em
 * `"circular-impact"`. Nunca deixa um golpe sem VFX por falta de
 * classificação.
 */
export type BasicAttackHitVfxKind = "slash-impact" | "circular-impact";

const SLASH_WEAPON_TYPES: ReadonlySet<string> = new Set([
  "dagger", "1h_sword", "2h_sword", "1h_spear", "2h_spear",
  "1h_axe", "2h_axe", "katar", "huuma", // huuma = Fuuma Shuriken (W_HUUMA)
]);

export function getBasicAttackHitVfx(weaponType: string | undefined): BasicAttackHitVfxKind {
  if (weaponType && SLASH_WEAPON_TYPES.has(weaponType)) return "slash-impact";
  return "circular-impact";
}

export interface SpawnCombatHitVfxOptions {
  targetGid: number;
  /** cor — `shardColorForElement(element)`; ataque básico não tem
   * elemento (`shardColorForElement(undefined)` = neutro, nunca
   * inventado), skill sem receita própria usaria o `element` real dela. */
  color: string;
  critical: boolean;
  /** `ItemSubType` da arma de quem bateu — `undefined` cai no circular
   * (ver `getBasicAttackHitVfx`). */
  weaponType?: string;
}

/** hit ÚNICO (NORMAL/SINGLE_HIT/CRITICAL — `multiplicity==="single"` do
 * `hitVfxResolver`) — um `play()` só, sem loop/timeout nenhum. */
export function spawnCombatHitVfx(opts: SpawnCombatHitVfxOptions): void {
  const kind = getBasicAttackHitVfx(opts.weaponType);
  const isSlash = kind === "slash-impact";
  const vfxId = isSlash ? SLASH_IMPACT_VFX_ID : COMBAT_HIT_VFX_ID;
  const handle = vfxManager.play(vfxId, {
    targetGid: opts.targetGid,
    scale: criticalScaleFor(opts.critical),
    rotation: isSlash ? randomSlashRotation() : undefined,
    payload: {
      color: opts.color,
      particleCount: opts.critical ? (isSlash ? SLASH_CRITICAL_BURST_PARTICLES : CRITICAL_BURST_PARTICLES) : 0,
    },
  });
  if (import.meta.env.DEV) {
    // `handle === undefined` = `vfxManager.play` descartou o spawn em
    // silêncio (definition não registrada OU `world` ainda não setado por
    // `VfxRoot` — ver `manager.ts: play()`). É o sinal definitivo de "não
    // deveria ter renderizado nada mesmo".
    console.debug("[vfx-hit-debug] spawnCombatHitVfx", { weaponType: opts.weaponType, kind, vfxId, targetGid: opts.targetGid, spawned: handle !== undefined });
  }
}

export interface SpawnCombatHitImpactsOptions {
  targetGid: number;
  hits: number;
  color: string;
  critical: boolean;
  /** mesmo campo de `SpawnCombatHitVfxOptions` — ver `getBasicAttackHitVfx`. */
  weaponType?: string;
}

/** MULTI_HIT/MULTI_HIT_CRITICAL sem receita própria — mesma mecânica de N
 * `play()` staggered + posição explícita que `spawnMultiHitShards` já usa
 * (`spawnHitImpacts`, generalizada nesta auditoria), só com o `vfxId`
 * genérico de combate em vez do losango mágico. */
export function spawnCombatHitImpacts(opts: SpawnCombatHitImpactsOptions): void {
  const kind = getBasicAttackHitVfx(opts.weaponType);
  const isSlash = kind === "slash-impact";
  const vfxId = isSlash ? SLASH_IMPACT_VFX_ID : COMBAT_HIT_VFX_ID;
  if (import.meta.env.DEV) {
    console.debug("[vfx-hit-debug] spawnCombatHitImpacts", { weaponType: opts.weaponType, kind, vfxId, targetGid: opts.targetGid, hits: opts.hits });
  }
  spawnHitImpacts({
    vfxId,
    targetGid: opts.targetGid,
    hits: opts.hits,
    staggerMs: BASIC_ATTACK_MULTI_STAGGER_MS,
    color: opts.color,
    critical: opts.critical,
    rotation: isSlash ? randomSlashRotation() : undefined,
  });
}

/** cor pra hit SEM elemento conhecido (ataque básico) — reexportado por
 * conveniência, mesma paleta real (`ELEMENT_PALETTE`) que as skills usam;
 * `undefined` sempre cai no neutro, nunca inventa elemento de arma. */
export { shardColorForElement };
