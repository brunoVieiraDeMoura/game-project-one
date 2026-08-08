-- Módulo NPCs — Mapper (leia1.txt, 2026-08-07): rótulos de evento
-- (OnTouch/OnInit/OnTimerNNNN/...) viram entrada de primeira classe no
-- schema, não achatados no diálogo principal. 11.649 ocorrências reais no
-- corpus (mais de 1 por NPC em média) — sem esta coluna, todo handler de
-- evento seria perdido no round-trip com o banco.
-- Aplicar no dashboard hosted: SQL Editor → Run.

alter table npcs
  add column event_handlers jsonb not null default '[]';
