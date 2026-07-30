# Plano — rAthena real como backend do cliente 3D (game-project)

## Context

Hoje `game-project` é uma reescrita da lógica de RO em TypeScript: `apps/game` simula combate,
IA de mob e dano no próprio browser (`src/combat/stats.ts`, `src/entities/Monster.tsx`),
`packages/engine-core/formulas/*` recalcula fórmulas do C++, e o conteúdo (29k itens, skills,
mobs) vive no Supabase editado pelo admin em `:3000`. `apps/gateway` é um stub de 25 linhas.

`idle-narok` já provou o caminho oposto: rAthena de verdade (C++, WSL2 + MariaDB) como única
autoridade, cliente falando o protocolo binário. A decisão é adotar esse backend e manter do
`game-project` só o que é a cara nova do jogo: **render 3D, UI e movimentação**.

Resultado pretendido:
- `localhost:3001/play` = cliente 3D logando numa conta rAthena, criando char, andando,
  batendo e morrendo com números vindos do map-server.
- `localhost:3000` = editor total de itens/monstros/skills/classes do rAthena, com hot-reload
  no servidor rodando.
- Teste-alvo: mapa 3D `novo_ms4yewiz` representando `prt_fild08`, com o modelo `Skeleton_Warrior`
  no lugar do sprite do Poring — status, dano e drops idênticos aos do Poring de verdade.

Decisões tomadas com o usuário: stack rAthena **copiada para dentro de game-project**; codec de
pacotes **no gateway Node** (browser só recebe JSON); conteúdo de jogo **no MySQL do rAthena**
(mapas 3D continuam no Supabase).

**Licença:** roBrowserLegacy e rAthena são GPL-3.0 (`idle-narok/client/LICENSE`,
`rathena/LICENSE`). Portar `client/src/Network/**` torna `game-project` derivado — ok para
projeto privado, impeditivo para distribuir fechado.

---

## F0 — Stack rAthena dentro do game-project

Copiar de `idle-narok` (arquivos, não symlink): `scripts/wsl-*.sh` → `scripts/`,
`rathena-conf/` e `npc-idle/` na raiz. `rathena/` já está vendorado aqui.

- `scripts/wsl-setup.sh`: rsync `rathena/` → `~/game-project/rathena` (ext4; compilar em /mnt/c
  é lento) + symlinks `rathena/conf/import` → `rathena-conf/`, `rathena/npc/game-project` → `npc-idle/`.
- `scripts/wsl-build.sh`: `--enable-packetver=20130618` (mesmo valor validado no idle-narok;
  o cliente 3D não usa asset RO, então o packetver só precisa bater com as tabelas do codec).
- `rathena/src/custom/defines_pre.hpp`: `PACKET_OBFUSCATION_KEY1/2/3 = 0` (obrigatório nessa faixa).
- `rathena-conf/`: IPs em 127.0.0.1, `pincode_enabled: no`, `new_account: yes`,
  `acc_name_min_length/password_min_length: 4`, `npc: npc/game-project/devmenu.txt`.
- `scripts/wsl-db.sh`: importa `main.sql logs.sql web.sql roulette_default_data.sql`
  **+ (novo) as tabelas de conteúdo**, ver F5.
- Documentar em `CLAUDE.md` que a máquina roda **WSL2 nativo, não Docker**.

Verificação: `scripts/wsl-run.sh` → `ss -tlnp` mostra 6900/6121/5121; login com `teste/teste123`.

## F1 — `packages/ro-protocol` + gateway real

Novo pacote com o subgrafo fechado do roBrowser (≈197k linhas, zero dep npm):
`Network/{PacketStructure,PacketVersions,PacketRegister,PacketLength,PacketVerManager,PacketCrypt}.js`,
`Network/Packets/packets20*_len_main.js`, `Utils/{BinaryReader,BinaryWriter,Struct,CodepageManager}.js`,
`Core/Configs.js`. Ajustes: aliases → relativos, `SEEK_*` em `globalThis`, remover
`import('UI/UIManager.js')`, `window.ROConfig` → config do pacote. Manter JS + `.d.ts` na borda —
não reescrever 197k linhas em TS.

