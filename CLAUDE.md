# game-project — cliente 3D sobre rAthena real

**Virada de rota (2026-07-28, tenta-entender.txt):** a engine própria em
TypeScript deixa de ser a autoridade. Quem simula o jogo é o **rAthena de
verdade** (C++, WSL2 + MariaDB); o projeto mantém a cara nova — render 3D
(R3F), UI e movimentação — e fala o protocolo binário com o servidor pelo
gateway. Plano completo e fases em `docs/plano-rathena.md`.

O que sobrevive da fase anterior: editor de mapas 3D, `packages/map-format`,
`engine-core/movement` (vira interpolação, não decisão) e os schemas zod (agora
para o editor do admin, não para rodar o jogo). O que morre: fórmulas
reimplementadas, combate/IA no cliente, `/balancing`.

## Estrutura

```
apps/game/               Vite + R3F + Rapier + Zustand/zundo — cliente 3D (porta 3001)
apps/admin/              Next.js + Tailwind v4 — dashboard admin (porta 3000)
apps/api/                Fastify + zod — REST usada por admin e game (porta 4000)
apps/gateway/            Socket.IO ↔ TCP rAthena (porta 4100) — traduz pacote binário ↔ JSON
packages/ro-protocol/    codec do protocolo RO (GPL-3.0, portado do roBrowserLegacy) + RoConnection
scripts/wsl-*.sh         build/DB/run do rAthena dentro do WSL2
rathena-conf/            conf/import do rAthena (entra por symlink) — toda customização mora aqui
npc-idle/                NPCs nossos (npc/game-project por symlink) — devmenu do GM
packages/game-data/      schemas zod + tipos (Item, JobClass, Skill, Monster, Npc, Balancing…)
packages/engine-core/    lógica de jogo pura (MovementController grid/free; fórmulas virão aqui)
packages/map-format/     schema GameMap (fonte de verdade: .claude/skills/skill-map-format)
tools/legacy-migration/  parsers offline rathena/db + rathena/npc → JSON (itens, jobs, statuses, skills, monstros, npcs, mapas feitos)
rathena/                 fonte original — SOMENTE LEITURA, é a referência autoritativa
supabase/migrations/     SQL aplicado manualmente no dashboard hosted (SQL Editor)
```

## Comandos

