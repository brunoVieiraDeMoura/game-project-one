-- Ícone visual da skill (mesma convenção do icon de statuses,
-- 20260719000001_statuses_skills.sql): nome de arquivo em
-- public/assets/skills/, opcional — sem ele a UI cai no placeholder por seed.
-- Aplicar no dashboard hosted: SQL Editor → Run.

alter table skills add column icon text;
