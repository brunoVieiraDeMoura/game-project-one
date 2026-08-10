# Content database, admin auth, migration/formula rules, and legacy hex terrain

Scope: how game content (items/mobs) is served from the real rAthena MySQL
database and hot-reloaded, the Supabase-hosted admin database/auth, the
renewal ruleset choice, the WASD-removal history and the resulting single
movement-controller architecture, legacy-migration data rules (never turn
rAthena scripts into free strings, unclear-formula flagging, skill damage
formulas, status catalog IDs, engine-core formula extraction), the
admin-only Users module, and — as a second half-topic that happened to be
adjacent in the source document — the legacy hex-grid terrain system
(measured tile heightfields, bridges, hexScale, gameplay distance-field
scaling, hex click-lattice movement, the retro pixel filter, hex ground
texture modes) plus the config-singleton pattern (`balancing`,
`server_config`).

HISTÓRICO + regra atual: the database/reload/auth architecture and the
migration rules are current, permanent decisions. The WASD-removal entry is
explicitly a HISTÓRICO record of what was ripped out and why (`FreeMovementController`
still exists for NPC patrol) — don't reintroduce WASD without re-reading it.

Full verbatim content below.

---

- **Conteúdo do jogo mora no MySQL do rAthena** (`use_sql_db: yes`):
  `item_db_re` (29.356) e `mob_db_re` (2.675) populados por
  `scripts/wsl-db-content.sh` (que roda o `yaml2sql` a partir dos YAML). A API
  escolhe repositório nesta ordem: **MariaDB do rAthena > Supabase > JSON**
  (`RO_DB_*` em `apps/api/.env`). Editar item/monstro no admin edita o JOGO.
  - `yaml2sql` lê a confirmação **um caractere por vez, de um tty**: pipe com
    `\n` responde "N" na pergunta seguinte. Daí `script -qec` + só letras `Y`.
  - As tabelas "2" (`item_db2_re`, `mob_db2_re`, `mob_skill_db2_re`) ficam
    vazias mas TÊM que existir — o map-server consulta e morre sem elas.
  - Drop de monstro aponta para o **nome aegis** do item, não o id: o
    repositório resolve numa consulta só (`mysql-monster-repository`).
  - Script de item é **texto cru** e nunca é regenerado do `EffectList` (18k
    itens têm efeito não mapeado) — o update preserva o que está no banco.
- **Recarregar sem reiniciar**: o rAthena não tem porta de administração. Toda
  escrita enfileira em `panel_reload_queue`; o NPC `npc-idle/panel.txt` lê a
  fila a cada 2s e roda `@reloaditemdb`/`@reloadmobdb`/… `atcommand` funciona
  sem jogador atachado (`script.cpp:15736` usa um personagem fantasma). A API
  expõe `POST /server/reload` (admin-only, 202 = enfileirado).
  **Skills e classes continuam em YAML** — o rAthena só tem 5 loaders SQL
  (item, mob, mob_skill); editor delas ainda não existe.
- **Banco**: Supabase hosted (revisado 2026-07-18 — Docker/WSL não funciona
  na máquina do usuário; docs/database-proposal.md). Migração inicial
  APLICADA no projeto hosted (via SQL Editor); 29.356 itens seedados
  (`pnpm --filter @ragnarok/api seed:items` — re-rodar sobrescreve edições
  do admin). Credenciais em `apps/api/.env` (não commitado; template
  `.env.example`). API escolhe backend por env: com SUPABASE_URL +
  SUPABASE_SERVICE_ROLE_KEY usa `SupabaseItemRepository`, senão
  `JsonItemRepository` — ambos atrás da interface `ItemRepository`, rotas e
  UI não mudam. Só a API fala com o banco (service role; RLS fechado sem
  policies). Drops de monstros: tabelas filhas; spawns/skills: jsonb.
- **Auth do admin**: Supabase Auth (email/senha) no browser via anon key
  (`apps/admin/.env.local`); API valida Bearer token e exige
  `accounts.group_level >= 10` em toda mutação (GET é público); toda mutação
  gera linha em `admin_audit_log`. Sem env Supabase = auth off (dev/testes).
  Primeiro admin: `pnpm --filter @ragnarok/api create:admin`.
- **Ruleset**: renewal (`rathena/db/re`) — confirmado pelo usuário
  (flag `--ruleset pre-re` existe no parser se mudar).
