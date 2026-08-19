import { defineVfx } from "../core/registry";
import type { VfxDefinition } from "../core/types";
import { vfxManager } from "../core/manager";
import { criticalScaleFor } from "../core/hitVfxResolver";

/**
 * Generic Hit VFX (2026-08-19, "arquitetura genérica de VFX de acerto
 * baseada no hitType real") — fragmento/losango caindo do céu, tocado UMA
 * VEZ POR HIT real. Nasceu como `buildMultiHitShardDef`/2 paletas
 * (Cold Bolt/Fire Lance, 2026-08-19 anterior) — REFATORADO aqui pra ser
 * genuinamente compartilhado: **UMA `VfxDefinition` só**
 * (`GENERIC_HIT_SHARD_ID`), registrada UMA VEZ, cor/escala vêm inteiras
 * de `payload`/`opts.scale` por CHAMADA — não mais uma `VfxDefinition`
 * nova por skill. Uma skill nova com `hitType==="multi_hit"` não precisa
 * registrar nada: só aparecer em `MULTI_HIT_SHARD_VFX`
 * (`multiHitRegistry.ts`) com seu `staggerMs`, a cor vem do `element`
 * REAL do skill_db (`ELEMENT_PALETTE` abaixo) — nunca uma tabela nova de
 * "cor por skill" pra manter.
 *
 * Desempenho em primeiro lugar (herdado, continua valendo): 1 camada só
 * — `sprite` (`rotation:45°` = diamante de graça, sem atlas/geometria
 * nova). SEM `ring` (achado real: `RingRenderer.onInstanceCreate` amostra
 * 81 pontos de terreno + recomputa bounding sphere TODA VEZ que nasce —
 * pagar isso 1×/cast era ok, pagar 5×/cast não). SEM `particle`
 * (`ParticleRenderer` tem `delayMs`/`durMs` cravados pra efeito de área de
 * vida longa, incompatível com um fragmento de ~450ms).
 */
export const GENERIC_HIT_SHARD_ID = "generic_hit_shard";
const SHARD_FALL_MS = 260;
const SHARD_TAIL_MS = 150;
const SHARD_FALL_HEIGHT = 8;
const SHARD_SPRITE_SCALE = 1.2;
/** rotação fixa — sprite quadrado virado 45° vira diamante, sem atlas
 * novo (`instance.spawnOptions.rotation`, já lido pelo `SpriteRenderer`). */
const SHARD_ROTATION = Math.PI / 4;
/** teto de instâncias VISUAIS por cast — margem generosa acima do maior
 * `HitCount` real confirmado hoje (10, Cold Bolt/Fire Lance/Thunder
 * Storm/Light Bolt nível 10). Nunca reescreve o `hits` real recebido —
 * só limita quantos `play()` ACONTECEM (Fase 5, "REAL COMBAT COUNT ≠
 * VISUAL INSTANCE COUNT"). */
const VISUAL_SHARD_CAP = 20;

const GENERIC_HIT_SHARD_DEF: VfxDefinition = {
  id: GENERIC_HIT_SHARD_ID,
  renderer: "sprite",
  anchor: "entity",
  // congela no spawn — mesma razão de sempre (auditoria multi-hit
  // 2026-08-17/18): cada fragmento pousa onde o alvo estava quando ELE
  // nasceu, nunca reconsulta o alvo depois disso.
  freezeAnchorAfterMs: 0,
  lifetimeMs: SHARD_FALL_MS + SHARD_TAIL_MS,
  scale: { base: SHARD_SPRITE_SCALE },
  layers: [
    {
      renderer: "sprite",
      // `color` NÃO fica aqui — vem de `payload.color` por CHAMADA
      // (`spawnMultiHitShards`), é isso que torna 1 definição só
      // suficiente pra qualquer elemento.
      params: { opacity: 0.95, fallMs: SHARD_FALL_MS, fallHeight: SHARD_FALL_HEIGHT, arriveY: 0 },
    },
  ],
};
defineVfx(GENERIC_HIT_SHARD_DEF);