```bash
# --- servidor rAthena (WSL2 Ubuntu, root) ---
wsl -d Ubuntu -u root bash /mnt/c/Users/Bruno/desktop/game-project/scripts/wsl-setup.sh  # rsync + symlinks (1x)
wsl -d Ubuntu -u root bash .../scripts/wsl-db.sh     # cria banco gameproject + schema (1x)
wsl -d Ubuntu -u root bash .../scripts/wsl-db-content.sh  # yaml2sql + importa item_db_re/mob_db_re (1x)
wsl -d Ubuntu -u root bash .../scripts/wsl-build.sh  # compila (packetver 20130618)
wsl -d Ubuntu -u root bash .../scripts/wsl-run.sh    # sobe login 6901 / char 6122 / map 5122
wsl -d Ubuntu -u root bash .../scripts/wsl-stop.sh   # derruba SÓ os deste projeto
wsl -d Ubuntu -u root bash .../scripts/wsl-gm.sh <account_id>  # group_id 99 (GM)

pnpm install                 # raiz
pnpm -r typecheck            # tudo
pnpm --filter @ragnarok/ro-protocol test   # codec: structs, tabela de tamanho, enquadramento
pnpm --filter @ragnarok/api start          # API (serve 29k itens migrados)
pnpm --filter @ragnarok/admin dev          # admin em localhost:3000
pnpm --filter @ragnarok/game dev           # game em localhost:3001 (/spectator)
pnpm --filter @ragnarok/engine-core test   # testes movement + paridade de fórmulas
pnpm --filter @ragnarok/game test          # testes editor (estradas/scatter) + hex (weld/colisão)
pnpm --filter @ragnarok/game test:perf     # SÓ os orçamentos: custo por operação (desempenho.test) + por cenário de jogo (cenarios.test)
pnpm --filter @ragnarok/game props:measure # re-mede o footprint dos assets → radius nos catálogos
pnpm --filter @ragnarok/game terrain:textures # re-gera public/assets/terrain/*.png (chão pintado)
pnpm --filter @ragnarok/api test           # testes CRUD itens + classes + auth
pnpm --filter @ragnarok/legacy-migration migrate:items   # re-gera output/items.json
pnpm --filter @ragnarok/legacy-migration migrate:jobs    # re-gera output/job-classes.json
pnpm --filter @ragnarok/legacy-migration migrate:statuses # re-gera output/statuses.json
pnpm --filter @ragnarok/legacy-migration migrate:skills  # re-gera output/skills.json (depende de items+statuses.json)
pnpm --filter @ragnarok/legacy-migration migrate:monsters # re-gera output/monsters.json (depende de items.json)
pnpm --filter @ragnarok/legacy-migration migrate:npcs    # re-gera output/npcs.json (depende de items.json)
pnpm --filter @ragnarok/legacy-migration migrate:maps    # re-gera output/maps/*.json de map_cache.dat (usa monsters+npcs.json p/ spawns)
pnpm --filter @ragnarok/legacy-migration migrate:maps -- --cache base --only moc_fild01,prt_fild07  # mapas do acervo geral (1.288); --only obrigatório
pnpm --filter @ragnarok/legacy-migration export:mapcache -- --maps prt_fild08  # mapa editado → rathena-db-import/map_cache.dat (reiniciar o rAthena)
pnpm --filter @ragnarok/api seed:items     # upsert itens → Supabase (sobrescreve edições!)
pnpm --filter @ragnarok/api seed:jobs      # upsert classes → Supabase (idem)
pnpm --filter @ragnarok/api seed:statuses  # upsert statuses → Supabase (idem)
pnpm --filter @ragnarok/api seed:skills    # upsert skills → Supabase (idem)
pnpm --filter @ragnarok/api seed:monsters  # upsert monstros + reescreve monster_drops (idem)
pnpm --filter @ragnarok/api seed:npcs      # upsert npcs → Supabase (idem)
pnpm --filter @ragnarok/api seed:maps      # upsert mapas → Supabase (idem)
pnpm --filter @ragnarok/api create:admin <email> <senha> [user]  # bootstrap admin
pnpm --filter @ragnarok/api link:legacy-map <mapa3d> <mapaRO> <x> <y>  # janela do mapa 3D
```


## Documentação detalhada

Este arquivo cobre só o que precisa estar sempre no contexto. O histórico de
bugs, medições, fórmulas de shader, layout pixel-a-pixel de cada janela de UI,
e as investigações de performance/netcode inteiras vivem em
`docs/claude-context/`, organizados por domínio:

| Arquivo | Cobre |
|---|---|
| `01-rathena-connection-and-world-sync.md` | WSL2/portas/PACKETVER/GPL, fluxo de sessão login→char→map, pacote-por-versão, duas grades (square/hex), A* do cliente espelhando o servidor, limite de 30 células por pedido de caminhada, janela de 200ms de clique, emenda de trechos, teleporte no mesmo mapa, célula fracionária |
| `02-terrain-rendering.md` | Mapa 3D = mapa do rAthena inteiro (dual map_cache), chão em chunks, geração/estilo de textura de terreno, mistura de cor nos cantos, água (rio/lago, profundidade, margem), altura nos cantos, budget de construção de chunk por quadro, tela de carregamento em duas fases, névoa (cor do céu, fração do raio de render), vazamento de textura por entidade (corrigido) |
| `03-ui-system-and-hud.md` | Todo o sistema de skin pintado (TravelBookLite + pacotes ui_definitiva/ui-change): frame do personagem, StatPlate, chat, skill bar, cast bar, minimapa, inventário, status, habilidades, world HP/SP bars, quests, mapa (Alt+M), lista de amigos, login/char-select; gating de sessão do /play; hotkeys; area_size/spawn tuning do servidor |
| `04-netcode-prediction-reconciliation.md` | Predição do cliente, reconciliação com fila de pendentes, interpolação de snapshots (100ms), fixpos/highjump, smart target (aim assist), TAB de alvo, clique parando em prop, ataque básico como modo persistente, CONJURANDO NÃO ANDA, posição contínua por sub-célula, a investigação dos "três bugs silenciosos" da predição, o bug do StrictMode desligando o pathfinder, threshold de fixpos-vira-teleporte |
| `05-diagnostics-flight-recorder.md` | `core/diagnostics/flightRecorder.ts` (`__voo`), sonda de renderer/device, sonda de árvore de cena, auditoria de assets/texturas (`__censo`), dedup de textura entre .gltf, `matrixAutoUpdate=false` em prop estático |
| `06-combat-orders-and-edge-cases.md` | As três ordens de vários quadros (atacar/pegar/lançar-com-aproximação), `moveTarget.ts` (nunca pedir caminho impossível), colisão cliente×servidor divergente, variantes "2" de pacote por PACKETVER, rotação só no modelo, nome de classe via enum, `@load` como saída de mapa sem cena 3D |
| `07-map-editor.md` | Duas grades no editor, culling por zoom, classificação de manchas bloqueadas, escopo de edição global (Dentro/Borda/Buraco/Tudo), picking de chão/prop, todos os pincéis de relevo (proporcional, montanha, rio, lago, promontório, escultura, rampa), scatter procedural por categoria/escopo, export:mapcache, sistema de terreno hex legado (ainda usado pelo editor/`/spectator`) |
| `08-data-database-config-and-hex-legacy.md` | Banco de conteúdo no MySQL do rAthena, reload sem restart, Supabase (banco admin + auth), ruleset renewal, remoção do WASD (histórico), `createMovementController`, regras de migração (scripts nunca viram string livre, fórmulas incertas, catálogo de status), módulo Usuários, config singleton |

