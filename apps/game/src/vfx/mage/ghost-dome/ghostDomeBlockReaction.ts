import { vfxManager } from "../../core/manager";
import { defineVfx } from "../../core/registry";
import { GHOST_DOME_BLOCK_GPU_DEF, GHOST_DOME_BLOCK_VFX_ID } from "./ghostDomeBlockVfxDefGpu";

defineVfx(GHOST_DOME_BLOCK_GPU_DEF);

/**
 * Reação de bloqueio da Cúpula Fantasma/Safety Wall — 2026-08-20, arquitetura
 * final (`rathena-patches/0001-ghost-dome-safetywall-block-notify.patch`).
 *
 * ## Por que isto não é mais heurística
 *
 * Versões anteriores deste arquivo tentavam inferir bloqueio real a partir
 * de "miss + alvo parado na célula da Cúpula", porque o rAthena vanilla não
 * mandava nenhum sinal de bloqueio pro client (`e_damage_type`/`ZC_NOTIFY_ACT`
 * não distingue bloqueio de esquiva — os dois chegam `damage:0` idênticos).
 *
 * Isso mudou: `battle_calc_weapon_attack()` (rathena/src/map/battle.cpp)
 * decrementa a carga da Safety Wall e notifica o client via
 * `clif_skill_nodamage()`/`ZC_USE_SKILL` ANTES do hit/miss ser decidido —
 * ou seja, HIT e MISS consomem a carga igual, e o client recebe um evento
 * (`ghost-dome-block`, traduzido pelo gateway a partir do pacote real) só
 * quando uma carga FOI de fato consumida. Não existe mais suposição
 * client-side nenhuma: o servidor é a única fonte de verdade, e este VFX
 * só nasce em resposta ao evento.
 *
 * `remainingHits` do evento é só log/diagnóstico — o client NUNCA usa esse
 * número pra decidir nada (nem cap, nem contagem, nem validação). O
 * contador de cargas é 100% responsabilidade do servidor.
 *
 * `wasHit` (2026-08-20, "mais visibilidade pra defesa do impacto"): o
 * servidor sabe, no MESMO ponto onde decide o bloqueio, se o ataque
 * absorvido teria sido um HIT de verdade ou um MISS (`wd.damage>0` antes de
 * zerar) — repassa isso via `clif_skill_nodamage`'s `success` (ver
 * `battle.cpp`). Client usa só pra ESCALAR o VFX (`VfxSpawnOptions.scale`,
 * já suportado nativamente por `SpriteRenderer`), nunca pra decidir SE o
 * bloqueio aconteceu — isso continua sendo o próprio evento chegar.
 */
const HIT_SCALE = 1.6;
const MISS_SCALE = 1;

export function spawnGhostDomeBlock(opts: {
  sourceGid: number;
  targetGid: number;
  remainingHits: number;
  wasHit: boolean;
}): void {
  vfxManager.play(GHOST_DOME_BLOCK_VFX_ID, {
    sourceGid: opts.sourceGid,
    targetGid: opts.targetGid,
    scale: opts.wasHit ? HIT_SCALE : MISS_SCALE,
  });
}