- **O WASD foi REMOVIDO — há UM caminho de movimento, o clique-tile**
  (next-change-game.txt de 2026-08-04). Ele não estava duplicando pedido em jogo
  normal, mas por ACIDENTE: `usePlayStore.mode` nascia `"grid"` cravado e o bloco
  do `NetPlayer` caía num early-return. Ligado pelo botão das Configurações — o
  único caminho para isso —, ele era um segundo sistema com regras próprias:
  - **era o único chamador de `emitir` que pulava `pedirMovimento`**, logo sem
    `limitarAlcance`, sem `destinoAlcancavel` e sem a quebra por `max_walk_path`;
  - **disputava a mesma janela de 200 ms** do clique e zerava o `destinoFinal`,
    cortando o encadeamento de uma caminhada longa.
  - Saíram junto: o campo `mode`/`setMode` do `playStore`, o bloco "Movimento"
    das Configurações, os guardas `mode !== "grid"` do `GroundInteract`, o
    arrasto com botão ESQUERDO do `FollowCamera` (e o `lookYaw`, que sem ele
    ficava preso em zero), os eixos do `usePlayerInput` (sobrou o pulo) e o campo
    `skill` (Digit1), que era escrito e **nunca lido**.
  - **`defaultMovementMode`/`allowMovementModeSwitch` saíram do schema** — e a
    lição é a que importa: eles existiam há muito e o cliente **NUNCA os leu**.
    `play/useGameplayConfig` parseia só o sub-bloco `gameplay`, e os dois eram
    irmãos dele. Qualquer campo novo fora de `gameplay` cai no mesmo buraco,
    calado.
  - **O `FreeMovementController` FICA**: `entities/NpcWalker` o usa cravado para
    patrulha de NPC, que nunca teve nada com teclado. `play/Player` (preview do
    editor e demo) passou a cravar `"grid"`.
- **Movimento**: `createMovementController(mode, terrain)` em engine-core é o
  ÚNICO ponto que escolhe implementação. Não há mais escolha em tempo de
  execução — o jogo crava `"grid"` e o NpcWalker crava `"free"`. Ambos os
  controllers consomem o MESMO `TerrainQuery` (sem duplicar colisão).
- **Scripts do rAthena** nunca viram strings livres no novo schema: efeitos
  reconhecidos → `EffectList` tipado; resto → `unmappedEffects[]` flagged
  pra revisão manual (nunca descartado, nunca adivinhado).
- **Fórmulas incertas**: marcar `needsReview: true` / comentário
  `UNCLEAR-FORMULA` e perguntar — nunca assumir valor (soul.txt §3).
- **Fórmulas de dano de skill**: skill_db.yml NÃO contém fórmulas (vivem em
  battle.cpp/skill.cpp) — todo skill de dano migra com
  `damageFormula.needsReview: true` + `legacySource`; chance/duração de
  status aplicado idem. Extração real é a Fase 6 (Balanceamento).
- **Catálogo de statuses**: id = nome SC do rAthena lowercase (bate com o
  `statusId` que a migração de itens já emite); skills/itens referenciam por
  dropdown do catálogo, nunca texto livre (soul §5.3).
- **Fórmulas do engine-core**: derivação de sub-stats + reduções de dano
  renewal ficam em `packages/engine-core/src/formulas/`, extraídas linha a
  linha de status.cpp/battle.cpp com testes de paridade (valores derivados à
  mão do C). Divisão inteira = `Math.trunc`; onde o C faz float com um cast
  no fim, replicar igual (inclusive imprecisão de double — é fidelidade, ver
  maxSP). Balanceamento é singleton editável (`/balancing`, default em
  `apps/api/src/store/default-balancing.ts` reflete essas fórmulas).
- **Módulo Usuários** (`/users`): admin-only em TODA rota (inclui GET —
  dados sensíveis), diferente dos módulos de conteúdo. Usa as tabelas da
  migração inicial (accounts/account_bans/login_history/admin_audit_log),
  sem SQL novo. Ban: 1 ativo por conta (novo ban levanta o anterior),
  motivo obrigatório, duração opcional (null = permanente). `SecurityContext.
  audit` aceita action string livre + reason (ban/unban além de CRUD).
- **Altura do chão = geometria da peça**: `hex/tile-heightfields.json`
  (gerado por `pnpm --filter @ragnarok/game tiles:measure`) guarda um
  heightfield 24×24 medido de cada .gltf de terreno; `hex/tileHeight.ts`
  amostra bilinear e `hexTerrainQuery.getHeight` devolve
  `levelToY(nível) + amostra × LEVEL_HEIGHT()`. Qual peça está em cada célula
  sai de `hex/tilePick.ts` — MESMA função que o HexTerrain usa pra desenhar,
  pra o chão que se vê e o que se pisa nunca divergirem. Aproximação (queda
  fixa por superfície, curva 1D na rampa) não serve: o personagem flutuava na
  estrada e vazava nas pontas da rampa. A medição desfaz o chanfro de 45° da
  borda (CHAMFER em measure-tiles.mjs), igual ao weld do render. Props são
  assentados nesse relevo na carga (`hex/groundProps.ts`), preservando quem
  foi posto acima do chão de propósito.
