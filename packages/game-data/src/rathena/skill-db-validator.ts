import type { ParsedSkillEntry } from "./skill-db-yaml";
import { MAX_SKILL_LEVEL } from "./skill-db-yaml";

/**
 * Validator (etapa 3 de 4) — roda ANTES de qualquer gravação em
 * `db/import/skill_db.yml`. Falha aqui = a API devolve 400 e o arquivo não
 * é tocado; nenhuma das regras abaixo é opcional, vêm direto do que
 * `SkillDatabase::parseBodyNode` rejeita (skill.cpp:14778-15749, ver a
 * tabela §2/§3 da auditoria).
 */
export function validateSkillEntry(entry: ParsedSkillEntry): string[] {
  const issues: string[] = [];

  if (entry.id < 1 || entry.id > 65535) issues.push(`Id ${entry.id} fora de 1..65535`);
  if (entry.name.length < 1 || entry.name.length > 39) issues.push(`Name "${entry.name}" precisa de 1..39 caracteres (rAthena: char[40], sem NUL sobra 39)`);
  if (entry.description.length < 1 || entry.description.length > 39) issues.push(`Description "${entry.description}" precisa de 1..39 caracteres`);
  if (entry.maxLevel < 1 || entry.maxLevel > MAX_SKILL_LEVEL) issues.push(`MaxLevel ${entry.maxLevel} fora de 1..${MAX_SKILL_LEVEL}`);

  if (entry.hit && entry.hit !== "Single" && entry.hit !== "Multi_Hit") {
    issues.push(`Hit "${entry.hit}" não é gravável — só "Single"/"Multi_Hit" são constante exportada (DMG_NORMAL/DMG_CRITICAL não são)`);
  }

  if (entry.unit && !entry.unit.id) {
    issues.push("Unit presente sem Unit.Id — o rAthena exige Id quando o bloco Unit existe (skill.cpp:15599)");
  }
  if (entry.copyFlags && entry.copyFlags.skill.Plagiarism === undefined && entry.copyFlags.skill.Reproduce === undefined) {
    issues.push("CopyFlags presente sem CopyFlags.Skill — o rAthena exige esse bloco quando CopyFlags existe (skill.cpp:15082)");
  }

  if (entry.requires) {
    if (entry.requires.itemCost.length > 10) issues.push(`ItemCost tem ${entry.requires.itemCost.length} entradas, máximo 10 (MAX_SKILL_ITEM_REQUIRE)`);
    for (const c of entry.requires.itemCost) {
      if (c.level !== undefined && (c.level < 1 || c.level > entry.maxLevel)) {
        issues.push(`ItemCost "${c.item}" com Level ${c.level} fora de 1..${entry.maxLevel} — o rAthena rejeita a entrada inteira (skill.cpp:15520-15526)`);
      }
    }
    if (Object.keys(entry.requires.equipment).length > 10) issues.push("Equipment tem mais de 10 entradas (MAX_SKILL_EQUIP_REQUIRE)");
    if (Object.keys(entry.requires.status).length > 3) issues.push("Requires.Status tem mais de 3 entradas (MAX_SKILL_STATUS_REQUIRE)");

    const ammoOn = entry.requires.ammo.None !== true && Object.values(entry.requires.ammo).some(Boolean);
    const hasAmmoAmount = entry.requires.ammoAmount.some((v) => v !== 0);
    if (hasAmmoAmount && !ammoOn) {
      issues.push("AmmoAmount preenchido sem Ammo requerida — o rAthena rejeita (skill.cpp:15433, require.ammo == 0)");
    }
  }

  return issues;
}
