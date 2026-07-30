-- Fase 5: tabela npcs (warps + shops + diálogos estruturados). Espelha
-- NpcSchema de packages/game-data. `kind` é derivado no write
-- (warp/shop/dialogue/duplicate/other) pra filtro indexado.
-- Aplicar no dashboard hosted: SQL Editor → Run.

create table npcs (
  id             text primary key,               -- slug do nome único do rAthena
  name           text not null,
  kind           text not null default 'other',
  sprite         text not null,
  map_id         text not null,                  -- "-" = script flutuante
  position       jsonb not null default '[0,0,0]',
  direction      integer not null default 0,
  dialogue_entry text,
  dialogue       jsonb not null default '[]',    -- nós legacyScript têm needsReview
  quest_triggers jsonb not null default '[]',
  shop           jsonb,
  warp           jsonb,
  quest_board    jsonb not null default '[]',
  touch_area     jsonb,
  duplicate_of   text,                            -- id do NPC fonte (duplicate() do rAthena)
  legacy_ref     text,                            -- arquivo:linha em rathena/npc
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index npcs_name_idx on npcs using gin (
  to_tsvector('simple', name || ' ' || id)
);
create index npcs_kind_idx on npcs (kind);
create index npcs_map_idx on npcs (map_id);

alter table npcs enable row level security;