/**
 * Paleta REAL por elemento do skill_db (`rathena/db/re/skill_db.yml:
 * Element:`, migrado até `net/skillCatalog.ts: SkillInfo.element`) — não
 * uma tabela de "cor por Aegis" inventada. Uma skill NOVA com elemento já
 * coberto aqui ganha a cor certa de graça, sem precisar de código novo.
 * Cobre só os elementos das skills multi-hit reais hoje (Water/Fire/Wind/
 * Ghost) + um fallback neutro — cresce por elemento descoberto, nunca por
 * skill.
 *
 * "Wind" aqui é ELÉTRICO de propósito (não verde) — Thunder Storm/Light
 * Bolt (as 2 skills Wind reais) sempre tiveram identidade elétrica nesta
 * reconstrução (SFX, paleta, nome "Eletrocutar"), preservada aqui — a
 * regra do pedido é "não quebrar identidade visual já estabelecida", não
 * "seguir a cor RO genérica do elemento".
 */
const ELEMENT_PALETTE: Record<string, string> = {
  water: "#c9f3ff",
  fire: "#ff9d3a",
  wind: "#b4dcff",
  ghost: "#eaf6ff",
  earth: "#9c8f7a",
  neutral: "#e8e8e8",
};
const FALLBACK_COLOR = ELEMENT_PALETTE.neutral!;

/** cor do fragmento pro elemento de uma skill — `element` vem de
 * `net/skillCatalog.ts: SkillInfo.element` (dado real do servidor), nunca
 * adivinhado. */
export function shardColorForElement(element: string | undefined): string {
  if (!element) return FALLBACK_COLOR;
  return ELEMENT_PALETTE[element.toLowerCase()] ?? FALLBACK_COLOR;
}

const pendingShardTimeouts = new Set<ReturnType<typeof setTimeout>>();

export interface SpawnHitImpactsOptions {
  /** qual `VfxDefinition` tocar N vezes — generalização (auditoria "Combat
   * Hit VFX genérico" 2026-08-19): a mecânica de stagger/freeze/posição-
   * explícita é a mesma pra QUALQUER def de impacto reutilizável, só o
   * `vfxId` muda (`GENERIC_HIT_SHARD_ID` pro losango de Cold Bolt/Fire
   * Lance, `COMBAT_HIT_VFX_ID`/`vfx/combat/combatHitVfx.ts` pro flash
   * genérico de ataque físico multi-hit). */
  vfxId: string;
  targetGid: number;
  /** quantidade REAL de hits do cast — quem decide isso é `useWorldEvents.
   * ts`/o servidor, nunca este módulo (pedido explícito: "o VFX não deve
   * controlar a quantidade de hits"). */
  hits: number;
  /** intervalo entre hits. */
  staggerMs: number;
  color: string;
  /** hit crítico — mesmo flag (`damageKind(p.action).crit`); aqui só
   * cresce o impacto (`criticalScaleFor`), nenhum mecanismo novo. */
  critical?: boolean;
  /** rotação fixa do sprite (ex.: 45° = diamante pro losango) — ausente =
   * sem rotação, o flash genérico de combate não precisa de nenhuma. */
  rotation?: number;
  /** teto de instâncias VISUAIS — default `VISUAL_SHARD_CAP` (20). */
  visualCap?: number;
}

/**
 * Dispara N impactos do MESMO `VfxDefinition` reutilizável — um `play()`
 * por hit, nunca uma animação só contendo os N hits pré-montados. O
 * primeiro hit ancora no alvo AO VIVO (`targetGid`, resolvido uma vez,
 * congela igual todo o resto); os hits SEGUINTES reusam essa MESMA
 * posição já resolvida, passada explicitamente (`opts.position`, sem
 * `targetGid`) — nunca fazem uma segunda consulta ao `worldStore`. Isso é
 * mais forte que só `freezeAnchorAfterMs`: um impacto agendado pra daqui
 * a 400ms nem TENTA olhar o alvo de novo, então não importa se o mob já
 * morreu/sumiu/foi reusado por um respawn entre o hit 1 e o hit N — todos
 * pousam no MESMO lugar onde o hit 1 pousou (correto: o servidor já
 * resolveu o dano da sequência inteira num único instante).
 */