Ao trabalhar em qualquer uma dessas áreas, leia o arquivo correspondente
primeiro — ele tem os números, nomes de função e caminhos exatos que este
CLAUDE.md só resume.

## Regras e invariantes essenciais

Estas são as regras que precisam estar sempre no contexto porque violá-las
quebra a arquitetura de forma silenciosa (o servidor recusa calado, ou o
cliente diverge do rAthena sem erro nenhum). Cada uma tem o arquivo com o
raciocínio completo.

**Autoridade e simulação**
- O rAthena real (C++, WSL2) é quem simula o jogo. O cliente nunca calcula
  dano, IA, drop ou fórmula de combate — isso foi removido de propósito na
  Fase F8 (`engine-core/formulas`, `combat/stats`, `/balancing` no cliente
  não existem mais). → `08-data-database-config-and-hex-legacy.md`
- `/play` exige sessão ativa e redireciona para `/login` sem ela; o mundo
  local (hex demo) só abre com `?preview=1` ou `?map=<id>` explícitos, nunca
  como fallback silencioso. → `03-ui-system-and-hud.md`
- HUD e estado do jogador (HP/SP/exp/zeny/atributos/inventário/skills) vêm
  do servidor via `net/playerStore`; o gateway reenvia o último estado
  conhecido no `world:ready`. Nunca inventar ou derivar esses valores no
  cliente. → `03-ui-system-and-hud.md`

**Servidor e protocolo**
- rAthena roda nativo no WSL2 (não Docker). Portas deste projeto: login
  6901 / char 6122 / map 5122, banco MariaDB `gameproject` (idle-narok usa
  6900/6121/5121 e `ragnarok` — não confundir). `conf/import` e
  `npc/game-project` são symlinks para `rathena-conf/` e `npc-idle/` no
  repo. → `01-rathena-connection-and-world-sync.md`
- `PACKETVER 20130618` tem que bater exatamente entre `scripts/wsl-build.sh`
  e o `initProtocol()` do gateway; pacote da versão errada faz o char-server
  derrubar a conexão calado. → `01-rathena-connection-and-world-sync.md`
- `packages/ro-protocol` é GPL-3.0 (cópia adaptada do roBrowserLegacy).
  Qualquer código que linka com ele herda a licença.
- Fluxo de sessão: navegador → Socket.IO (`apps/gateway`, porta 4100) → três
  conexões TCP em sequência (login → char → map). Contrato JSON em
  `apps/gateway/src/protocol.ts`. → `01-rathena-connection-and-world-sync.md`

**Movimento e pathfinding**
- O cliente refaz o caminho do servidor com A* portado de `path.cpp`
  (`net/pathfind.ts`) — nunca emitir um pedido de movimento para uma célula
  que o próprio A* do cliente já sabe ser inalcançável (isso produzia o
  "dash" atravessando parede). → `04-netcode-prediction-reconciliation.md`,
  `06-combat-orders-and-edge-cases.md`
