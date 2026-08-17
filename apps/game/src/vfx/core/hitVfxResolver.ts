import { getSkillProjectileCount } from "../mage/multiHitShared";

/**
 * Auditoria "arquitetura genérica de Hit VFX" (2026-08-19) — rastreamento
 * completo rAthena → gateway → cliente antes de escrever qualquer linha
 * daqui, com evidência de código (não inferência):
 *
 * **`hits` (quantidade real)**: `SkillCast.count`/`entity:action.count` =
 * `dmg.div_` — pra magia (`ad`, as 5 skills multi-hit atuais),
 * `battle_calc_magic_attack` (`battle.cpp:5829`) faz
 * `ad.div_ = skill_get_num(skill_id,skill_lv)`, lendo `HitCount:` do
 * skill_db direto (achado real "count real", Round 10 — não mais
 * aproximado por nível). Já confirmado autoritativo, este módulo só
 * CONSOME o valor, nunca recalcula.
 *
 * **`critical` (dimensão separada, não um hitType a mais)**: o byte
 * `action` do pacote É literalmente `e_damage_type` (`rathena/src/map/
 * clif.hpp:691-707`, `DMG_NORMAL=0 .. DMG_SPLASH_ENDURE=14`), repassado
 * CRU pelo gateway (`session.ts:835` pro ataque básico, `session.ts:1356`
 * pra skill — mesmo comentário lá: "mesmo byte DMG_* do NOTIFY_ACT — sem
 * repassar, o cliente não tinha como saber"). Achado NOVO desta auditoria
 * (evidência em código, `battle.cpp`):
 *
 *   - Ataque FÍSICO (`wd`, ataque básico/skill de arma): `wd.type` é
 *     setado de verdade em runtime (`battle.cpp:5285` `DMG_NORMAL`,
 *     `:5425` `DMG_LUCY_DODGE`, `:5439` `DMG_MULTI_HIT_CRITICAL`, `:5441/
 *     5443` `DMG_CRITICAL`) — o enum inteiro é usado, `action` do pacote
 *     é um sinal real por golpe.
 *   - Ataque MÁGICO (`ad`, as 5 skills multi-hit atuais — Cold Bolt/Fire
 *     Lance/Thunder Storm/Light Bolt/Soul Strike): `battle_calc_magic_
 *     attack` faz `memset(&ad,0,sizeof(ad))` (`battle.cpp:5815`) e NUNCA
 *     escreve `ad.type` em lugar nenhum da função (grep confirmado, zero
 *     ocorrência de `ad.type =`) — fica cravado em `DMG_NORMAL` (0)
 *     SEMPRE, não importa `div_`/crítico. **Magia não crita nesta regra
 *     (renewal) e o byte não marca multi-hit pra magia** — achado real,
 *     não hipótese: o crítico que `damageKind()` já detecta (`action===
 *     10||13`) só é alcançável hoje por ataque FÍSICO básico, nunca pelas
 *     5 skills multi-hit mágicas. `MULTI_HIT_CRITICAL` pras 5 skills atuais
 *     é uma combinação REPRESENTÁVEL no modelo (nunca barrada por código),
 *     só INALCANÇÁVEL no jogo real hoje — só testável forçando `critical:
 *     true` manualmente (unit test / helper de debug), nunca via cast real
 *     enquanto nenhuma classe com ataque físico multi-hit existir neste
 *     cliente.
 *
 * Por isso a MULTIPLICIDADE (single/multi) nunca deveria vir do byte
 * `action` pra magia (sempre 0, não informativo) — vem de `hits` (`count`
 * real), que já é 1:1 correto pras duas famílias (físico E mágico, porque
 * `div_` é o mesmo campo pros dois). O CRÍTICO sim vem do byte `action`
 * (`net/damageFeed.ts: damageKind()`, já correto, não duplicado aqui).
 *
 * Resultado: duas dimensões ORTOGONAIS, nunca fundidas num hitType só —
 * exatamente a exigência do pedido ("não trate Crítico como só mais um
 * hitType").
 */
export type HitMultiplicity = "single" | "multi";

export interface HitClassification {
  /** quantidade REAL de hits — nunca capada aqui (o teto visual é
   * responsabilidade de quem RENDERIZA, ex. `multiHitShardImpact.ts:
   * VISUAL_SHARD_CAP` — este módulo só CLASSIFICA, nunca decide budget). */
  hits: number;
  multiplicity: HitMultiplicity;
  critical: boolean;
}

/**
 * Classifica um evento de dano real em (multiplicidade × crítico) — a
 * MENOR abstração que cobre os 5 casos do pedido (Normal/Single/Multi/
 * Critical/Multi+Critical) sem inventar um enum novo: `multiplicity` já É
 * "quantos hits", `critical` já É o bit real do wire, os dois juntos
 * cobrem as 5 combinações pedidas sem precisar de um sexto conceito.
 *
 * `rawCount` é `p.count` cru do pacote (`SkillCast.count`/`entity:action.
 * count`) — pode vir ausente/inválido/extremo:
 *  - ausente/`NaN`/`<=0` → cai no fallback por nível (`getSkillProjectileCount`,
 *    MESMO fallback que `useWorldEvents.ts` já usava antes desta
 *    auditoria — nunca usado em operação normal, só quando o campo real
 *    falta).
 *  - válido → `Math.round(Math.abs(...))`, nunca alterado além disso —
 *    um `count=999` extremo passa INTEIRO pra `hits` (a defesa contra
 *    "centenas de instâncias visuais" mora em quem renderiza, não aqui).
 */
export function classifyHit(rawCount: number | undefined, fallbackLevel: number, critical: boolean): HitClassification {
  const hits =
    rawCount !== undefined && Number.isFinite(rawCount) && rawCount > 0
      ? Math.max(1, Math.round(Math.abs(rawCount)))
      : getSkillProjectileCount(fallbackLevel);
  return { hits, multiplicity: hits > 1 ? "multi" : "single", critical };
}

/**
 * "Crítico = variação do MESMO mecanismo visual" (pedido explícito: maior
 * escala, não uma composição nova) — multiplicador único, compartilhado
 * por QUALQUER VFX de impacto via `VfxSpawnOptions.scale` (já lido por
 * `SpriteRenderer`; `ParticleRenderer`/`TrailRenderer`/`BeamRenderer`
 * passam a ler também nesta auditoria — ver docblock de cada um). Migrado
 * de `multiHitShardImpact.ts` (era local só do fragmento genérico) pra
 * cá: agora é o MESMO número pra QUALQUER skill com impacto GPU, dedicado
 * ou genérico — nunca uma tabela de "quanto cada skill cresce no crítico".
 */
export const CRITICAL_SCALE_MULTIPLIER = 1.35;

export function criticalScaleFor(critical: boolean): number {
  return critical ? CRITICAL_SCALE_MULTIPLIER : 1;
}
