# Roadmap de fases

## Rodada 1 — concluída (2026-07-17)

- [x] Monorepo pnpm + turborepo rodando (4 apps, 3 packages, 1 tool)
- [x] Schemas zod completos: Item, JobClass, Skill, Monster, Npc, Status,
      Balancing (regras de derivação), ServerConfig, Account/Audit
- [x] Módulo Itens ponta a ponta (API CRUD + paginação + busca; tabela e
      form completo no admin; validação zod nos dois lados)
- [x] Parser item_db: 29.356 itens renewal migrados, 0 inválidos;
      scripts → efeitos tipados + 18.077 itens com fragmentos flagged
- [x] MovementController grid + free com troca em runtime + 8 testes
- [x] Spectator mode básico no game client (/spectator)
- [x] Proposta de banco Supabase (rascunho, aguardando aprovação)

## Fase 2 — Banco + Classes

1. ~~Aplicar migração Supabase aprovada; `SupabaseItemRepository`; seed dos itens migrados~~
   ✔ 2026-07-18 (hosted; usuário aplicou SQL no dashboard; seed 29.356 ok)
2. ~~Autenticação do admin (Supabase Auth) + admin_audit_log desde já~~
   ✔ 2026-07-18 (login /login; API exige Bearer em POST/PUT/DELETE,
   group_level ≥ 10; auditoria em admin_audit_log; `create:admin` bootstrap)
3. ~~Parser job_stats.yml/skill_tree.yml → módulo Classes completo no admin~~
   ✔ 2026-07-18 (175 classes migradas: stats/hp/sp/exp/aspd/árvore de skills
   achatada; módulo Classes no admin; migração aplicada + 175 classes
   seedadas no hosted em 2026-07-18 — Fase 2 completa)

## Fase 3 — Skills + catálogo de status

1. ~~Parser status.yml → catálogo statuses (habilita dropdowns, soul §5.3)~~
   ✔ 2026-07-19 (1019 statuses; flags/estados em snake_case; 166 com Script
   flagged pra revisão)
2. ~~Parser skill_db.yml (fórmulas de dano → DSL com needsReview)~~
   ✔ 2026-07-19 (1635 skills, 0 inválidos; semântica per-level portada de
   skill.cpp parseNode; 682 fórmulas de dano + 768 status aplicados com
   needsReview — extração real na Fase 6)
3. ~~Módulo Skills no admin~~
   ✔ 2026-07-19 (páginas /skills e /statuses; dropdown de status do
   catálogo no form; verificado no browser; migração aplicada + 1019
   statuses e 1635 skills seedados no hosted em 2026-07-19 — Fase 3
   completa)

## Fase 4 — Monstros

Parser mob_db.yml + spawns de rathena/npc → módulo Monstros (tabela de
drops com consulta reversa "quem dropa X").

- Feito 2026-07-19: parser (2675 mobs, 0 inválidos, 3334 linhas de spawn de
  100 arquivos do scripts_monsters.conf; aiMode derivado da tabela de
  códigos Aegis de doc/mob_db_mode_list.txt); API /monsters com
  `?dropsItem=` (drops em tabela filha monster_drops); módulo admin
  completo verificado no browser. Skills de monstro (mob_skill_db.txt)
  ficaram pra fase posterior.
- Migração aplicada + seed em 2026-07-19: 2675 monsters + 13.339
  monster_drops no hosted; consulta reversa verificada contra o banco —
  Fase 4 completa.

## Fase 5 — NPCs

Conversor de scripts npc → árvore de diálogo estruturada (fragmentos não
reconhecidos flagged) → módulo NPCs + shops + warps.

- Feito 2026-07-19: parser da cadeia de conf do scripts_main.conf (683
  arquivos): 24.133 NPCs, 0 inválidos, 0 warnings — 4082 warps, 347 shops,
  1225 diálogos totalmente convertidos + 7981 com prefixo convertido e
  resto do script preservado em nó legacyScript needsReview (nunca
  descartado), 10.498 duplicatas resolvidas; API /npcs (filtros kind/mapId)
  + módulo admin verificado no browser.