- O servidor só aceita **30 células por pedido de caminhada**
  (`battle_config.max_walk_path`, `rathena-conf/battle_conf.txt`) e descarta
  em silêncio acima disso. O número está COPIADO no cliente
  (`net/pathfind.ts: MAX_WALK_PATH_DEFAULT`) — mudar um lado sem o outro é
  uma falha muda. → `01-rathena-connection-and-world-sync.md`
- Posição é contínua: o servidor é dono da CÉLULA, o cliente é dono do
  deslocamento DENTRO dela (sub-célula). Só teleporte de verdade
  (`> FIXPOS_TELEPORTE`) encaixa no centro da célula.
  → `04-netcode-prediction-reconciliation.md`
- O pathfinder é registrado tanto no render (`useMemo`) quanto num efeito
  com as mesmas dependências — StrictMode remonta em dev e uma limpeza sem
  o registro duplicado deixa `pathfinder` nulo a sessão inteira, calado.
  → `04-netcode-prediction-reconciliation.md`
- Predição do cliente, reconciliação com fila de pendentes e interpolação
  de snapshots são a arquitetura de rede atual, não um extra opcional —
  ler `04-netcode-prediction-reconciliation.md` inteiro antes de mexer em
  `NetPlayer`, `worldStore` ou qualquer coisa que escreva a posição de uma
  entidade.
- WASD foi REMOVIDO — o único caminho de movimento é clique-tile. Não
  reintroduzir sem ler o histórico completo (por que ele duplicava pedidos
  e furava os limites do clique). → `08-data-database-config-and-hex-legacy.md`

**Grades e terreno**
- `gridFor(map)` decide tudo sobre célula↔mundo, lattice de movimento e
  TerrainQuery a partir de `terrainMode` (`"square"` = mapa real do rAthena,
  `"blocks"` = hexágono do editor, `"smooth"` = plano legado). A grade
  quadrada NUNCA passa por `hexScale` — célula fixa de 2,0 unidades.
  → `01-rathena-connection-and-world-sync.md`
- Passabilidade e altura são independentes: nunca derivar colisão a partir
  de um limiar de altura, nem o contrário. Quem decide é quem autora.
  → `07-map-editor.md`
- Mapa editado só chega ao rAthena de verdade com `export:mapcache` +
  reiniciar o servidor — editar no editor 3D não muda a colisão do servidor
  até esse passo. → `07-map-editor.md`
- O escopo de edição (Dentro/Borda/Buraco/Tudo, `editor/editScope.ts`) vale
  GLOBALMENTE para toda ferramenta nova que escreve terreno — pincel,
  scatter procedural, prefab. → `07-map-editor.md`

**Combate e skills**
- CONJURANDO NÃO ANDA: um clique durante a conjuração é DESCARTADO, nunca
  guardado — o próprio rAthena ressuscitaria um pedido guardado num destino
  velho quando a conjuração acabasse. → `04-netcode-prediction-reconciliation.md`
- Nome de skill, tipo de alvo (célula vs. entidade) e nome de classe vêm
  sempre de fonte autoritativa do servidor (`net/skillCatalog`, enum
  `e_job`), nunca adivinhados ou hardcoded. → `06-combat-orders-and-edge-cases.md`
- Variantes "2" de pacote (ex.: `USE_SKILL_TOGROUND2`) só valem acima do
  PACKETVER que as introduziu — usar sem a guarda de versão derruba a
  sessão. → `06-combat-orders-and-edge-cases.md`

**UI**
- Toda janela do HUD usa a arte pintada dos pacotes TravelBookLite/
  ui_definitiva — antes de tocar em qualquer `hud/*Window.tsx` ou
  `ui/*.ts`, ler `03-ui-system-and-hud.md`. Regra rápida: arte pixel-art
  (TravelBookLite) exige `image-rendering: pixelated` + escala INTEIRA;
  arte pintada (character frame, quest, minimapa etc.) é o oposto — escala
  fracionária com interpolação suave.

**Dados e banco**
- Item e monstro moram no MySQL do próprio rAthena (`item_db_re`,
  `mob_db_re`, banco `gameproject`); editar no admin edita o JOGO ao vivo.
  Sem porta de administração — toda escrita entra na fila
  `panel_reload_queue`, lida por um NPC a cada 2s. → `08-data-database-config-and-hex-legacy.md`
