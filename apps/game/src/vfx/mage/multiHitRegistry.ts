import { ICICLE_TOTAL_MS } from "./cold-bolt/ColdBoltImpact";
import { FIRE_LANCE_TOTAL_MS } from "./fire-lance/FireLanceImpact";
import { THUNDER_STORM_TOTAL_MS } from "./thunder-storm/ThunderStormImpact";

/**
 * Skills de "N hits com VFX próprio, dano repartido em cascata" (Cold Bolt,
 * Fire Lance, Thunder Storm). O `vfxStore` poda todo efeito pontual pelo
 * `EFFECT_MS` genérico (600ms) — curto demais pra uma cascata de 5 hits +
 * total, que precisa do PRÓPRIO tempo total de vida
 * (`net/useWorldEvents.onSkillCast`).
 *
 * Existia só pra Cold Bolt, um `isColdBolt` cravado ali dentro — generalizado
 * aqui pra virar um LOOKUP por nome Aegis em vez de crescer um boolean por
 * skill nova (pedido explícito: "não fazer um if gigante").
 *
 * Nunca por id — o id de uma constante MG_* já divergiu de projeto pra
 * projeto no rAthena; o nome Aegis é o que não muda (mesma razão que cada
 * `AEGIS_*` espalhado em `vfx/SkillVfx.tsx`/`net/useWorldEvents.ts`/
 * `audio/mage/multiHitCastAudio.ts` já documenta).
 */
export const MULTI_HIT_TOTAL_MS: Record<string, number> = {
  MG_COLDBOLT: ICICLE_TOTAL_MS,
  MG_FIREBOLT: FIRE_LANCE_TOTAL_MS,
  MG_THUNDERSTORM: THUNDER_STORM_TOTAL_MS,
};
