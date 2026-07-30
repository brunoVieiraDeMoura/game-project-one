# Proposta de schema Supabase — APROVADA (2026-07-17)

> Decisões do usuário: **ruleset renewal** (db/re), **Supabase hosted**
> (nuvem — revisado 2026-07-18: local via CLI descartado, Docker/WSL não
> funciona na máquina), **tabelas filhas para drops de monstros**
> (spawns/skills em jsonb).
> Migração inicial: `supabase/migrations/20260717000001_initial.sql`.
> Aplicação: `pnpm exec supabase link --project-ref <ref>` +
> `pnpm exec supabase db push` (sem Docker).
> O módulo Itens roda num repositório JSON local
> (`apps/api/src/store/json-item-repository.ts`) atrás da interface
> `ItemRepository` — trocar pra Supabase não muda rotas nem UI.

## Contexto: como o rAthena moderno organiza dados

- **Conteúdo de jogo** (item_db, mob_db, skill_db, job db): arquivos YAML em `rathena/db/`, NÃO SQL.
- **Estado de runtime** (contas, personagens, inventário, guildas): SQL em `rathena/sql-files/main.sql` — `login` → `char` (FK account_id) → `inventory`/`storage`/`skill` (FK char_id).

"Manter os mesmos relacionamentos" (soul.txt §2) se aplica ao segundo grupo. O primeiro grupo vira tabelas novas espelhando os schemas zod de `packages/game-data`.

## Grupo 1 — Conteúdo (editável pelo admin)

| Tabela | Origem | Design |
|---|---|---|
| `items` | item_db.yml (29.356 migrados) | colunas escalares pesquisáveis + `jsonb` p/ estruturas aninhadas (flags, trade, effects) |
| `job_classes` | job_stats.yml + skill_tree.yml | idem |
| `skills` | skill_db.yml | idem; `applied_statuses` referencia `statuses.id` |
| `monsters` | mob_db.yml | drops/skills/spawns em `jsonb` (ou tabelas filhas — ver pergunta 3) |
| `npcs` | npc/ scripts | árvore de diálogo `jsonb` |
| `statuses` | status.yml | catálogo p/ dropdowns |
| `derivation_rules` | novo (soul §5.6) | 1 linha por regra atributo→derivado |
| `combat_formulas` | novo | expressões DSL |
| `server_config` | novo (soul §5.7) | singleton; API lê com cache curto → hot reload sem restart |

## Grupo 2 — Runtime (relacionamentos do rAthena preservados)

| Tabela | Equivale a (main.sql) | Relacionamento |
|---|---|---|
| `accounts` | `login` | — |
| `characters` | `char` | `account_id → accounts.id` |
| `inventory` | `inventory` | `char_id → characters.id`, `item_id → items.id` |
| `login_history` | `loginlog` | `account_id → accounts.id` |
| `account_bans` | (campo `state`/`unban_time` do login) | `account_id`, `banned_by` — normalizado p/ auditoria |
| `admin_audit_log` | novo (soul §5.8) | `actor_account_id → accounts.id` |

Rascunho SQL do módulo Itens + contas: `supabase/migrations/0001_initial.draft.sql`.
Demais tabelas ganham SQL completo após aprovação desta proposta.

## Segurança

- RLS habilitado em tudo; escrita só via service role (API) — admin nunca fala com o banco direto do browser.
- Senhas: Supabase Auth (não replicar o MD5 do rAthena — ver skill-network-protocol; MD5 só existe na ponte TCP legada, se usada).

## Perguntas abertas (bloqueiam a aplicação da migração)

1. **Ruleset**: renewal (`db/re`, usado na migração atual) ou pre-renewal (`db/pre-re`)?
2. **Supabase**: projeto hosted (precisa de URL + keys) ou local via CLI (`supabase start`, Docker)?
3. **Drops/spawns de monstros**: `jsonb` embutido (edição atômica, simples) ou tabelas filhas relacionais (consultas SQL "quem dropa item X")? Recomendo tabelas filhas para drops (consulta reversa é comum em admin de RO) e `jsonb` pro resto.
