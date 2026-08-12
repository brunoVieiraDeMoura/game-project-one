import { useSkillCatalog } from "../net/skillCatalog";
import { playOneShot } from "./oneShotPool";

/**
 * SFX de conjuração do Cold Bolt (MG_COLDBOLT), POR SKILL — diferente de
 * `audio/combatWeapon` (um som só por classe pro golpe de skill), este é o
 * primeiro caso de 3 estágios amarrados no TEMPO de uma skill específica:
 * início do cast, liberação, e o impacto — pedido explícito (leia1.txt):
 * "enquanto casta / no fim do cast / 0,5s depois do fim do cast".
 *
 * Mesma constante `AEGIS_COLD_BOLT` que `net/useWorldEvents`/`vfx/SkillVfx`
 * já usam pra distinguir Cold Bolt de qualquer outra skill — nunca um id
 * cravado (o id de `MG_COLDBOLT` já divergiu de projeto pra projeto no
 * rAthena; o nome Aegis não muda).
 */
const AEGIS_COLD_BOLT = "MG_COLDBOLT";

const CAST = "/assets/audio/combat/mage/skills/cold-bolt/cast.mp3";
const CAST_COMPLETE = "/assets/audio/combat/mage/skills/cold-bolt/cast-complete.mp3";
const HIT = "/assets/audio/combat/mage/skills/cold-bolt/hit.mp3";

/** ms entre o fim do cast (liberação) e o som de impacto — valor do pedido,
 * fixo, não amarrado à cascata de estalactites de `vfx/ColdBoltImpact`
 * (aquela é visual/dano escalonado em 5 hits; este é UM som de impacto). */
const HIT_DELAY_MS = 500;

function isColdBolt(skillId: number): boolean {
  return useSkillCatalog.getState().byId[skillId]?.aegisName === AEGIS_COLD_BOLT;
}

/** chamar do `skill:casting`, com `p.sourceGid === selfGid` — só a PRÓPRIA
 * conjuração, nunca a de outro caster por perto (mesmo portão que
 * `useCastStore.comecar` já usa). */
export function aoComecarCastDeColdBolt(skillId: number): void {
  if (!isColdBolt(skillId)) return;
  playOneShot(CAST);
}

/** chamar do `skill:cast`, com `p.sourceGid === selfGid` — a magia SAIU;
 * o som de impacto vem sozinho 500ms depois, sem esperar confirmação de
 * dano nenhuma (o pedido é sobre TEMPO de conjuração, não sobre acerto). */
export function aoLiberarCastDeColdBolt(skillId: number): void {
  if (!isColdBolt(skillId)) return;
  playOneShot(CAST_COMPLETE);
  setTimeout(() => playOneShot(HIT), HIT_DELAY_MS);
}
