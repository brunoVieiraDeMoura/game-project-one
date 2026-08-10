# Matriz de auditoria — Monster Skills (mob_skill_db)

**Sem UI nenhuma no admin** (nem leitura). Bloqueado por **A4**: zero referência a `mob_skill_db`
em `apps/api/src` — não existe caminho de persistência SQL. Fase 4 (editor) explicitamente fora
do escopo desta rodada, inclusive como somente-leitura (decisão do usuário via AskUserQuestion).

Fonte da verdade rAthena: `mob_parse_row_mobskilldb` (`rathena/src/map/mob.cpp:6372-6623`), lido
via `sv_readdb(..., "mob_skill_db.txt", ',', 19, 19, -1, ...)` — CSV de **19 colunas fixas**, não
YAML. Schema: `MonsterSkillUseSchema` (`packages/game-data/src/monster.ts:30-43`) só mapeia um
SUBCONJUNTO das 19 colunas — `skillId, level, condition.{kind,value,needsReview,legacySource},
chance, castTimeMs, cooldownMs`. Não há `state`, `target`, `cancelable`, `val1..val5`, `emotion`,
`chat` no schema atual.

| Coluna CSV rAthena | # | Schema atual | rAthena — tipo | rAthena — faixa/enum | Fonte | Sentinelas |
|---|---|---|---|---|---|---|
| MobID | 0 | n/a (é o `Monster.id` pai) | int (signed, SQL `smallint(6)`) | `>0` existente em mob_db; **-1**=todo boss, **-2**=todo normal, **-3**=todos | mob.cpp:6454; mob_skill_db.txt:71-75 | sentinelas negativas |
| INFO (dummy) | 1 | n/a | string livre | literal `"clear"` apaga skills do mob | mob.cpp:6475-6479 | `"clear"` |
| State | 2 | n/a (fora do schema) | `"State"` table | `any idle walk loot dead attack angry chase follow anytarget` (10) | mob.cpp:6376-6448 | `any`=MSS_ANY=-1 |
| SkillID | 3 | `skillId: int().positive()` | precisa existir em skill_db | catálogo skill | mob.cpp:6501 | — |
| SkillLv | 4 | `level: int().positive()` | `<=0→1`; capado em `mob_max_skilllvl` (default `MAX_MOBSKILL_LEVEL=100`) | 1..100 | mob.cpp:6512; skill.hpp:44 | — |
| Rate | 5 | `chance: number().min(0).max(100).default(100)` (schema é %, rAthena é permillage) | permillage (n/1000?) `*mob_skill_rate/100`, cap 10000 | 0 vira 1 se config ligada | mob.cpp:6516-6522 | 0→1 |
| CastTime | 6 | `castTimeMs: int().nonnegative().default(0)` | int32 ms | livre | mob.cpp:6525 | — |
| Delay | 7 | `cooldownMs: int().nonnegative().default(0)` | `*mob_skill_delay/100`; 0..`MOB_MAX_DELAY`(24h ms) | negativo → MOB_MAX_DELAY | mob.cpp:6526-6530; mob.cpp:48 | — |
| Cancelable | 8 | n/a | bool-ish, aceita literal `"yes"` | — | mob.cpp:6531-6533 | `"yes"` |
| Target | 9 | n/a | `"Target"` table | `target randomtarget self friend master around1..8 around` (14) | mob.cpp:6433-6448 | cross-check com skill ground/não-ground |
| Condition type | 10 | `condition.kind: string()` | `"Condition"` table, 27 entradas | ver mob.cpp:6391-6419 | | |
| Condition value | 11 | `condition.value: number().optional()` | `atoi` OU literal `cond2[]` | `anybad(-1) stone freeze stun sleep poison curse silence confusion blind hiding sight` | mob.cpp:6420-6432 | `anybad=-1` |
| val1..val5 | 12-16 | n/a | `strtol(base 0)` — hex/octal auto-detectado | livre | mob.cpp:6578-6582 | `0x...`=hex |
| Emotion | 17 | n/a | msg id | vazio→**-1** | mob.cpp:6599-6602 | vazio=-1 |
| Chat | 18 | n/a | msg id, tabela `mob_chat_db` | não encontrado→0 | mob.cpp:6604 | — |

Limites gerais: `MAX_MOBSKILL=50` skills por mob (mob.cpp:6481, map.hpp:71).

## Ação nesta rodada
Nenhuma. Registrado como levantamento de referência para quando A4 (persistência) for resolvido
e Fase 4 for aprovada. `Monster.skills` continua sem UI, sem edição, sem leitura no admin.
