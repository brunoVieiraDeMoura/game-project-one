import { registerMultiHitDamageArt } from "../../core/multiHitDamageDomArt";
import { LIGHT_BOLT_MAX_HITS, LIGHT_BOLT_STAGGER_MS, LIGHT_BOLT_DAMAGE_NUMBER_MS, LIGHT_BOLT_TOTAL_VISIBLE_MS } from "./LightBoltImpact";

/**
 * Só os NÚMEROS de Light Bolt (`lb-dmgnum`/`lb-total`) — o raio em si virou
 * GPU (`lightBoltVfxDefGpu.tsx`: `beam`). Diferente de Cold Bolt/Fire
 * Lance/Soul Strike: cada hit NÃO tem fase de "queda" — a descarga acontece
 * imediatamente em `t>=0` (raio já está de pé), por isso `impactAtMs: 0`.
 * Componente/update genéricos vivem em `core/multiHitDamageDomArt.tsx`
 * (auditoria multi-hit 2026-08-17) — este arquivo só configura a paleta.
 */
registerMultiHitDamageArt({
  artKey: "light_bolt_dmgnum",
  maxHits: LIGHT_BOLT_MAX_HITS,
  staggerMs: LIGHT_BOLT_STAGGER_MS,
  impactAtMs: 0,
  damageNumberMs: LIGHT_BOLT_DAMAGE_NUMBER_MS,
  totalVisibleMs: LIGHT_BOLT_TOTAL_VISIBLE_MS,
  headY: 1.7,
  dmgClass: "lb-dmgnum",
  totalClass: "lb-total",
  jitterSeedBase: 5000,
});
