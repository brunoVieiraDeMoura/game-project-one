-- Fase 9: tabela maps (Editor de mapas). Espelha GameMap de
-- packages/map-format. heightmap/collision/props/spawns em jsonb; width/height
-- viram colunas pra listagem barata (list() nunca puxa os arrays grandes).
-- Aplicar no dashboard hosted: SQL Editor → Run.

create table maps (
  id          text primary key,           -- slug (nome do mapa no rAthena)
  name        text not null,
  width       integer not null,
  height      integer not null,
  cell_size   double precision not null default 5,
  heightmap   jsonb not null default '[]',  -- float por célula (0 = ausente; vem do .gat do cliente)
  collision   jsonb not null default '[]',  -- walkable|wall|water|cliff por célula
  water_level double precision,             -- null = sem água
  props       jsonb not null default '[]',
  spawns      jsonb not null default '[]',
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index maps_name_idx on maps using gin (
  to_tsvector('simple', name || ' ' || id)
);

alter table maps enable row level security;
