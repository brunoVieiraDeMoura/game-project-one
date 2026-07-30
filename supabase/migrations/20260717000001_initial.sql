-- Migração inicial (aprovada em 2026-07-17 — ver docs/database-proposal.md).
-- Cobre módulo Itens + espinha dorsal de contas (relacionamentos do rAthena main.sql).
-- Decisões: ruleset renewal; Supabase local via CLI; drops de monstros em
-- tabelas filhas (entra na migração da fase 4, junto com a tabela monsters).

-- ============ Grupo 1: conteúdo — items ============

create table items (
  id            integer primary key,
  aegis_name    text not null unique,
  name          text not null,
  type          text not null check (type in (
                  'healing','usable','etc','armor','weapon','card','pet_egg',
                  'pet_armor','ammo','delay_consume','shadow_gear','cash')),
  sub_type      text,
  buy_price     integer not null default 0,
  sell_price    integer not null default 0,
  weight        integer not null default 0,
  attack        integer not null default 0,
  magic_attack  integer not null default 0,
  defense       integer not null default 0,
  range         integer not null default 0,
  slots         integer not null default 0 check (slots between 0 and 4),
  jobs          text[] not null default '{all}',
  classes       text[] not null default '{}',
  gender        text not null default 'both' check (gender in ('male','female','both')),
  locations     text[] not null default '{}',
  weapon_level  integer,
  armor_level   integer,
  equip_level_min integer not null default 0,
  equip_level_max integer not null default 0,
  refineable    boolean not null default false,
  gradable      boolean not null default false,
  view_sprite   integer not null default 0,
  alias_name    text,
  -- estruturas aninhadas do schema zod (ItemSchema) ficam em jsonb:
  flags         jsonb,
  delay         jsonb,
  stack         jsonb,
  no_use        jsonb,
  trade         jsonb,
  on_use        jsonb,   -- EffectList tipado (effects + unmappedEffects)
  on_equip      jsonb,
  on_unequip    jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index items_name_search on items using gin (
  to_tsvector('simple', name || ' ' || aegis_name)
);
create index items_type_idx on items (type);

-- ============ Grupo 2: runtime — espelha main.sql ============

-- rAthena `login`
create table accounts (
  id            serial primary key,
  username      text not null unique,
  email         text,
  group_level   integer not null default 0,
  auth_user_id  uuid references auth.users (id), -- Supabase Auth faz o hash de senha
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- rAthena `char` (char.account_id → login.account_id)
create table characters (
  id            serial primary key,
  account_id    integer not null references accounts (id) on delete cascade,
  name          text not null unique,
  class_id      integer not null,
  base_level    integer not null default 1,
  job_level     integer not null default 1,
  base_exp      bigint not null default 0,
  job_exp       bigint not null default 0,
  stats         jsonb not null default '{"str":1,"agi":1,"vit":1,"int":1,"dex":1,"luk":1}',
  hp            integer not null default 40,
  sp            integer not null default 11,
  zeny          bigint not null default 0,
  map_id        text not null default 'start',
  position      jsonb not null default '[0,0,0]',
  movement_mode text not null default 'grid' check (movement_mode in ('grid','free')),
  created_at    timestamptz not null default now()
);

-- rAthena `inventory` (inventory.char_id → char.char_id, nameid → item)
create table inventory (
  id            bigserial primary key,
  char_id       integer not null references characters (id) on delete cascade,
  item_id       integer not null references items (id),
  amount        integer not null default 1 check (amount > 0),
  equipped      boolean not null default false,
  refine        integer not null default 0,
  cards         integer[] not null default '{}',
  unique_id     bigint
);
create index inventory_char_idx on inventory (char_id);

-- rAthena `loginlog`
create table login_history (
  id            bigserial primary key,
  account_id    integer not null references accounts (id) on delete cascade,
  at            timestamptz not null default now(),
  ip            inet
);
create index login_history_account_idx on login_history (account_id, at desc);

-- ban normalizado (rAthena usa colunas state/unban_time em login)
create table account_bans (
  id            bigserial primary key,
  account_id    integer not null references accounts (id) on delete cascade,
  reason        text not null,
  banned_at     timestamptz not null default now(),
  expires_at    timestamptz,             -- null = permanente
  banned_by     integer not null references accounts (id),
  lifted_at     timestamptz
);
create index account_bans_account_idx on account_bans (account_id);

-- auditoria administrativa (soul.txt §5.8)
create table admin_audit_log (
  id                bigserial primary key,
  actor_account_id  integer not null references accounts (id),
  action            text not null,
  target_type       text not null,
  target_id         text not null,
  reason            text,
  payload           jsonb,
  at                timestamptz not null default now()
);
create index admin_audit_target_idx on admin_audit_log (target_type, target_id);

-- ============ RLS: tudo fechado; API usa service role ============

alter table items            enable row level security;
alter table accounts         enable row level security;
alter table characters       enable row level security;
alter table inventory        enable row level security;
alter table login_history    enable row level security;
alter table account_bans     enable row level security;
alter table admin_audit_log  enable row level security;
