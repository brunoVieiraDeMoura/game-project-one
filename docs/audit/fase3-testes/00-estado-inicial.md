# Estado inicial — antes da bateria de testes Fase 3

Capturado em 2026-08-10, antes de qualquer teste/alteração desta rodada.

## HEAD

```
bc1a93c218aefb892fc9ff3e1e281061d5a6b704
```

5 commits à frente de `a44facc` (Fase 0-2b), que era a última referência mencionada no pedido:

```
bc1a93c fix: warn on Skill.hitType "normal" losing Hit on save (A13)
823970c fix: make EffectsEditor actually read-only for Item onUse/onEquip/onUnequip (A9)
6ee84ac fix: convert Item.delay.durationMs ms<->seconds at MySQL boundary (A19)
9af25a5 fix: expose Monster.spawns write capability (A23)
b64b583 fix: edit job class skill tree inheritance
```

## git stash list

Vazio — nenhum stash pendente.

## git status --porcelain (WIP pré-existente do usuário, preservado)

```
 M CLAUDE.md
 M "SFX/login/Whispers of the Forgotten (1).mp3"
 M apps/admin/next-env.d.ts
 M apps/api/src/store/job-database-writer.test.ts
 M apps/api/src/store/job-database-writer.ts
 M apps/game/public/assets/audio/login-theme.mp3
 M apps/game/src/hud/InventoryWindow.tsx
 M apps/game/src/hud/SkillBar.tsx
 M apps/game/src/hud/StatusWindow.tsx
 M apps/game/src/hud/hotkeys.ts
 M apps/game/src/hud/skillBarStore.ts
 M apps/game/src/net/NetDamageNumbers.tsx
 M apps/game/src/net/NetPlayer.tsx
 M apps/game/src/net/acoes.ts
 M apps/game/src/net/ataqueBasico.ts
 M apps/game/src/net/attackStore.ts
 M apps/game/src/net/damageFeed.ts
 M apps/game/src/net/equipmentStore.test.ts
 M apps/game/src/net/equipmentStore.ts
 M apps/game/src/net/gateway.ts
 M apps/game/src/net/playerStore.ts
 M apps/game/src/net/skillCatalog.ts
 M apps/game/src/net/skillWalk.test.ts
 M apps/game/src/net/skillWalkStore.ts
 M apps/game/src/net/useWorldEvents.ts
 M apps/game/src/play/AimPreview.tsx
 M apps/game/src/ui/status.ts
 M apps/game/src/views/PlayView.tsx
 M apps/gateway/src/protocol.ts
 M apps/gateway/src/ro/session.ts
 M apps/gateway/src/ro/stat-names.ts
 M apps/gateway/src/server.ts
 M leia1.txt
 M packages/game-data/src/rathena/job-class-mapper.ts
 M rathena-conf/battle_conf.txt
 M tools/legacy-migration/src/job-class-mapper.test.ts
 M tools/legacy-migration/src/migrate-npcs.ts
?? SFX/cidades/
?? apps/game/public/assets/ui/status/icon-ammo.png
?? apps/game/src/net/pararMovimentoDeAcao.ts
?? apps/game/src/play/AttackRangeCircle.tsx
?? apps/game/src/vfx/Projectile.tsx
?? apps/game/src/vfx/projectileStore.ts
?? docs/audit/fase3-testes/   (esta pasta, criada agora)
?? docs/claude-context/
```

**Regra**: nenhum destes arquivos WIP é tocado por esta bateria; nenhum é commitado por esta
rodada, exceto se o próprio arquivo virar alvo direto de um teste (não é o caso — a bateria não
edita nenhum arquivo listado acima, todo o WIP pré-existente permanece como está).

## Serviços confirmados no ar antes de começar (não reiniciados sem necessidade)

