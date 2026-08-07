-- Colunas geradas pra alimentar filtros novos da dashboard admin, sem tocar
-- nos dados existentes (backfill automático do ALTER, sem reseed).

-- Skills: filtro por classe. `class_prefix` é exatamente o que
-- `packages/game-data/src/skill-class.ts:prefixOf` calcula em memória — a
-- mesma regra (split_part por "_", sem underscore = a string inteira), só
-- que gerada no banco pra poder indexar e filtrar com `IN (...)` sem LIKE
-- (LIKE não dá pra escapar "_" via PostgREST, e "AL_%" bateria em
-- "ALL_RESURRECTION" também — o mesmo bug que a igualdade exata evita).
alter table skills
  add column class_prefix text
  generated always as (split_part(aegis_name, '_', 1)) stored;

create index skills_class_prefix_idx on skills (class_prefix);

-- NPCs: filtro por origem (a pasta rAthena de onde o NPC veio — quest, guild,
-- instance, battleground, event, merchant, kafra, job, city, airport, warp,
-- other). Mesma ideia da coluna `kind` que já existe nesta tabela: derivado
-- no write pela API (`npcOrigin` em packages/game-data/src/npc.ts), não é
-- coluna gerada porque a regra lê `legacy_ref` com lógica de string, não uma
-- expressão SQL simples. Backfill dos NPCs já existentes: recalcula pela
-- mesma regra, direto no banco.
alter table npcs add column origin text not null default 'other';

update npcs set origin = case
  when legacy_ref is null then 'other'
  when split_part(legacy_ref, '/', 2) = 're' then
    case split_part(legacy_ref, '/', 3)
      when 'quests' then 'quest'
      when 'guild' then 'guild'
      when 'guild2' then 'guild'
      when 'guild3' then 'guild'
      when 'instances' then 'instance'
      when 'battleground' then 'battleground'
      when 'events' then 'event'
      when 'merchants' then 'merchant'
      when 'kafras' then 'kafra'
      when 'jobs' then 'job'
      when 'cities' then 'city'
      when 'airports' then 'airport'
      when 'warps' then 'warp'
      else 'other'
    end
  else
    case split_part(legacy_ref, '/', 2)
      when 'quests' then 'quest'
      when 'guild' then 'guild'
      when 'guild2' then 'guild'
      when 'guild3' then 'guild'
      when 'instances' then 'instance'
      when 'battleground' then 'battleground'
      when 'events' then 'event'
      when 'merchants' then 'merchant'
      when 'kafras' then 'kafra'
      when 'jobs' then 'job'
      when 'cities' then 'city'
      when 'airports' then 'airport'
      when 'warps' then 'warp'
      else 'other'
    end
  end;

create index npcs_origin_idx on npcs (origin);

-- Statuses: grupo funcional + parâmetros (val1..val4 do
-- rathena/doc/status_change.txt). `description` JÁ EXISTE nesta tabela
-- (20260719000001_statuses_skills.sql) — só passa a ser preenchida.
-- Nome da coluna é `status_group`, não `group`: `group` é palavra reservada
-- do SQL e precisaria de aspas em toda query/filtro PostgREST.
alter table statuses add column status_group text not null default 'outro';
alter table statuses add column params jsonb not null default '[]';

create index statuses_group_idx on statuses (status_group);
create index statuses_category_idx on statuses (category);
