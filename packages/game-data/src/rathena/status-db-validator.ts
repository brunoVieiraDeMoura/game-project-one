import type { StatusEffectDef } from "../status";
import type { SkillIdResolver } from "./job-class-mapper";

/**
 * Validator do domínio Status (leia1.txt, aprovação Mapper/Validator/Writer,
 * 2026-08-07) — roda ANTES de qualquer gravação em `db/import/status.yml`.
 * Duas camadas, mesmo padrão de Skills/Classes:
 *
 * 1. `validateStatusEntry` — estrutural, uma entrada por vez.
 * 2. `validateStatusBatch` — cruzada: referências entre Status (`Fail`/
 *    `EndOnStart`/`EndReturn`/`EndOnEnd`) existem no catálogo, `DurationLookup`
 *    referencia skill existente, ids duplicados no lote, referências órfãs.
 */

const MIN_RATE_MAX = 65535; // uint16, status.cpp:16205 (asUInt16)

export interface StatusValidationIssue {
  status: string;
  message: string;
}

export function validateStatusEntry(status: StatusEffectDef): string[] {
  const issues: string[] = [];

  if (status.minRate !== undefined && (status.minRate < 0 || status.minRate > MIN_RATE_MAX)) {
    issues.push(`minRate ${status.minRate} fora de 0..${MIN_RATE_MAX}`);
  }
  if (status.minDurationMs !== undefined && status.minDurationMs < 0) {
    issues.push(`minDurationMs ${status.minDurationMs} não pode ser negativo`);
  }

  const seenRefs = new Set<string>();
  for (const ref of [...status.failOn, ...status.endOnStart, ...status.endReturn, ...status.endOnEnd]) {
    const lower = ref.toLowerCase();
    if (seenRefs.has(lower)) issues.push(`referência a "${ref}" repetida (Fail/EndOnStart/EndReturn/EndOnEnd)`);
    seenRefs.add(lower);
  }

  return issues;
}

/**
 * `knownStatusIds`: universo completo de ids de status conhecidos (o
 * catálogo inteiro — igual `allKnown` de Classes, aqui sempre o catálogo
 * todo porque não há um "arquivo base separado" pra unir: `status.yml`
 * roda num slot de import só, então "existe" = "está no catálogo
 * migrado", ponto).
 */
export function validateStatusBatch(
  statuses: StatusEffectDef[],
  knownStatusIds: ReadonlySet<string>,
  skills: SkillIdResolver,
): StatusValidationIssue[] {
  const issues: StatusValidationIssue[] = [];

  const seenIds = new Set<string>();
  for (const s of statuses) {
    if (seenIds.has(s.id)) issues.push({ status: s.id, message: `id "${s.id}" duplicado no lote` });
    seenIds.add(s.id);
  }

  for (const s of statuses) {
    const refFields: [string, string[]][] = [
      ["Fail", s.failOn],
      ["EndOnStart", s.endOnStart],
      ["EndReturn", s.endReturn],
      ["EndOnEnd", s.endOnEnd],
    ];
    for (const [field, refs] of refFields) {
      for (const ref of refs) {
        const lower = ref.toLowerCase();
        if (!knownStatusIds.has(lower) && !statuses.some((other) => other.id === lower)) {
          issues.push({ status: s.id, message: `${field} referencia status "${ref}" que não existe no catálogo (referência órfã)` });
        }
      }
    }

    if (s.durationLookupSkill && !skills.idOf(s.durationLookupSkill)) {
      issues.push({ status: s.id, message: `DurationLookup referencia skill "${s.durationLookupSkill}" que não existe no catálogo` });
    }
  }

  return issues;
}
