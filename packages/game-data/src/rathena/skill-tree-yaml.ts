import { z } from "zod";

/**
 * Formato OFICIAL de `skill_tree.yml` do rAthena (SKILL_TREE_DB v1) —
 * schema-first, lido de `rathena/db/skill_tree.yml` (header/imports) +
 * `rathena/db/re/skill_tree.yml` (dados) + `rathena/src/map/pc.cpp`
 * (`SkillTreeDatabase::parseBodyNode`, pc.cpp:13422-13630), não inferido.
 *
 * Loader SEPARADO do `JobDatabase` (`job-stats-yaml.ts`) — classe própria
 * `SkillTreeDatabase`, e o construtor de 2 args (`pc.hpp:1631`) fixa
 * `minimumVersion === version === 1`: SÓ `Version: 1` é aceito, sem janela
 * de compatibilidade (diferente de JOB_STATS, que aceita 2..4).
 *
 * Achado que muda o schema do projeto: `Tree[].BaseLevel`/`Tree[].JobLevel`
 * são campos REAIS e usados (12+ ocorrências em `db/re/skill_tree.yml`,
 * ex. `SU_POWEROFFLOCK` exige `BaseLevel: 100`) e `JobClassSchema.skills[]`
 * atual NÃO tem esses dois campos — são descartados hoje, tanto pelo
 * migrador quanto pelo schema. Corrigido aqui na raiz (Parser), a correção
 * do schema do projeto (`job-class.ts`) e do migrador vêm no Mapper.
 *
 * Herança (`Inherit`) NÃO é resolvida transitivamente pelo motor rAthena —
 * o loader lê `skills` de cada ancestral LISTADO, sem multi-hop
 * (`pc.cpp:13632-13701`). Funciona porque os DADOS já listam a cadeia
 * inteira (`Rune_Knight` lista `Novice`+`Swordman`+`Knight`, não só o pai
 * direto). O Parser aqui só CAPTURA `Inherit` como veio — não resolve nada;
 * resolução é trabalho do Mapper, e se resolver, tem que ser NÃO-transitiva
 * pra bater com o motor real (o migrador atual resolve transitivamente, o
 * que dá o mesmo resultado só porque os dados de estoque já são flat —
 * ver auditoria).
 */

const RawSkillTreeRequireSchema = z.object({
  Name: z.string().min(1),
  Level: z.number().int().min(0).max(13),
});

const RawSkillTreeSkillSchema = z.object({
  Name: z.string().min(1),
  MaxLevel: z.number().int().min(0).max(13),
  Exclude: z.boolean().optional(),
  BaseLevel: z.number().int().min(0).max(275).optional(),
  JobLevel: z.number().int().min(0).max(275).optional(),
  Requires: z.array(RawSkillTreeRequireSchema).optional(),
});
export type RawSkillTreeSkill = z.infer<typeof RawSkillTreeSkillSchema>;

/** `Job`/`Inherit`: nome de job livre — mesma razão de `job-stats-yaml.ts` (enum de ~200 valores não verificado nesta auditoria, nunca copiado à mão). */
export const RawSkillTreeEntrySchema = z.object({
  Job: z.string().min(1),
  Inherit: z.record(z.string(), z.boolean()).optional(),
  Tree: z.array(RawSkillTreeSkillSchema).default([]),
});
export type RawSkillTreeEntry = z.infer<typeof RawSkillTreeEntrySchema>;

export const SkillTreeDocSchema = z.object({
  Header: z.object({ Type: z.literal("SKILL_TREE_DB"), Version: z.literal(1) }),
  Body: z.array(RawSkillTreeEntrySchema).default([]),
});
export type SkillTreeDoc = z.infer<typeof SkillTreeDocSchema>;
