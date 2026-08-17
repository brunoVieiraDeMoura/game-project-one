/**
 * Ajustes de duração pro VFX de skills que NÃO são "N hits em cascata"
 * (essas usam `vfx/mage/multiHitRegistry`) mas ainda assim precisam de mais
 * tempo que o flash pontual genérico (`EFFECT_MS`, 600ms, `net/
 * useWorldEvents.ts`) — bola de fogo viajando até o alvo, ou um buff com
 * VFX próprio que precisa ficar de pé pela duração REAL do status.
 */

/** impacto de UM hit só, mas que precisa de mais tempo que o flash genérico
 * (viagem visível caster→alvo, explosão grande). Fixo, não depende de
 * `hits` — estas skills não escalam projétil por nível. */
export const IMPACT_VFX_DURATION_MS: Record<string, number> = {
  // `FireBallImpact.FIREBALL_TOTAL_MS` (voo 480ms*0.93 + rabo de 650ms
  // ≈ 1096ms) + folga — mantido em número aqui de propósito (não importado
  // do componente React, ver comentário do arquivo).
  MG_FIREBALL: 1150,
  // Frost Diver/Stone Curse: burst de impacto puro (trilha/olhar + flash),
  // sem a prisão/transformação condicional — essa parte persistente vive
  // fora do ciclo de vida do cast: Congelar é VFX (`FreezeBodyVfx`), Petrificar
  // é tint de material direto no body (`net/NetEntity.tsx:
  // usePetrifyMaterial`, `entities/petrifyMaterial.ts`). `fd-impact__snow`
  // (700ms) é a animação mais longa dos dois bursts — folga cobre com sobra.
  MG_FROSTDIVER: 750,
  MG_STONECURSE: 750,
};

/** self-buff com VFX PRÓPRIO (`vfx/SkillVfx.tsx: BUFF_VFX`) — usa a duração
 * REAL do catálogo (`SkillInfo.durationMs`) em vez do flash de 600ms.
 * Deliberadamente um SET separado do `BUFF_VFX` (que vive em `SkillVfx.tsx`,
 * componente React): `net/useWorldEvents.ts` só precisa saber "esta skill
 * tem VFX próprio, dá a duração de verdade", nunca precisa importar o
 * componente em si. */
export const BUFF_VFX_AEGIS = new Set<string>(["MG_SIGHT"]);