`apps/gateway/src/` deixa de ser stub:
- `ro/session.ts` — máquina de estados login(6900) → char(6121) → map(5121). Sequência exata
  (de `idle-narok/client/src/Engine/{Login,Char,Map}Engine.js`): `CA.LOGIN` → `AC.ACCEPT_LOGIN`
  → `CH.ENTER` + **leitura crua de 4 bytes de AID** → lista de chars (usar
  `PacketVerManager.parseCharList`/`calculateBlockSize` verbatim) → `CH.SELECT_CHAR` →
  `HC.NOTIFY_ZONESVR` → `CZ.ENTER` (+ AID cru se packetver < 20070521) → `ZC.ACCEPT_ENTER`
  → `CZ.NOTIFY_ACTORINIT`. Pings: `CA.CONNECT_INFO_CHANGED` / `CZ.PING` / `CZ.REQUEST_TIME` (10s).
- `ro/socket.ts` — `net.Socket` via `Network.setSocketFactory` (não precisa de WS↔TCP proxy;
  o gateway já é Node). Replicar o buffer pré-conexão do proxy do idle-narok.
- `protocol.ts` — **contrato JSON próprio** cliente↔gateway (nada de opcode cru no browser):
  `auth:login/chars/select`, `world:enter`, `entity:spawn/move/vanish/action/vanish`,
  `self:move/stats/hp`, `chat:*`, `inv:*`, `skill:*`. Uma sessão rAthena por socket.

Verificação: teste de integração no gateway que loga `teste/teste123`, entra em `prt_fild08`
e imprime spawns recebidos, sem browser.

## F2 — Login / seleção de personagem no `/play`

`apps/game/src/main.tsx` ganha `/login` e `/char-select` (hoje só 5 rotas, sem auth).
Reusar a linguagem visual de `src/ui/rpg.tsx` (`Panel`, `RpgButton`, `ink`) — é o único ponto
de tokens do HUD. Fluxo: form → `auth:login` no gateway → lista de chars → criar/apagar/entrar
→ `world:enter` → monta a cena. Conta nova pelo sufixo `_M`/`_F` (`new_account: yes`).
Nada de Supabase Auth aqui — a conta é a tabela `login` do rAthena.

## F3 — Mundo servidor-autoritativo (vertical slice do teste)

**Mapa legado ↔ mapa 3D.** `packages/map-format` ganha
`legacy: { mapName, originX, originY }`. `novo_ms4yewiz` (32×32, `authoredHexScale: 1`,
`terrainMode: "blocks"`) recebe `{ mapName: "prt_fild08", originX, originY }` — janela 32×32
de células RO ao redor do ponto de spawn (`170,373` do devmenu / `272,244` do char de teste).
Célula RO (x,y) → índice de célula hex 1:1; `hexToWorld` continua desenhando.
Fora da janela: o servidor manda, o cliente clampa e loga (não trava).

**Movimento.** `Player.tsx` para de decidir posição. Novo `play/netMovement.ts`:
- modo grid (default, RO puro): clique no chão → `CZ.REQUEST_MOVE(cell)`; a posição vem de
  `ZC.NOTIFY_PLAYERMOVE` e o `MovementController` de `engine-core/movement/grid.ts` passa a
  **interpolar** o caminho confirmado (sobrevive como suavização, perde a autoridade).
- WASD: converte direção contínua em célula-alvo à frente e re-emite `CZ.REQUEST_MOVE`
  (truque padrão do RO); rubber-band quando o servidor discordar. Ordem pedida: tile primeiro,
  WASD depois de o tile estar correto.

