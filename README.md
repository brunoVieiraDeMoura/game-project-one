# game-project

Cliente 3D moderno (React Three Fiber) falando o protocolo binário de um
**rAthena real** (C++, WSL2 + MariaDB). O rAthena é a única autoridade de
simulação — dano, IA, drop e colisão de combate são calculados nele. Este
repositório mantém o render 3D, a UI, a movimentação/predição no cliente, o
painel administrativo que edita o banco do jogo ao vivo, e todas as
ferramentas de autoria (editor de mapas, migração de dados legados).

> Este documento é um mapa de navegação: cada caminho + a técnica usada nele,
> sem trechos de código. Para o histórico de bugs, números medidos e nomes de
> função exatos, ver [`docs/claude-context/`](docs/claude-context/README.md) e
> o [`CLAUDE.md`](CLAUDE.md) da raiz — este README não os substitui.

## Índice

- [Visão geral e fluxo](#visão-geral-e-fluxo)
- [Como rodar](#como-rodar)
- [Mapa de paths](#mapa-de-paths)
  - [Raiz](#raiz)
  - [apps/game/src](#appsgamesrc)
  - [apps/admin](#appsadmin)
  - [apps/api](#appsapi)
  - [apps/gateway](#appsgateway)
  - [packages](#packages)
  - [tools/legacy-migration](#toolslegacy-migration)
- [Assets — inventário completo](#assets--inventário-completo)
- [Técnicas do jogo](#técnicas-do-jogo)
- [Técnicas do painel admin](#técnicas-do-painel-admin)
- [Protocolo e servidor](#protocolo-e-servidor)
- [Comandos](#comandos)
- [Onde aprofundar](#onde-aprofundar)
- [Licenças e créditos de asset](#licenças-e-créditos-de-asset)

## Visão geral e fluxo

```
                     ┌────────────────────────┐
 navegador  ──────▶  │  apps/game (R3F, 3001) │
                     └───────────┬────────────┘
                        Socket.IO│ (JSON only)
                     ┌───────────▼────────────┐
                     │  apps/gateway (4100)    │  "o binário morre aqui"
                     └───────────┬────────────┘
                    3 conexões TCP sequenciais
                    login 6901 → char 6122 → map 5122
                     ┌───────────▼────────────┐
                     │   rAthena (WSL2, C++)   │  autoridade de simulação
                     │   MariaDB "gameproject" │
                     └─────────────────────────┘

                     ┌────────────────────────┐
 navegador  ──────▶  │ apps/admin (Next, 3000)│
                     └───────────┬────────────┘
                          REST (Bearer)
                     ┌───────────▼────────────┐
                     │  apps/api (Fastify,4000)│
                     └──────┬──────┬──────┬───┘
                MySQL rAthena│  Supabase│  db/import/*.yml
                (item/mob/  │ (contas, │  npc-idle/*.txt
                 login)     │  npcs,   │  (via fila de reload
                            │  mapas,  │   dentro do jogo)
                            │  config) │
```

O admin nunca fala com o rAthena diretamente: toda escrita passa pela API, que
decide o backend certo por domínio e — quando o alvo é um arquivo que o
servidor só lê ao iniciar/recarregar — enfileira um `@reload*` que um NPC
dentro do próprio jogo executa a cada 2 s.

## Como rodar

| Componente | Comando | Porta |
|---|---|---|
| rAthena (login/char/map) | `scripts/wsl-*.sh` dentro do WSL2 Ubuntu | 6901 / 6122 / 5122 |
| Gateway (Socket.IO ↔ TCP) | `pnpm --filter @ragnarok/gateway dev` (via `apps/gateway`) | 4100 |
| Cliente do jogo | `pnpm --filter @ragnarok/game dev` | 3001 |
| API | `pnpm --filter @ragnarok/api start` | 4000 |
| Admin | `pnpm --filter @ragnarok/admin dev` | 3000 |

Lista completa de comandos (setup do WSL, migração de dados, seeds) na
[tabela de comandos](#comandos) mais abaixo.

## Mapa de paths

### Raiz

| Caminho | O que é | Técnica |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` | Monorepo pnpm + Turborepo, workspaces `apps/*` `packages/*` `tools/*` | `build` depende de `^build`; `dev`/`test`/`typecheck` roteados por Turbo; TS `strict` + `noUncheckedIndexedAccess` compartilhado por todo pacote |
| `CLAUDE.md` | Contrato de arquitetura para quem edita o repo (humano ou agente) | Lista as invariantes que quebram o jogo silenciosamente se violadas (PACKETVER, limite de 30 células, etc.) |
| `docs/` | Documentação funda: `claude-context/` (9 arquivos, histórico de bugs e medições), `audit/` (matrizes admin↔rAthena, achados A1–A23), `plano-rathena.md`, `roadmap.md` | — |
| `rathena/` | Fonte upstream do rAthena, vendorizado | **Somente leitura** — nada aqui é escrito; é a referência autoritativa para todo parser/limite do repo |
| `rathena-conf/` | `conf/import/` real (entra por symlink) | Toda customização de servidor mora aqui: portas, `battle_conf.txt` (`max_walk_path: 30`), registro de mapas/NPCs |
| `rathena-db-import/` | `db/import/` real (symlink) | Alvo de escrita dos writers do admin: `skill_db.yml`, `status.yml`, `job_stats.yml`, `skill_tree.yml`, `map_cache.dat` |
| `rathena-patches/` | 2 patches C++ reais contra o rAthena vendorizado + teste + README | `0001` move o consumo de carga do Safety Wall para dentro de `battle_calc_weapon_attack` (bloqueio do Ghost Dome); `0002` adiciona a skill custom GP_BLINK (id 9000) |
| `npc-idle/` | `npc/game-project/` real (symlink) | NPCs do projeto: `panel.txt` (motor da fila de reload), `devmenu.txt` (GM), `admin-created.txt` (destino de NPCs criados pelo admin), `mobs/*.txt` (spawns) |
| `scripts/` | Scripts `wsl-*.sh` rodados dentro do WSL2 como root | Setup/build/DB/run/stop/GM do servidor rAthena |
| `supabase/migrations/` | SQL aplicado manualmente no dashboard hospedado | Backbone do banco do admin: contas, auditoria, npcs, mapas, config, skills/status com filtros gerados |
| `SFX/` | Biblioteca de áudio bruta (wav+mp3) | Fonte pré-conversão de `apps/game/public/assets/audio` |
| `Spritesheet/` | Atlas Kenney (`uipack_rpg_sheet.png` + xml) | Não usado em runtime hoje |
| `assets-new/` | **1,5 GB, gitignorado** — packs licenciados brutos (KayKit, Quaternius, Kenney, CC0 terrain, UI autoral) | Entrada de autoria para tudo em `apps/game/public/assets`; um clone novo não consegue regerar arte sem isso |
| `.claude/skills/` | 5 skills do projeto: map-format, legacy-import, r3f-conventions, network-protocol, vfx-authoring | Checklist obrigatório antes de mexer na área correspondente |

### `apps/game/src/`

Stack: React 19 + React Three Fiber 9 + drei 10 + three 0.176 + `@react-three/rapier` 2 + zustand 5 (+ zundo no editor) + Vite 6 + Vitest 3. ~430 arquivos de código, 145 arquivos de teste.

| Diretório | Papel | Técnica |
|---|---|---|
| `vfx/` | Todo efeito visual de skill/combate | Ver [Técnicas do jogo → VFX](#1-vfx-de-skill) |
| `grid/` | Terreno **quadrado** = grade real do rAthena | Chunks com orçamento de frame, heightfield por canto, texturas em array |
| `hex/` | Terreno **hexagonal** legado, ainda usado pelo editor/`/spectator` | Peça por célula derivada (nunca guardada) a partir da topologia de borda extraída do atlas |
| `props/` | Vegetação, vento, instancing | Um `InstancedMesh` por espécie, vento como uniform global único |
| `scene/` | Céu, névoa, filtro retrô, HUD de performance | Domo colorido por elevação, mesma curva de gradiente para céu e névoa |
| `net/` | Transporte, estado de mundo, predição, catálogos | Único ponto de contato com o gateway; snapshot interpolation + reconciliação; A* portado de `path.cpp` |
| `hud/` | Toda janela de UI (inventário, status, skills, chat, minimapa…) | Arte pintada skinada, réguas de "pixel de arte" |
| `ui/` | Sistema de skin, 9-slice, cursores | 9-slice construído em runtime a partir de um canto desenhado |
| `entities/` | Modelo 3D por classe/monstro, armas equipadas, petrificação | Merge de skinned mesh, âncora de ponta de arma medida |
| `audio/` | SFX, ambiente, passos, voz de combate | Pool de um `<audio>` por `src`, nunca `new Audio()` |
| `play/` | Runtime de gameplay: câmera, clique-pra-mover, mira, gatilhos de área | Quatro raios de visibilidade independentes (detalhe/entidades/horizonte/névoa) |
| `editor/` | Editor de mapas 3D (embutido via iframe no admin) | Ver [Técnicas do jogo → Editor de mapa](#9-editor-de-mapa) |
| `perf/` | Orçamentos de custo (`pnpm test:perf`) | Medição normalizada por razão, nunca ms cru |
| `core/diagnostics/` | Flight recorder + sondas | Black-box de correlação de séries temporais |
| `views/` | Raiz de cada rota (`/play`, `/editor`, `/login`, `/spectator`…) | — |
| `map/` | Fallback de mapa achatado (colisão como textura 1 texel/célula) | — |
| `combat/`, `character/` | Modo local/demo (sem servidor) | Inativo quando existe sessão rAthena real |

### `apps/admin`

Next.js 16 App Router + Tailwind v4, porta 3000.

| Caminho | O que edita | Técnica |
|---|---|---|
| `app/items`, `app/classes`, `app/skills`, `app/statuses`, `app/monsters`, `app/npcs` | Catálogos de conteúdo do jogo | Padrão uniforme: lista paginada + busca com debounce + filtro por tipo → form completo (create/edit) |
| `app/users`, `app/users/[id]`, `app/users/audit` | Contas rAthena (tabela `login`) + auditoria | Ban/unban com motivo e presets de duração; `admin_audit_log` |
| `app/config` | Taxas globais de EXP/drop + overrides por escopo | Config singleton versionado |
| `app/game-editor` | Bloco `gameplay` da mesma config singleton (escala hex, câmera, névoa, filtro retrô) | Descritores de campo com `min`/`max` espelhando o zod — impossível digitar um valor que preta a cena |
| `app/maps`, `app/maps/[id]` | Catálogo de mapas + host do editor 3D | Editor embutido em iframe, ponte autenticada por `postMessage` |
| `app/asset-scaling` | Escala padrão por asset | Iframe do próprio `apps/game`, persistido no localStorage do jogo |
| `components/ui.tsx` | Primitivos + campos inteligentes (`NumberField`, `MultiSelectField`, `CatalogPickerField`) | Valor fora do catálogo nunca é apagado — vira chip âmbar |
| `components/*Form.tsx` (Item, Skill, Monster, Npc, JobClass, Status) | Um form por domínio | Cobertura total dos campos reais do rAthena |
| `lib/api.ts` | Cliente REST único | Anexa Bearer do Supabase, decodifica erros de recusa do writer em mensagem humana |
| `lib/field-limits.ts` | Limites numéricos de UI | Cada entrada cita `arquivo:linha` do loader C++ real de origem |

### `apps/api`

Fastify 5 + zod, porta 4000.

| Caminho | Papel | Técnica |
|---|---|---|
| `src/routes/*.ts` | Um arquivo por domínio (items, skills, statuses, monsters, npcs, job-classes, maps, users, server-config, server-control) | REST convencional; mutações exigem `group_level >= 10` |
| `src/store/*-repository.ts` | Uma interface por domínio | [Técnicas do painel admin → repositório](#1-abstração-de-repositório--precedência-de-backend) |
| `src/store/{json,supabase,mysql,yaml}-*-repository.ts` | 4 implementações intercambiáveis por domínio | Rota e UI nunca mudam quando o backend troca |
| `src/store/job-database-writer.ts` | Escreve `job_stats.yml` + `skill_tree.yml` | Validação → round-trip/diff → backup → escrita atômica dos dois arquivos → fila de reload |
| `src/store/monster-spawn-writer.ts` | Sincroniza `Monster.spawns[]` com `npc-idle/mobs/<mapa>.txt` | Identidade por marcador `// spawnId:`, nunca número de linha |
| `src/store/npc-script-locate.ts` + `npc-script-sync.ts` + `npc-script-create.ts` | Escrita de NPC em `.txt` real | Localização por brace-matching balanceado; recusa arquivo CRLF em vez de normalizar |
| `src/auth/security.ts`, `src/auth/guard.ts` | Auth admin | Supabase `auth.getUser` → `accounts.group_level`, cache de token de 60 s |
| `src/audit/log.ts`, `src/audit/diff.ts` | Trilha de auditoria | Só grava depois que a persistência deu certo; diff por conjunto (reordenar array não conta como mudança) |
| `src/scripts/seed-*.ts` | Upsert direto no Supabase (service-role) | Só para carga inicial — rodar de novo sobrescreve edição manual |

### `apps/gateway`

Socket.IO ↔ TCP, porta 4100.

| Caminho | Papel |
|---|---|
| `src/protocol.ts` | O único contrato JSON que o browser vê — nenhum opcode binário escapa daqui |
| `src/ro/session.ts` | Máquina de estado da sessão: 3 conexões TCP sequenciais (login → char → map) + todos os comandos (mover, atacar, usar skill, hotkeys…) |
| `src/ro/entity-kind.ts`, `src/ro/stat-names.ts` | Tradução de enums binários do rAthena para nomes legíveis |
| `src/server.ts` | Um `RoSession` por socket do browser; converte exceções em `session:closed` |

### `packages/`

| Pacote | Expõe | Técnica |
|---|---|---|
| `ro-protocol` | Codec binário RO + `RoConnection` | **GPL-3.0** (portado do roBrowserLegacy) — qualquer código que linka herda a licença |
| `game-data` | Schemas zod de todo domínio + `src/rathena/` (parsers/writers do formato oficial YAML/`.txt`) | Pipeline de NPC: Lexer → Parser → Mapper → Validator → Writer, com posição de byte preservada para reconstrução |
| `map-format` | Schema `GameMap` (heightmap, colisão, água, props, spawns) | Fonte de verdade em `.claude/skills/skill-map-format` |
| `engine-core` | Movimento puro (grid/free) | Fórmulas de combate foram deletadas de propósito — o servidor calcula dano |

### `tools/legacy-migration`

Parsers offline que leem `rathena/db/re/**` e `rathena/npc/**` e escrevem `output/*.json` validado por zod. Regra: nunca chutar (fórmula incerta → `needsReview`), nunca descartar (script não mapeado → `unmappedEffects`).

| Script | Produz |
|---|---|
| `migrate:items` | 29.356 itens |
| `migrate:jobs` | 175 classes |
| `migrate:statuses` | 1.020 status |
| `migrate:skills` | 1.635 skills |
| `migrate:monsters` | 2.675 monstros (1.351 com spawn, 190 MVP) |
| `migrate:npcs` | 24.133 NPCs de 683 arquivos |
| `migrate:maps` | `.json` por mapa a partir de `map_cache.dat` |
| `export:mapcache` | Viagem de volta: mapa 3D editado → `map_cache.dat` real (exige reiniciar o rAthena) |

## Assets — inventário completo

### Onde a arte mora

| Caminho | Tamanho | Git | Papel |
|---|---|---|---|
| `apps/game/public/assets` | 114 MB, 1128 arquivos | versionado | **Único root de asset em runtime** do cliente |
| `apps/game/public/ui` | 40 KB | versionado | Kit de UI genérico legado (12 png) |
| `apps/admin/public/assets` | 452 KB | versionado | Espelho de ícones (items + skills) — a API escreve nos dois roots ao subir um ícone |
| `assets-new/` | **1,5 GB** | **gitignorado** | Packs-fonte licenciados brutos — entrada de autoria |
| `SFX/` | 74 MB | versionado | Biblioteca de áudio bruta, fonte de `assets/audio` |
| `Spritesheet/` | 40 KB | versionado | Atlas Kenney não usado hoje |

Totais em `apps/game/public`: 361 `.png` · 347 `.gltf` + 347 `.bin` (pares) · 58 `.mp3` · 12 `.glb` · 6 `.gif` · 2 `.json`.

### Modelos 3D

| Diretório | Conteúdo |
|---|---|
| `assets/characters/` | 8 `.glb` (Knight, Mage, Ranger, Rogue, Rogue_Hooded, Barbarian, Skeleton_Warrior, Skeleton_Minion) + `Knight_Mixamo.gltf` gerado |
| `assets/animations/` | 4 `.glb` de clipes (`Rig_Medium_General/MovementBasic/CombatMelee/CombatRanged`) — casam por nome de osso com qualquer personagem no rig compartilhado `Rig_Medium` |
| `assets/weapons/` | 5 `.gltf`+`.bin` (bow, dagger, staff, sword_2handed) |
| `assets/nature/` | 57 MB — **maior diretório do repo** — 68 `.gltf`, pack tipo Quaternius, vegetação ativa no editor |
| `assets/props/` | 105 `.gltf`, KayKit Forest/Nature — **desativado** no registry (`hidden`) |
| `assets/hex/**` (base, coast, rivers, roads, buildings) | 187 `.gltf` no total, KayKit Medieval Hexagon; `buildings/` sozinho tem 93 (uma peça por cor de time) |

### Texturas

`assets/terrain/` — 25 PNG + `manifest.json`, **geradas** por `terrain:textures` a partir de `assets-new/terrain-cc0` (fotos CC0 Poly Haven/ambientCG) · `assets/terrain/thumb/` — 26 miniaturas para a paleta do editor · `assets/sky/` — 5 panoramas equiretangulares (dia/manhã/noite/alien/espaço) · `assets/particles/` — 6 texturas de partícula genérica.

### VFX / sprites de skill

`assets/skill_effects/mage/cold_bolt/` — 6 `.gif` · `.../fire_ball/` — 2 PNG de sprite-sheet · `.../light_bolt/` — `lightning-sheet.png` + `lightning-sheet.json` (**o único atlas real em uso** no jogo hoje).

### Skin de UI (`assets/ui/`, ~4,4 MB, 16 pastas)

| Pasta | PNG | Janela |
|---|---|---|
| `travelbook/` | 72 | Kit pixel-art genérico (Crusenho TravelBookLite) — base de quase toda a UI |
| `login/`, `login2/` | 15+jpg, 11 | Tela de login/seleção de personagem |
| `chat/` | 15 | Janela de chat (4 cantos distintos, nunca `border-image`) |
| `skills/` | 11 | Livro de skills |
| `status/` | 11 | Janela de status + 10 ícones de slot de equipamento |
| `cursor/` | 10 | Cursores (passam por canvas antes de virar CSS) |
| `minimap/`, `tools/` | 7, 7 | Minimapa, barra de ferramentas |
| `skillbar/` | 6 | Barra de habilidades |
| `character-frame/` | 4 | Fonte do 9-slice da plaquinha de HP/SP |
| `bag/` | 3 | Inventário |
| `map/`, `quest/`, `friends/`, `character-create/` | 2, 1, 1, 1 | — |

Fonte autoral (gitignorada): `assets-new/ui_definitiva/` — 237 PNG organizados por janela.

### Ícones de dado

`assets/skills/` — 21 PNG, nome pt-BR (`bola-de-fogo.png`) · `assets/debuffs/` — 29 PNG, nome pt-BR acentuado (`Envenenamento Mortal.png`) · `assets/elements/` — 10 · `assets/races/` — 11 · `assets/monster-size/` — 3 · `assets/items/` — nome = **id do item**, subido em runtime pelo endpoint de upload e escrito nos dois public roots (game + admin).

### Áudio (`assets/audio/`, 58 `.mp3`)

Música e ambiente (1 cada) · passos por superfície (6) · item (3) · voz + arma por classe (swordman/mage/archer) · 11 pastas de skill de mago (cold-bolt, fire-bolt, light-bolt, fire-ball, fire-wall, frost-diver, stone-curse, thunder-storm, ghost-dome, oracle, soul-strike).

### Fontes

Nenhuma. Toda tipografia é stack de sistema — não há `.ttf`/`.woff`/`@font-face` no repo.

### Gerado vs. autoral

| Script | Lê | Escreve |
|---|---|---|
| `pnpm --filter @ragnarok/game terrain:textures` | `assets-new/terrain-cc0/**` | `public/assets/terrain/*.png` + `manifest.json` |
| `pnpm --filter @ragnarok/game props:measure` | glTF de props/nature/hex | Os 4 catálogos JSON em `src/props/` (reescreve `radius`/`hull`/`spread` medidos) |
| `pnpm --filter @ragnarok/game tiles:measure` | glTF de `assets/hex` | `src/hex/tile-heightfields.json` |
| `pnpm --filter @ragnarok/game chars:knight-mixamo` | `assets-new/characters-test/**` | `public/assets/characters/Knight_Mixamo.*` |
| Upload de ícone da API | multipart do admin | `apps/game/public/assets/{items,skills}` + espelho em `apps/admin/public/assets` |

Tudo o mais em `public/assets` foi copiado à mão de `assets-new/`.

### Catálogos que ligam asset ↔ dado

`nature-catalog.json` (68 entradas), `forest-catalog.json` (105, escondido), `hex-tiles-catalog.json` (132), `hex-decor-catalog.json` (30), `tile-heightfields.json`, `terrain/manifest.json`, `lightning-sheet.json`. Cada entrada de prop carrega `{id, file, cat, label, defaultScale, radius, hull, spread}` — `radius`/`hull`/`spread` são **medidos** do glTF por `props:measure`, nunca escritos à mão.

### Avisos

- `assets-new/` (1,5 GB), `rathena/` (105 MB) e `tools/legacy-migration/output/` (~180 MB) são **gitignorados** — um clone novo não consegue regerar arte nem re-rodar migração sem obtê-los separadamente.
- Ícones subidos pelo admin (`items/909.png`, `skills/9000.png`) não são versionados por padrão.
- Nomes de pasta de ícone em pt-BR com acento e espaço (`Envenenamento Mortal.png`) são frágeis para URL e para deploy case-sensitive.

## Técnicas do jogo

### 1. VFX de skill

Toda skill registra sua visual sob um **ID estável** via `defineVfx` — a mesma
chamada registra ou substitui, o que permite alternar DOM↔GPU em runtime sem
tocar em quem consome. **GPU é o padrão de produção** nas 11 skills
DOM-pesadas (Fire Ball, Oracle, Cold Bolt, Fire Wall, Thunder Storm, Soul
Strike, Fire Lance, Light Bolt, Frost Diver, Stone Curse, Ghost Dome); DOM
continua disponível como alternância de desenvolvimento.

Sete renderers cobrem toda a superfície de efeito: Sprite, Particle, Beam,
Ring, Trail e Cage compartilham uma base de **billboard instanciado** — um
único `InstancedMesh`, orientação calculada no vertex shader a partir da
matriz de câmera, atributos por instância (offset/escala/rotação/cor), e
slots mortos marcados com escala 0 e reaproveitados em vez de compactados
(a capacidade dobra quando falta espaço). O sétimo, DOM, existe para o que
ainda não migrou: uma única raiz React reaproveitada para N instâncias, nunca
uma por efeito.

O movimento de cada skill (voo em curva, órbita, queda, flicker) vem de
helpers **puros e opt-in via payload** — nenhum renderer tem `if <nome da
skill>` no meio. Três mecanismos de throttling ficam deliberadamente
separados porque respondem perguntas diferentes: frustum culling decide
desenhar ou não, LOD por distância decide o nível de detalhe, e um budget por
prioridade decide quem é sacrificado sob pressão (própria > perto > longe >
mob-longe). Coalescing agrupa múltiplos pulsos num único efeito visual
(Thunder Storm = 1 raio, N pulsos). Âncoras resolvem "onde no mundo": célula,
entidade, ponta da arma (medida por asset) ou caster→alvo. Pooling e cache de
textura por contagem de referência evitam realocar a cada cast.

### 2. Terreno

O mapa 3D é o mapa **inteiro** do rAthena, fatiado em chunks (400×400 células
= 169 chunks de 13×13) construídos sob um **orçamento de 6 ms por quadro** —
número escolhido para caber dentro dos 16,6 ms de um quadro a 60 FPS mesmo
somando outro trabalho no mesmo frame. A altura vive no **canto** de cada
célula (média de até 4 células vizinhas), não no centro — isso transforma
degraus tipo Minecraft numa superfície contínua. As texturas de superfície
usam `DataArrayTexture` (uma camada por tipo), deliberadamente **não** um
atlas: UV em espaço de mundo tileia infinitamente, e o `fract()` de um atlas
quebraria as derivadas de UV nas bordas de cada tile. Além do raio de
detalhe, uma malha de horizonte **decimada** cobre o resto do mapa sem
precisar de culling, e árvores distantes viram **impostores** — billboards
texturizados *bakeados* offscreen a partir do modelo 3D real. Céu, névoa e
água compartilham a mesma curva de gradiente por elevação, para o horizonte
nunca destoar do chão.

### 3. Vegetação e vento

Cada espécie de planta vira **um `InstancedMesh`** (a alternativa — um Mesh
por prop — chegava a ~1800 draw calls num mapa comum). Um único uniform
global de vento, avançado por um `useFrame` central, desloca vértices via
`onBeforeCompile` em todo material clonado que participa. Vegetação perto do
jogador ou no corredor câmera→jogador some por fade de shader, não por
esconder o objeto. Bloqueio de props nunca é corpo de física — é um índice
espacial em hash-grid consultado pela mesma malha de terreno.

### 4. Netcode

O cliente prediz o próprio movimento e reconcilia contra o servidor através
de uma fila de pedidos pendentes; entidades remotas usam **interpolação de
snapshots** com atraso fixo de renderização. O pathfinder do cliente é um
**A\* portado byte a byte de `path.cpp`** do rAthena, para as duas pontas
concordarem sobre o que é alcançável — nunca se emite um pedido de
movimento para uma célula que o próprio A\* do cliente já sabe inatingível.
O servidor aceita no máximo **30 células por pedido de caminhada**
(`battle_config.max_walk_path`, `rathena-conf/battle_conf.txt:17`) e descarta
em silêncio acima disso; o mesmo número está copiado no cliente
(`MAX_WALK_PATH_DEFAULT`, `apps/game/src/net/pathfind.ts:46`) — mudar um lado
sem o outro é uma falha muda. Cliques dentro de uma janela de 200 ms coalescem
num único pedido, e o mais novo sempre vence. A posição é contínua: o
servidor é dono da **célula**, o cliente é dono do **deslocamento dentro
dela** (sub-célula); só um teleporte de verdade encaixa no centro exato.
Conjurando não anda — um clique durante o cast é descartado, nunca guardado
para depois. Uma bancada de ping simulado injeta latência artificial de
propósito, porque o servidor local no WSL responde perto de 0 ms e sem isso
predição/reconciliação nunca seriam exercitadas de verdade.

### 5. Ordens de combate

Atacar, pegar item e lançar skill com aproximação são todas ordens de
**vários quadros no cliente**, porque o rAthena recusa a ação fora de
alcance e não persegue automaticamente por um jogador — o cliente precisa
andar até o alcance e então reemitir a ordem sozinho. Mira inteligente conta
um clique perto de um alvo como clique nele; TAB cicla alvos sem nunca
atacar sozinho.

### 6. UI / HUD

Cada moldura 9-slice é construída em **runtime a partir de um único canto
desenhado** — os outros três nascem por espelhamento, então a arte só
precisa fornecer 1/4 de cada peça. Toda janela usa uma régua de "pixel de
arte" com uma única constante que reescala texto e posição juntos. Duas
famílias de arte convivem com regras opostas: pixel-art (TravelBookLite)
exige escala inteira + `image-rendering: pixelated`; arte pintada (moldura de
personagem, quest, minimapa) é o oposto — escala fracionária com
interpolação suave. Barras de HP/SP no mundo 3D usam o mesmo frame de HUD
virado textura de canvas, porque não existe CSS dentro da cena 3D. Cursores
também passam por canvas antes de virar CSS. Todos os timers de status
compartilham um único `requestAnimationFrame`, em vez de um por ícone.

### 7. Áudio

Cada som é um único `<audio>` reaproveitado para sempre — nunca `new
Audio()` por disparo — permitindo que sons diferentes toquem sobrepostos
sem que o mesmo som duplique. Duas categorias de volume (música/efeitos) são
lidas ao vivo, sem precisar recarregar. O som de passo é escolhido pela
mesma precedência de superfície que decide a cor do chão, então nunca
diverge visualmente do que se ouve.

### 8. Diagnóstico e performance

Um flight recorder (`__voo`, tecla F9) correlaciona múltiplas séries
temporais numa única linha do tempo para investigar engasgo de frame ou
memória. Sondas dedicadas cobrem renderer/WebGL, árvore de cena, atribuição
de VFX (qual skill, qual instância, início/fim) e carregamento de asset. Um
censo de recursos confere se objetos idênticos realmente compartilham
geometria/textura únicas. A flag `?iso=chave1,chave2` desliga subsistemas
individualmente sem recompilar. Os orçamentos de custo em `src/perf/` medem
em **razão contra uma calibração**, nunca milissegundo cru — porque
milissegundo é propriedade da máquina, não do código — e rodam junto da
suíte de teste normal.

### 9. Editor de mapa

O editor opera sobre duas grades (quadrada real / hexagonal legada) com um
escopo de edição global — Dentro / Borda / Buraco / Tudo — que toda
ferramenta nova (pincel, scatter, prefab) precisa respeitar. Blocos
impassáveis são classificados pelo **formato** do blob, já que o
`map_cache` só diz "bloqueado", nunca por quê. Arrastos rápidos usam
Bresenham para nunca pular célula. Miniaturas de prop vêm de um único
renderer offscreen compartilhado, com cache por hash. A edição só chega ao
servidor de verdade com `export:mapcache` seguido de reiniciar o rAthena —
editar no editor 3D sozinho não muda a colisão que o servidor usa.

## Técnicas do painel admin

### 1. Abstração de repositório + precedência de backend

Cada domínio (itens, skills, monstros, npcs, mapas…) tem **uma interface**
(`list/get/create/update/remove`) e até quatro implementações
intercambiáveis — MySQL do rAthena, Supabase, JSON local, ou um wrapper YAML.
A escolha de backend por domínio segue uma regra fixa: "o banco do rAthena
ganha porque é o que o jogo lê" para itens/monstros/contas; skills/status/
classes vivem no Supabase mas, quando o MySQL está configurado, ganham um
wrapper que também escreve o YAML de override real. Rota e componente de UI
nunca mudam quando o backend por trás troca.

### 2. Dois bancos, dois papéis

Conteúdo que o jogo lê ao vivo mora no MariaDB do próprio rAthena
(`item_db_re`, `mob_db_re`, `login`). Identidade de admin, auditoria e
conteúdo autoral (mapas, npcs, catálogos, configuração) mora no Supabase
hospedado. Tabelas auxiliares (`panel_item_icon`, `panel_account_ban`,
`panel_reload_queue`) são criadas sob demanda para nunca sujar o schema
original do rAthena.

### 3. Fila de reload

Não existe porta de administração no rAthena. Toda escrita que precisa
recarregar o servidor insere uma linha em `panel_reload_queue`; um NPC
(`panel.txt`) dentro do próprio jogo lê até 5 pendências a cada 2 s e executa
uma lista **fechada** de comandos `@reload*`. Uma falha na fila nunca desfaz
a escrita já persistida — só deixa o servidor rodando desatualizado até o
próximo reload manual ou automático.

### 4. Nunca editar upstream

Nada dentro de `rathena/` é escrito por nenhum writer. Toda customização
chega ao servidor por três symlinks que apontam de volta para o repositório:
`conf/import` → `rathena-conf/`, `db/import` → `rathena-db-import/`,
`npc/game-project` → `npc-idle/`.

### 5. Disciplina de writer

Todo writer segue a mesma sequência: Parser → Mapper → Validator → Writer,
com validação estrutural **e** cruzada entre entidades, round-trip e diff
provados antes de qualquer gravação real, backup do arquivo anterior, escrita
atômica tudo-ou-nada (temp + rename, nunca dois arquivos meio escritos), e um
`rollback()` exposto para quem chama desfazer se a etapa seguinte falhar.
Identidade de linha é sempre um marcador estável gravado no próprio arquivo
(`// spawnId:<id>`), nunca um número de linha — que já causou drift em versão
anterior do sistema.

### 6. Nunca chutar, nunca descartar

Script de NPC não reconhecido vira `legacyScript` em vez de ser reescrito;
efeito de item não mapeado vai para `unmappedEffects[]`; fórmula incerta na
migração ganha `needsReview: true`. Na UI, um valor salvo que não existe mais
no catálogo atual nunca é apagado silenciosamente — aparece como chip âmbar
"(fora do catálogo)" e é preservado ao salvar. Todo limite numérico de campo
cita o `arquivo:linha` exato do loader C++ de onde veio.

### 7. Autenticação

O browser autentica com a chave anônima do Supabase e guarda um access
token; toda chamada da API carrega esse token como Bearer; o Fastify resolve
a identidade via `auth.getUser` → linha em `accounts` → exige
`group_level >= 10`, com cache de token de 60 s para não pagar esse
round-trip a cada requisição de CRUD. Auditoria é gravada só depois que a
mutação já persistiu.

### 8. Editor de mapa embutido

`/maps/[id]` hospeda o editor 3D do próprio `apps/game` dentro de um iframe
autenticado; a página troca mensagens `postMessage` com ele para salvar. As
duas pontas reusam as mesmas funções de `packages/map-format`
(`resizeGameMap`, `objetosForaDosLimites`) para o admin e o editor 3D nunca
divergirem sobre o que sai fora dos limites ao redimensionar um mapa.

## Protocolo e servidor

- **O binário morre no gateway** — `apps/gateway/src/protocol.ts` é o único
  contrato que o navegador vê; nenhum opcode bruto do rAthena cruza o
  Socket.IO.
- **PACKETVER 20130618** precisa bater exatamente entre `scripts/wsl-build.sh`
  e `initProtocol()` do gateway (`apps/gateway/src/config.ts:13`); pacote da
  versão errada faz o char-server derrubar a conexão sem aviso.
- Sessão é sequência de **3 conexões TCP**: login (6901) entrega
  AuthCode/AID → char (6122) entrega GID + endereço do map-server → map
  (5122) abre o mundo.
- Hotkeys usam **38 slots reais** (`MAX_HOTKEYS`), persistidos pelo próprio
  char-server (`HOTKEY_SAVING`) — a UI mostra só 27, os 38 ficam
  sincronizados por baixo.
- `packages/ro-protocol` é **GPL-3.0** (portado do roBrowserLegacy) —
  qualquer código que linka com ele herda a licença.

## Comandos

```bash
# --- servidor rAthena (WSL2 Ubuntu, root) ---
wsl -d Ubuntu -u root bash scripts/wsl-setup.sh        # rsync + symlinks (1x)
wsl -d Ubuntu -u root bash scripts/wsl-db.sh            # cria banco + schema (1x)
wsl -d Ubuntu -u root bash scripts/wsl-db-content.sh    # importa item_db_re/mob_db_re (1x)
wsl -d Ubuntu -u root bash scripts/wsl-build.sh         # compila (packetver 20130618)
wsl -d Ubuntu -u root bash scripts/wsl-run.sh           # sobe login/char/map
wsl -d Ubuntu -u root bash scripts/wsl-stop.sh          # derruba só os deste projeto
wsl -d Ubuntu -u root bash scripts/wsl-gm.sh <account_id>  # vira GM

# --- workspace ---
pnpm install
pnpm -r typecheck
pnpm --filter @ragnarok/game dev            # localhost:3001
pnpm --filter @ragnarok/admin dev           # localhost:3000
pnpm --filter @ragnarok/api start           # localhost:4000
pnpm --filter @ragnarok/game test:perf      # orçamentos de custo

# --- migração de dados legados (tools/legacy-migration) ---
pnpm --filter @ragnarok/legacy-migration migrate:items
pnpm --filter @ragnarok/legacy-migration migrate:maps -- --cache base --only <mapa>

# --- seed inicial (sobrescreve edição manual — só carga inicial) ---
pnpm --filter @ragnarok/api seed:items
pnpm --filter @ragnarok/api create:admin <email> <senha>
```

Lista completa e sempre atual de comandos no [`CLAUDE.md`](CLAUDE.md#comandos)
da raiz.

## Onde aprofundar

| Arquivo | Cobre |
|---|---|
| [`docs/claude-context/01-rathena-connection-and-world-sync.md`](docs/claude-context/01-rathena-connection-and-world-sync.md) | WSL2/portas/PACKETVER, fluxo de sessão, A* do cliente, limite de 30 células |
| [`02-terrain-rendering.md`](docs/claude-context/02-terrain-rendering.md) | Chunking, textura de terreno, água, altura, orçamento de chunk |
| [`03-ui-system-and-hud.md`](docs/claude-context/03-ui-system-and-hud.md) | Sistema de skin pintado completo, hotkeys, sessão |
| [`04-netcode-prediction-reconciliation.md`](docs/claude-context/04-netcode-prediction-reconciliation.md) | Predição, reconciliação, interpolação, sub-célula |
| [`05-diagnostics-flight-recorder.md`](docs/claude-context/05-diagnostics-flight-recorder.md) | Flight recorder, sondas, auditoria de asset |
| [`06-combat-orders-and-edge-cases.md`](docs/claude-context/06-combat-orders-and-edge-cases.md) | As três ordens de vários quadros, colisão cliente×servidor |
| [`07-map-editor.md`](docs/claude-context/07-map-editor.md) | Grades, escopo de edição, pincéis, `export:mapcache` |
| [`08-data-database-config-and-hex-legacy.md`](docs/claude-context/08-data-database-config-and-hex-legacy.md) | Banco MySQL, fila de reload, Supabase, regras de migração |
| [`09-vfx-gpu-migration.md`](docs/claude-context/09-vfx-gpu-migration.md) | VFX Core, os 5+ renderers GPU, limites calibrados |
| [`docs/audit/`](docs/audit/README.md) | Matrizes campo-a-campo admin ↔ rAthena, achados de risco |
| `.claude/skills/skill-vfx-authoring` | Checklist obrigatório antes de criar VFX de skill nova |
| `.claude/skills/skill-map-format` | Fonte de verdade do schema `GameMap` |
| `.claude/skills/skill-network-protocol` | Regras de enquadramento de pacote binário |

## Licenças e créditos de asset

- **KayKit** (Characters, Skeletons, Weapons, Medieval Hexagon, Character
  Animations, Forest/Nature) — modelos 3D e animações.
- **Quaternius** — vegetação ativa (`assets/nature`).
- **Kenney** — skyboxes, particle pack.
- **Crusenho** (`Complete UI Book Styles Pack Free v1.0` / TravelBookLite) —
  base pixel-art de quase toda a UI; licença em
  `apps/game/public/assets/ui/travelbook/LICENSE-crusenho.txt`.
- **Poly Haven / ambientCG** (CC0) — fotos de terreno em `assets-new/terrain-cc0`,
  fonte das texturas geradas de chão.
- **`packages/ro-protocol`** — GPL-3.0, portado do roBrowserLegacy; ver
  `packages/ro-protocol/README.md`.
