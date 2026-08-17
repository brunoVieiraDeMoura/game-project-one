import { registerMultiHitDamageArt } from "../../core/multiHitDamageDomArt";
import { ICICLE_MAX_HITS, ICICLE_STAGGER_MS, ICICLE_FALL_MS, ICICLE_IMPACT_FRACTION, DAMAGE_NUMBER_MS, TOTAL_VISIBLE_MS } from "./ColdBoltImpact";

/**
 * Só os NÚMEROS de Cold Bolt (`cb-ice-dmgnum`/`cb-ice-total`) — a lança/
 * burst de gelo em si (`cb-ice-spike`/`cb-ice-hit*`) virou GPU
 * (`coldBoltVfxDefGpu.tsx`: particle+ring+sprite). Componente/update
 * genéricos vivem em `core/multiHitDamageDomArt.tsx` (auditoria multi-hit
 * 2026-08-17) — este arquivo só configura a paleta.
 *
 * Constantes de timing IMPORTADAS de `ColdBoltImpact.tsx` (nunca
 * reescritas) — esse arquivo continua o baseline DOM intocado, e as duas
 * versões (legado e Core) precisam cair no MESMO instante de "impacto" pra
 * não destoar do resto do combo (SFX, cadência visual).
 */
registerMultiHitDamageArt({
  artKey: "cold_bolt_dmgnum",
  maxHits: ICICLE_MAX_HITS,
  staggerMs: ICICLE_STAGGER_MS,
  impactAtMs: ICICLE_FALL_MS * ICICLE_IMPACT_FRACTION,
  damageNumberMs: DAMAGE_NUMBER_MS,
  totalVisibleMs: TOTAL_VISIBLE_MS,
  headY: 1.8,
  dmgClass: "cb-ice-dmgnum",
  totalClass: "cb-ice-total",
  jitterSeedBase: 2000,
});
