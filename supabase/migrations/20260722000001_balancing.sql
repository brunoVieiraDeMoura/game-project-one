-- Fase 6: tabela balancing (singleton). Config inteira de regras de
-- derivação + fórmulas de combate em jsonb, uma linha (id=1). A API semeia o
-- default extraído no primeiro GET se a linha não existir.
-- Aplicar no dashboard hosted: SQL Editor → Run.

create table balancing (
  id         integer primary key default 1,
  config     jsonb not null,
  updated_at timestamptz not null default now(),
  -- garante singleton: só a linha id=1 é permitida
  constraint balancing_singleton check (id = 1)
);

alter table balancing enable row level security;
