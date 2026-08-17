import { registerMultiHitDamageArt } from "../../core/multiHitDamageDomArt";
import { SOUL_STRIKE_MAX_HITS, SOUL_STRIKE_STAGGER_MS, SOUL_FLIGHT_MS, SOUL_IMPACT_FRACTION, SOUL_DAMAGE_NUMBER_MS, SOUL_TOTAL_VISIBLE_MS } from "./SoulStrikeImpact";

/**
 * Só os NÚMEROS de Soul Strike (`ss-dmgnum`/`ss-total`) — o corpo da alma
 * em si (`ss-ghost`/`ss-echo`/`ss-hit*`) virou GPU
 * (`soulStrikeVfxDefGpu.tsx`). Componente/update genéricos vivem em
 * `core/multiHitDamageDomArt.tsx` (auditoria multi-hit 2026-08-17) — este
 * arquivo só configura a paleta.
 */
registerMultiHitDamageArt({
  artKey: "soul_strike_dmgnum",
  maxHits: SOUL_STRIKE_MAX_HITS,
  staggerMs: SOUL_STRIKE_STAGGER_MS,
  impactAtMs: SOUL_FLIGHT_MS * SOUL_IMPACT_FRACTION,
  damageNumberMs: SOUL_DAMAGE_NUMBER_MS,
  totalVisibleMs: SOUL_TOTAL_VISIBLE_MS,
  headY: 1.8,
  dmgClass: "ss-dmgnum",
  totalClass: "ss-total",
  jitterSeedBase: 3000,
});
