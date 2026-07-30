-- Fase 2: tabela job_classes (espelha JobClassSchema de packages/game-data).
-- Aplicar no dashboard hosted: SQL Editor → Run.

create table job_classes (
  id                integer primary key,
  name              text not null unique,
  parent_class_id   integer references job_classes (id),
  max_base_level    integer not null,
  max_job_level     integer not null,
  max_weight        integer not null default 20000,
  -- estruturas aninhadas do schema zod em jsonb:
  base_stats        jsonb not null default '{"str":1,"agi":1,"vit":1,"int":1,"dex":1,"luk":1}',
  bonus_stats       jsonb not null default '[]',   -- bonusStatsPerLevel
  base_hp_by_level  jsonb not null default '[]',
  base_sp_by_level  jsonb not null default '[]',
  base_exp_by_level jsonb not null default '[]',
  job_exp_by_level  jsonb not null default '[]',
  hp_growth         jsonb,                          -- UNCLEAR-FORMULA fallback
  sp_growth         jsonb,
  allowed_weapons   jsonb not null default '[]',
  allowed_armor_tags jsonb not null default '[]',
  skills            jsonb not null default '[]',    -- árvore achatada {skillId,maxLevel,requires[]}
  aspd_modifiers    jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index job_classes_name_idx on job_classes using gin (
  to_tsvector('simple', name)
);
create index job_classes_parent_idx on job_classes (parent_class_id);

alter table job_classes enable row level security;