- Migração aplicada + seed em 2026-07-19: 24.133 npcs no hosted, filtros e
  auth verificados contra o banco — Fase 5 completa.

## Fase 6 — Balanceamento

Extrair fórmulas de status.cpp/battle.cpp pro engine-core com testes de
paridade input/output contra o servidor original (soul §3); tela de regras
de derivação editáveis.

- Feito 2026-07-19: packages/engine-core/src/formulas/ com derivação renewal
  (HIT/FLEE/def2/mdef2/crit/perfect-dodge/PATK/SMATK/RES/MRES/baseATK/baseMATK/
  maxHP/maxSP/amotion) + reduções RE de DEF/MDEF, cada fórmula citando a
  linha do C; 35 testes de paridade (valores derivados à mão, inclui
  fidelidade à imprecisão de double). Singleton /balancing (default extraído,
  needsReview=false) + tela editável no admin (verificada em JSON mode).
- Migração aplicada 2026-07-19: tabela balancing criada, default semeado no
  primeiro GET (version 1, 5 regras), persistência + auth verificados —
  Fase 6 completa.

## Fase 7 — Gerenciador Global

server_config com hot-reload (cache curto na API), multiplicadores por
categoria refletindo no engine-core sem restart.

- Feito 2026-07-19: singleton /server-config (default taxas 1×, bump de
  version no PUT, cache 5s TTL invalidado no save); engine-core
  formulas/rates.ts com resolveDropRate/resolveExpRate/apply* (overrides por
  itemType/mvp/mapId empilhando multiplicativamente), 7 testes; tela
  /config no admin (taxas + overrides + movimento), verificada em JSON mode.
- Migração aplicada 2026-07-19: tabela criada, default semeado (version 1),
  auth verificada — Fase 7 completa.

## Fase 8 — Usuários

Contas, bans com motivo/duração, histórico de login, auditoria completa.

- Feito 2026-07-19: módulo /users admin-only (sem GET público) sobre as
  tabelas da migração inicial (accounts/account_bans/login_history/
  admin_audit_log — SEM novo SQL). Listar/detalhar contas (histórico de
  login + bans), ban com motivo+duração (1 ativo por vez, um-por-vez),
  unban, leitura do admin_audit_log com filtro. Audit ganhou action string
  livre + reason (ban/unban). 5 testes API; verificado no browser contra o
  banco (conta bruno grupo 99, auditoria com 2 edições da Fase 2).
  Fase 8 completa.

## Fase 9 — Editor de mapas

Parser gat/rsw (skill-legacy-import) → GameMap JSON; editor no admin;
loader no game client substituindo o plano de referência do spectator.

- Feito 2026-07-19: parser de map_cache.dat (cache do próprio rAthena — o
  .gat/.rsw do cliente não estão no repo; header 8b + map_info 20b + células
  zlib, célula→collision via map.cpp:3285). 8 mapas, 0 warnings; heightmap
  zerado (altura só no .gat do cliente) e waterLevel null flagged; spawns
  enriquecidos de monsters.json + warps de npcs.json. API /maps (list =
  resumo, get = mapa inteiro; heightmap/collision jsonb), 5 testes. Editor no
  admin: canvas de colisão pintável (walkable/wall/water/cliff) + spawns
  read-only. engine-core createMapTerrainQuery (colisão→TerrainQuery, 4
  testes). Game client: loader + MapTerrain (DataTexture 1 draw call),
  spectator carrega mapa real — Prontera renderizou com a colisão correta.
- Seed aplicado 2026-07-19: 8 mapas no hosted (prontera 122304 células,
  23 spawns), verificado contra o banco + auth — Fase 9 completa.
  Roadmap inteiro (Fases 1–9) coberto.
