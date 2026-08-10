import { z } from "zod";

/**
 * Formato OFICIAL de `job_stats.yml`/`job_basepoints.yml`/`job_exp.yml`/
 * `job_aspd.yml` do rAthena (JOB_STATS v2-4) — schema-first, lido de
 * `rathena/db/re/job_stats.yml` (header) e `rathena/src/map/pc.cpp`
 * (`JobDatabase::parseBodyNode`, pc.cpp:13819-14266), não inferido.
 *
 * Achado da auditoria (2026-08-07): os QUATRO arquivos são o MESMO schema
 * (mesmo `Header: {Type: JOB_STATS, Version: 4}`, mesmo header de comentário
 * verbatim) e o MESMO loader (`JobDatabase`), só divididos por categoria de
 * conteúdo — `job_stats.yml` (peso/HP-SP factor/BonusStats), `job_basepoints.yml`
 * (BaseHp/BaseSp/BaseAp), `job_exp.yml` (MaxLevel/BaseExp/JobExp),
 * `job_aspd.yml` (BaseASPD). O ponto de entrada real é `db/job_stats.yml`
 * (raiz, sem Body), que importa os quatro por `Footer.Imports` — MERGE por
 * campo, igual `skill_db.yml`: campo ausente num import posterior NÃO apaga
 * o que um import anterior já setou (pc.cpp: todo campo é
 * `if (nodeExists(...)) set; else if (!exists) default`).
 *
 * `Version` aceita 2..4 (`JobDatabase` usa o ctor de 3 args,
 * `minimumVersion=2`, `pc.hpp:1107`) — diferente de `skill_tree.yml`, que
 * exige exatamente `Version: 1`.
 *
 * ESCOPO DESTE PARSER: captura fiel da tabela ESPARSA como está no YAML
 * (lista de `{Level, Valor}`, nunca resolvida pra array denso). A fórmula
 * de fallback de HP/SP/AP pra nível sem entrada na tabela
 * (`pc.cpp:13710-13808`, condicional por classe — Ninja/Gunslinger/
 * Summoner/Super Novice têm casos especiais) NÃO é executada aqui — é
 * lógica de SIMULAÇÃO do servidor, não do formato do arquivo, e a mesma
 * decisão já vale pra fórmula de dano de skill (`battle.cpp`, nunca
 * reimplementada, sempre `needsReview`). Documentado, não escondido.
 */

/**
 * `BaseASPD` — chaves de arma, 25 valores. Verificadas por grep direto em
 * `db/re/job_aspd.yml` + `db/pre-re/job_aspd.yml` (nunca derivadas do enum
 * `weapon_type`: a busca do rAthena é case-insensitive —
 * `script.cpp:690-699` — e a grafia dos dados é escolha de quem escreveu o
 * YAML, não uma regra mecânica. É a mesma armadilha que a auditoria de
 * Skills achou em `Unit.Id`).
 */
export const JOB_ASPD_WEAPON_KEYS = [
  "Fist", "Dagger", "1hSword", "2hSword", "1hSpear", "2hSpear", "1hAxe", "2hAxe",
  "Mace", "2hMace", "Staff", "Bow", "Knuckle", "Musical", "Whip", "Book", "Katar",
  "Revolver", "Rifle", "Gatling", "Shotgun", "Grenade", "Huuma", "2hStaff", "Shield",
] as const;

/**
 * `BonusStats`/`MaxStats` — 12 chaves de `e_params` (`map.hpp:203-230`).
 * Ao contrário de `BaseASPD`, estas SÃO lidas por índice contra o array
 * `parameter_names[]` do próprio rAthena (`pc.cpp:14005-14136`) — grafia
 * garantida estável, verificada aqui e não é armadilha de casing.
 */
export const JOB_STAT_KEYS = ["Str", "Agi", "Vit", "Int", "Dex", "Luk", "Pow", "Sta", "Wis", "Spl", "Con", "Crt"] as const;

const RawLevelValue = (valueKey: string) =>
  z.array(z.object({ Level: z.number().int().min(1).max(275), [valueKey]: z.number() }));

const RawBonusStatsEntry = z.object({
  Level: z.number().int().min(1).max(275),
  ...Object.fromEntries(JOB_STAT_KEYS.map((k) => [k, z.number().int().optional()])),
});

/** `Jobs`/`Inherit`/`AlternateOutfits`: nomes de job livres (string), nunca fechados num enum — ver nota abaixo. */
const JobFlagMap = z.record(z.string(), z.boolean());

/**
 * `Jobs` referencia `enum e_job` (`mmo.hpp:888`), ~200+ valores
 * não-contíguos. O PRÓPRIO migrador atual não copia essa lista à mão — ele
 * faz parse ao vivo do enum em `mmo.hpp` (`migrate-jobs.ts:106-123`), que é
 * a abordagem certa. Fechar isso num `z.enum` aqui seria digitar ~200
 * nomes sem fonte verificada nesta auditoria — exatamente o "por tentativa
 * e erro" que a instrução do usuário proíbe. Fica como string livre; quem
 * valida contra a lista real de jobs é o Mapper, que tem acesso ao
 * resultado do parse do `mmo.hpp` (mesmo mecanismo do migrador).
 */
export const RawJobBodyEntrySchema = z.object({
  Jobs: JobFlagMap,
  MaxWeight: z.number().int().positive().optional(),
  HpFactor: z.number().int().nonnegative().optional(),
  HpIncrease: z.number().int().nonnegative().optional(),
  SpFactor: z.number().int().nonnegative().optional(),
  SpIncrease: z.number().int().nonnegative().optional(),
  ApFactor: z.number().int().nonnegative().optional(),
  ApIncrease: z.number().int().nonnegative().optional(),
  BaseASPD: z.record(z.enum(JOB_ASPD_WEAPON_KEYS), z.number().int()).optional(),
  MaxStats: z.record(z.enum(JOB_STAT_KEYS), z.number().int()).optional(),
  MaxBaseLevel: z.number().int().min(1).max(275).optional(),
  BaseExp: RawLevelValue("Exp").optional(),
  MaxJobLevel: z.number().int().min(1).max(275).optional(),
  JobExp: RawLevelValue("Exp").optional(),
  BonusStats: z.array(RawBonusStatsEntry).optional(),
  BaseHp: RawLevelValue("Hp").optional(),
  BaseSp: RawLevelValue("Sp").optional(),
  BaseAp: RawLevelValue("Ap").optional(),
  AlternateOutfits: JobFlagMap.optional(),
});
export type RawJobBodyEntry = z.infer<typeof RawJobBodyEntrySchema>;

export const JobStatsDocSchema = z.object({
  Header: z.object({ Type: z.literal("JOB_STATS"), Version: z.number().int().min(2).max(4) }),
  Body: z.array(RawJobBodyEntrySchema).default([]),
});
export type JobStatsDoc = z.infer<typeof JobStatsDocSchema>;
