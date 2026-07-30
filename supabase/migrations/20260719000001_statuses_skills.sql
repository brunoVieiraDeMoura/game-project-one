-- Fase 3: tabelas statuses (catálogo de buffs/debuffs) e skills.
-- Espelham StatusEffectDefSchema e SkillSchema de packages/game-data.
-- Aplicar no dashboard hosted: SQL Editor → Run.

create table statuses (
  id                    text primary key,          -- slug (nome SC do rAthena em lowercase)
  name                  text not null,
  category              text not null default 'neutral',  -- buff | debuff | neutral
  states                jsonb not null default '[]',
  calc_flags            jsonb not null default '[]',
  opt1                  text,
  opt2                  jsonb not null default '[]',
  opt3                  jsonb not null default '[]',
  options               jsonb not null default '[]',
  flags                 jsonb not null default '[]',
  duration_lookup_skill text,
  default_duration_ms   integer,
  min_rate              integer,
  min_duration_ms       integer,
  fail_on               jsonb not null default '[]',
  end_on_start          jsonb not null default '[]',
  end_return            jsonb not null default '[]',
  end_on_end            jsonb not null default '[]',
  effects               jsonb,                     -- EffectList (unmappedEffects = revisão manual)
  icon                  text,
  description           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index statuses_name_idx on statuses using gin (
  to_tsvector('simple', name)
);

alter table statuses enable row level security;

create table skills (
  id                      integer primary key,
  aegis_name              text not null unique,
  name                    text not null,
  max_level               integer not null,
  type                    text not null,           -- damage | support | area | self_buff | passive
  damage_nature           text not null default 'none',
  hit_type                text not null default 'normal',
  target                  text not null,
  -- valores por nível (escalar ou array, semântica perLevel do zod) em jsonb:
  element                 jsonb not null default '"weapon"',
  damage_flags            jsonb not null default '[]',
  flags                   jsonb not null default '[]',
  range                   jsonb not null default '0',
  hits                    jsonb not null default '1',
  area_radius             jsonb not null default '0',
  knockback               jsonb not null default '0',
  active_instances        jsonb not null default '0',
  give_ap                 jsonb not null default '0',
  sp_cost                 jsonb not null default '0',
  cast_time               jsonb not null default '{"variable":0,"fixed":0}',
  cooldown                jsonb not null default '0',
  after_cast_delay        jsonb not null default '0',
  after_cast_walk_delay   jsonb not null default '0',
  duration                jsonb not null default '0',
  duration2               jsonb not null default '0',
  interruptible           boolean not null default true,
  cast_defense_reduction  integer,
  cast_time_flags         jsonb not null default '[]',
  cast_delay_flags        jsonb not null default '[]',
  requirements            jsonb,
  copy_flags              jsonb,
  no_near_npc             jsonb,
  unit                    jsonb,
  damage_formula          jsonb,                   -- needsReview=true até extração da Fase 6
  applied_statuses        jsonb not null default '[]',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index skills_name_idx on skills using gin (
  to_tsvector('simple', name || ' ' || aegis_name)
);

alter table skills enable row level security;