**Entidades.** `src/entities/Monster.tsx` perde a IA inteira (`useFrame` 106-160) e vira um
renderer burro de `entity:spawn/move/action/vanish` (31 variantes de `ZC.NOTIFY_*ENTRY`
funiladas em um handler no gateway). `demoMonsters.ts`, `combat/stats.ts` e `rollDamage` saem.
Novo `src/entities/mobModels.ts`: `mobId → { model, scale }`, com fallback
`Skeleton_Warrior.glb` — Poring (1002) mapeado no skeleton, exatamente o teste pedido.
Sem tocar em nada de status/drop: eles são do `mob_db` do servidor.

Verificação do slice: logar → entrar no `novo_ms4yewiz` → skeletons andando onde o servidor
diz → clicar e atacar → dano do rAthena na tela → mob morre → drop no chão → pegar item.

## F4 — Combate, HUD e itens ligados nos pacotes

- Dano: `ZC.NOTIFY_ACT` (action 0/8/10/11/13 = normal/duplo/crítico/lucky) → `DamageNumbers.tsx`.
- HP/SP/stats: `ZC.STATUS` (bloco cheio), `ZC.PAR_CHANGE`/`LONGPAR_CHANGE` (funil genérico),
  `ZC.NOTIFY_MONSTER_HP` → `combatStore`/`characterStore`. `useCharacterLoader.ts` (Swordman
  hardcoded, nível 50) morre.
- Inventário: `ZC.NORMAL_ITEMLIST`/`EQUIPMENT_ITEMLIST`/`ITEM_PICKUP_ACK` → janela `inventory`
  (hoje 24 slots vazios em `hud/Windows.tsx`); drop no chão via `ZC.ITEM_FALL_ENTRY`
  (cubo simples até haver modelo de item, conforme pedido).
- Chat: `hud/Chat.tsx` sai do `useState` local → `CZ.REQUEST_CHAT` / `ZC.NOTIFY_PLAYERCHAT`+`NOTIFY_CHAT`.
- Skills: `ZC.SKILLINFO_LIST` alimenta a árvore; `CZ.USE_SKILL`/`USE_SKILL_TOGROUND` no uso;
  `CZ.STATUS_CHANGE` (0xbb) para distribuir ponto de atributo na janela status.
- Hotkeys RO: `Alt+A` status, `Alt+E` inventário, `Alt+S` skills, `Alt+Q` equip, `Alt+Z` party…
  em `hud/hotkeys.ts`, com o posicionamento das janelas espelhando o RO (status/equip à esquerda,
  inventário à direita, chat embaixo à esquerda, barra de skill embaixo) — **posição e caminho de
  acesso imitam o RO; a estilização é a do pack TravelBookLite** (F5).

## F5 — Skin de UI: TravelBookLite

Fonte: `assets-new/ui_style/Complete_UI_Book_Styles_Pack_Free_v1.0/01_TravelBookLite/`
(pixel-art de livro/pergaminho; Crusenho). **Licença exige crédito** — linha de atribuição na
janela `settings` + `README.md` (uso comercial liberado, revenda proibida).

Sprites são minúsculos (`Slot01a` 30×30, `Frame01a`/`Bar01a` 62×14/62×4, `BookPageLeft01a`
104×147, `Popup01a` 62×30), então a regra é: copiar para
`apps/game/public/assets/ui/travelbook/`, `image-rendering: pixelated` e **escala inteira**
(`--ui-scale: 3`, nunca fracionária — meio pixel borra a arte toda).

Reskin acontece num arquivo só: `apps/game/src/ui/rpg.tsx` (217 linhas, já é o ponto único
de tokens — "trocar aqui reveste o HUD inteiro"). Trocas:
- `Panel` → `border-image` de `Frame01a` (slice 4px) para janelas; janelas grandes
  (status/inventário/skills) usam `BookPageLeft/Right01a` como fundo de página dupla.
- `Slot` → `Slot01a` (normal) / `Slot01b`/`c` (hover/equipado); `Select01a` como realce.
- `RpgBar` → trilho `Bar01a` + preenchimento `Fill01a` (HP) / `Fill01b` (SP), recorte por
  `width` em % com `background-repeat: repeat-x`.
