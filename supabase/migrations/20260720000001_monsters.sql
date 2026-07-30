-- Fase 4: tabelas monsters + monster_drops (tabela filha — consulta reversa
-- "quem dropa X" por índice em item_id; CLAUDE.md). Espelham MonsterSchema
-- de packages/game-data. Aplicar no dashboard hosted: SQL Editor → Run.

create table monsters (
  id                   integer primary key,
  aegis_name           text not null unique,
  name                 text not null,
  level                integer not null default 1,
  hp                   integer not null default 1,
  sp                   integer not null default 1,
  base_exp             integer not null default 0,
  job_exp              integer not null default 0,
  mvp_exp              integer not null default 0,
  stats                jsonb not null default '{"str":1,"agi":1,"vit":1,"int":1,"dex":1,"luk":1}',
  attack_range         integer not null default 1,
  skill_range          integer not null default 0,
  chase_range          integer not null default 0,
  attack               integer not null default 0,   -- renewal: ATK base
  magic_attack         integer not null default 0,   -- renewal: MATK base (yml Attack2)
  defense              integer not null default 0,
  magic_defense        integer not null default 0,
  resistance           integer not null default 0,
  magic_resistance     integer not null default 0,
  flee_override        integer,
  hit_override         integer,
  walk_speed           integer not null default 150,
  attack_delay         integer not null default 0,
  attack_motion        integer not null default 0,
  client_attack_motion integer,
  damage_motion        integer not null default 0,
  damage_taken         integer not null default 100,
  ai                   text not null default '06',   -- código Aegis cru
  ai_mode              text not null default 'passive',
  chases_attacker      boolean not null default false,
  class                text not null default 'normal',
  modes                jsonb not null default '[]',
  race_groups          jsonb not null default '[]',
  group_id             integer not null default 0,
  title                text,
  race                 text not null,
  element              jsonb not null,               -- {type, level}
  size                 text not null,
  mvp                  boolean not null default false,
  skills               jsonb not null default '[]',  -- mob_skill_db: fase posterior
  spawns               jsonb not null default '[]',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index monsters_name_idx on monsters using gin (
  to_tsvector('simple', name || ' ' || aegis_name)
);

alter table monsters enable row level security;

create table monster_drops (
  id                  bigint generated always as identity primary key,
  monster_id          integer not null references monsters (id)
                        on delete cascade on update cascade,
  item_id             integer not null,
  rate                double precision not null,     -- % (0-100)
  steal_protected     boolean not null default false,
  random_option_group text,
  drop_index          integer,                       -- slot do rAthena (Index)
  is_mvp              boolean not null default false
);

create index monster_drops_item_idx on monster_drops (item_id);
create index monster_drops_monster_idx on monster_drops (monster_id);

alter table monster_drops enable row level security;