- **Ponte = travessia medida**: `deck` (altura do piso + meio-vão, unidades
  locais) sai do .gltf em `scripts/measure-props.mjs` e vai pro catálogo;
  `buildBridgeDecks` marca TODAS as células cujo centro cai no vão (girado/
  escalado pelo prop) como andáveis, na altura `prop.y + deck.y × scale`. Só a
  célula do centro virava tabuleiro — dava pra encostar, não pra atravessar. A
  altura vem do modelo, não do nível da margem, pra o piso bater com o que está
  desenhado. Ponte fica FORA do `groundProps` (se apoia nas margens, não no
  leito).
- **Distâncias vs hexScale**: os campos de distância do `gameplay` (câmera,
  névoa, renderDistance, pulo/gravidade, moveSpeed) são em unidades de HEXÁGONO
  nativo e passam por `scaleToWorld` (play/useGameplayConfig) antes de chegar na
  cena — hexScale multiplica o mundo inteiro, inclusive a altura de cada nível.
  A câmera segue o personagem (`charScale`) com piso de 1.6 níveis pra não
  entrar dentro do bloco. `charScale` TAMBÉM escala: ele é a PROPORÇÃO do
  personagem em relação ao hexágono (~0.34 = 1/4 do hex), não um tamanho
  absoluto — fixo, ele virava formiga e os props arranha-céus ao subir o
  hexScale.
- **Velocidade única**: `gameplay.moveSpeed` (unidades de mundo/s) vale pros
  DOIS modos — o grid divide pelo tamanho da célula pra virar células/s
  (play/Player.tsx). Não existe mais walkSpeed/runSpeed separados: clique-tile
  e WASD tinham que andar igual — o WASD saiu depois (next-change-game.txt).
- **Clique-tile em mapa hex**: o modo grid recebe um `CellLattice`
  (engine-core/movement/types.ts) — quadrado por default, `HEX_LATTICE`
  (hex/hexLattice.ts) nos mapas de bloco. Com ele o passo é de hexágono em
  hexágono (6 vizinhos, escolhe o mais alinhado ao destino) e o personagem
  para no CENTRO do hexágono clicado; o marcador de destino do chão
  (GroundInteract) usa o mesmo lattice e é um quadrado pouco maior que o
  personagem (não do tamanho da célula, como era antes).
- **hexScale é uma escala só**: `clampHexScale` (hex/hexGrid) define a faixa
  real (0.4–12) e TODO cálculo passa por ela — o grid usava um teto de 3 e as
  distâncias outro valor, e o player ia parar fora do mapa. As POSIÇÕES de
  props/spawns são coordenada de mundo: o mapa guarda `authoredHexScale` e
  `hex/mapScale.ts` reescala na carga (mapa sem o campo = escala 1).
- **Filtro retrô (16 bits)**: pós-processamento em `apps/game/src/scene/
  RetroFilter.tsx` (EffectComposer + RenderPixelatedPass do three/addons +
  shader de quantização/dither). Não toca em asset/material — `gameplay.
  retroMode` (off|pixel|16bit) liga/desliga. Ativo no /play; no editor é só
  prévia opcional (painel Cena), porque pixelizar atrapalha posicionar asset.
- **Chão do mundo hex**: os tiles KayKit não têm textura de chão — a face de
  cima amostra UM pixel do atlas (grama = 191,197,55). `gameplay.groundMode`
  (atlas | color | texture) troca isso NO SHADER (`hex/groundMaterial.ts`),
  casando por MATIZ pra pegar a família toda de tons do bloco sem tocar em
  estrada/água. Preview ao vivo no painel Cena do editor; valor oficial em
  `/game-editor`.
- **Configs singleton** (balancing, server_config): tabela de 1 linha
  (id=1, `check (id=1)`), config inteira em jsonb; API semeia default no
  primeiro GET, PUT faz bump de version no servidor + audita. server_config
  serve do cache curto (5s TTL, invalidado no save) → hot-reload sem restart;
  multiplicadores aplicados por funções puras em `formulas/rates.ts`
  (chamador passa a config, nada capturado em módulo).