- `RpgButton` → frames de `Sprites Animated/UI_TravelBook_Button01a_1..5.png` como
  idle/hover/press (sprite-sheet CSS, sem JS de animação).
- `IconSquare` → ícones do pack onde existir equivalente (`IconHeart`=HP, `IconEnergy`=SP,
  `IconCoin`=zeny, `IconStar`, `IconGear`=settings); ícone de skill do rAthena continua vindo do
  catálogo, emoldurado pelo `Frame01a`.
- Paleta `ink` reescrita com as cores do pergaminho, para texto e bordas não brigarem com o pack.
- Cursor: `Cursor01c/d` como `cursor: url()` no canvas do jogo.

`RetroFilter` (`gameplay.retroMode`) fica só na cena 3D — a UI é DOM e já é pixel-art nativa,
pixelizar de novo destrói a leitura.

## F6 — Admin `:3000` como editor do rAthena

**Itens / monstros / mob_skill → MySQL.** `yaml2sql` (`rathena/src/tool/yaml2sql.cpp`) gera as
linhas a partir de `db/re/*.yml`; importar em `ragnarok` junto dos schemas
`sql-files/{item_db_re,mob_db_re,mob_skill_db_re}.sql`; `rathena-conf/inter_conf.txt` ganha
`use_sql_db: yes` (hoje `no` em `conf/inter_athena.conf:176`).

`apps/api` ganha uma terceira implementação por trás das interfaces existentes
(`store/item-repository.ts` etc., 5 métodos): `store/mysql-item-repository.ts`,
`mysql-monster-repository.ts` + mapeadores `mysql-item-row.ts`/`mysql-monster-row.ts`
(colunas booleanas `job_*`/`location_*`/`mode_*`, drops em `drop1_item..drop10_item`).
Seleção em `server.ts` (`defaultXRepository()`): MySQL > Supabase > JSON. Dep nova: `mysql2`.
**O campo `script`/`equip_script` é `text` cru no rAthena** e o `EffectList` tipado não
re-serializa (18k itens com `unmappedEffects`): o form do admin edita o script como texto,
com o `EffectsEditor` como visualização somente-leitura. Sem isso o round-trip corrompe item.

**Skills / classes → YAML.** rAthena não lê SQL nesses (confirmado: só existem 5 loaders SQL em
`src/map/`). `apps/api/src/store/yaml-skill-repository.ts` / `yaml-job-repository.ts` escrevem
`rathena/db/re/{skill_db,job_stats,skill_tree,job_exp}.yml` preservando ordem e comentários.

**Hot-reload sem restart.** `npc-idle/panel.txt`: NPC com `OnTimer` fazendo `query_sql` numa
tabela `panel_reload_queue` e disparando `atcommand "@reloaditemdb"` / `@reloadmobdb` /
`@reloadskilldb` / `@reloadscript`. Funciona sem jogador atachado — `atcommand_sub` usa
`dummy_sd` quando `st->rid == 0` (`rathena/src/map/script.cpp:15736-15771`). O admin, ao salvar,
insere na fila; a API expõe `POST /server/reload`.

**Usuários.** `/users` passa a ler `login`/`char` do MariaDB no lugar de `accounts` do Supabase;
ban vira `state`/`unban_time` do rAthena. Auth do admin continua Supabase (é só o painel).

## F7 — VFX de skill e NPCs (placeholders combinados)

- `src/vfx/`: área = disco com shader de gradiente radial no chão (`ZC.SKILL_ENTRY`/`NOTIFY_GROUNDSKILL`);
  buff = anel/partícula simples no personagem (`ZC.MSG_STATE_CHANGE`); hit = flash + número.
  Registro `skillId → efeito` com default genérico, para nenhuma skill ficar invisível.
- NPCs: `NpcWalker.tsx` deixa de patrulhar sozinho; NPC vem de `ZC.NOTIFY_STANDENTRY_NPC`,
  modelo `Knight.glb` provisório, diálogo por `ZC.SAY_DIALOG`/`CZ.CONTACTNPC` (janela de diálogo
  nova em `hud/`). Player usa `Knight.glb` como "espadachim/GM" até haver modelo por classe
  (`CHARACTER_URLS` em `src/assets.ts`).