export function spawnHitImpacts(opts: SpawnHitImpactsOptions): void {
  // REAL COMBAT COUNT — nunca alterado, é exatamente o que o servidor
  // mandou (`p.count`). Usado só pra decidir quantos `play()` ACONTECEM
  // dentro do teto visual abaixo; o valor em si não é reescrito em
  // lugar nenhum (quem quiser o número real de hits pro combate/áudio/
  // damage number continua lendo `opts.hits` puro, esta função não o
  // devolve nem o transforma).
  const realHits = Math.max(1, Math.floor(opts.hits));
  // VISUAL INSTANCE COUNT — pode ser MENOR que `realHits` sob pressão
  // (pedido explícito, Fase 5: "não altere o count recebido, apenas
  // reduza a representação visual"). `VISUAL_SHARD_CAP` é uma margem
  // generosa acima do teto real hoje (10, Cold Bolt/Fire Lance/Thunder
  // Storm/Light Bolt no nível máximo) — nunca aperta nada confirmado
  // seguro, só protege contra uma skill futura com `count` muito maior
  // que qualquer coisa já medida (mesmo espírito de `PARTICLES_PER_
  // SKILL_CONFIRMED_SAFE` em `vfx/core/budget.ts`: margem sobre dado
  // real, não limite descoberto quebrando).
  const visualHits = Math.min(realHits, opts.visualCap ?? VISUAL_SHARD_CAP);

  const scale = criticalScaleFor(opts.critical === true);
  const rotation = opts.rotation ?? 0;
  const payload = { color: opts.color };
  const first = vfxManager.play(opts.vfxId, { targetGid: opts.targetGid, rotation, scale, payload });
  if (!first) return;
  const instance = vfxManager.getInstance(first.instanceId);
  if (!instance) return;
  const position = { x: instance.position.x, y: instance.position.y, z: instance.position.z };

  for (let i = 1; i < visualHits; i++) {
    const timeoutId = setTimeout(() => {
      pendingShardTimeouts.delete(timeoutId);
      vfxManager.play(opts.vfxId, { position, rotation, scale, payload });
    }, i * opts.staggerMs);
    pendingShardTimeouts.add(timeoutId);
  }
}

export interface SpawnMultiHitShardsOptions {
  targetGid: number;
  hits: number;
  staggerMs: number;
  color: string;
  critical?: boolean;
}

/** Cold Bolt/Fire Lance especificamente — wrapper fino sobre `spawnHitImpacts`
 * fixando `vfxId:GENERIC_HIT_SHARD_ID` + `rotation:SHARD_ROTATION` (o
 * losango), contrato/comportamento IDÊNTICO ao de antes da generalização. */
export function spawnMultiHitShards(opts: SpawnMultiHitShardsOptions): void {
  spawnHitImpacts({ vfxId: GENERIC_HIT_SHARD_ID, rotation: SHARD_ROTATION, ...opts });
}

/** sessão/mapa trocou — mesmo gatilho que `migratedVfxBridge.
 * resetMigratedVfx()` já reage, chamado junto dele em `vfxStore.reset()`.
 * Sem isto, um cast interrompido no meio (troca de mapa antes do 5º hit
 * chegar) deixaria timers pendentes tentando `play()` num mundo/instância
 * que já não existe mais — inofensivo (`manager.play()` já devolve
 * `undefined` sem `world`), mas desnecessário deixar rodando. */
export function clearPendingMultiHitShards(): void {
  for (const id of pendingShardTimeouts) clearTimeout(id);
  pendingShardTimeouts.clear();
}
