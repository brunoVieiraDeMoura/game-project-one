-- Fase 7: tabela server_config (singleton, Gerenciador Global). Config
-- inteira (taxas EXP/drop + overrides + movimento) em jsonb, uma linha
-- (id=1). A API semeia o default no primeiro GET; serve do cache curto pra
-- hot-reload sem restart. Aplicar no dashboard hosted: SQL Editor → Run.

create table server_config (
  id         integer primary key default 1,
  config     jsonb not null,
  updated_at timestamptz not null default now(),
  constraint server_config_singleton check (id = 1)
);

alter table server_config enable row level security;
