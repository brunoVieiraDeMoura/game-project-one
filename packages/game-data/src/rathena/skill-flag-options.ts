import { ITEM_SUBTYPE_LABELS } from "../labels";
import { AMMO_SUBTYPE_MAP, WEAPON_SUBTYPE_MAP, toSnake } from "./skill-db-mapper";
import { SKILL_DB_CAST_FLAGS, SKILL_DB_DAMAGE_FLAGS, SKILL_DB_FLAGS } from "./skill-db-yaml";

/**
 * Opções prontas de `MultiSelectField` pros campos de flag da Skill
 * (`damageFlags`, `flags`, `castTimeFlags`, `castDelayFlags`,
 * `requirements.requiredWeapons`, `requirements.requiredAmmo`).
 *
 * NENHUM enum é redigitado aqui — `value`/`description` vêm de
 * `SKILL_DB_*` (`skill-db-yaml.ts`, já a fonte que o Writer usa) via o
 * MESMO `toSnake` do mapper (`skill-db-mapper.ts`), reexportado só pra
 * isso. As listas foram reconferidas linha a linha contra
 * `script_constants.hpp`/`pc.hpp` na revisão da Fase 2 (docs/audit/
 * risk-report.md) — 11 NK_, 42 INF2_, 3 SKILL_CAST_, batem exato.
 */

/** Forma estrutural igual a `MultiOption` de `apps/admin/components/ui.tsx`
 * — não importada de lá de propósito (`game-data` não depende de `admin`,
 * é a direção contrária); TS estrutural cobre a compatibilidade sozinho. */
export type FlagOption = { value: string; label: string; description?: string; deprecated?: boolean };

function optionsFrom(canonical: readonly string[]): FlagOption[] {
  return canonical.map((c) => ({ value: toSnake(c), label: toSnake(c).replace(/_/g, " "), description: c }));
}

export const SKILL_DAMAGE_FLAG_OPTIONS: FlagOption[] = optionsFrom(SKILL_DB_DAMAGE_FLAGS);
export const SKILL_FLAG_OPTIONS: FlagOption[] = optionsFrom(SKILL_DB_FLAGS);
/** CastTimeFlags e CastDelayFlags usam o MESMO conjunto SKILL_CAST_ —
 * confirmado em skill.cpp (o prefixo é idêntico, só o campo de destino
 * muda: castnodex vs delaynodex). Uma lista, dois campos de UI. */
export const SKILL_CAST_FLAG_OPTIONS: FlagOption[] = optionsFrom(SKILL_DB_CAST_FLAGS);

/** `requiredWeapons`/`requiredAmmo` guardam `ItemSubType` (não o nome
 * rAthena), então a opção usa `ITEM_SUBTYPE_LABELS` já existente —
 * filtrado ao subconjunto que faz sentido pra arma/munição de skill
 * (`WEAPON_SUBTYPE_MAP`/`AMMO_SUBTYPE_MAP`, as mesmas tabelas que o
 * Writer usa pra reverter na hora de gravar `Requires.Weapon`/`Ammo`). */
export const SKILL_REQUIRED_WEAPON_OPTIONS: FlagOption[] = Object.entries(WEAPON_SUBTYPE_MAP).map(
  ([rathenaName, subtype]) => ({
    value: subtype,
    label: ITEM_SUBTYPE_LABELS[subtype] ?? subtype,
    description: rathenaName,
  }),
);
export const SKILL_REQUIRED_AMMO_OPTIONS: FlagOption[] = Object.entries(AMMO_SUBTYPE_MAP).map(
  ([rathenaName, subtype]) => ({
    value: subtype,
    label: ITEM_SUBTYPE_LABELS[subtype] ?? subtype,
    description: rathenaName,
  }),
);
