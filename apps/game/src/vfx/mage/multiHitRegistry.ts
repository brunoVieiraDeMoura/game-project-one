import { icicleTotalMs, ICICLE_STAGGER_MS } from "./cold-bolt/ColdBoltImpact";
import { fireLanceTotalMs, FIRE_LANCE_STAGGER_MS } from "./fire-lance/FireLanceImpact";
import { thunderStormTotalMs } from "./multiHitShared";
import { lightBoltTotalMs } from "./light-bolt/LightBoltImpact";
import { soulStrikeTotalMs } from "./soul-strike/SoulStrikeImpact";

/**
 * Skills de "N hits com VFX próprio, dano repartido em cascata" (Cold Bolt,
 * Fire Lance, Thunder Storm, Soul Strike). O `vfxStore` poda todo efeito
 * pontual pelo `EFFECT_MS` genérico (600ms) — curto demais pra uma cascata
 * de hits + total, que precisa do PRÓPRIO tempo total de vida
 * (`net/useWorldEvents.onSkillCast`).
 *
 * **Papel mudou na auditoria multi-hit (2026-08-17)**: isto NÃO é mais a
 * lista que decide "esta skill é multi-hit" — essa pergunta agora usa o
 * `hitType` real do servidor (`skill_db.yml: Hit: Multi_Hit`, via
 * `net/skillCatalog.ts`). Esta tabela virou só a PALETA de timing visual
 * ("pra quem JÁ É multi-hit e tem cascata própria registrada, quanto tempo
 * ela dura") — uma skill que o servidor marcar Multi_Hit mas não tiver
 * entrada aqui cai pro número genérico (`damageFeed`) em vez de quebrar.
 *
 * Cada entrada é uma FUNÇÃO de `hits`, não um número fixo — a quantidade de
 * verdade vem do NÍVEL da skill (`getSkillProjectileCount`,
 * `vfx/mage/multiHitShared`), então a duração também precisa variar: um
 * Lv1 (1 hit) não deveria ficar pendurado no `vfxStore` pelo tempo de uma
 * cascata de 5.
 *
 * Nunca por id — o id de uma constante MG_* já divergiu de projeto pra
 * projeto no rAthena; o nome Aegis é o que não muda (mesma razão que cada
 * `AEGIS_*` espalhado em `vfx/SkillVfx.tsx`/`net/useWorldEvents.ts`/
 * `audio/mage/multiHitCastAudio.ts` já documenta).
 */
export const MULTI_HIT_DURATION_MS: Record<string, (hits: number) => number> = {
  MG_COLDBOLT: icicleTotalMs,
  MG_FIREBOLT: fireLanceTotalMs,
  MG_THUNDERSTORM: thunderStormTotalMs,
  MG_LIGHTNINGBOLT: lightBoltTotalMs,
  MG_SOULSTRIKE: soulStrikeTotalMs,
};

/**
 * Skills que usam o fragmento GENÉRICO compartilhado ("Generic Hit VFX",
 * 2026-08-19: `vfx/mage/multiHitShardImpact.ts: GENERIC_HIT_SHARD_ID`,
 * UMA `VfxDefinition` só, cor vem do `element` real via `payload.color`).
 * `net/useWorldEvents.ts` chama `spawnMultiHitShards({targetGid, hits,
 * staggerMs, color, critical})` uma vez por cast; o driver toca a MESMA
 * definição `hits` vezes, espaçadas por `staggerMs` — nenhuma
 * `VfxDefinition` nova nasce por skill. `staggerMs` é o MESMO valor que a
 * cascata de números já usa (`ICICLE_STAGGER_MS`/`FIRE_LANCE_STAGGER_MS`)
 * — fragmento e número pousam juntos.
 *
 * **Decisão deliberada de escopo**: só Cold Bolt/Fire Lance, mesmo o
 * mecanismo agora sendo genérico o bastante pra qualquer skill. Thunder
 * Storm/Light Bolt/Soul Strike JÁ são GPU (composições próprias — flash+
 * faíscas radiais, `beam`, enxame voador) e continuam assim de propósito:
 * forçar "raio"/"orbe espiritual" a cair como o MESMO losango de gelo
 * seria exatamente a "identidade de skill substituída por efeito
 * genérico" que foi pedido explicitamente pra NUNCA fazer — "reutilizar a
 * infraestrutura" (position-freeze, budget, renderers) não é o mesmo que
 * "reutilizar a receita visual". Uma skill nova sem identidade própria
 * ainda definida pode entrar aqui livremente — é exatamente o caso que
 * este mecanismo existe pra cobrir sem precisar de um `NewSkillVfx.tsx`.
 */
export const MULTI_HIT_SHARD_VFX: Record<string, { staggerMs: number }> = {
  MG_COLDBOLT: { staggerMs: ICICLE_STAGGER_MS },
  MG_FIREBOLT: { staggerMs: FIRE_LANCE_STAGGER_MS },
};