- Banco do admin (contas, usuários, auditoria) é Supabase hosted; mutação
  exige `group_level >= 10` e gera linha em `admin_audit_log`.
  → `08-data-database-config-and-hex-legacy.md`
- Ruleset é **renewal** (`rathena/db/re`).
- Migração legada: script do rAthena nunca vira string livre (efeito
  reconhecido → `EffectList` tipado; resto → `unmappedEffects[]`); fórmula
  incerta nunca é assumida (`needsReview: true`). → `08-data-database-config-and-hex-legacy.md`

**Performance**
- Caminho quente (montagem de chunk, A*, resolução de clique) tem teto de
  custo em `src/perf/` — rodar `pnpm --filter @ragnarok/game test:perf`
  depois de mexer nessas áreas. → `05-diagnostics-flight-recorder.md`
- Existe um flight recorder (`__voo`, F9) e um auditor de assets (`__censo`)
  para investigar regressão de frame/memória — usar antes de adivinhar a
  causa de um engasgo. → `05-diagnostics-flight-recorder.md`

## Convenções

- TypeScript strict, ESM (`"type": "module"`), zod como fonte dos tipos
  (`z.infer`), pacotes expõem `src/index.ts` direto (sem build step;
  Next usa `transpilePackages`).
- Enums legíveis em snake_case no lugar de bitmasks — conversão só em
  tools/legacy-migration (ver mappings.ts).
- **Mexeu em caminho quente, rode o orçamento** (`pnpm --filter @ragnarok/game
  test:perf`): montagem de chunk, lâmina d'água, varredura de chunk sujo, A* e
  resolução de clique têm teto de custo em `src/perf/`. Ele roda junto com a
  suíte normal, mas rodar sozinho é mais rápido enquanto se experimenta uma
  implementação — é para isso que ele serve: comparar duas maneiras de escrever
  a mesma coisa com número, em vez de escolher no olho.
- Skills do projeto em `.claude/skills/`: skill-map-format,
  skill-legacy-import, skill-r3f-conventions, skill-network-protocol —
  ler antes de mexer nas áreas correspondentes.
- UI admin: primitivos em `apps/admin/components/ui.tsx`; módulos seguem o
  padrão do Itens (tabela paginada + busca + form completo).

## Fases

Plano completo em `docs/plano-rathena.md`. Estado (2026-07-28):

- **F0–F8 feitas**: stack rAthena no WSL, `ro-protocol` + gateway, login/char,
  mundo servidor-autoritativo, HUD/combate/itens por pacote, skin de UI,
  admin editando `item_db_re`/`mob_db_re` com reload sem restart, VFX + NPC, e
  a remoção do engine simulado.
- **F9 (next-change.txt) feita**: escala de célula, plaquinha com nome/nível/HP,
  barras do próprio personagem, alvo clicável, itens no chão (pegar e soltar),
  barra de habilidades por arrastar (persistida), mira de skill (chão e alvo),
  minimapa em células e respawn instantâneo por `battle_conf`.
- **Editor de classes escreve YAML** (`JobDatabaseWriter`, leia1.txt
  2026-08-07): `job_stats.yml` (MaxWeight/BonusStats/BaseHp/BaseSp/
  MaxBaseLevel/MaxJobLevel/BaseExp/JobExp/BaseASPD — `job_exp` é parte da
  MESMA estrutura de `job_stats.yml`, não um arquivo físico separado no
  override, porque o dispatcher do rAthena só declara um slot de import pro
  domínio JOB_STATS inteiro) e `skill_tree.yml` (Tree/Inherit) já têm
  write-path completo: validação estrutural + cruzada, escrita atômica
  (tudo-ou-nada nos 2 arquivos), backup antes de sobrescrever, diff e
  round-trip provados antes de qualquer gravação real, `@reloadpcdb`
  enfileirado ao final. Testado (`job-database-writer.test.ts`,
  `job-classes.test.ts`), inclusive isolamento entre classes (editar uma
  não toca a entrada já gravada de outra).
- **Pendências conhecidas**: spawn de mob continua sendo script de NPC do
  rAthena (não há tela para isso); modelo por classe/monstro é o placeholder
  KayKit; hotkeys do servidor (ZC.SHORTCUT_KEY_LIST) ainda não são usadas — a
  barra mora no navegador.