## F8 — Limpeza

Removido depois que F3/F4 passarem: `combat/stats.ts`, `entities/demoMonsters.ts`, IA de
`Monster.tsx`, auto-attack de `Player.tsx:213-247`, `character/useCharacterLoader.ts`,
`engine-core/formulas/{derived-stats,damage-reduction,rates}.ts` + testes de paridade, e o módulo
`/balancing` do admin (rAthena é a autoridade; rates viram `conf/import/battle_conf.txt`).
**Preservado:** `engine-core/movement/*`, `map-terrain.ts`, todo `hex/*`, o editor de mapas
(`/editor` + `apps/admin/app/maps`) e `packages/map-format` — a cara nova do jogo.

---

## Ordem de execução

F0 → F1 → F2 → **F3 (vertical slice: parar e validar aqui)** → F4 → F5 → F6 → F7 → F8.
F6 (editor MySQL) é independente de F2-F5 e pode ser feito em paralelo se preferir ver o editor antes.
F5 (skin) vem depois de F4 de propósito: reskinar janela que ainda vai mudar de conteúdo é retrabalho.

## Arquivos críticos

| Área | Arquivo |
|---|---|
| Bridge | `apps/gateway/src/server.ts` (stub, 25 linhas) → `ro/session.ts`, `ro/socket.ts`, `protocol.ts` |
| Codec | `packages/ro-protocol/` (novo, portado de `idle-narok/client/src/Network/**`) |
| Cliente/rotas | `apps/game/src/main.tsx`, `views/PlayView.tsx:106,155-173,340-345` |
| Movimento | `apps/game/src/play/Player.tsx:250`, `usePlayerInput.ts`, `GroundInteract.tsx:76-82` |
| Entidades | `apps/game/src/entities/Monster.tsx:106-160`, `demoMonsters.ts` |
| Estado | `apps/game/src/combat/combatStore.ts`, `character/characterStore.ts` |
| HUD | `apps/game/src/hud/{Hud,Windows,Chat,SkillBar}.tsx`, `ui/rpg.tsx` |
| Skin | `assets-new/ui_style/.../01_TravelBookLite/Sprites*` → `apps/game/public/assets/ui/travelbook/` |
| Mapa | `packages/map-format/src/index.ts` (campo `legacy`), `apps/game/src/hex/mapScale.ts` |
| API | `apps/api/src/server.ts:67-168`, `src/store/*-repository.ts` |
| rAthena | `rathena-conf/*`, `npc-idle/*`, `scripts/wsl-*.sh`, `rathena/src/custom/defines_pre.hpp` |

## Verificação ponta a ponta

1. `scripts/wsl-run.sh` → 3 servidores online + MariaDB.
2. `pnpm --filter @ragnarok/gateway test` → handshake completo sem browser.
3. `pnpm --filter @ragnarok/game dev` → `/login` com `teste_M`/`teste123` cria conta, cria char,
   entra no mapa.
4. No `/play?map=novo_ms4yewiz`: andar por clique (tile) e por WASD; conferir no
   `~/game-project/logs/map.log` que o servidor confirmou as células.
5. Matar um skeleton (= Poring 1002): dano, exp e drop batem com `mob_db` — comparar com
   `@mobinfo 1002` no chat.
6. `Alt+A` abre status com os atributos do servidor; gastar ponto e ver `ZC.STATUS_CHANGE_ACK`.
7. Skin: em 100%, 150% e 200% de zoom do browser as bordas do pack continuam nítidas (escala
   inteira + `pixelated`); crédito ao Crusenho visível na janela `settings`.
8. Admin `:3000` → editar HP do Poring → salvar → `POST /server/reload` → matar outro skeleton
   sem reiniciar nada e ver o HP novo.
9. `pnpm -r typecheck` e as suítes que sobrarem (`engine-core` movimento, `game` editor/hex, `api`).