| Porta | Serviço | PID |
|---|---|---|
| 3000 | admin (Next.js) | 22896 |
| 3001 | game (Vite) | 1396 |
| 4000 | api (Fastify) | 6060 |
| 4100 | gateway (Socket.IO↔TCP) | 12572 |
| 5122 | rAthena map-server | 12032 |
| 6122 | rAthena char-server | 12032 |
| 6901 | rAthena login-server | 12032 |
| 3306 | MariaDB (`gameproject`) | 12032 |

## Backend ativo confirmado por sonda HTTP (`GET /maps`, `/npcs`, `/monsters` em `localhost:4000`)

- `/maps` → 14 mapas reais (alberta, hexdemo, izlude, ...) — repositório JSON/Supabase.
- `/npcs` → NPCs reais migrados (ex. `#!@#$%` em `um_in`) — repositório JSON/Supabase +
  ponte `npc-script-sync.ts`.
- `/monsters` → monstro real `SCORPION` (id 1001) com stats completos — `MysqlMonsterRepository`
  confirmado (backend MySQL ativo, não fallback JSON).

## Contas/personagens pré-existentes relevantes

- `campo1` (account_id 2000010, group_id 99 = GM) — char `Campo`, classe 4055, base lvl 200,
  job lvl 70, zeny 4500, `prt_fild08`. Login/senha do painel de campo1 apareceram pré-preenchidos
  pelo autofill do navegador na tela de login (`campo1`/`campo123`) — não usados nesta bateria por
  decisão do usuário (conta QA nova).
- Login admin (`bruno.moura.code@gmail.com`) documentado em `pw.txt`.

## Conta QA criada para esta bateria

- Usuário `gpqa3` (sufixo `_M` aplicado pelo cliente) → conta `gpqa3_M`? — na prática o rAthena
  registrou `userid = gpqa3` (ver `SELECT` abaixo), `account_id = 2000042`, sexo M.
- `acc_name_min_length: 4` (`rathena-conf/login_conf.txt:14`) bloqueou a primeira tentativa
  (`qa3`, 3 chars) com "senha incorreta" — mensagem genérica do rAthena tanto para senha errada
  quanto para falha de registro por nome curto. Não é bug desta bateria, é o mínimo de config já
  documentado no próprio `login_conf.txt`.
- GM concedido: `UPDATE login SET group_id = 99 WHERE account_id = 2000042` (equivalente ao
  `scripts/wsl-gm.sh 2000042` — o script em si não rodou por um problema de tradução de path
  `/mnt/c/...` do Git Bash ao chamar `wsl bash <script>`; os mesmos comandos SQL do script foram
  executados manualmente, efeito idêntico).
- Personagem `GPQA3` criado, entrou em `/play`, spawn em `prt_fild08` (HP 40/40, SP 11/11, zeny
  5.000 — `start_zeny` de `char_conf.txt`).
- GM confirmado funcional: `@item 501 1` no chat deu 1 "First aid..." (Red Potion, id 501) —
  visível no inventário (`docs/audit/fase3-testes/backup/01-inventory-check-gm.png`).

## Backups feitos (`docs/audit/fase3-testes/backup/`)

- `skill_db.yml.bak-fase3`, `status.yml.bak-fase3`, `job_stats.yml.bak-fase3`,
  `skill_tree.yml.bak-fase3`, `map_index.txt.bak-fase3`, `map_cache.dat.bak-fase3`
  (todos de `rathena-db-import/`)
- `map_conf.txt.bak-fase3` (`rathena-conf/`)
- `scripts_custom.conf.bak-fase3` + `npc-idle-mobs/*.txt` (`npc-idle/`)
- `item_mob_dump.sql` — `mysqldump gameproject item_db_re mob_db_re panel_reload_queue`
  (33.239 linhas, sem erro — `mysqldump.err` vazio)

`rathena/` não foi tocado nem lido para escrita em nenhum momento desta preparação — só leitura
(`mapindex.cpp`, `map.cpp`) para confirmar como o servidor carrega mapa novo.
