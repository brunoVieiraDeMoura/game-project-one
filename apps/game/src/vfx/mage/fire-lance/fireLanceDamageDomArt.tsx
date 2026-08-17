import { registerMultiHitDamageArt } from "../../core/multiHitDamageDomArt";
import { FIRE_LANCE_MAX_HITS, FIRE_LANCE_STAGGER_MS, FIRE_LANCE_FALL_MS, FIRE_LANCE_IMPACT_FRACTION, FIRE_LANCE_DAMAGE_NUMBER_MS, FIRE_LANCE_TOTAL_VISIBLE_MS } from "./FireLanceImpact";

/**
 * Só os NÚMEROS de Fire Lance (`fl-fire-dmgnum`/`fl-fire-total`) — a lança
 * em si virou GPU (`fireLanceVfxDefGpu.tsx`). Componente/update genéricos
 * vivem em `core/multiHitDamageDomArt.tsx` (auditoria multi-hit
 * 2026-08-17) — este arquivo só configura a paleta.
 */
registerMultiHitDamageArt({
  artKey: "fire_lance_dmgnum",
  maxHits: FIRE_LANCE_MAX_HITS,
  staggerMs: FIRE_LANCE_STAGGER_MS,
  impactAtMs: FIRE_LANCE_FALL_MS * FIRE_LANCE_IMPACT_FRACTION,
  damageNumberMs: FIRE_LANCE_DAMAGE_NUMBER_MS,
  totalVisibleMs: FIRE_LANCE_TOTAL_VISIBLE_MS,
  headY: 1.8,
  dmgClass: "fl-fire-dmgnum",
  totalClass: "fl-fire-total",
  jitterSeedBase: 4000,
});
