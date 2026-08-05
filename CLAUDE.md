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

## Decisões e estado

- **Servidor rAthena roda em WSL2 nativo, NÃO em Docker** (Docker é que não
  funciona nesta máquina — o WSL funciona e o idle-narok já provou). Árvore
  compilada em `~/game-project/rathena` (ext4; build em `/mnt/c` é lento
  demais), com `conf/import` e `npc/game-project` como **symlinks de volta**
  para `rathena-conf/` e `npc-idle/` no repo — editar no Windows vale na hora
  (`@reloadscript`), e nada dentro de `rathena/` é tocado.
- **Portas e banco separados do idle-narok**: login **6901** / char **6122** /
  map **5122**, banco MariaDB **`gameproject`** (o idle-narok ocupa
  6900/6121/5121 e o banco `ragnarok`). Os dois projetos convivem no mesmo WSL;
  `wsl-run.sh`/`wsl-stop.sh` filtram processo pelo **cwd**, porque o nome
  (`map-server`) é idêntico nos dois.
- **PACKETVER 20130618** (`scripts/wsl-build.sh`) — tem que bater com o
  `initProtocol()` do gateway. Nessa faixa o rAthena ofusca pacote, daí
  `rathena/src/custom/defines_pre.hpp` zerar `PACKET_OBFUSCATION_KEY1/2/3` e o
  codec rodar com `packetKeys: false`.
- **`packages/ro-protocol` é GPL-3.0** (cópia do roBrowserLegacy em
  `src/vendor/**`, adaptada só no necessário para Node: aliases → relativo,
  `window`/`self` → `globalThis`, sem UIManager). Quem linka herda a licença.
  Sem singleton de socket: uma `RoConnection` por sessão, enquadramento
  reescrito por conexão (`src/stream.js`).
- **Fluxo de sessão**: navegador → Socket.IO (`apps/gateway`, 4100) → 3 conexões
  TCP em sequência (login → char → map). Contrato JSON em
  `apps/gateway/src/protocol.ts`; no cliente, `apps/game/src/net/` (gateway.ts =
  socket, sessionStore = conta/personagem, worldStore = entidades). Rotas novas
  `/login` e `/char-select`; conta nova pelo sufixo `_M`/`_F`, como no RO.
- **Pacote certo é por PACKETVER, não "o mais novo"**: criar personagem é 0xa39
  (≥2015), 0x970 (≥2012-03-07) ou 0x67 — o char-server só aceita o formato do
  `#if` com que foi compilado (`rathena/src/common/packets.hpp:120-155`) e
  derruba a conexão calado se vier outro. Mesma regra em apagar (0x1fb vs 0x68).
  Depois de criar, o char-server NÃO reenvia a lista: quem traz o personagem
  novo é o próprio 0x6d.
- **Mundo é do servidor**: com sessão ativa, `/play` desenha o que vem em
  `entity:spawn/move/stop/vanish` e pede movimento com `move:to`
  (CZ.REQUEST_MOVE) — nada de IA, dano ou colisão no cliente. O modo local
  (demo/preview/editor) continua existindo para o editor de mapas.
- **Duas grades, uma interface** (`apps/game/src/grid/`): `gridFor(map)` devolve
  o `WorldGrid` do mapa e é ele que converte célula↔mundo, escolhe a lattice do
  movimento, a TerrainQuery e a extensão do mundo. `terrainMode` decide:
  `"square"` = mapa do rAthena (célula de 2 unidades, isotrópica), `"blocks"` =
  hexágonos do editor, `"smooth"` = plano legado. Antes isso era um
  `map.terrainMode === "blocks"` repetido em treze lugares — e dois deles
  (culling de props e névoa) valiam só para o hex, sem ninguém perceber.
- **A grade quadrada NÃO passa por `hexScale`**: tamanho fixo de 2,0 unidades
  por célula (`grid/squareGrid.ts`). Com `hexScale: 10` um mapa 400×400 viraria
  8.000 unidades de lado — além do `camera.far` — e desafinaria câmera, névoa e
  alcance de uma vez. `setHexScale` só é chamado em mapa de bloco.
- **O cliente refaz o CAMINHO do servidor** (`net/pathfind.ts`, A* portado de
  `rathena/src/map/path.cpp`): o pacote de movimento traz só as duas pontas do
  trecho, e interpolar em linha reta atravessava parede — o personagem subia no
  bloco e reaparecia do outro lado. Custo 10 reto / 14 diagonal, heurística
  Manhattan×10, e diagonal SÓ quando os dois ortogonais estão livres (`chk_dir`),
  que é o que impede cortar quina. O próprio rAthena explica por quê
  (path.cpp:337): *"Easy pathfinding cuts corners of non-walkable cells, but
  client always walks around it"*. A duração vem do custo real (diagonal 40%
  mais lenta, unit.cpp:229), não de Chebyshev.
- **O servidor só aceita 17 células por pedido de caminhada**
  (`battle_config.max_walk_path`, `conf/battle/client.conf:42`, conferido em
  unit.cpp:860) — acima disso ele descarta EM SILÊNCIO, e era isso o "clique
  não tem alcance". `MAX_WALKPATH` (32) é outro limite, o teto absoluto do
  caminho. O cliente pede em trechos de 16 e encadeia (medido: 55 células em 4
  pedidos).
  - **`max_walk_path` subiu para 30** (`rathena-conf/battle_conf.txt`; o teto do
    rAthena é `MAX_WALKPATH` = 32, validado em battle.cpp:8684). Menos ida e
    volta por caminhada longa. **O número é COPIADO no cliente**
    (`net/pathfind.ts: MAX_WALK_PATH_DEFAULT`) e os dois lados têm de bater:
    acima do limite o map-server descarta o pedido EM SILÊNCIO, então divergir é
    uma falha muda.
  - **UMA janela de 200 ms para clique e emenda** (`net/filaDePedidos`):
    spammar clique (alternando diagonais) fazia o personagem "voltar" para uma
    célula clicada segundos antes. A causa está no rAthena e é o cliente que a
    dispara — `clif_parse_WalkToXY` chama `unit_walktoxy(..., flag 4)`, e lá
    (unit.cpp:876) o pedido que chega enquanto o personagem não pode mover NÃO é
    recusado: vira `add_timer(..., unit_delay_walktoxy_timer, x<<16|y)`, ou seja,
    o servidor AGENDA aquela caminhada com aquele destino para até 2 s depois.
    Cada clique do spam vira um timer próprio, e eles disparam em ordem. O
    clique era o único caminho nosso sem o intervalo que o próprio código já
    documentava (o roBrowser limita a 200 ms).
    - **A janela é TRAILING, não descarte**: com a janela fechada o pedido fica
      PENDENTE e o clique novo substitui o pendente — o alvo que sai quando ela
      abre é sempre o ÚLTIMO. Descartando, o clique mais provável de cair seria
      justamente o último do spam, que é o que o jogador quis.
    - Houve um `reservar`/`imediato` que DESCARTAVA em vez de guardar, para o
      WASD (a tecla é reavaliada no quadro seguinte, e um pendente de 200 ms
      atrás mandaria o personagem para uma direção já largada). Saiu com ele —
      ver "O WASD foi REMOVIDO" abaixo.
  - **A emenda sai ANTES de chegar** (`EMENDA_CELULAS` = 3): pedir o trecho
    seguinte só depois de PARAR fazia o personagem estacar a cada 16 células e
    esperar a ida e volta do pacote, com mais 200 ms de intervalo mínimo por
    cima — uma parada visível a cada três passos, que é o que se sentia como
    "o clique não tem alcance". Emendando a três células do fim, a caminhada
    longa não tem costura.
  - **O clique vale até a borda da NÉVOA** (`limitarAlcance`, teto =
    `gameplay.fogFar / cellSize`): o plano de clique cobre o mapa INTEIRO, então
    mirar perto do horizonte podia pedir uma célula a 75+ de distância (medido no
    navegador). Ali o A* varre um pedaço enorme do mapa e, se aquele ponto
    estiver cercado, devolve `null` e o clique não faz NADA. Encurtar na mesma
    direção é melhor que ignorar — o jogador clicou para aquele lado, então anda
    para aquele lado até onde enxerga, e o encadeamento continua dali.
- **Redirecionar no meio do caminho parte da posição VISUAL**: o pacote novo traz
  a célula em que o servidor acha que o personagem está, atrás de onde ele é
  desenhado; recomeçar dali dava a "travadinha" ao clicar de novo à frente.
  Medido: maior salto entre frames 0,275 célula (o passo normal).
  - **E o CAMINHO tem de sair da mesma origem que o desenho** (`selfMove`/`move`
    em `net/worldStore`): a posição recomeçava na célula visual — certo — mas o
    A* era refeito a partir da célula do SERVIDOR. Como o `interpolatedCell` usa
    `x,y` como início do primeiro passo e `path[0]` como fim dele, o primeiro
    passo ia da posição visual para uma célula ATRÁS dela: o personagem andava
    de ré e só então seguia, com a duração medida sobre um caminho maior que o
    trecho restante. Era metade do "spammo clique de um lado para o outro e ele
    trava / se arrasta / fica parado e depois anda".
  - **Sem caminho, o `buildMotion` tem de ZERAR o anterior**: quem chama faz
    `{ ...entidade, ...buildMotion(...) }`, e um retorno só com `durationMs`
    deixava passar o `path` da jogada ANTERIOR — o personagem seguia a rota
    velha com destino novo, "escorregando" até o tempo acabar. É a outra metade.
    `path: undefined, stepEnds: undefined` explícitos.
  - Os dois estão travados em `net/redirecionamento.test.ts` (conferido: 3 dos 4
    casos REPROVAM sem a correção). Redirecionar no meio do caminho é o caso
    COMUM — clique novo e, desde a emenda automática, a cada 16 células.
- **Teleporte no mesmo mapa vem como `ZC_NPCACK_MAPMOVE`**: `pc_setpos`
  (pc.cpp:7118) usa o mesmo pacote de troca de mapa quando o destino é o mapa
  atual — `@jump`, warp de NPC e Asa de Borboleta caem aí. Tratar só como "mapa
  novo" deixava o personagem desenhado na célula velha; o gateway agora também
  emite `self:warp` quando o mapa não mudou.
- **Célula fracionária exige conversão CONTÍNUA**: `interpolatedCell` devolve
  célula quebrada, e `hexToWorld` usa `0.5 * (row & 1)` — `&` trunca para
  inteiro, então o termo de paridade é DEGRAU: ao cruzar uma linha o personagem
  saltava meia célula de lado num frame. Era o "andar hexagonal" que se sentia.
  `squareToWorld` é linear nos dois eixos e o salto sumiu (medido: 0).
- **Mapa 3D = mapa do rAthena inteiro**: `migrate-maps.ts` gera `terrainMode:
  "square"` com `legacy.origin = 0,0` a partir do `map_cache.dat` — 400×400
  células com a colisão de verdade (`prt_fild08`: 90.796 andáveis, 61.303
  parede, 7.899 penhasco). `map3dFor` caiu na identidade: cada mapa do servidor
  usa a cena de mesmo nome. `GameMap.legacy { mapName, originX, originY }`
  continua existindo para os mapas AUTORADOS no editor, que cobrem só um pedaço
  (`link:legacy-map` grava a janela). Modelo de mob vem de
  `entities/mobModels.ts` (Poring 1002 → esqueleto) — aparência só, status/drop
  são do mob_db.
  - **São DOIS caches, e o servidor lê os dois** (map.cpp:3920):
    `db/re/map_cache.dat` tem só os 8 mapas específicos de renewal (entre eles
    `prt_fild08` e `prontera`) e `db/map_cache.dat` tem o acervo inteiro — 1.288
    mapas, 106 milhões de células. Migrar só o primeiro era o motivo de todo
    portal de borda cair em "mapa sem cena 3D": o vizinho (`moc_fild01`,
    `prt_fild07`) mora no outro arquivo. `--cache base|re|pre-re` escolhe, e o
    base EXIGE `--only` — sem filtro seriam ~1 GB de JSON. Migrar só os destinos
    dos warps do mapa em uso é o caminho: `prt_fild08` tem 6 warps para 4 mapas.
- **Mapa grande é problema de PARSE, não de rede**: `prt_fild08.json` tem 1,73
  MB e comprime para ~13 KB (`@fastify/compress` na API) — a colisão é a mesma
  string dezenas de milhares de vezes. O custo real é o zod validando 160.000
  enums; medido em `window.__mapParseMs` (30 ms, dentro do orçamento). Só se
  isso passar de ~150 ms vale empacotar a colisão em binário.
- **Chão quadrado é malha por chunk** (`grid/squareChunks.ts` +
  `SquareTerrain.tsx`): 32×32 células por pedaço, uma `BufferGeometry` cada, cor
  no VÉRTICE (superfície autorada ou, na falta dela, o tipo de colisão) e o
  mesmo ruído fbm do mundo hex (`scene/groundNoise.glsl.ts`). ~25 malhas
  visíveis contra as 160.000 instâncias que um tile por célula exigiria. Não há
  tile de chão QUADRADO de campo aberto em pack nenhum do repo (o KayKit Dungeon
  só tem piso de masmorra), e é por isso que o chão é procedural.
  - **A textura de chão é PRODUZIDA aqui, de duas fontes** (change.txt de
    2026-07-31 + next-change.txt de 2026-08-01, referências Synty POLYGON em
    `Desktop/ref`): `scripts/make-terrain-textures.mjs`
    (`pnpm --filter @ragnarok/game terrain:textures`) escreve
    `public/assets/terrain/{grass,dirt,stone,sand,snow}.png` 512² **e as
    miniaturas 128² que o editor mostra na paleta**. Cada slot vem de uma
    **foto CC0** (`assets-new/terrain-cc0/`, Poly Haven + ambientCG, catalogada
    em `LEIA-ME.md`) ou da **receita procedural**, que é o caminho de origem e
    continua sendo o de grama — os três conjuntos de `grama/` são chão com musgo
    fotografado de cima, não grama. Os dois atlas KayKit do repo não servem: são
    rampas de gradiente que os .gltf amostram por UV.
    Três regras valem para as duas fontes: **seamless obrigatório** (a
    amostragem é por coordenada de mundo e não há costura para esconder emenda),
    **contraste baixo** (mais que isso vira granulado quando a câmera afasta, o
    oposto do look pintado) e **cor base = a paleta que já existia**.
    - **Foto crua não convive com prop low-poly**, então ela passa por uma
      estilização em HSL: matiz e saturação puxados para os da cor base (tira o
      desvio de cor da fotografia), contraste comprimido e **média normalizada
      na cor base** — esta última obrigatória, porque o shader faz
      `texel / corBase` e uma média diferente tingiria o chão inteiro.
    - **O contraste é um ALVO, não um fator**: um fator fixo dava 28% de
      amplitude na terra lisa e 79% na rocha, porque a faixa dinâmica de cada
      foto é outra. Mede-se p2..p98 da fonte, escala-se para a amplitude alvo e
      **cortam-se** os 4% de fora — sem o corte, numa fonte lisa (onde o fator
      satura em 1) o resultado saía com o contraste da foto crua.
    - **A miniatura tem que DIVIDIR o lado da textura**: com 96 (512/96 = 5,33)
      a redução somava 6×6 amostras e dividia por 28,4; o valor passava de 255 e
      o `Buffer` grava módulo 256 — a neve, quase branca, dava a volta e saía
      PRETA na paleta do editor.
    - **O script gera TODAS as variantes, não só a escolhida** (25 arquivos,
      8,5 MB em disco) mais um `manifest.json`. O cliente baixa só a que o mapa
      pede; o editor lê o manifesto para montar o seletor, então acrescentar uma
      textura ao acervo já a faz aparecer na lista sem tocar em código.
  - **Qual textura e de que TAMANHO é escolha do MAPA** (`GameMap.terrainStyle`,
    schema v6 — editor: dock "Texturas do terreno"): a grama de um campo aberto
    não é a de um pântano, e é a mesma natureza da iluminação, que já mora no
    mapa. Só aparência: nada ali muda colisão, altura ou passagem, e o
    `map_cache` exportado não é afetado.
    - **Campo sem coluna tem de entrar no stash dos DOIS lados**
      (`apps/api/src/store/map-row.ts`): `terrainMode`, `surface`, `triggers`,
      `ramps`, `lighting`, `authoredHexScale`, `legacy` e agora `terrainStyle`
      viajam numa chave `_blocks` dentro do `metadata` jsonb, e a lista é FIXA.
      Fora dela o campo some CALADO no round-trip — foi o motivo de "a textura
      escolhida aparece no editor e não no /play": o editor mostrava o rascunho
      do navegador, que tem o campo, e o /play lia a API, que já o tinha
      descartado no save. Corolário: mapa salvo antes da correção não tem estilo
      nenhum gravado; é preciso reescolher e salvar uma vez.
    - **A escala precisava existir e ser grande.** Com as 8 unidades de mundo
      que valiam para tudo, o padrão repetia a cada 4 células — na distância de
      câmera do jogo isso vira granulado, e granulado a essa escala lê como COR
      SÓLIDA (foi o relato: "as texturas parecem pequenas, parece ser uma cor
      sólida"). Os padrões hoje vão de 18 a 28 unidades, um por superfície,
      porque o conteúdo é outro: rocha tem estrutura grande, areia é quase
      uniforme e aguenta repetir miúdo.
    - **A escala é UNIFORM, a variante recarrega só a camada dela**: trocar a
      grama não recompila shader, não reconstrói geometria e não mexe nas outras
      quatro camadas do array texture.
    - **O PEDIDO chega ANTES do buffer, e não pode se perder no caminho**
      (`ultimoEstilo` + `criarSeFaltar` em `grid/terrainTextures.ts`) — esta é a
      causa de verdade do "a grama escolhida no editor vira procedural no /play",
      e ela não é corrida: é ordem FIXA. `terrainArrayTexture()` é chamado dentro
      do `onBeforeCompile` do material (`SquareTerrain`), ou seja, só quando o
      shader COMPILA — no primeiro quadro DESENHADO. O `useEffect` que pede
      `map.terrainStyle` roda antes disso, no commit do React. A sequência real é
      sempre:
      1. efeito → `aplicarEstilo(estilo do mapa)` → **o buffer ainda não existe**
      2. 1º quadro → `onBeforeCompile` → cria o buffer → carrega

      No passo 1 havia um `if (!tex || !data) return` mudo que jogava o pedido
      fora, e o passo 2 carregava os PADRÕES. Ficava assim **até recarregar a
      página**, porque o efeito não roda de novo sem o `estiloKey` mudar. Agora
      `aplicarEstilo` GRAVA o pedido e GARANTE o buffer, e a criação aplica o que
      foi pedido em vez de `undefined`.
      - **A tela de carregamento piorou isto de intermitente para certo**: com a
        cena oculta nada compila, então o buffer nem chegava a existir enquanto o
        mapa era montado.
      - Como diagnosticar de novo, na ordem que funcionou: `GET /maps/<id>` para
        ver o que está GRAVADO (estava certo), `ls public/assets/terrain/` para
        ver se o PNG existe (existia) e só então o carregador. Ler código antes
        de olhar o dado custou duas rodadas.
    - **A carga das camadas é uma CORRIDA, e ela precisa de árbitro**
      (`geracao` em `grid/terrainTextures.ts`, next-change.txt de 2026-08-03):
      há SEMPRE duas chamadas de `aplicarEstilo` no ar — `terrainArrayTexture()`
      dispara `aplicarEstilo(undefined)` ao criar a textura (para o chão nunca
      aparecer em cor chapada) e o `SquareTerrain` dispara
      `aplicarEstilo(map.terrainStyle)` no efeito dele. As duas escrevem no MESMO
      buffer, e o `carregado[i]` que parecia protegê-las só era escrito DEPOIS do
      `await`: as duas passavam pela conferência e vencia a que terminasse por
      último — a que baixou o PNG mais leve, não a que o mapa pediu. Era o "algo
      está mudando a textura da grama no /play": a escolha do editor voltava à
      procedural, e **ficava assim até recarregar a página**, porque
      `carregado[0]` passava a dizer que a camada já estava certa e o efeito não
      roda de novo sem o estilo mudar.
      - Não era o editor nem a API: `terrainStyle` é gravado certo pelo
        `setTerrainStyle` e viaja nos dois sentidos no `_blocks` do
        `map-row.ts`. O defeito era só de ORDEM DE CHEGADA, e por isso
        intermitente.
      - Descartar a chamada antiga POR INTEIRO não deixa buraco: toda chamada
        descreve TODAS as camadas, então a nova cobre o mesmo conjunto.
      - O carregador é injetável (`aplicarEstilo(estilo, carregar?)`) só para o
        teste conseguir controlar a ordem de chegada sem um DOM — o de verdade
        usa `canvas`. `grid/terrainStyleRace.test.ts` força a ordem PIOR;
        conferido que 2 dos 3 casos REPROVAM sem a guarda.
  - **A fronteira entre duas superfícies se dissolve pela COR DE CANTO**: antes
    a cor era constante nos quatro vértices do quad, então grama do lado de terra
    dava um degrau seco na linha da célula — a textura já se misturava
    (`pesoCanto`), mas a tinta pulava, e é a tinta que se enxerga. Agora cada
    canto recebe a média das células que se encontram nele, exatamente como
    `cornerLevel` faz com a altura. O centro da célula continua com a cor pura,
    então a mistura acontece SÓ na interseção: o mapa segue quadriculado, a
    emenda é que deixa de ser degrau. A média só junta células do MESMO grupo de
    passagem — senão a cor da mata escorreria para dentro do campo e a fronteira
    entre o que se anda e o que não se anda ficaria ilegível.
  - **A água usa a aquarela como PADRÃO NEUTRO** (`agua/Water_0*.png`, pack CC0
    pintado à mão): o PNG é gerado com a média em cinza, e o shader multiplica
    `texel / 0.5`. A mancha e a variação de matiz da pintura sobrevivem, a cor
    absoluta não — que é o que preserva a leitura de PROFUNDIDADE (turquesa no
    raso, azul escuro no fundo), a mesma que faz o canal bloqueado parecer
    intransponível antes de o jogador tentar.
    - **`NoColorSpace`, nunca sRGB.** Ela não é cor, é RAZÃO. Marcada como sRGB o
      three decodifica na amostragem e o 128 chega ao shader como **0,216** — a
      divisão por 0,5 escurecia a água em 43% e comprimia a variação a quase
      nada. O chão não sofre disso porque lá a divisão é por uma `THREE.Color`,
      que também está em espaço linear.
    - **Não amorteça o que já é fraco.** As quatro aquarelas variam de 1,4% a
      4,5% de luminância; amortecidas por um fator no gerador (×0,6) e de novo no
      shader (×0,75), e ainda com duas amostras em MÉDIA (que cancela variação
      descorrelacionada), sobravam ~2% — a textura era amostrada e simplesmente
      não se via. Hoje o gerador MIRA uma amplitude (as quatro saem em 8%) e o
      shader MULTIPLICA as duas amostras em vez de mediá-las.
    - **Percentil de corte tem de ser da RAZÃO, não do valor do canal**: cortar o
      canal por percentis de luminância achatava a imagem (num azul-petróleo o
      canal azul fica todo acima do p98 da luminância e grampeava no teto —
      medido: desvio 0,0%).
    - **A margem da lâmina dissolve pelo alpha** (`vMargem`, a mesma fração de
      canto que já dava a espuma), com piso de 0,40: num canal de duas células
      TODOS os cantos são de beira, e um fade até zero apagaria o rio inteiro em
      vez de suavizar a margem dele.
    - O seixo é disco claro **com aro escuro**: sem o aro, um disco só clareado
      sobre base quente lê como mancha AZUL (contraste simultâneo, não erro de
      matiz — o HSL nem toca no tom).
    - A estria da terra é larga e fraca. Com lattice fino num eixo (48×8) ela
      saía como listra vertical dura, lendo como veio de MADEIRA.
  - **A textura entra como PADRÃO, não como cor** (`grid/terrainTextures.ts` +
    `SquareTerrain.makeSquareGroundMaterial`): um `DataArrayTexture` com uma
    camada por superfície, e o shader usa `texel / corBase`. Assim a tinta do
    vértice (`cellColor`) continua sendo a fonte da cor — a mata segue verde
    escura e o penhasco marrom usando as mesmas texturas de grama e terra. O
    array texture nasce preenchido com a cor base e as imagens entram depois, no
    mesmo buffer: antes de carregar, o chão é exatamente o de antes.
    - **Array texture, não atlas**: o chão ladrilha infinitas vezes por
      coordenada de mundo, e num atlas o `fract()` de cada repetição quebraria a
      derivada da UV — o mip saltaria e apareceria uma linha por ladrilho.
    - **Nada de `material.glslVersion`**: `sampler2DArray` exige GLSL ES 3.00, e
      é o que o three já usa em TODO material embutido (a conversão em
      `WebGLProgram.js` é incondicional fora do `RawShaderMaterial`). Setar
      `GLSL3` faria o three parar de declarar `pc_fragColor`/`gl_FragColor`, que
      os chunks embutidos escrevem, e o shader nem compilaria.
    - **A transição entre superfícies sai dos CANTOS**, como a altura: cada quad
      leva DUAS camadas constantes (própria + a mais comum entre os 8 vizinhos) e
      um PESO por vértice, igual à fração das células daquele canto que são da
      segunda camada. O índice de camada é interpolado pelo rasterizador — se dois
      cantos do mesmo quad pedissem camadas diferentes, o meio do quad receberia
      um índice fracionário, que não é camada nenhuma. Num canto de fronteira os
      dois lados calculam o mesmo 0,5 e a costura some (testado em
      `grid/terrainLayers.test.ts`).
    - **Triplanar mistura AMOSTRAS, não coordenadas**: misturar as duas UV é mais
      barato, mas numa encosta a normal muda de canto a canto do mesmo quad, os
      dois sistemas de coordenada se disputam dentro do triângulo e a textura
      escorre em riscos verticais na ladeira (visto no primeiro teste). Duas
      amostras por camada resolvem, com atalho quando o peso está saturado.
  - **Rio CORRE, lago está PARADO — e isso muda a lâmina** (next-change.txt de
    2026-08-01, referência `agua-bugada.jpg`): água parada tem superfície
    horizontal, água corrente desce com o leito. Dar nível plano ao rio fazia a
    lâmina cortar a encosta — enterrada em cima, boiando embaixo —, e o que
    sobrava era uma lasca de água subindo o morro. A distinção já existia no
    dado: `surface: "water"` é massa parada, `"river"` é canal. O rio segue o
    leito célula a célula; o lago acha um nível único por corpo, e o flood fill
    do lago NÃO atravessa para dentro do rio.
    - A altura da lâmina é por CANTO (média das células de água que o tocam),
      não por quad: com um nível por quad um rio em declive desceria em ESCADA. E
      na junção rio/lago a média dos dois costura os regimes sem emenda.
  - **Erguer o chão de um pedaço da água faz ILHA, não água boiando**
    (referência `agua-bugada.jpg`, item 1): o pincel de relevo não apaga a
    `surface: "water"` da célula, e o quad continuava sendo desenhado no nível do
    corpo — sobrava uma tira de água flutuando sobre a areia, sem leito embaixo.
    Duas correções, cada uma resolvendo metade do relato "faça a textura
    acompanhar ou remova-a":
    - **`temLamina`**: só desenha água onde o leito está ABAIXO da superfície do
      corpo. O mesmo predicado vale para o contorno e a profundidade — se não há
      lâmina ali, a célula também não pode contar como água ao decidir onde a
      margem passa, senão a espuma contornaria terra seca.
    - **O nível do corpo sai do percentil 90 dos leitos, não do MÁXIMO**
      (`rasoDoCorpo`): pelo máximo, UMA célula erguida levantava a lâmina inteira
      e o lago todo passava a boiar. Continua sendo a parte rasa (a média
      secaria a beirada, ver abaixo) — só deixa de obedecer a um punhado de
      células erguidas. Corpo com menos de 10 células mantém o máximo: ali não há
      percentil que signifique alguma coisa.
  - **A lâmina tem UM nível POR CORPO d'água** (`nivelDosCorpos`, flood fill de 4
    vizinhos): água parada tem um nível por corpo, não uma constante do mapa. Com
    o `WATER_LEVEL_Y = -0,1` global, afundar o terreno de um lago deixava a
    lâmina BOIANDO sobre o leito rebaixado (referência `afundei.jpg`). O nível
    sai do ponto mais RASO do corpo — não da média, senão um canal fundo puxaria
    a lâmina para baixo do próprio barranco. Afundar o lago inteiro afunda a
    lâmina junto; afundar só o meio apenas aprofunda. Cacheado por `WeakMap` nos
    três arrays, senão os 169 chunks refariam a varredura de 160.000 células.
  - **A margem da lâmina é a ISOLINHA de um campo BORRADO**, não a borda do quad
    (referências `square-form.jpg` e `olha.jpg`, duas rodadas). Três coisas, e as
    três foram necessárias:
    1. o contorno de quads é uma escada de 90°, então quem desenha a margem tem
       de ser o alpha, não a geometria;
    2. a fração crua das 4 células do canto só assume cinco valores (0; 0,25;
       0,5; 0,75; 1) — a isolinha de um campo tão grosso é um zigue-zague de 45°,
       melhor que a escada mas ainda facetado. O campo é BORRADO num raio de 2
       células (peso 1/(1+d²)) e aí a isolinha vira curva;
    3. o limiar fica ACIMA de 0,5 (0,45..0,70) porque a malha existe só sobre as
       células de água: cortando em 0,5 o contorno cairia exatamente na borda do
       quad, e seria a escada que se veria. A meia célula para dentro há malha de
       sobra para desenhar a curva.
    Um piso de alpha (tentei 0,40) anula tudo: mantém o quad visível até a quina.
    A PROFUNDIDADE não é borrada — ela descreve o leito logo abaixo, e borrá-la
    arrastaria a cor de fundo para dentro da margem rasa.
  - **A separação por grupo na altura de canto vale só onde a altura é PALPITE**
    (`cornerLevel`): ela existe por causa do `visualLevel` (parede +1, buraco −1),
    que é chute por TIPO — misturar isso com o campo daria ladeira onde o
    servidor não deixa subir. Mas num relevo AUTORADO não há chute: um morro
    pintado por cima de mata e campo tem `wall` e `walkable` INTERCALADOS, cada
    grupo calculava um canto diferente, e o vão virava uma prateleira de face
    vertical no meio da encosta (referência `craquelado-square.jpg`; medido no
    mapa do usuário: **618 fronteiras assim, degrau de até 3,73 níveis**). Quando
    as quatro células do canto têm altura autorada, a média junta todas.
    Complemento no `buildChunkGeometry`: a saia só é emitida se houver VÃO de
    verdade nos CANTOS — a condição antiga olhava o nível da CÉLULA e plantava
    face vertical dentro de superfície contínua. `relevoAtravessaBloqueio.test`
    trava os dois, e trava também que a mata SEM altura autorada mantém a saia.
  - **A face vertical de um desnível é TERRA EXPOSTA**, não o topo escurecido
    (referência `ref2.png`): cortar o campo mostra o solo por baixo. Rocha e
    areia se expõem como elas mesmas — quem tem solo por baixo é vegetação e
    neve.
  - **A cor de canto NÃO separa por grupo de passagem** (a altura, sim): separada,
    o pé da montanha e a beira da mata voltavam a ser um degrau de tinta em
    escada. Quem sinaliza "aqui não se anda" é o DESNÍVEL e a saia de terra —
    sinal geométrico, mais forte que o de cor.
  - **Toda água nova abre BARRANCO** (`escavarBarranco`, referência `ref1.png` e
    next-change.txt): duas células de rampa interpolando entre o nível do campo e
    o do leito. Antes o vale só grampeava a margem em nível 1 e o leito começava
    em −0,25, deixando um degrau seco de 1,25 nível na linha da água — um murinho
    em volta do rio inteiro. Vale para o rio GERADO e para os pincéis de água
    pintados à mão, pelo MESMO helper — rio gerado e rio pintado divergirem seria
    a próxima surpresa. O lago pintado também afunda o leito (`LAGO_LEITO_Y`),
    senão não haveria para onde a margem descer.
  - **A água lê o LEITO** (`buildWaterGeometry` + `makeWaterMaterial`): o que
    separa poça de canal é o quanto o leito afunda sob a lâmina do corpo. Profundidade e proximidade da margem são medidas nos CANTOS e
    interpoladas — por célula sairiam em blocos, que é a "mancha azul chapada"
    que a lâmina existe para evitar. Raso puxa para o turquesa e fica
    transparente, fundo puxa para o azul escuro e opaco (é o que faz o canal
    bloqueado LER como intransponível antes de o jogador tentar), e a margem
    ganha espuma clara. A ondulação é o único uniform animado, mutado no
    `useFrame` — passar por `setState` repintaria o React 60×/s.
  - **A altura mora nos CANTOS, não na célula** (`grid/heightField.ts`): o
    heightmap tem um valor por célula, mas o vértice usa a MÉDIA das células que
    se encontram nele — dois vizinhos compartilham dois cantos, a superfície fica
    contínua e a encosta inclina em vez de escalonar. Era o pedido de "não quero
    um jogo igual Roblox todo quadrado". O `heightmap` já aceitava fracionário
    (`z.array(z.number())`, sem `.int()`), então nada mudou no schema. A média só
    junta células do MESMO grupo de passagem (chão com chão, bloqueio com
    bloqueio): sem isso, parede e buraco viravam rampa para dentro do campo e o
    jogador via ladeira onde o servidor não deixa subir — a saia vertical
    sobrevive exatamente na fronteira entre os grupos.
    - `flatShading` teve que SAIR do material do chão: com ele cada face acende
      com um tom só e a colina volta a parecer caixas, por mais suave que seja a
      geometria. Quem manda agora é o atributo `normal`, vindo do gradiente do
      campo. A cor segue chapada por célula — ela vem do atributo `color`.
    - `squareTerrainQuery.getHeight` usa `sampleHeight` (bilinear entre os quatro
      cantos), a MESMA conta da malha: ler o nível chapado da célula deixava o
      personagem meio nível no ar na encosta.
    - **A grade de cantos é pré-computada por chunk**: cada canto é usado por até
      quatro células e a normal lê mais quatro cantos, então calcular sob demanda
      repetia a mesma média dezesseis vezes — 433 ms para os 177 chunks visíveis
      de `prt_fild08` contra 293 ms com a grade pronta (o patamar de antes do
      relevo suave era ~170 ms com degraus).
  - **O cache de chunk se invalida NO RENDER, não num effect**: as geometrias
    moram num `useRef` chaveado por posição, e o `useMemo` que monta a lista
    visível LÊ esse cache durante o render — um cleanup de `useEffect` só roda
    depois do commit e não agenda render novo, então mapa editado continuava
    desenhado com a geometria velha (era o "clico em Remover, o contador zera e o
    mapa não muda"). `chunksSujos` compara a IDENTIDADE de cada posição de
    `collision`/`surface`/`heightmap` — o editorStore é imutável, então uma
    pincelada recria o array inteiro e só a varredura diz ONDE mudou: 1 chunk em
    0,6 ms contra 169 em 145 ms de "joga tudo fora". Primeira edição num mapa
    importado suja TUDO de propósito: ao passar a existir, `surface` troca a
    fonte da cor de todas as células.
  - **Montar chunk tem ORÇAMENTO POR QUADRO** (`ORCAMENTO_MS` = 6 ms +
    `porConstruir`): cada chunk custa ~2,5 ms (medido em 549 construções) e o
    centro de visão muda a cada 16 unidades andadas, trazendo uma fileira nova
    de uma dezena deles — 25 ms num quadro que já gasta 16, que é o engasgo que
    se sentia ao ANDAR. Agora o que não cabe no orçamento vai para uma fila que
    o `useFrame` drena, do mais PERTO para o mais longe: o buraco que sobra fica
    sempre na borda do alcance, dentro da névoa. Medido na carga fria de
    `prt_fild08` (400×400): **112 chunks / 301 ms espalhados por 38 quadros,
    pior quadro 19 ms, nenhum acima de 33 ms** — antes era uma rajada de 479 ms.
    - **A fila obriga o `useMemo` a ter uma `versao` nas dependências**: quando
      o `useFrame` constrói, NENHUMA das outras dependências mudou, e sem ela o
      memo devolveria a lista velha — o chunk ficaria no cache sem ser desenhado.
    - Um anel ALÉM do alcance é construído por último (`adiantar`): cruzar a
      fronteira do culling deixa de construir qualquer coisa, porque o trabalho
      foi feito nos quadros ociosos anteriores. Ele não entra no que se desenha.
    - **O mapa INTEIRO é montado atrás de uma TELA DE CARREGAMENTO**
      (`SquareTerrain.precarregar` + `orcamentoMs`/`onProgresso`, overlay em
      `views/PlayView`). A pré-carga já existia, mas gotejava 6 ms por quadro
      ENQUANTO se jogava — competindo com o quadro justamente enquanto o jogador
      anda, que é quando chunk novo entra no alcance. Atrás da tela não há jogo
      para desenhar, então o orçamento dobra (12 ms) e ninguém vê a espera; ao
      sair dela, **andar não constrói mais nada** (`chunksPorSegundo` = 0 no F9,
      que é como se confere). Medido: 169 chunks ≈ 35 MB / ~450 ms no
      `prt_fild08`, e `perf/entidades.test.ts` já travava esse orçamento antes
      da tela existir.
      - O canvas NÃO é desmontado — a tela é um overlay por cima dele. Quem
        drena a fila é o `useFrame` do `SquareTerrain`, e trocar o canvas pela
        tela pararia exatamente o trabalho que ela está esperando. O cache de
        geometria também mora num `useRef` da instância: desmontar jogaria fora
        tudo que já foi construído.
      - **Ela tem DUAS fases, e a segunda desenha de propósito**
        (`play/aquecimento.ts`): **construir** (chunks, com a cena apagada) e
        **aquecer** (cena desenhada de verdade, cortina ainda no ar). A segunda
        existe porque a primeira não aquece NADA: com `scene.visible = false` o
        three nem percorre a cena, então não compila shader nem sobe textura.
        Revelar direto no fim da construção só mudava o engasgo de lugar — o
        primeiro quadro visível pagava a compilação de TODOS os materiais de uma
        vez, no instante exato em que o jogador ganha o controle. Aqui os quadros
        caros acontecem atrás da cortina, e o primeiro que o jogador vê já é
        barato.
        - **O sinal é `gl.info.programs.length`, não um relógio**: essa lista só
          cresce quando um material é desenhado pela primeira vez, então parada
          significa "não há mais compilação à vista". Contar TRABALHO em vez de
          TEMPO é o que faz isto valer numa máquina lenta — um `setTimeout` fixo
          revelaria a cena no meio da compilação, que é justamente o que se quer
          esconder. Oito quadros parados encerram.
        - **O teto (2,5 s) não é enfeite**: um efeito ou uma entidade entrando
          pode compilar shader novo a cada quadro e a contagem nunca estabiliza.
          Segurar o jogador para sempre é pior que revelar cedo, e uma tela de
          carregamento eterna é o pior defeito possível desta tela — por isso a
          regra é uma função PURA com teste dos dois lados
          (`play/aquecimento.test.ts`: não revela enquanto compila, e SEMPRE
          revela pelo teto).
      - **Enquanto ela está no ar, NADA além dela é desenhado** (next-change.txt
        de 2026-08-04). Três coisas apareciam por cima ou por trás e as três
        saíram:
        - **A cena 3D** (mapa, personagem, monstro) — apagada por
          `OcultarCena`, que faz `scene.visible = false`. É o único jeito de
          parar o desenho SEM desmontar: o `projectObject` do three sai na
          primeira linha quando o objeto está invisível
          (three.module.js:16326), então a lista de render sai vazia; o `clear`
          do quadro continua acontecendo (:1355), então a tela fica limpa em vez
          de congelada no último quadro; e o laço do R3F segue chamando todo
          `useFrame`, porque isso não passa pelo renderer. Ganho de brinde: os
          quadros da espera param de gastar GPU com sombra, névoa e chão para
          nada, e sobra máquina para montar chunk — que é o que se está
          esperando.
        - **O HUD** — ele vem DEPOIS da tela no DOM, e elemento posicionado
          pinta na ordem em que aparece, então barras, minimapa e chat ficavam
          POR CIMA do aviso.
        - **O overlay do F9** — ele mede o JOGO rodando; sobre a tela de
          carregamento mediria quadros que não desenham nada.
      - **Teto de 3 s** (`TETO_PRECARGA_MS`) e saída pelo estouro de memória: se
        a projeção passa de 64 MB a pré-carga se desliga sozinha, e aí ela
        PUBLICA o progresso final — sem isso quem espera esperaria para sempre.
        Nos dois casos o streaming de sempre continua valendo.
  - Parede sobe um nível e penhasco afunda (`visualLevel`): a altura não existe
    no `map_cache`, mas o TIPO existe — sem isso, 38% do mapa vira mancha
    chapada. A `squareTerrainQuery` usa a MESMA função, senão o que se vê e o
    que se pisa divergem. **Altura autorada tem prioridade**: nível ≠ 0 vence o
    palpite por tipo, que é o que deixa o editor decidir se um "gap" do rAthena
    é encosta (pincel Elevar ⛰) ou ravina (Afundar ⤓) — os dois só agem onde já
    está bloqueado e NÃO mexem na passagem.
  - Água é superfície própria (`buildWaterGeometry`), não cor no chão: leito
    afundado + lâmina translúcida única por chunk. Como cor de vértice ela
    acompanhava o relevo e virava mancha azul chapada. No rAthena a célula de
    água é ANDÁVEL (tipo 3), e continua sendo.
  - Com `flatShading` quem manda é a normal GEOMÉTRICA, não o atributo: a saia
    do bloco precisa do winding invertido em relação ao topo, senão o bloco
    aparece vazado, mostrando o próprio interior iluminado.
- **A névoa desbota para a COR DO CÉU, não para uma constante**
  (`scene/skyFog.ts`, referência `silhueta.jpg`): o `THREE.Fog` tem uma cor só e
  o céu é um degradê vertical, então tudo 100% enevoado saía pálido — inclusive
  o topo de uma montanha, que na tela fica bem acima do horizonte, onde o céu já
  é azul. Dava um recorte claro com a borda serrilhada da malha. Agora a névoa
  mistura com a cor do céu NAQUELE ponto da tela: geometria totalmente enevoada
  fica idêntica ao que está atrás dela. Medido com um render de teste (mesma
  cena com e sem a montanha, pixel a pixel): **74/255 de diferença antes, 1/255
  depois** — e 1 é arredondamento de 8 bits.
  - **É o `ShaderChunk`, não cada material**: `fog_fragment` é incluído por todo
    material embutido do three, então trocar o chunk uma vez pega chão, água,
    props, monstros e personagem. Nada disso toca geometria ou o fatiamento em
    chunks do terreno — é só a cor final do fragmento.
  - **As constantes entram em sRGB, NÃO em linear**: no r176 o `fog_fragment` é
    incluído DEPOIS do `colorspace_fragment` (meshbasic.glsl.js:108-111), ou
    seja, a névoa mistura com o fragmento já convertido — é por isso que o
    próprio three sobe o `fogColor` com
    `getRGB(..., getUnlitUniformColorSpace(renderer))`. Com as cores em linear a
    silhueta continuava lá, escura em vez de clara (medido: 74/255). Pelo mesmo
    motivo o `GradientSky` usa DUAS paradas e deixa o canvas interpolar em sRGB:
    é o espaço em que o shader mistura.
  - **A altura de tela chega sem uniform novo**: `fog_vertex` roda depois do
    `project_vertex`, então `mvPosition` está lá, e `mvPosition.y / -mvPosition.z`
    é a tangente da elevação — dividida por `tan(fov/2)` vira NDC. Um varying
    `float` e uma conta, sem resolução nem matriz.
  - O editor não é afetado: a cena dele não tem `fog`, e o chunk inteiro vive
    dentro de `#ifdef USE_FOG`.
- **A NÉVOA é fração do raio de render, e nada é desenhado atrás dela**
  (`server-config: fogNearFrac/fogFarFrac` + `play/viewRadius.ts`): eram três
  números soltos (raio 200, névoa 90 e 120) e eles saíram de acordo — medido no
  jogo, **81% dos triângulos de chão desenhados estavam atrás de névoa OPACA**
  (84.552 invisíveis contra 19.912 visíveis, 49 das 59 malhas). Era o "end
  range" da referência `render.jpg`: como a malha ia 116 unidades além do ponto
  em que a névoa já fechava, a BORDA do terreno aparecia recortada contra o céu
  em vez de dissolver.
  - **Um número só se ajusta**: `renderDistance`. A névoa é 0,69 e 0,92 DELE, e
    o desenho acaba em `min(renderDistance, fogFar + folga)`. Com raio 130 isso
    reproduz exatamente a vista antiga (90 → 120) desenhando 39% da área.
    Medido depois: 4 malhas inteiramente atrás da névoa (6.816 triângulos, 13%)
    contra 49 (84.552, 81%), e 23 draw calls contra 88.
  - **A config antiga se converte sozinha** (`converterNevoaAntiga`, um
    `preprocess` do zod): `fogFar` em unidades vira raio × fração. Fica no
    SCHEMA, não num script, porque API, jogo e admin leem o mesmo módulo — em
    qualquer outro lugar, um dos três divergiria. Quem salvar no admin já grava
    no formato novo.
  - **O culling mede a distância até a CAIXA do chunk**, não até o centro: pelo
    centro era preciso somar meia diagonal (45 unidades) de folga para o chunk
    onde o jogador está não sumir quando ele anda para a beirada — e essa folga
    valia para TODOS os chunks, inclusive os que estão inteiros atrás da névoa.
    Pela caixa ficam exatamente os que encostam no círculo, e a folga que resta
    é só o passo do centro de visão (16 unidades, `useViewCenter`).
  - **A regra virou TESTE** (`perf/desempenho.test.ts`): a névoa fecha antes de
    a malha acabar, a malha não passa da névoa + folga, e props não vão além do
    chão. O schema já pedia isso em comentário desde sempre — e foi violado por
    116 unidades sem ninguém notar. O teste pegou de brinde um caso que eu tinha
    deixado passar: em raio 700 a folga de 8% virava 56 unidades de malha
    invisível.
- **Vazamento de textura por entidade — CORRIGIDO**: com o personagem parado num
  campo com mob, `__gl().info.memory.textures` marcava **4.042 texturas vivas
  contra 5 referenciadas pela cena**, subindo 1,8/s, e os saltos batiam com
  spawn de entidade (~9 por mob que aparece). A causa era o
  `SkeletonUtils.clone`: ele faz `skeleton.clone()` POR MALHA SKINADA, e cada
  `Skeleton` carrega um `boneTexture` próprio — os personagens KayKit têm nove
  malhas skinadas cada. Duas correções em `entities/personagemGltf.ts`:
  `fundirSkinned` funde as nove por MATERIAL antes de clonar (sobra uma, ou duas
  no Skeleton_Warrior, que tem material só para os olhos) e `descartarPersonagem`
  chama `skeleton.dispose()` no desmonte (`assets.ts`). `mixer.uncacheRoot` NÃO
  entra ali: ele deixa as actions órfãs e o StrictMode, que remonta todo efeito
  no dev, derrubava o `<Canvas>` inteiro. Travado por `perf/entidades.test.ts`.
  Descartados por leitura de código, na mesma investigação: `ui/barTexture`
  (cacheia por proporção arredondada — o jogo inteiro usa 2 texturas) e o
  material do clone (é compartilhado). O detector segue no overlay do F9 ("tex
  novas (10 s)", vermelho acima de 3): em regime tem de ser 0.
  - **O que sobrava depois disso era MATERIAL, não textura** (`net/GlowChao`): o
    `ShaderMaterial` do brilho de chão vem de um `useMemo` e é entregue pela
    PROP `material`, e o R3F só descarta o que ELE construiu. Cada entidade que
    nascia e sumia — e cada item que caía e era pego (`net/GroundItems`) —
    deixava um material com o programa compilado atrás dele. `dispose()` na
    limpeza do efeito.
- **`/play` é o JOGO e exige sessão** (redireciona para `/login` sem ela). O
  mundo local só abre quando pedido de propósito: `?preview=1` (mapa do editor)
  ou `?map=<id>`. Antes, abrir /play direto desenhava um personagem nível 50 de
  ninguém ao lado de um HUD que dizia estar logado.
- **Nível, zeny, classe e atributos iniciais vêm da LISTA DE PERSONAGENS**, não
  de pacote de status: o rAthena só manda `PAR_CHANGE` quando eles MUDAM. Por
  isso o gateway anexa a ficha no `world:enter` e o cliente semeia o
  `playerStore` (`seedFromChar`). Corolário: o reset do playerStore é do fim da
  SESSÃO, não do desmonte da cena — o StrictMode desmonta o efeito no dev e
  apagava a ficha.
- **HUD lê o servidor**: `net/playerStore` guarda HP/SP/exp/zeny/atributos/
  inventário/skills como o map-server descreve. O rAthena manda DIFERENÇAS
  (`self:stat`, varID do enum `_sp` em `map.hpp:499` → nome em
  `gateway/src/ro/stat-names.ts`) e às vezes o bloco inteiro (`self:status`,
  0xbd). O gateway guarda o último estado e reenvia no `world:ready`: os
  pacotes de status chegam antes de a cena 3D existir, e sem o reenvio o HUD
  abria zerado. Sem sessão, HUD/janelas caem no mundo simulado local.
- **Alt+A/E/S/Q/Z/M/U/O** abrem as janelas (`hud/hotkeys.ts`) — mesmo caminho
  de dedo do RO; a estilização é nossa.
- **Com sessão, /play nunca cai no hexdemo**: mapa sem cena 3D correspondente
  vira aviso na tela. Cair no demo fazia o jogador andar num mundo que não era
  o dele (aconteceu ao morrer e renascer em Prontera).
- **Skin de UI = TravelBookLite** (pixel-art de livro, Crusenho): arte em
  `apps/game/public/assets/ui/travelbook/`, tokens e helpers em
  `ui/travelbook.ts`, primitivos em `ui/rpg.tsx` (Panel = página com moldura
  9-slice, Slot/RpgButton = peças de madeira, RpgBar = trilho + fill tingido).
  Duas regras inegociáveis: `image-rendering: pixelated` e escala INTEIRA
  (`UI_SCALE`) — meio pixel borra a arte. As cores (`BOOK`) foram MEDIDAS dos
  PNGs, não escolhidas no olho. **Licença exige crédito** (`UI_PACK_CREDIT`, na
  janela Configurações); revenda proibida.
- **O frame do personagem saiu do TravelBook** (change.txt de 2026-07-30): a
  placa do topo-esquerda usa a arte PINTADA de
  `assets-new/ui_definitiva/character-up-left` (copiada para
  `public/assets/ui/character-frame/`), com medidas em `ui/charFrame.ts` e
  desenho em `hud/PlayerFrame.tsx`. Aqui vale o CONTRÁRIO das regras do
  TravelBook: a arte tem alpha suave e não é pixel-art, então nada de
  `pixelated` nem de escala inteira — interpolar é o certo. A placa é UMA
  imagem e todo o resto (nome, barras, aros) é posicionado em % dela, medido
  pixel a pixel no PNG; a largura passada à placa reescala o frame inteiro num
  número só.
  - **A MESMA placa serve ao ALVO** (`StatPlate`, ui-change.txt): o frame do
    monstro é ela a 320 px contra os 400 do jogador, com um aro só (mob não tem
    classe) e o HP em vermelho (`ENEMY_FILL` = a curva medida do HP com a matiz
    girada para ~8°, claridade de cada parada preservada — a arte não traz barra
    vermelha e inventar um degradê destoaria).
    - **Sem SP o HP vai para o MEIO** (`PLATE_LAYOUT.hpAlone`, y=97): o rAthena
      não manda SP de mob, então online a segunda faixa nunca existe e deixar o
      HP no lugar de sempre abria um vão vazio embaixo dele. Quem enche SP de
      monstro é só o preview do editor.
    - **Nível e HP do mob chegam DEPOIS do spawn** (resposta ao CZ.REQNAME que o
      gateway dispara): até ela voltar o aro mostra "?" e a barra fica sem
      número e sem preenchimento. Continua valendo a regra antiga — desenhar
      barra cheia seria inventar HP que ninguém informou —, só que agora a
      barra aparece vazia em vez de sumir, que é o que o usuário pediu.
    - Aparência do retrato do alvo sai de `entities/mobModels`, a MESMA tabela
      que a cena usa para desenhá-lo — senão o rosto no HUD e o boneco no mundo
      seriam monstros diferentes.
  - **A moldura curva das barras é 9-slice montado em RUNTIME**
    (`charFrame.ts: barFrameUrl`): a arte traz um canto só (o superior-direito,
    x 53..76 / y 0..23 do `bar-corner.png`) e um trecho reto de 9 px
    (`bar-edge.png`). Um canvas 56×56 espelha o canto nos quatro cantos e
    estica o reto entre eles; o resultado vira `border-image` com corte 24. Oito
    divs por barra fariam o mesmo, mas aí cada barra teria que saber onde cada
    peça vai — assim ela é um elemento só e a moldura acompanha qualquer
    tamanho. A coluna de FORA do canto é justamente a linha 0 do trecho reto
    (conferido: alpha 36/105/191/240/251… idêntico nos dois PNGs), e é isso que
    faz os espelhamentos casarem sem emenda.
  - **Espessura e raio saem da ALTURA da barra**, não de números fixos:
    `border-width` = 38% da altura reproduz a proporção da referência (traço =
    1/3 do canto = ~1/8 da altura). O trilho por baixo é recortado com
    `inset: border/3` e `border-radius: border × 0.66` — que é exatamente a
    curva INTERNA do desenho (canto 24, traço 8 → raio interno 16).
  - **O fundo do medalhão é PRETO com opacidade**: a versão amarronzada competia
    com a madeira do aro. O escuro translúcido deixa o mundo aparecer de leve e
    faz o personagem destacar.
  - **Retrato = o próprio glb, não uma textura de rosto**
    (`hud/CharacterPortrait`): um canvas de ~94 px com o mesmo modelo do mundo,
    lente de 24° (os 50° da cena distorcem o rosto), ATRÁS da placa — o buraco
    do aro é vazado no PNG. O `idle` já toca sozinho (assets.ts).
    - **O enquadramento vem do OSSO `head`, não da caixa do modelo**: a `Box3`
      é a geometria em BIND POSE e no Knight ela sobe até y=2,543 (a crista do
      elmo) enquanto o pescoço está em 1,241 — 51% da caixa é vazio acima da
      cabeça. Mirar "14% abaixo do topo da caixa" apontava para o alto do
      capacete, e o medalhão mostrava só o topo da cabeça. Os três chars do kit
      compartilham o Rig_Medium e têm o osso `head` no MESMO y (1,241), então
      `getObjectByName("head")` + a distância dele ao topo da caixa dá cabeça e
      ombros em qualquer um deles.
  - **A placa inteira é `pointer-events: none`**: 400×118 de decoração no canto
    engoliriam o clique de andar. Só o aro de classe volta a `auto` (abre as
    habilidades, como o badge antigo fazia).
  - **Tudo que preenche um vazado da arte tem que SOBRAR nas beiradas.** O
    buraco do avatar é um círculo EXATO (raio 77,5 em (122,93), conferido em
    cinco linhas e cinco colunas) e de borda dura — alpha salta 0→255 num pixel.
    Ainda assim, um disco do tamanho exato vaza: a placa é desenhada em escala
    fracionária (400/663) e o recorte redondo do retrato é suavizado, e meio
    pixel abre um fio de céu. `AVATAR_OVERLAP` = 4 px da arte para dentro da
    madeira (o aro tem 12 px de opaco no ponto mais fino, o topo).
  - **O disco que pinta o miolo do aro tem que SOBRAR** (`RING_HOLE_INSET`, 8%):
    o vazado do `ring-level.png` é 75,7% da largura mas 78,1% da altura (imagem
    74×73 com a arte em 73×73, então esticar para um quadrado deixa o furo
    ovalado). Um disco de 76% deixava um fio de céu dentro do anel — o "fundo do
    jogo vazando". Com 84% o excesso fica sob o aro.
  - **Dentro do aro, nada de atalho `font:`**: ele reescreve `line-height` para
    `normal` (~1,2 em), e era essa entrelinha — somada a um `margin-top` — que
    abria o buraco entre o número e o "LVL" e empurrava o par para fora do
    vazado. Com `fontSize` + `lineHeight: 1` a caixa de cada linha é o corpo da
    letra, e o par ocupa ~80% do buraco em qualquer tamanho de placa.
  - **Número não usa Georgia** (`FRAME_NUM_FONT`): os algarismos dela são de
    estilo antigo — 3, 4, 7 e 9 descem abaixo da linha, 0 e 1 têm altura de
    minúscula — e "37187 / 37187" saía embaralhado. Números em Cambria/Times com
    `lining-nums tabular-nums` (tabular para o HP não dançar a cada golpe);
    nome e rótulos continuam em Georgia, que é o que casa com a arte pintada.
- **Botões do menu também saíram do TravelBook** (ui-change.txt): a barra do
  canto inferior-direito usa a arte de `ui_definitiva/tools-right-down`
  (`public/assets/ui/tools/`), listada em `ui/toolIcons.ts` e desenhada em
  `hud/MenuBar.tsx`. Cada PNG é o botão INTEIRO — moldura, fundo colorido e
  desenho —, então não há 9-slice aqui: o botão É a imagem, com o nome por
  cima. Some o `Panel` que existia atrás: a página pixel-art brigava com a
  moldura pintada de cada peça.
  - **`width: auto`, altura fixa**: as sete peças não têm o mesmo tamanho
    (169..177 de largura por ~162 de altura) e a referência as usa como vieram;
    forçar um quadrado deformaria umas e não outras.
  - **Rótulo é o único número que NÃO copia a referência**: lá a maiúscula tem
    10% da altura do botão, mas lá o botão tem 143 px e aqui tem 48 — no mesmo
    proporcional o nome sairia com 5 px. Vai com 17%, que é o teto: em 19% a
    palavra mais longa ("Inventário") encosta na moldura pintada.
  - **Hover/clique mexem só em `transform` e `filter`**: subir 4 px e clarear no
    hover, afundar ao apertar. Mudar largura/altura empurraria os vizinhos a
    cada passada de mouse. O brilho do estado aberto é `drop-shadow` e não
    `box-shadow` — a peça tem canto arredondado com alpha, e box-shadow
    desenharia um retângulo em volta dela.
  - **48 px por botão é o teto de largura**: sete deles dão ~375 px, e a barra
    de skills (centrada, ~520 px) já chega perto dos 900 px numa tela de 1280.
- **Chat vestido com a arte pintada** (ui-change.txt): peças em
  `public/assets/ui/chat/`, medidas em `ui/chatFrame.ts`, moldura em
  `hud/ChatFrame.tsx`, rolagem em `hud/ChatScrollbar.tsx`.
  - **A moldura NÃO é 9-slice**: os quatro cantos são desenhos diferentes e de
    tamanhos diferentes (171×135, 206×137, 171×123, 206×128), com folhagem que
    invade o painel. Cada um é ancorado no seu canto e três trechos retos
    esticam entre eles. O que faz a emenda sumir é o alinhamento MEDIDO na arte:
    trilho de cima 18 px começando 1 px abaixo do topo, esquerda 12 px a 1 px da
    borda, direita 26 px terminando 1 px antes (largo porque inclui a calha
    escura da rolagem — só ~6 px são o dourado).
  - **Cada reto é uma FATIA EXATA do canto vizinho**, e é só por isso que a
    emenda casa sem truque: `mid-bar-extension-top` (19 px) são as 19 PRIMEIRAS
    linhas do canto e `mid-bar-extension-botton` (9 px) as 9 ÚLTIMAS —
    conferido cor a cor (#3f2810/a236, #43382c/a172, #bbb8ad/a75 idênticos nos
    dois). Basta ancorar na mesma borda e desenhar na altura nativa. Enquanto
    topo e base dividiam UMA peça só (o antigo `…-botton-and-top`) não havia
    jeito certo: espelhá-la punha a luz do lado errado, esticá-la clareava a
    base, e o corte + `brightness` que resolvia era remendo.
  - **Trocar de aba SEMPRE cai na última mensagem** (`useLayoutEffect` no
    `tab`): o `scrollTop` é do mesmo elemento nas duas abas, mas a lista muda de
    tamanho — quem estava no fim de uma conversa curta reaparecia no meio de uma
    longa. E enquanto a aba está escondida as mensagens continuam entrando sem
    ninguém rolar, então o valor guardado já nasce velho. Vale para o Geral
    também, que junta todos os canais. Tem que ser `useLayoutEffect`: num
    `useEffect` o navegador chega a pintar um quadro na posição errada.
  - **Aba, canvas e campo de digitar reusam o 9-slice das BARRAS**:
    `border-curve.png` e `reta-buttons.png` do pack do chat são byte a byte
    (md5 igual) os arquivos de `character-up-left`, então `CurvedBox` chama o
    mesmo `barFrameUrl()` de `ui/charFrame.ts`. Não há PNG duplicado.
  - **A barra de rolagem é desenhada por cima da nativa**: o navegador não veste
    a barra do sistema com imagem, então a do canvas é escondida por uma regra
    `.chat-scroll::-webkit-scrollbar` (pseudo-elemento não cabe em estilo
    inline, daí o único `<style>` do app) e `ChatScrollbar` desenha calha, setas
    e cursor de três partes. A posição é LIDA do elemento rolável a cada
    `scroll`, não guardada em paralelo — roda do mouse e auto-scroll mexem no
    `scrollTop` sem passar pelo componente.
  - **Abas são preferência do NAVEGADOR** (`ragnarok:chat-tabs`): Geral, Global
    e Party abrem por padrão, o "+" adiciona Guild/Comércio e o "x" fecha
    (menos o Geral, que é o apanhado e o destino de quem não tem canal). A
    ordem gravada segue `CHAT_TABS`, não a ordem de clique, senão a fileira
    embaralhava. `local` saiu do enum — virou Geral.
  - **Cada canal tem um caminho PRÓPRIO no protocolo** (`session.say`), e usar o
    pacote errado faz a fala sumir sem erro: mapa = CZ_REQUEST_CHAT (0x8c),
    party = CZ_REQUEST_CHAT_PARTY (0x108), guilda = CZ_GUILD_CHAT (0x17e). Os
    três exigem o texto como "Nome : mensagem" numa string só —
    `clif_process_message` valida esse prefixo e descarta o resto. Na volta são
    ZC_NOTIFY_CHAT_PARTY (0x109) e ZC_GUILD_CHAT (0x17f), que agora o gateway
    engancha; sem eles as abas ficavam vazias para sempre.
  - **`#global` e `#trade` NÃO são pacote, são CANAL** (`conf/channels.conf`):
    manda-se pelo pacote de SUSSURRO com o nome do canal no lugar do
    destinatário (clif.cpp:11916), e o rAthena ainda entra no canal sozinho se
    a pessoa não estiver nele e não houver senha — não precisa de `@join`. A
    volta vem toda por ZC_NPC_CHAT (0x2c1); quem separa é o APELIDO no começo
    da linha ("[Global] Fulano : oi"), que é como `channel_send` a monta
    (channel.cpp:466).
  - **O rAthena já manda "Nome : mensagem" pronto** (`clif_GlobalMessage` envia
    o `output` de `clif_process_message`, clif.cpp:11525) — em fala de mapa,
    party, guilda e canal. Procurar o nome pelo `gid` e prefixar de novo, como
    o código antigo fazia, escrevia o nome DUAS vezes na linha.
  - **Prefixo de canal só no GERAL**: lá cada linha abre com "#Guild - " na cor
    do canal e segue em branco (nome e mensagem); dentro da aba do próprio
    canal o prefixo sai, senão seria a mesma palavra em toda linha. O RÓTULO da
    aba também é branco — quem diz o canal é a cor do fundo, e texto verde
    sobre verde some.
- **Barra de habilidades pintada** (ui-change.txt): arte em
  `public/assets/ui/skillbar/`, medidas em `ui/skillBar.ts`, desenho em
  `hud/SkillBar.tsx`. Como a placa do personagem, o fundo é UMA imagem e o resto
  é posicionado em % dela — `BAR_WIDTH` (660) reescala tudo num número só.
  - **Quem define as bordas úteis são os ADORNOS, não o campo verde**: o
    medalhão da esquerda vai até x≈71 (pixel claro mais à direita dele, y=70) e
    a folhagem da direita começa em x≈969 na altura dos slots mas desce para
    x≈910 na altura das barras. Daí o conteúdo abrir em x=80 — começando em 36,
    o primeiro slot passava por cima do medalhão.
  - **`ui/nineSlice.ts` é o montador GENÉRICO** que antes vivia dentro do
    `charFrame`: barras de HP/SP, caixas do chat e slots de skill usam a mesma
    peça de canto superior-direito espelhada quatro vezes. `square-skill.png` é
    exatamente esse tipo de peça (traço de 8 px, canto começando em x=38, pois
    a arte vai até 61 e 61−24+1=38) — é o "4 dessas girando cria um square" do
    change. Sem peça de trecho reto, o montador recorta o quadradinho à
    esquerda do canto, que já é reto puro; as bordas verticais são esse mesmo
    traço GIRADO, porque no `drawImage` a largura da origem vira o comprimento
    do destino e recortar a coluna sairia deitado.
  - **Recarga vem do SERVIDOR** (`ZC_SKILL_POSTDELAY` 0x43d, clif.cpp:6033 —
    `<skill ID>.W <tick>.L`): o cliente não tem como calcular, a duração sai do
    skill_db e de modificadores de status. `net/cooldownStore` guarda o INSTANTE
    em que acaba, não o que falta — o que falta muda a cada quadro e passar isso
    por `setState` repintaria o HUD 60×/s. O cronômetro anima mutando o DOM por
    ref. `durationMs <= 0` é o servidor avisando que ACABOU; tratar como início
    travava o slot.
  - **O valor da XP anda junto com o preenchimento, mas com teto**: na
    referência ele encosta na ponta da barra, e perto de 100% atropelaria a
    porcentagem — então para em 62% da pista.
  - **A barra de XP precisa de largura MÍNIMA e de casa decimal**: no começo de
    um nível alto a fração é microscópica (6.928 de 99.999.999 = 0,007% da
    pista, meio centésimo de pixel) e a barra parecia quebrada. `minWidth` de
    10 px da arte mostra que há progresso, e a porcentagem vai com uma casa —
    arredondada para inteiro ela ficava "0%" parada por horas de jogo.
  - **A placa do paginador é um "D" DEITADO**: a metade tem corpo cheio só até
    x≈37 e os dois trilhos seguem sozinhos até x=53, com o miolo vazado. Por
    isso esticá-la pede três coisas — as duas metades nas pontas, os trilhos
    (`…-extend-top-side`/`-botton-side`) esticando entre elas e um
    preenchimento por baixo. As alturas dos trilhos saíram de casar cor com cor
    no encontro (x=51): a linha 0 do de cima é a linha 4 da placa, a do de
    baixo é a linha 53. E o preenchimento é amostrado na BEIRADA INTERNA da
    metade (x=34), não no centro dela — o corpo tem um escurecido no meio da
    altura, e a cor do centro deixava uma emenda clara no encontro.
    - **Setas e o "1 / 3" precisam de `position: relative`**: a placa é um `div`
      ABSOLUTO e, sem `z-index`, elemento posicionado pinta por cima do
      conteúdo em fluxo — o preenchimento do miolo apagava o número. Enquanto o
      miolo era vazado o problema não aparecia.
  - **Barra de CONJURAÇÃO** (`hud/CastBar`, ui-change.txt): entre o personagem e
    a barra de skills, com 1/3 da largura dela, na mesma coluna flex — assim
    nasce centrada, e como ela some sem conjuração o `gap` não deixa buraco. A
    moldura é o MESMO 9-slice das barras de HP/SP (`curva-das-bordas-barra-hp-sp`
    e `reta-barra-hp-sp` do pacote da conjuração são esses arquivos); o roxo é a
    curva de claridade do HP com a matiz girada para 280°.
    - Quem diz que há conjuração e quanto dura é o SERVIDOR (ZC_USESKILL_ACK →
      `skill:casting`, já no contrato). Some sozinha no fim do tempo E quando a
      skill sai (`skill:cast`) — é o caso de conjuração interrompida ou mais
      curta que a anunciada.
    - **Duração abaixo de 150 ms não abre barra**: skill instantânea chega com 0
      e piscar a barra é pior que não mostrar nada.
    - Conjuração e recarga são zeradas no FIM DA SESSÃO (`useGatewayEvents`):
      os dois cronômetros vivem em `performance.now()`, e sem isso a barra
      ficava congelada na tela de login com o nome da última skill.
  - **`@xp <base%> [job%]`** (`npc-idle/devmenu.txt`) põe a experiência numa
    fração do nível para conferir as barras sem farmar. O rAthena não tem
    atcommand que ESCREVA experiência — `@exp` só mostra —, então vai por
    script, onde `BaseExp`/`JobExp` são graváveis. A conta é `Next / 100 * pct`
    nessa ordem: no nível alto `Next` chega a 99.999.999 e multiplicar antes de
    dividir estoura a faixa.
- **Minimapa pintado** (ui-change.txt): arte em `public/assets/ui/minimap/`,
  medidas em `ui/minimap.ts`, desenho em `hud/Minimap.tsx` + `hud/NotificationBell`.
  - **Metade do pacote é REPETIDA**: `ring-level`, `curva-das-bordas-barra-hp-sp`,
    `reta-barra-hp-sp`, `tab-off`, `arrow`, `rolling-bar-*` e
    `background-rolling-bar` são byte a byte (md5 conferido) os do chat e da
    placa do personagem. Então o aro do sino usa o PNG de `character-frame/`, e
    o popup e a rolagem usam os de `chat/` — só entram no repo os 7 arquivos
    novos (fundo, sino, sol, lua, seta, zoom-in, zoom-out).
  - **O círculo se mede pelo MAIOR VÃO de cada linha e coluna, não por varredura
    radial**: as folhas que entram no aro cortam o raio cedo (dão 153 onde o vão
    real passa de 170) e ainda puxam o centro para cima. Pelo vão o meio é
    estável — 209,5..210 em toda linha e 236,5..237,5 em toda coluna, raio ≈174.
    A coluna do MEIO é a única que discorda (222), porque ali quem corta o vão é
    a placa do relógio e não o aro; foi ela que me fez cravar `cy: 228` na
    primeira vez, e o círculo ficava 9 px alto com um vão de fundo embaixo. O
    raio vai a 178 (4 acima do medido) para o mapa passar POR BAIXO da moldura,
    como o retrato na placa do personagem.
  - **A placa do relógio se centraliza pelo RECESSO, não pela caixa** (x≈90..336,
    y 386..427 → centro 213×406): o desenho tem bisel, e usar a caixa externa
    deixava o relógio alto e à direita dentro dele.
  - **A colisão é pré-desenhada num canvas do TAMANHO DO MAPA**, uma vez por
    mapa; o zoom só recorta um pedaço dele com `drawImage`. Redesenhar 160.000
    células por quadro para seguir o personagem seria impagável.
  - **A janela do zoom é presa às bordas do mapa**: sem a trava, no canto do
    mapa metade da vista seria vazio. Por isso em zoom 1 (mapa inteiro) ela não
    "segue" ninguém — não há para onde correr.
  - **A seta do personagem fica FORA do canvas**: o container do mapa é
    espelhado em X (herança do minimapa antigo, e é o que deixa a orientação
    certa) e a seta sairia invertida junto. Ela é um `<img>` posicionado com
    `lado - x`, que desfaz o espelho só para essa camada; o ângulo sai de
    `atan2(-(dcol), drow)` — na tela, direita é coluna DECRESCENDO.
  - **Sino e popup são MOCK** (`hud/notificationStore`): o gateway não emite
    convite de amizade nem venda na feira. As duas mensagens são as do change e
    estão marcadas no módulo; quando os eventos existirem é só chamar `add()` de
    `useWorldEvents` e nada da tela muda.
  - **O relógio é a hora REAL da máquina**: o rAthena não manda hora de jogo por
    pacote nenhum. Sol das 6h às 18h, lua no resto.
  - `ui/ScrollbarHider` isola a única regra CSS solta do app (esconder a barra
    nativa): quem rola com arte própria monta ela, em vez de o popup depender do
    chat estar montado.
- **Inventário pintado** (ui-change.txt): arte em `public/assets/ui/bag/`,
  medidas em `ui/bag.ts`, desenho em `hud/InventoryWindow.tsx`.
  - **Ele NÃO entra no `Panel` genérico de `Windows.tsx`**: a arte já traz
    moldura, faixa de título e botão de fechar, e a página pixel-art do
    TravelBook por baixo brigaria com a madeira pintada. `Windows` desvia a
    chave `inventory` para o componente próprio; as outras janelas seguem no
    Panel.
  - **Quase tudo é peça REPETIDA** (md5 conferido): `square-skill` é o canto dos
    slots da barra de habilidades, `curva`/`reta` são as das barras de HP/SP,
    `ring-level` é o aro da placa do personagem e `tab-off` é o "x" do chat. Só
    entram no repo três arquivos: fundo, moeda e peso.
  - As faixas saíram do perfil da coluna central do fundo: título em y 16..45,
    campo em y 47..295 e a faixa das contagens em y 297..335. A grade é 5 × 4
    como na referência.
  - **Todo conteúdo sai de UM retângulo** (`BAG_CONTENT`, x 30..264): o campo
    chapado da arte começa em x=14, mas isso é a BEIRADA, colada no bisel.
    Enquanto as caixas iam de 20 a 274 elas encostavam na moldura e aba, slot e
    contador pareciam estourados para fora.
  - **Medida de dentro sai do CONTAINER, não da arte**: o lado do slot vem da
    grade, e dele saem a espessura da moldura, o tamanho do ícone e o corpo do
    número. Com o ícone num número fixo da arte (34) ele ficava MAIOR que o
    miolo do slot e passava por cima da moldura ao aumentar a janela.
  - **Peso sem casa decimal**: o rAthena manda em décimos e "112.1 / 311.0" não
    cabia no contador; o inteiro é o que o jogador usa. Aba e contadores ainda
    levam `ellipsis`/`overflow: hidden` como rede — nenhuma palavra pode
    empurrar a moldura.
  - **"Ouro" é o zeny**: só o nome muda. Peso vem em DÉCIMOS do rAthena
    (`weight`/`maxWeight`), daí o `/10` na hora de mostrar.
- **Janela de Status pintada** (ui-change.txt): arte em
  `public/assets/ui/status/`, medidas em `ui/status.ts`, desenho em
  `hud/StatusWindow.tsx`. Como o inventário, ela sai do `Panel` genérico —
  `Windows` desvia `inventory` e `status` para os componentes próprios.
  - A cena de floresta (fundo do personagem) ocupa x 24..263 do PNG, medida
    pelo verde saturado, que só existe ali; o painel escuro é o resto até a
    moldura. A divisória entre "Status" e "Atributos" veio da proporção da
    referência (0,483 da largura do painel).
  - **A cena de floresta é OPACA**, diferente do medalhão da placa do
    personagem: o retrato vai POR CIMA da placa, não atrás. Atrás dela ele
    simplesmente não aparecia — a cena é o cenário, o boneco é o que fica na
    frente.
  - **Classe vem do SERVIDOR**: o id está em `stats.class` (semeado da lista de
    personagens) e o nome sai do enum `e_job` via `character/jobNames`. Usar o
    `jobName` da ficha local mostrava a classe do demo.
  - As divisórias (entre Nível/Classe e HP-SP, entre HP-SP e os derivados, entre
    Atributos e a dica, e a vertical entre as colunas) são a peça
    `reta-barra-hp-sp` com opacidade, não `border` — assim o traço é o mesmo do
    resto da arte. A vertical gira um filho que nasce DEITADO: `backgroundSize:
    100% 100%` numa caixa já em pé mapearia a espessura no comprimento e
    esmagaria o traço.
  - **Arrastar no avatar gira o personagem** (`CharacterPortrait giravel`), só
    no eixo Y: girar em X deitaria o boneco e o enquadramento — que sai do osso
    da cabeça — deixaria de valer. Meia volta a cada ~180 px de arrasto, aplicada
    por QUADRO mutando `scene.rotation.y`; passar o ângulo por `setState`
    repintaria o HUD a cada pixel de mouse.
  - **A dica mora num "?"** ao lado dos pontos livres, não em texto solto: as
    quatro linhas dela empurravam a coluna para além do fundo e os botões
    Cancelar/Confirmar caíam para fora da moldura.
  - **Teto de 130 por atributo**: no máximo o "+" fica CINZA (`grayscale`), não
    some — sumir tiraria a coluna de alinhamento das outras linhas — e o número
    esmaece junto.
  - **Ponto de atributo é ESTAGIADO**: o "+" só soma na tela e o Confirmar é que
    manda os pedidos. O rAthena não tem pacote de "subir N de uma vez" —
    `CZ_STATUS_CHANGE` sobe um por vez —, então o lote vira uma sequência de
    `stat:raise`. É o que a referência pede ("os pontos são fixados quando
    confirmados"), e o Cancelar existe porque o valor na tela ainda não foi ao
    servidor.
  - O retrato reusa `hud/CharacterPortrait` com `inteiro` (enquadra dos pés ao
    topo em vez do busto) e `fundo={false}` — quem faz o fundo é a cena pintada.
  - As descrições dos seis atributos são as do próprio pacote
    (`especificação de cada status (str-int-etc).txt`), abertas pela seta ao
    lado de cada linha.
- **Janela de Habilidades pintada** (`skills`): arte em
  `public/assets/ui/skills/`, medidas em `ui/skills.ts`, desenho em
  `hud/SkillsWindow.tsx`. Das dezoito peças do pacote, SETE são byte a byte
  (md5) arquivos que o repo já tinha; entram onze — o livro, os dois quadros da
  virada e as oito fitas de classe.
  - **A placa é MAIOR que a arte**: as fitas ficam ACIMA do livro e o aro do "x"
    à direita dele, os dois FORA do desenho. `SK_BOOK` diz onde o livro é
    desenhado dentro dela — o contrário do inventário e do status, onde a arte É
    a janela.
  - **O livro cresce por UM número** (`SK_BOOK_K`, hoje 1,15): páginas, conteúdo
    delas, folha da virada, aro do "x" e a própria placa saem dele. As medidas
    de conteúdo estão em px da ARTE DO LIVRO (`SK_LAYOUT_ART`) e passam por
    `caixaDoLivro`; antes estavam cravadas em coordenada de placa e crescer o
    livro exigia recalcular todas à mão.
  - **Classe é FITA na LATERAL ESQUERDA, não aba em cima**
    (`referencia-da-mark.png`): as fitas ficam EMPILHADAS na margem esquerda, com
    o bico em V apontando para fora e o corpo entrando por cima da lombada. Cada
    cor vem em duas peças — a ponta, na proporção nativa, e o corpo reto
    esticado atrás do texto. A largura sai do PRÓPRIO nome e cresce para a
    ESQUERDA: a borda direita é comum a todas (presa ao livro) e é ela que dá o
    alinhamento da referência, então a pilha é ancorada por `right`, não por
    `left`. `SK_MARK_MARGIN` reserva a margem; nome maior que ela ganha "…".
    - **A pilha vem DEPOIS do livro no DOM**: sem `z-index`, ordem de DOM é
      ordem de pintura, e é isso que põe a fita POR CIMA da madeira. Desenhada
      antes, ela sumia sob a capa.
    - **Altura e vão encolhem com a quantidade** (`pilhaDeMarcas`): a referência
      tem quatro fitas e um personagem de terceira classe chega a seis. O vão
      encolhe primeiro, a fita só depois — assim a pilha nunca vaza do livro.
    - **`SK_PAGE_PAD_L` recua o conteúdo da página esquerda**: a pilha passa por
      cima da lombada, e sem o recuo o nome da habilidade e o retrato começavam
      colados nela. Um número só desloca o bloco inteiro, porque todas as caixas
      da página saem da mesma origem.
    - **O corpo é esticado, não repetido**: a peça é um degradê chapado na
      horizontal, então esticar não mostra emenda — repetir mostraria, porque a
      largura útil quase nunca é múltiplo dos 46 px da peça.
    - **A reticência precisa de elemento PRÓPRIO**: `text-overflow` não age em
      filho de flex container, e sem essa camada o nome era cortado seco no meio
      da letra quando a fileira batia no teto de largura (o livro).
  - **As páginas foram medidas pelo pergaminho**, o único tom claro do PNG:
    esquerda x 30..205, direita 230..405, as duas de y 3 a 222, lombada em
    206..229 — livro simétrico. O conteúdo não usa a página inteira porque ela é
    desenhada em perspectiva e estreita embaixo (em y=210 a esquerda já vai só
    de 33 a 192).
  - **As ABAS saem do PREFIXO do nome aegis**, não de uma árvore de classes: o
    ZC.SKILLINFO_LIST manda a constante ("MG_FIREBOLT") e o prefixo dela é o
    código da classe. As abas são as classes que aparecem nas habilidades que o
    personagem REALMENTE tem — que é o "Noviço | Mago | Wizard | High Wizard" da
    referência, saindo dos dados. `classeDaSkill` casa por IGUALDADE do prefixo,
    nunca por "começa com": `AL_HEAL` é do Acólito e `ALL_RESURRECTION` é comum
    a todos. Prefixo fora da tabela vira ele mesmo e vai para o fim — a mesma
    regra de `character/jobNames`: lacuna em vez de nome errado.
  - **O "x/10" só existe por causa da API**: o ZC.SKILLINFO_LIST manda id,
    nível, SP, alcance e "dá para subir" — o TETO de nível não vem em pacote
    nenhum. `net/skillCatalog` passou a guardar `maxLevel`, `aegisName`, `type`,
    `element`, `spCost`, `range` e `cooldownMs`, e a resolver os campos
    `perLevel` NO NÍVEL do personagem (`ensure(ids, niveis)`) — sem isso o custo
    de SP mostrado seria sempre o do nível 1.
  - **A descrição é COMPOSTA do skill_db, não é texto de sabor**: o
    skill_db.yml não tem campo de descrição, e escrever uma à mão para 1.200
    skills seria inventar. Cada oração de `descrever()` sai de um campo — tipo,
    elemento, alvo e raio de área.
  - **Alcance tem DUAS convenções do rAthena**: negativo é "o alcance de ataque
    da arma" e não uma distância (mostrar "-1 células" seria mentira), e zero
    numa skill usada no próprio personagem é a ausência de alcance, não zero
    célula. Daí "corpo a corpo" / "pessoal" / "N células".
  - **Nome e tipo são UM bloco, não duas caixas fixas**: "WATER MAGIC" da
    referência cabe numa linha, mas "Increase SP Recovery" — nome real do
    skill_db — não, e com altura fixa a segunda linha era cortada no meio da
    letra e passava por cima do tipo.
  - **A folha da virada é PRESA NO VINCO, não centrada nele**, e a virada tem
    QUATRO quadros (`animacao-da-pagina.png`, que mostra os quatro montados
    sobre o livro). Os dois desenhos do pacote são as duas aberturas — larga e
    estreita — e cada um aparece dos DOIS lados: larga à direita → estreita à
    direita → estreita à esquerda → larga à esquerda. É a folha subindo do lado
    direito, passando da vertical e caindo no esquerdo. Centrada na lombada,
    como eu tinha feito antes, ela flutuava em vez de girar em torno da costura.
    - No lado esquerdo o mesmo desenho vai espelhado em X e a âncora passa para
      a borda DIREITA dele — a costura é o ponto fixo nos dois lados (conferido
      no navegador: a folha encosta no vinco com erro de 0,02 px).
    - **Voltar percorre a mesma lista ao contrário**, o que sai de graça porque
      cada quadro já carrega o lado.
    - **A folha vai em tamanho NATIVO × `SK_BOOK_K`**, o mesmo fator do livro —
      os dois crescem juntos. Derivar a altura de uma caixa estimada no olho
      deixava a folha a 89% do tamanho certo, pequena dentro do livro crescido.
      Medido nos quatro quadros da referência (o livro deles está em tamanho
      nativo): o topo do pergaminho cai em y=40/41 do quadro e a ponta da folha
      em y=0/1, ou seja, ela começa 36 px ACIMA da arte do livro; a altura
      nativa de 274 leva a dobra de baixo a y=238, ainda dentro da capa. As
      larguras conferem — a larga vai do vinco a 347 e sua ponta aparece até
      x=344; a estreita, a 282 contra 281 medidos.
  - **Subir skill é `CZ_UPGRADE_SKILLLEVEL` (0x112), um nível por vez**, como o
    atributo. O "+" só aparece quando o SERVIDOR disse `upgradable` e ainda há
    ponto; pré-requisito de árvore quem valida é ele, e a recusa volta calada. A
    confirmação chega em ZC_SKILLINFO_UPDATE, que o gateway já engancha — a
    lista se atualiza sozinha, o cliente não soma nada.
- **Barras de HP/SP do MUNDO usam a moldura pintada** (`net/WorldBar` +
  `ui/barTexture.ts`): a plaquinha do mob e as barras embaixo do personagem
  passaram a ter a mesma moldura das barras do HUD. A arte de
  `ui_definitiva/skill-cast` é byte a byte (md5) `curva-das-bordas-barra-hp-sp` +
  `reta-barra-hp-sp`, que o repo já tinha — nenhum arquivo novo entrou.
  - **`ui/nineSlice.ts` não serve aqui**: ele monta um atlas de 56×56 para
    `border-image`, que é CSS. No mundo 3D a barra é um plano com material, e
    esticar aquele atlas num plano largo deformaria os cantos. `barTexture`
    compõe a moldura JÁ no tamanho final — cantos em tamanho fixo, só os trechos
    retos esticados — e devolve uma `CanvasTexture`.
  - **A textura é cacheada por proporção ARREDONDADA**: a barra do mob e a do
    personagem têm proporções parecidas, e sem o arredondamento cada fração
    geraria um canvas. Assim todos os mobs da tela compartilham uma textura só.
  - **O miolo da moldura é transparente** e o preenchimento é plano PRÓPRIO por
    baixo: a moldura é imagem fixa, e é a largura do plano de baixo que anima o
    valor.
  - **A barra precisou ENGORDAR** para o desenho aparecer: 0,05 → 0,085 de
    célula no mob e 0,10 → 0,115 no personagem. No fio de antes a moldura virava
    uma linha só. O nome do mob subiu junto (0,10 → 0,115 de célula), senão
    ficava miúdo ao lado dela.
- **Layout de conteúdo do `CurvedBox` vai em `inner`, NUNCA em `style`**
  (next-change.txt de 2026-08-04): o `style` é do elemento de FORA, cujos únicos
  filhos são as duas camadas absolutas da moldura — um `display: grid` ali não
  governa nada. Os filhos moram no elemento de dentro. Foi assim que o aviso de
  loot (`hud/LootToast`) saiu com o ícone numa linha e a mensagem na outra: a
  grade `auto 1fr` existia, aplicada ao elemento errado, e os dois filhos caíam
  em fluxo normal (um `div` de bloco e um `span`).
- **Janela de Missões pintada** (`quest`): arte em `public/assets/ui/quest/`,
  medidas em `ui/quest.ts`, desenho em `hud/QuestsWindow.tsx`. Das doze peças do
  pacote, NOVE são byte a byte (md5) arquivos que o repo já tinha; entra uma —
  `background.png`, a placa inteira (o `rs.png` é a mesma arte numa tela 2× mais
  larga, arquivo de trabalho).
  - **As missões são MOCKUP** (`QUEST_MOCK`): o projeto não vai usar as do
    rAthena e o sistema próprio ainda não existe, então a janela não fala com o
    gateway. Oito missões autorais num arquivo só — quando houver missão de
    verdade é a constante que sai, nenhum componente da tela conhece a origem
    dos dados de perto.
  - **A placa é NORMALIZADA antes de entrar na escala comum**: a arte tem
    1783×1454, contra 294 do inventário e 601 do status. `WINDOW_SCALE` aplicado
    direto nela daria uma janela de 2.496 px. `QT_PLATE` (560×457, a MESMA
    proporção) é o tamanho lógico que passa pela escala da família, e
    `daArte()` converte as medidas — assim o "x", as fontes e a rolagem
    continuam do tamanho das outras janelas.
  - **O PNG foi reamostrado**: 1783 px de largura para uma janela que renderiza
    a 784 é 2,3× de sobra, e o arquivo original tinha 2,2 MB — 8× o maior asset
    de UI do repo. Reamostrado para 1120 px com paleta, ficou em 416 KB, na
    faixa dos outros fundos (o status tem 276 KB). A cena é pintada com pouca
    variação de tom, então a paleta não bandeia.
  - **A janela tem DOIS fundos e por isso DUAS tintas**: o painel da lista é
    escuro (creme sobre ele) e o pergaminho do detalhe é claro (marrom sobre
    ele) — a mesma divisão do livro de habilidades. As recompensas ficam sobre a
    CENA DE FLORESTA, não sobre o pergaminho, então voltam para a tinta clara:
    com o marrom do detalhe elas sumiam no fundo.
  - **NEM o cartão de pergaminho NEM o painel do detalhe estão na placa**: a
    cena de floresta vai de ponta a ponta. Sem o pergaminho, o texto escrito
    direto nela some entre as folhas; sem o painel marrom
    (`QT_LAYOUT_ART.detailPanel`), faixas, recompensas e botões flutuavam sobre
    a mata e pareciam fora do painel. O marrom também é o CONTORNO: tudo da
    direita soma exatamente a altura dele.
  - **Só o CORPO do texto rola** (`ChatScrollbar` própria dentro do
    pergaminho): descrição comprida é comum, e esticar o cartão empurraria as
    recompensas para fora do painel. Nome e objetivos ficam fixos no topo e na
    base — o contador é o que o jogador confere e não pode sair da vista.
    - **`ChatScrollbar` ganhou `auto`**: com ele a barra some quando não há o
      que rolar (trilho vazio ao lado de um parágrafo curto parecia defeito).
      Ela some por LARGURA ZERO e continua MONTADA de propósito: quem mede o
      excedente é o `medir`, e ele precisa do trilho no DOM para saber a altura
      do vão — desmontada, a barra nunca descobriria que passou a ser
      necessária. Vale para as DUAS barras da janela (a lista de missões e o
      texto do detalhe). Medido no navegador nas duas: 0 px sem excedente,
      18,2 px com.
  - **O painel COBRE a cena inteira**: a floresta vai de x 747 a 1718 e de y 196
    a 1396 (algumas colunas até 1414) e o painel vai de 745 a 1720 e de 194 a
    1420, passando de cada borda para não sobrar um fio de verde na emenda.
    Recuado, o verde aparecia em volta de todo o conteúdo. Faixa, recompensas e
    botões recuam mais 60 px de cada lado que o pergaminho — é esse degrau que
    separa a leitura da recompensa.
  - **Na lista só há DOIS glifos**: "?" enquanto a missão não acabou e "✓"
    quando está pronta. O "!" da referência não é usado; quem separa disponível
    de em andamento é a COR do "?" (dourada chama atenção, apagada não).
  - **Os botões dividem a largura em partes iguais** (`flex: 1 1 0`) e o rótulo
    é curto de propósito: "Parar de rastrear" não cabia e roubava espaço do
    vizinho, deixando os dois de tamanhos diferentes. Quem diz que a missão está
    sendo rastreada é o ESTADO do botão ("Rastreando", aceso), não o
    comprimento da frase.
  - **A tipografia mora num objeto só** (`FONTE`, sete papéis saindo de `TYPE`):
    antes cada bloco escolhia o corpo no lugar de uso e o nome da missão saía do
    mesmo tamanho do título da janela, sem hierarquia.
  - **O título NÃO é centrado na placa**: a barra de madeira só existe do x≈700
    para a direita e o aro do "x" ocupa a ponta dela, então centrar na placa
    inteira jogava "Missões" visivelmente para a direita.
- **Acesso rápido às missões** (`hud/QuestTracker` + `hud/questStore`): quadro
  fixo LOGO ABAIXO DO MINIMAPA com as três primeiras missões aceitas, cada uma
  com um botão de rastrear. Moldura é o 9-slice das barras (`CurvedBox`) —
  nenhum arquivo de arte novo.
  - **Minimapa e quadro na MESMA coluna flex** do HUD, não em dois `top`
    cravados: assim o quadro acompanha a altura do minimapa, e como ele some
    quando não há missão aceita o `gap` não deixa buraco. A largura é
    `MINIMAP_WIDTH` — com largura própria a coluna ficava escalonada.
  - **"Só uma ativa" sai de graça**: `rastreada` é UM id no store, não uma
    lista. Rastrear outra sobrescreve, sem nenhuma checagem.
  - **O estado mora num store, não na `QuestsWindow`**: duas telas precisam
    concordar (o quadro e a janela do Alt+U). Marcar no quadro acende na janela
    e vice-versa; clicar no nome abre a janela JÁ naquela missão.
  - **Só missão ACEITA entra** (`active`/`done`): a `available` não foi pega, e
    pôr no rastreador algo que o jogador não aceitou seria mentira. O progresso
    mostrado é o do primeiro objetivo não cumprido — é o que ele está fazendo
    agora, e listar todos viraria a janela inteira.
- **Janela de Mapa pintada** (`map`, Alt+M): medidas em `ui/mapWindow.ts`,
  desenho em `hud/MapWindow.tsx`, arte em `public/assets/ui/map/`. Das dez peças
  do pacote, OITO são byte a byte (md5) arquivos que o repo já tinha — os quatro
  cantos com folhagem e os dois retos laterais são os do CHAT, `ring-level` é o
  aro da placa do personagem e `tab-off` é o "x". Entram DOIS: a placa de
  madeira do título e o mapa-múndi pintado.
  - **A moldura é a do CHAT, e o `ChatFrame` serve a TERCEIRA tela** (chat 0,5 ·
    login 0,72 · mapa 0,62). Ele já era parametrizado por `escala` justamente
    porque os quatro cantos são desenhos DIFERENTES e o alinhamento medido entre
    as oito peças é a parte difícil — copiar o componente duplicaria isso.
  - **O mapa-múndi é JPEG**, a segunda imagem não-PNG do projeto (a outra é o
    fundo do login), e pela mesma razão: pintura de tela cheia, sem alpha
    (`sharp().stats().isOpaque`). Em PNG ele tem **3,7 MB** — 8× o maior asset
    de UI do repo; reamostrado para 1200×800 e em q84 fica em **321 KB**, na
    faixa do fundo do status (276 KB). 1200 px é 1,4× a largura de render do
    campo (834 px): folga para hi-dpi sem pagar pelos 1536 originais.
  - **A placa do título é 3-slice, não uma imagem esticada**: medido no PNG
    (363×41), a folhagem ocupa ~70 px de cada ponta e o miolo é madeira lisa de
    veio horizontal. Vai por `border-image` com `fill` e slice só no eixo X — o
    mesmo mecanismo do 9-slice das barras, num eixo só. Esticada inteira, as
    folhas das pontas achatariam junto.
  - **O canvas de colisão é COMPARTILHADO com o minimapa**
    (`hud/colisaoCanvas.ts`, `WeakMap` chaveado pelo `GameMap`): as duas telas
    desenham o MESMO mapa, e um canvas por tela seria o dobro do bitmap (640 KB
    num 400×400) para o mesmo pixel. A paleta também é a do minimapa
    (`MM_COLORS`) — duas paletas fariam o campo mudar de cor ao abrir a janela e
    o jogador leria como outro lugar. O y é invertido no canvas (norte em cima)
    e o espelho em X continua sendo do CONTAINER de quem desenha: ele é o que
    faz a orientação bater com a da câmera (no mundo 3D o +x cai à ESQUERDA da
    tela), e assar o espelho na fonte quebraria as duas contas de posição já
    provadas do minimapa.
  - **A navegação é UMA função pura** (`enquadrar`), e o que ela existe para
    garantir é o CLAMP: sem ele o arrasto leva o mapa para fora do campo e o
    jogador fica olhando o vazio sem saber como voltar. Em zoom 1 o conteúdo
    cabe inteiro, a folga é zero e o gesto é inerte de propósito — não há nada
    fora da vista para procurar. `panAoAproximar` mantém sob o ponteiro o ponto
    que já estava lá, senão aproximar joga a vista para o centro do mapa e o
    gesto vira "aproxima e procura de novo". Travadas em `ui/mapWindow.test.ts`.
  - **O arrasto mora num REF, não em estado**: ele muda a cada `pointermove`
    (~100×/s), e um `setState` ali repintaria a janela a cada pixel de mouse — a
    mesma razão do giro do retrato no Status. Pelo mesmo motivo a coordenada do
    personagem é escrita no DOM por ref, de dentro do laço de 20 fps.
  - **A roda vai por `addEventListener` com `passive: false`**: o React registra
    `wheel` como PASSIVO na raiz, e num `onWheel` o `preventDefault` seria
    ignorado — a página rolaria atrás da janela em vez de dar zoom.
  - **O mapa-múndi NÃO marca onde você está**, e é escolha: não existe tabela
    ligando os mapas do rAthena às terras pintadas. Inventar a posição seria
    pior que a lacuna (a mesma regra do "—" da Lista de Amigos); o rodapé diz
    isso em uma linha. Quando houver região, o marcador entra sem mexer no resto
    da tela.
  - **`Windows.tsx` passa `map`/`playerPos`** (as mesmas duas coisas que o
    minimapa recebe): sem sessão — preview do editor — quem sabe onde o boneco
    está é o ref da cena, não o `worldStore`.
  - **Botão de zoom desabilitado precisa de disco escuro por baixo**: em
    opacidade 0,4 sobre a pintura (que tem uma rosa dos ventos clara bem onde
    ele fica) o "−" SUMIA, e some com ele a única pista de que dá para afastar.
- **Uma escala SÓ para as janelas com arte própria** (`ui/windowChrome.ts`):
  inventário, status e amigos multiplicam toda medida de dentro por
  `largura de render ÷ largura da arte`, e cada uma tinha a sua — 1,43 / 1,26 /
  1,53. O mesmo número de arte virava três tamanhos na tela: o aro do "x" saía
  com **43,0 px no status, 48,6 no inventário e 67,1 nos amigos**, a fonte do
  título com 21,5 / 27,1 / 29,0, a aba com 40,0 contra 30,5. `WINDOW_SCALE`
  (1,40) passa a valer para as três, e aí um px de arte vale o MESMO px de tela
  em qualquer uma — a correlação deixa de precisar de manutenção, em vez de
  depender de uma tabela de tamanhos que alguém tem que lembrar de atualizar.
  - **1,40 saiu do INVENTÁRIO**, a janela mais densa (5×4 slots): é ela que fixa
    o piso legível, e na escala nova ela praticamente não se mexe (420 → 412 px,
    slot 61,1 → 59,9). O status cresce 11% (760 → 841) e os amigos encolhem 8%
    (700 → 643) — os dois estavam fora da curva, não o inventário.
  - **`CHROME` e `TYPE` estão em px de ARTE, não de tela**: como a escala é
    comum, escrever `px(TYPE.title)` já garante o mesmo corpo nas três. Os
    valores são a média do que elas praticavam, convertida de volta — nada dá
    salto visual; muda quem estava fora (o "x" e a rolagem dos amigos).
  - `TYPE` tem seis degraus (title/section/name/label/small/tab) e nada fora
    deles. Antes cada janela escolhia o corpo no lugar de uso — só o status
    usava 17, 15, 14, 13, 11, 10,5, 10 e 9 —, e rótulos de mesmo papel saíam
    diferentes de uma tela para a outra.
  - A altura da placa dos amigos foi de 252 para 258 para absorver a aba mais
    alta (`CHROME.tabH`) sem perder a quinta linha da lista (medido: 5,03).
  - O CHAT fica de fora: a arte dele foi medida na própria moldura
    (`FRAME_SCALE` 0,5) e ele não é uma das três janelas de conteúdo.
- **Lista de Amigos pintada** (`friend-list`): medidas em `ui/friends.ts`,
  desenho em `hud/FriendsWindow.tsx`, dados em `net/friendStore.ts`. É a
  primeira janela SEM PNG de fundo — o pacote só traz a referência e peças
  soltas, e das onze **dez são byte a byte** (md5) arquivos que já existiam
  (`curva`/`reta` das barras, `square-skill`, `ring-level`, `tab-off`, `arrow`,
  `rolling-bar-*`, `background-rolling-bar`, o "+" do chat). Só
  `friends-icon.png` entrou no repo. A moldura é o 9-slice das barras em escala
  grande (`CurvedBox`), que é justamente o desenho da referência.
  - **A altura é a ÚNICA medida que não copia o mockup**: 258 em vez de 242. A
    moldura de lá é um traço fino, a nossa tem `border` de 10 px de arte — e nos
    242 originais o "+ Adicionar Amigo" terminava a 4 px da borda, ou seja, por
    baixo da madeira. Os 16 px a mais devolvem a margem e a aba mais alta da
    escala comum sem espremer as cinco linhas (medido: cabem 5,03 no campo).
  - **A aba de amigos NÃO tem nível nem classe, e isso é do protocolo**: em
    PACKETVER 20130618 o ZC_FRIENDS_LIST é `{ AID, CID, nome }*`
    (clif.cpp:15355) e o online/offline vem separado, em ZC_FRIENDS_STATE
    (0x206, sem nome — casa pelo par de ids). Mapa do amigo não existe em pacote
    nenhum desta faixa. Por isso a linha escreve "—" onde a referência escreve
    "Nv. 32 / Guerreiro / Veridia": inventar seria pior que a lacuna.
  - **A aba de GUILDA tem a linha inteira**: ZC_MEMBERMGR_INFO (0x154) manda
    nome, nível, classe, online e cargo — é a única lista de gente do protocolo
    completa. Ela só chega quando PEDIDA (CZ_REQ_GUILD_MENU tipo 1,
    clif.cpp:14310), e o mesmo vale para os bloqueados (CZ_REQ_WHISPER_LIST →
    ZC_WHISPER_LIST 0xd4). O gateway pede as duas no `world:ready`, senão a
    primeira abertura da janela vinha vazia.
  - **A lista de amigos chega ANTES do HUD existir**: `clif_friendslist_send` é
    chamado em `pc_authok` (pc.cpp:2252), bem antes do NOTIFY_ACTORINIT. O
    gateway guarda e reenvia no `world:ready`, como já fazia com stats,
    inventário e entidades — sem isso a janela abria vazia até alguém logar ou
    deslogar. Corolário: quem escuta esses eventos é o `useGatewayEvents` (vive
    desde o login), não o `useWorldEvents` (monta com a cena).
  - **"Recentes" não é do servidor**: o rAthena não tem lista de "vistos por
    último". É memória do NAVEGADOR (`friendStore.verJogador`), alimentada por
    `entity:spawn` de jogador e por quem fala no chat, com teto de 40 e "cena"
    ganhando de "chat". Existe pelo caminho que o RO não tem: ver o nome,
    clicar e convidar sem digitar.
  - **Adicionar amigo é convite, não gravação**: CZ_ADD_FRIENDS manda o pedido,
    o outro lado responde e só então o par é gravado (clif.cpp:15475). Os quatro
    resultados do ZC_ADD_FRIENDS_LIST são traduzidos no GATEWAY
    (`ADD_FRIEND_RESULT`) — número cru de protocolo não vai para a UI. Resposta
    do convite recebido: `Result` 0 = recusa, ≠0 = aceite (clif.cpp:15508).
  - **`ChatScrollbar` passou a aceitar `largura`**: a arte foi medida no vão do
    chat (11,5 px) e, num vão maior, a barra saía fina e encostada num lado. As
    alturas das peças acompanham na mesma proporção — seta e ponta do cursor são
    desenhos, e esticar um eixo só as deforma.
  - **`Windows.tsx` desvia por `switch`, não por ternário**: inventário, status,
    amigos, habilidades e missões saem do `Panel` genérico, e o TS só estreita `openWindow` (tirando as
    cinco do `Record` de TITLES/CONTENT) depois de um `switch` com `return`.
- **Bug do gateway consertado junto**: a fila de perguntas de nome
  (`queryName`) chamava `requestName` → `sendMap` de dentro de um `setInterval`,
  e quando a conexão de mapa já tinha sumido o `throw` acontecia FORA de
  qualquer try — o processo do gateway inteiro morria e derrubava todas as
  outras sessões. Agora o tick confere `this.map` e para a fila
  (`pararFilaDeNomes`, também usado no `close`).
- **VFX de skill e NPC**: `vfx/` desenha o que o servidor manda — área/cast =
  disco com gradiente (shader), buff = anel + coluna, impacto = flash. Medidos
  em CÉLULAS (`cellSize`), senão o mesmo efeito some num hexScale e cobre a tela
  noutro. NPC: clique manda `CZ.CONTACTNPC` e a janela (`hud/NpcDialog`) só
  mostra o que o script do servidor devolve; fechar avisa (`CZ.CLOSE_DIALOG`),
  senão o script fica preso esperando resposta.
- **Gateway guarda o último estado** (stats, status, inventário, skills e
  ENTIDADES) e reenvia no `world:ready`. O map-server anuncia mobs/NPCs uma vez
  só, logo após o NOTIFY_ACTORINIT: quem não estava escutando naquele instante
  nunca mais recebe. Trocar de mapa limpa a lista.
- **`world:ready` sai quando a SESSÃO entra no mapa**, não quando a cena 3D
  monta (`net/useGatewayEvents`): o rAthena só considera o personagem ativo
  depois dele — sem isso, chat, `@comando` e movimento eram ignorados, e o
  jogador ficava preso num mapa sem cena 3D.
- **Uma célula = um personagem** (`charScale` default 1, `server-config`): é
  essa proporção que faz o passo em tile parecer Ragnarok. Com 0,34 o mundo
  virava "quadrados gigantes" e o mob parecia voar (1 célula por passo, célula
  5× o boneco). `CHAR_SCALE_REF` (play/useGameplayConfig) tem que acompanhar o
  default, senão a câmera se afasta em todo mapa com hexScale ≠ 1.
- **Monstro se desenha da NÉVOA para dentro**, e isso são DOIS números que têm
  de concordar:
  - **o servidor decide quem EXISTE** (`area_size`, `rathena-conf/battle_conf.txt`):
    o rAthena só anuncia spawn/vanish/move de quem está dentro desse raio, e o
    padrão 14 células vem do cliente 2D. O valor certo é onde a névoa FECHA
    (`fogFar` = 120 unidades ÷ 2 por célula = **60 células**), não onde ela
    começa: com 45 (o `fogNear`), tudo entre 45 e 60 células estava à vista e
    vazio, e o mob estalava no meio do campo limpo em vez de emergir da névoa.
    Medido com 45: 20 monstros à vista, de 19 a 45 células, contra ZERO com 14.
  - **quantos monstros o mapa TEM é decisão nossa, e o prt_fild08 usa o spawn do
    RO ORIGINAL** (`npc-idle/mobs/prontera.txt`): o renewal põe **271** ali (20
    linhas, 8 delas caixas de agrupamento — `263,79,90,90` sozinha são 20
    Fabres); o pre-renewal põe **140**, e é esse o número do jogo original.
    Trocado para 140: Poring 70, Lunatic 40, Pupa 20, Drops 10, os quatro em
    `0,0` (mapa inteiro, sem caixa). Conta: com 271 em 400×400, o quadrado de
    121×121 do `area_size` anuncia ~24,8 monstros; com 140, ~12,8 — e some o
    ponto quente, porque parado dentro de uma caixa do renewal dava bem mais que
    a média. Cada anunciado é uma subárvore React montada no cliente.
    - **`npc/scripts_custom.conf` é o ÚNICO lugar de onde dá para fazer isso**,
      e a razão é ordem de execução: `npc_delsrcfile` (`src/map/npc.cpp`) faz
      `vector_erase_if_exists`, então só vale DEPOIS que o arquivo oficial entrou
      na lista. Em `map.cpp`, `map_config_read` (:5357, que lê o nosso
      `conf/import/map_conf.txt`) roda ANTES de `map_reloadnpc` (:5363, que traz
      os spawns), e só em `do_init_npc` (:5444) a lista é lida de verdade — um
      `delnpc:` no `map_conf.txt` seria no-op. O `scripts_custom.conf` é a última
      linha do `npc/re/scripts_main.conf`, depois de todos os `import:` de spawn.
      Chega ao rAthena por SYMLINK (`scripts/wsl-setup.sh`), como o `conf/import`
      e o `npc/game-project`; nada dentro de `rathena/` no repo é escrito.
    - **`delnpc:` apaga o ARQUIVO, e ele cobre DOZE mapas** (`prt_fild00`..`11`),
      não só o 08. Por isso `npc-idle/mobs/prontera.txt` é uma CÓPIA do oficial
      com apenas o bloco do `prt_fild08` trocado — conferido por diff: os outros
      onze saem byte a byte iguais ao renewal. Ao subir de versão o rAthena, é
      essa cópia que precisa ser reconciliada.
    - **A migração NÃO enxerga isto** e é de propósito: `migrate-npcs.ts:26`
      pula `scripts_custom.conf` e `migrate-monsters.ts:127` lê a cadeia vanilla,
      então o `spawns` do JSON do mapa continua com os 271 do renewal. Só afeta o
      PREVIEW do editor (`entities/previewSpawns`) — no `/play` com sessão quem
      manda spawn é o map-server, e ele lê o nosso arquivo.
  - **o cliente decide quem é DESENHADO** (`NetEntity`, corte radial pela
    distância até a CÂMERA — a mesma conta que a névoa faz por fragmento). O
    servidor mede num QUADRADO de células, então com 60 o canto da diagonal
    chega a 170 unidades, bem além das 120 da névoa; sem o corte, esses bichos
    seriam desenhados 100% da cor da névoa. É `visible = false`, não desmontar:
    desmontar devolveria o custo de criar modelo, plaquinha e barra a cada
    travessia da fronteira, e o raycaster pula objeto invisível de graça.
  - **Não é de graça**: a área anunciada cresce com o QUADRADO do raio — 29×29 =
    841 células (padrão) viram 121×121 = 14.641, ~17× mais entidade por jogador
    em pacote e em processamento. Num servidor de desenvolvimento é irrelevante;
    com multidão, é o primeiro número a revisar.
  - **Não é de graça**: a área anunciada cresce com o QUADRADO do raio — 29×29 =
    841 células viram 91×91 = 8.281, ~10× mais entidade por jogador em pacote e
    em processamento. Num servidor de desenvolvimento é irrelevante; com
    multidão, é o primeiro número a revisar.
  - **`@reloadbattleconf` aplica sem reiniciar** (e sem derrubar quem está
    logado): foi assim que a troca foi conferida ao vivo.
- **Plaquinha do mob vem de PERGUNTA, não do spawn**: o pacote de spawn traz só
  o nome; `Lv.`/`HP:` chegam no campo de nome de PARTY do ACK_REQNAMEALL, e só
  para quem manda CZ.REQNAME (`show_mob_info: 5` = HP absoluto + nível,
  `monster.conf`). O gateway pergunta de toda entidade nova, numa fila (4 a cada
  120 ms) com UMA repetição 1,5 s depois — perguntado no instante do spawn, o
  mob responde só com o nome. Spawn manda `hp: -1` para "não sei": repassar isso
  apagava o HP já conhecido, então vira `undefined` no gateway e no store.
- **Entrar num mapa ESQUECE o mundo que ficou para trás**
  (`worldStore.limparEntidades`, chamado no `world:enter` de
  `net/useGatewayEvents`): era daqui que saía "o mapa parece ter muito mais
  monstro do que tem". O rAthena **não manda `NOTIFY_VANISH` por entidade ao
  teleportar** o jogador — `pc_setpos` emite `clif_clearunit_area(*sd,
  CLR_TELEPORT)`, que fala dos OUTROS para este jogador, e depois o
  `ZC_NPCACK_MAPMOVE`; quem recebe MAPMOVE tem de limpar sozinho, e é o que o
  cliente oficial faz. O gateway já limpava o snapshot dele (`this.entities
  .clear()` no hook do MAPMOVE), mas o store do navegador não limpava nada — e
  como o gateway acabara de esquecer aquelas entidades, o `entity:vanish` delas
  NUNCA chegaria.
  - **O caso é o warp de MESMO MAPA**, que é o comum: `@jump`, warp de NPC
    interno, Asa de Borboleta e morte-e-respawn. Cada um deixava para trás as
    ~13 entidades que estavam à vista, congeladas na última célula, para sempre
    — e elas somam a cada warp. Não era duplicação (gateway e store dedupam por
    gid), era ACÚMULO.
  - **Trocar de mapa escapava por ACIDENTE**: o `mapId` muda → o `useMap`
    devolve `null` enquanto busca → o `WorldEventsBridge` desmonta → o `clear()`
    da limpeza do efeito roda. Depender de três camadas sem relação para limpar
    a lista de entidades é frágil demais para ser a regra; agora os dois casos
    passam pelo mesmo caminho e o do mapa novo só limpa o que já estava vazio.
  - **`limparEntidades` e não `clear`**: o `self` tem de sobreviver. Quem
    reposiciona o personagem num warp de mesmo mapa é o `self:warp`
    (`aplicarFixpos`) que chega LOGO ATRÁS, e zerar a posição no meio o jogaria
    para a célula 0,0 por um quadro. `clear()` continua existindo e continua
    sendo do FIM DA SESSÃO. Item no chão limpa junto (`useGroundItems`), que
    nem snapshot no gateway tem.
  - Travado em `perf/cenarios.test.ts` ("WARP no mesmo mapa esquece tudo que
    estava em volta"): lista e alvo zerados, `self` intacto.
- **NETCODE: predição, reconciliação e interpolação de snapshots**
  (next-change-game.txt de 2026-08-04). O alvo é internet com jogadores reais
  (40–200 ms), não o WSL local — e é justamente por isso que o **ping simulado
  vem primeiro**: com RTT ~0 nenhuma das três se manifesta, o código pode estar
  errado e parecer perfeito.
  - **`net/pingSimulado` é o banco de provas**: `?ping=120&jitter=40` na URL,
    `__ping(rtt, jitter)` no console para mudar ao vivo. Embrulha `emit` e os
    handlers no `gateway()`, o único ponto de contato com o servidor, só em DEV.
    - **O `off` PRECISA do mapa original→embrulhado**: atrasar a chegada
      significa registrar no socket um handler DIFERENTE do que o chamador
      passou, e um `socket.off(ev, original)` não removeria nada. O
      `useWorldEvents` desmontaria deixando tudo vivo, e cada remonte
      (StrictMode, warp) somaria uma cópia — o mundo processaria cada pacote
      duas, três, quatro vezes. É a única regra de verdade do módulo, e está em
      teste.
  - **O relógio do servidor já chegava e era JOGADO FORA**
    (`net/relogioDoServidor`): `ZC_NOTIFY_MOVE` carrega `moveStartTime`, o
    `gettick()` de quando o trecho começou, e o gateway não o repassava;
    `self:move` até o levava até o navegador e o handler o ignorava. Sem ele o
    trecho era ancorado na hora de CHEGADA, e um pacote de 80 ms fazia a
    entidade recomeçar o caminho do zero — atraso que se SOMA, porque o rAthena
    manda um pacote por trecho.
    - **Estimativa por MEDIANA, não média**: `gettick()` conta ms desde o boot
      do map-server (não epoch), então o desvio para o `performance.now()` só dá
      para estimar, e cada amostra carrega a latência daquele pacote. Um pacote
      de 400 ms envenena a média e não move a mediana. Mesma regra do
      `perf/orcamento.ts`.
    - **Nunca devolver instante FUTURO** (`paraRelogioLocal` grampeia em
      `agora`): um trecho que ainda não começou faria `interpolatedCell` calcular
      `decorrido < 0` e desenhar a entidade ANTES da origem — andando de ré.
    - Corrigido de brinde: `entity:move` mandava `speed: 0` em todo pacote
      (`pkt.speed ?? 0`, e a struct 0x86 não tem esse campo), então velocidade de
      mob nunca atualizava depois do spawn. Agora vai a do snapshot.
  - **CLIENT-SIDE PREDICTION** (`preverMovimento` + `emitir` no `NetPlayer`): o
    personagem sai andando no instante do clique, sem esperar o
    `ZC_NOTIFY_PLAYERMOVE`. Antes ficava CRAVADO — com 100 ms de ping mais os até
    200 ms da janela do `filaDePedidos`, passava de 300 ms até o primeiro pixel.
    - **Prever é seguro AQUI porque o cliente já é uma cópia do servidor**: o A*
      de `net/pathfind` é portado de `path.cpp`, e o pedido só chega ao `emitir`
      depois de passar por `destinoAlcancavel` e pelo teto de `max_walk_path` —
      as mesmas regras que o rAthena aplica antes de aceitar. Reusa a MESMA
      `buildMotion`, então previsto e confirmado têm forma idêntica e o desenho
      não sabe a diferença.
    - **Não se prevê sem pathfinder nem sem caminho**: sem colisão (preview do
      editor) é adivinhar, e sem caminho o `buildMotion` cai no passo de REI —
      a reta que atravessa parede, exatamente o "dash" que `net/moveTarget`
      existe para impedir.
    - **A janela de 200 ms deixa de ser sentida sem precisar ser mexida**: o
      pedido espera na fila, o boneco não. E ela existe por um bug do rAthena
      (`unit.cpp:876`), então mexer nela seria errado.
    - O WASD chegou a passar pelo `emitir` para não divergir do clique; depois
      foi removido inteiro (ver "O WASD foi REMOVIDO" abaixo).
  - **SERVER RECONCILIATION — e ela JÁ ESTAVA ESCRITA**: o mecanismo que o
    projeto usava para a deriva (manter a posição DESENHADA como origem e pagar
    a diferença em TEMPO, `celulasExtras` esticando os `stepEnds` com clamp
    `[0,5; 2]`) **é** uma reconciliação. Confirmada, ela reancora o trecho sem
    mover um pixel e ainda corrige o adiantamento da predição — o cliente saiu
    ~meio RTT antes, `extras` sai positivo, o trecho estica e os dois se
    reencontram. Divergente, reconstrói para o destino novo a partir de onde o
    personagem está. **Só faltava medir**: `predito` marca o trecho e
    `__mov().predicao.taxaDeErro` é o número que importa — alta quer dizer que
    alguma cópia da regra do servidor saiu de sincronia, e aí o defeito é a
    cópia, não a predição.
    - **…e faltava a FILA DE PENDENTES** (`previstos` no `worldStore`), que é o
      que faltava para o ZIGZAG parar de dar recuada. Reconciliar contra a
      predição CORRENTE só está certo quando há UM pedido no ar. Clicar três
      vezes num RTT põe três: a primeira resposta descreve o clique #1, o
      cliente já previu o #3, e comparar os dois faz #1 parecer divergência — o
      cliente "corrigia" a trajetória de volta para um destino que o jogador já
      tinha abandonado. Quanto mais rápido o zigzag, mais recuadas.
      - É o algoritmo clássico (Gambetta, *Client-Side Prediction and Server
        Reconciliation*): guardar os pedidos enviados, DESCARTAR os
        reconhecidos e REAPLICAR os pendentes por cima do estado autoritativo.
      - **Adaptação ao rAthena**: `CZ_REQUEST_MOVE` não tem número de sequência
        (protocolo de 2002). Mas `ZC_NOTIFY_PLAYERMOVE` traz o DESTINO, e
        destino identifica o pedido igualmente bem — casa-se pelo `to`.
      - **"Reaplicar os pendentes" aqui é trivial**: cada pedido é um destino
        ABSOLUTO, não um input incremental, então reaplicar todos equivale a
        MANTER a predição mais nova. Ack antigo com fila não vazia = não tocar
        na trajetória.
      - **A fila precisa de PRAZO** (`PREVISTO_VALIDO_MS`): o rAthena recusa em
        silêncio (unit.cpp:860), e um pedido engolido ficaria na fila para
        sempre — todo ack seguinte pareceria "antigo" e a reconciliação
        congelaria. Ela também morre em `setSelfCell`, `aplicarFixpos` e
        `clear`: depois de um teleporte, o mundo que aqueles pedidos descreviam
        não existe mais.
      - Travado em `net/predicao.test.ts` (bloco ZIGZAG); conferido que os dois
        casos REPROVAM com a fila desligada.
    - **O MINI-TELEPORTE para o centro do tile ao conjurar skill andando**
      (next-change-game.txt de 2026-08-04) tinha a mesma raiz, e a prova está no
      rAthena: `unit_skilluse_pos2` chama `unit_stop_walking(USW_FIXPOS)`
      (unit.cpp:2750) **oito linhas antes** do `clif_skillcasting` — daí a ordem
      que se via, pulo primeiro e animação depois —, e lá dentro
      (unit.cpp:1734) ele faz `ud->sx = 8; ud->sy = 8` com o comentário literal
      **"Stop on cell center"**. O `ZC_STOPMOVE` não tem campo de sub-célula
      (clif.cpp:2207): o servidor manda `bl.x`/`bl.y`, célula INTEIRA. O "centro
      do square mais próximo" É a célula do servidor.
      - O que era NOSSO: aplicar essa célula **sem animação** quando a diferença
        fosse `< 0,35` célula. A célula mede `SQUARE_SIZE = 2` e o personagem
        ocupa uma — 0,35 é **35% da largura dele, num quadro só**. O comentário
        que justificava o número ("gap desprezível") vale para ruído de float, e
        é essa a ordem de grandeza do `FIXPOS_EPSILON` hoje (0,05).
      - **"Atrás" passou a ser medido pelo RUMO, não por distância à origem.**
        A comparação euclidiana tinha dois furos: numa rota em COTOVELO um ponto
        já percorrido pode estar mais LONGE da origem que a posição atual; e,
        pior, depois de um fixpos a origem do trecho passa a ser a própria
        posição desenhada — `distDoDesenho` virava 0 e "está atrás" ficava
        **matematicamente impossível**, então todo fixpos seguinte cravava a
        célula. Agora é produto escalar com o rumo do PASSO em andamento.
      - **O rumo é memorizado** (`rumoX/rumoY` no `SelfMotion`) porque precisa
        sobreviver ao próprio fixpos: depois de um, o personagem está parado e
        não há passo de onde derivar direção nenhuma.
      - Travado em `net/predicao.test.ts` (bloco "o MINI-TELEPORTE"); conferido
        que o limiar antigo REPROVA o caso da janela 0,05..0,35, e que desligar
        a guarda de rumo reprova quatro casos, incluindo o cotovelo e o segundo
        fixpos.
    - **…e a recuada anterior a essa era o `clif_fixpos`** (`aplicarFixpos`). O rAthena o
      manda sempre que interrompe a caminhada — `unit_stop_walking` com
      `USW_FIXPOS`, o que acontece ao ATACAR (unit.cpp:2975, antes do golpe), ao
      usar skill e ao parar. Sem predição o cliente quase nunca estava à frente e
      o deslize de 120 ms até a célula do servidor era arredondamento; com
      predição ele anda ~meio RTT à frente POR CONSTRUÇÃO, então esse pacote
      passou a apontar sistematicamente uma célula JÁ PERCORRIDA — e deslizar até
      lá é andar de ré.
      - A distinção é geométrica e barata: **o ponto do fixpos está mais perto da
        ORIGEM do trecho do que o personagem?** Então já foi percorrido, o
        servidor é que está atrasado, e o certo é PARAR onde se está — a
        diferença é paga no pacote seguinte, pelo tempo, como sempre.
      - Empurrão para o lado e teleporte continuam sendo aplicados: ali o ponto
        não está atrás na rota (ou o gap passa de `FIXPOS_TELEPORTE`).
      - **Isto INVERTEU uma expectativa deliberada**: `spamDeCliques.test.ts`
        exigia que o personagem CONVERGISSE para a célula do servidor. O teste
        foi atualizado com o porquê da inversão — antes da predição aquele
        deslize era arredondamento, depois dela virou o defeito.
    - **`__mov().recuadas` nomeia o culpado** (`movRecuada` + o campo `causa` do
      `SelfMotion`): quatro ações escrevem a posição do personagem (predição,
      pacote do servidor, fixpos, snap) e cada uma recua por um motivo
      diferente. O detector vive no `useFrame` do `NetPlayer`, compara com o
      quadro anterior SÓ dentro do mesmo trecho (entre trechos a mudança de
      direção é legítima) e anota quem escreveu. Em regime tem de ser zero —
      `porCausa` é onde se olha primeiro.
    - **O ping simulado precisa SOBREVIVER À NAVEGAÇÃO**: o socket nasce no
      LOGIN (é lá que `gateway()` é chamado primeiro), então `?ping=150` na URL
      do `/play` chegava tarde demais — o embrulho já tinha sido instalado com a
      busca da tela de login. Agora o valor é guardado no `localStorage`, vale a
      partir de qualquer tela e `?ping=0` limpa.
  - **INTERPOLAÇÃO DE SNAPSHOTS** (`ATRASO_DE_INTERPOLACAO` = 100 ms): o mundo
    dos OUTROS é desenhado no passado, para o pacote atrasado ainda chegar a
    tempo. Sem isso o trecho terminava, `interpolatedCell` devolvia
    `moving: false`, o mob CONGELAVA em `idle` e o pacote atrasado o fazia
    SALTAR — o "anda aos trancos".
    - **A conta é feita atrasando a ÂNCORA, não o relógio de leitura**: é
      idêntico a renderizar em `now − atraso` e não exige que `interpolatedCell`
      conheça atraso nenhum — o minimapa e os testes de orçamento ganham de
      graça.
    - **Mas EXIGE fila.** Tentei sem, e o teste pegou: como o pacote seguinte
      chega ANTES de o trecho anterior terminar na tela (essa antecipação é
      justamente a folga comprada), sobrescrever jogava a folga fora e a
      entidade SALTAVA para a frente. `proximo` guarda um trecho; chegando um
      terceiro, o guardado é promovido antes, senão o pedaço de caminho que ele
      descrevia seria pulado.
    - **A âncora atrasada vale inclusive quando cai no FUTURO** (entidade parada
      recebendo trecho novo). Prendê-la em `agora` parecia cautela e era o
      contrário: o mob parado saía na hora e o que já andava saía atrasado —
      dois relógios para o mesmo mundo. Quem o segura é o `decorrido < 0` do
      `interpolatedCell` (estritamente menor: `=== 0` é o trecho começando
      AGORA, e tratá-lo como futuro faria toda predição nascer parada).
    - **Nunca para o jogador local** — `selfMove` é outra ação, e atrasar o
      próprio personagem seria desfazer a predição. Travado em teste, porque a
      garantia é fácil de perder se alguém "unificar" as duas ações.
    - O atraso desloca o alvo do clique num mob em movimento nesses 100 ms. É a
      única coisa deste bloco que o jogador pode sentir; subir ajuda em rede
      ruim e piora a mira.
- **Reposicionamento do próprio personagem**: teleporte/empurrão dentro do mapa
  é `ZC_STOPMOVE` (fixpos) / `ZC_HIGHJUMP` (slide) com o AID do jogador —
  `self:warp` no contrato. Sem tratar, o cliente seguia desenhando a célula
  velha e todo pedido de andar saía do lugar errado (depois de um `@jump`,
  andar simplesmente parava de funcionar). **Dentro do mapa o bloco do jogador é
  o ACCOUNT id**, não o `gid` que o char-server devolveu (esse só vale no
  handshake) — daí `isSelf()` aceitar os dois; comparando só com o `gid`, o
  próprio teleporte era tratado como movimento de outra entidade.
- **Alvo de clique não pode ser `visible={false}`**: o raycaster do three PULA
  objeto invisível, e era por isso que clicar no mob não fazia nada. O cilindro
  de clique some pelo material (`transparent`, `opacity 0`, `colorWrite false`)
  e continua clicável.
- **SMART TARGET: o clique perto de um alvo vale como clique NELE**
  (`play/aimAssist` + `play/softLockStore`). A hitbox já foi engordada, mas ela é
  uma caixa no espaço 3D — câmera afastada, bicho atrás de um prop, ou mob
  andando entre o apertar e o soltar do botão, e o raio passa raspando: o clique
  vira "andar até ali" e o personagem sai CORRENDO em vez de bater, que é o pior
  resultado possível num jogo de clique.
  - **A conta é em PIXEL DE TELA, não em célula.** O jogador não mira no chão,
    mira na tela. Com a câmera inclinada o mesmo pixel vale muito mais célula
    longe do que perto, então a versão em unidades de mundo escolhia o monstro
    que não estava debaixo do ponteiro. Cada candidato é projetado com
    `Vector3.project(camera)` e convertido por `useThree(s => s.size)` — px de
    CSS, não de dispositivo (o canvas tem teto de `dpr` 1,5, e as duas medidas
    divergem numa tela hi-dpi).
  - **Projeta-se o CORPO, não o pé.** O ponto é o centro do cilindro de clique
    do `NetEntity` (0,62 célula; loot em 0,2). Projetando o chão, numa câmera a
    ~26 unidades com fov 50° o corpo cai ~26 px acima — e o mouse chega POR CIMA,
    então metade do raio de 48 px ficava atrás do bicho, do lado por onde ele
    nunca passa. Era o "aim assist não funciona".
  - **Pontuação, e TODOS os termos em pixel**, para o peso ser uma frase que se
    lê: `-distPx − min(12, distJogador × 1,5) + 14 se ele está te batendo`. "Está
    me atacando" é o termo que mais muda a sensação (no meio de três mobs é quase
    sempre o que se quer) e sai de graça do `entity:action` que já chega —
    `net/ameacas`, um `Map<gid, instante>` com validade de 4 s, FORA do zustand
    porque é lido por candidato por quadro.
  - **"Na tela" e "dentro da névoa" são PORTA, não bônus**: somar pontos a um
    alvo fora da vista o deixaria ganhar de um candidato de verdade num empate
    ruim.
  - **UMA avaliação por quadro serve o realce E o clique.** Ela publica no
    `softLockStore` (`{ gid, tipo: "mob" | "item" }`) e o clique só LÊ. Enquanto
    eram duas execuções da mesma função em instantes diferentes, o mouse podia
    andar no meio: acendia um monstro e o clique pegava outro.
  - **O ponteiro do sistema NÃO pode ser puxado** — não existe API que o mova (o
    Pointer Lock só o esconde e entrega deslocamento relativo). O retorno é o
    realce do alvo travado, e ele precisou de força 0,46: em 0,34, sobre grama
    clara e em movimento, o jogador não via que havia trava e concluía que a
    assistência não existia.
  - **Skill de ÁREA fica de fora**: ali o alvo é a CÉLULA, e puxar o ponto mudaria
    onde a magia cai — quem mirou o vão entre dois monstros mirou de propósito.
  - `__mira()` no console (DEV) devolve ponteiro, alvo e a distância em pixel de
    cada mob, ordenada: é como se responde "por que ele não travou" sem adivinhar.
    Custo medido: **0,004 da calibração** para 40 candidatos
    (`perf/entidades.test.ts`).
- **O clique de andar para no primeiro prop** (`play/GroundInteract`): o alvo de
  clique é um PLANO em y=0, então o raio atravessa a árvore e acerta o chão atrás
  dela — mirando a copa de um prop escalado 5× isso caía **28 células adiante**
  (medido), e parecia teleporte. Agora o raio é testado contra o grupo
  `map-props` e o hit mais próximo vence. Complemento: clique em célula bloqueada
  (árvore, parede, penhasco) anda até a andável mais próxima, em anéis — pedir
  caminho para dentro do obstáculo era pedido que o servidor descarta calado, e
  o clique "não fazia nada".
- **Encadear trecho de caminhada exige PROGRESSO** (`net/NetPlayer`): o pedido é
  quebrado em 16 células e o resto fica em `destinoFinal`; se o A* nunca alcança o
  alvo (célula de árvore, ilha cercada), reencadear a cada chegada fazia o
  personagem vagar sozinho pelo mapa, mudando de rota — só encadeia quando o
  trecho aproxima do destino.
- **ATAQUE BÁSICO é um MODO, não um comando** (`net/ataqueBasico`,
  next-change.txt de 2026-08-04): ligado, o personagem vai até o alvo e bate até
  o alvo MORRER, o jogador CLICAR FORA ou a skill ser DESLIGADA — as três
  desligam. Vale igual para corpo a corpo e distância, porque quem decide
  alcance e dano é o servidor; o cliente só mantém a ORDEM de pé.
  - Reusa a ordem de vários quadros que o clique no mob já cria (`net/acoes` +
    `attackStore`). O que a skill acrescenta é PERSISTÊNCIA através das trocas
    de alvo — é o que faz o Tab virar combate sem mais nenhum comando.
  - **Id NEGATIVO** (`-1`): a barra guarda id por slot e o rAthena usa
    positivos, então não há colisão possível — e número negativo na barra torna
    óbvio, na leitura, que aquilo é coisa do cliente.
  - As reações moram num `subscribe` do `worldStore`, fora do React (como o
    cursor da mira em `net/aimStore`): é regra que vale enquanto a SESSÃO
    existir, não enquanto um componente estiver montado. "Alvo sumiu" já limpa
    `target` no `vanish`, então "até matar" sai da mesma porta que "troquei de
    alvo", sem evento novo.
  - **A barra nasce com ele no slot 0** (`skillBarStore`, `version: 1` +
    `migrate`): ele não vem do servidor, então não aparece na janela de
    habilidades e não haveria de onde arrastá-lo. Quem já tinha barra salva
    recebe no primeiro slot LIVRE, para não atropelar a arrumação.
- **TAB cicla o inimigo, com a direção da CÂMERA pesando** (`play/cicloDeAlvo` +
  `play/AlvoPorTab`): a regra de ordenação é pura e testável, a leitura do mundo
  fica com quem tem câmera. `PESO_CAMERA` é 12 CÉLULAS — convertido para a
  unidade da distância, o peso vira uma frase que se lê ("um mob bem à frente
  vale como se estivesse 12 células mais perto que um às costas") em vez de um
  fator adimensional que ninguém sabe justificar.
  - **Não reusa `play/aimAssist`**: aquela responde "em quem o clique cairia
    deste pixel" e é um FILTRO com raio; o Tab não filtra, ORDENA o campo e
    percorre. Fatores parecidos, perguntas diferentes.
  - O olhar da câmera é projetado no PLANO DO CHÃO: crua, a direção dela aponta
    para baixo e todo alinhamento encolheria pelo cosseno da inclinação.
  - Campo vazio devolve `null` e o chamador MANTÉM o alvo — apertar Tab sem
    ninguém por perto não é motivo para largar o mob já mirado. E o `gid`
    desempata, senão a ordem dançaria entre uma tecla e outra.
  - Tab **seleciona**, não ataca. Quem transforma seleção em golpe é o Ataque
    Básico, e é essa separação que deixa mirar antes de decidir.
- **O chão sob o mob diz TRÊS coisas** (`net/GlowChao` + `NetEntity`): ponteiro
  em cima (`realce`), a assistência de mira escolheria este (`travado`) e é o
  alvo SELECIONADO (`alvo`). O último ganha um ARO — circunferência fechada, um
  uniform a mais no mesmo shader —, porque seleção é um estado que DURA e precisa
  ser legível de relance no meio de um bando. O brilho subiu (0,46 → 0,62 na
  trava): sobre grama clara e em movimento, o que havia se perdia no chão.
- **Aviso de loot é UM, e o drop novo substitui** (`hud/lootStore`): a pilha de
  quatro existia para o segundo item não apagar o primeiro antes de ser lido, mas
  numa caçada o que se lê é sempre o de cima e quatro linhas viram parede.
  Sobrevive o AGRUPAMENTO (cinco poções = "×5", com o relógio renovado), porque o
  rAthena manda um `inv:add` por item. A chave de render só muda quando o aviso é
  OUTRO — somando, remontar o nó reiniciaria a entrada.
- **Inventário: 4 colunas, nome truncado e rolagem** (`ui/bag` +
  `hud/InventoryWindow`). Com 5 colunas o slot ficava estreito demais para a
  faixa do nome caber embaixo, e nome de item do RO passa de trinta caracteres —
  era o "Alt+E quebrado". `encurtarNome` corta em 12 (nove + "…"), e o excedente
  virou problema de ROLAGEM em vez de espremer mais coisa na mesma largura. A
  barra é a MESMA do chat: as peças do pacote da bolsa são byte a byte (md5) as
  que o repo já tinha, e nenhum arquivo novo entrou.
  - `gridAutoRows` com a altura do slot, não `1fr`: com fileira fracionária a
    grade tentaria caber TODAS na altura visível e os slots encolheriam conforme
    a bolsa enchesse.
- **O painel do F9 fica à ESQUERDA do minimapa**, não no canto superior-esquerdo
  — lá ele cobria a placa do personagem, justamente as barras que se quer olhar
  enquanto se mede. `MINIMAP_WIDTH` é importado, não copiado: mexer na largura do
  minimapa tem de mover o painel junto.
- **A primeira `idle` NÃO tem `fadeIn`** (`assets.useCharacter`): peso zero
  significa BIND POSE, e era daí que saía o T-POSE ao abrir o Alt+Q — dois
  décimos de segundo de boneco de braços abertos. Pior no retrato do HUD, que
  roda em `frameloop="demand"` a 24 Hz: são cinco quadros parados na T-pose. Não
  há o que interpolar na PRIMEIRA animação, e um `mixer.update(0)` na sequência
  aplica a pose antes do primeiro quadro desenhado.
- **`/login` e `/char-select` vestidos** (`ui/login`, `ui/LoginChrome`): cena
  pintada de tela cheia e painel com a moldura de folhagem — que é a MOLDURA DO
  CHAT. Os quatro cantos do pacote de login são byte a byte (md5) os de
  `public/assets/ui/chat/`, e `ring-level`, `tab-off` e as peças da rolagem
  também; do pacote inteiro só DOIS arquivos entraram: o fundo e a seta.
  - **O `ChatFrame` ganhou `escala` em vez de ser copiado**: a arte tem cantos
    DESENHADOS (não é 9-slice) e o alinhamento medido entre as oito peças é a
    parte difícil — duplicar o componente para mudar um número duplicaria isso.
    0,72 aqui contra 0,5 do chat, porque o painel passa de 600 px e na escala do
    chat a folhagem viraria um fio em volta de um vão enorme.
  - **O fundo é JPEG — a única imagem do projeto que não é PNG.** Ela não tem
    alpha (medido: 3 canais) e é pintura de tela cheia: PNG com paleta deu
    1.055 KB contra **523 KB** do JPEG na mesma qualidade. Todo o resto da UI é
    PNG porque precisa de recorte; esta não precisa.
  - As barras da ficha são as MESMAS do HUD (`ui/CurvedBar` + `HP_FILL`): a
    primeira vez que o jogador vê o HP dele é ali, e trocar de barra na tela
    seguinte seria estranho.
- **CONJURANDO NÃO ANDA** (`net/castStore: estaCastando`, guarda única no
  `pedirMovimento` do `NetPlayer`): a regra é do servidor — `unit_can_move`
  (unit.cpp:1813) devolve `false` enquanto `ud->skilltimer` está ativo. Sem
  consultá-la, o cliente PREVIA a caminhada e o personagem saía andando no meio
  da conjuração.
  - **Pior que a divergência visual**: `unit_walktoxy` NÃO descarta o pedido de
    quem não pode mover — ele AGENDA (unit.cpp:876,
    `add_timer(ud->canmove_tick+1, unit_delay_walktoxy_timer, …)`). O clique
    dado durante a conjuração ressuscitava ao fim dela e levava o personagem
    para um destino de segundos atrás. É a mesma armadilha que o
    `filaDePedidos` já documenta para o spam de clique, por outra porta.
  - O pedido é **DESCARTADO, não guardado**: guardar seria reproduzir de
    propósito o timer do rAthena. Quem clicou durante a conjuração quer andar a
    partir de onde vai estar quando ela acabar.
  - **Compara com `fim`, não com `atual !== null`**: conjuração interrompida nem
    sempre traz um `skill:cast` para limpar o store, e um `atual` pendurado
    travaria a caminhada PARA SEMPRE — o pior defeito possível aqui. O relógio
    resolve sozinho, e isso é teste (`net/castBloqueiaMovimento.test.ts`).
  - `SA_FREECAST` (o Sage anda conjurando) fica de fora: é a exceção do próprio
    `unit_can_move` e exige estado de skill que o cliente ainda não tem.
- **A POSIÇÃO JÁ É CONTÍNUA — o que faltava era não obedecer ao snap do
  servidor** (next-change-game.txt + leia.txt, 2026-08-04). O pedido era migrar
  para "posição lógica em tiles, física em float"; a resposta é que **essa é a
  arquitetura que existe desde sempre**. `interpolatedCell` devolve célula
  FRACIONÁRIA e é ela que desenha; os doze `Math.round` do caminho de movimento
  produzem a célula LÓGICA a partir da física e nunca escrevem de volta
  (`origemCel` serve ao A*, `origem` serve ao desenho — variáveis diferentes, de
  propósito). A conversão é contínua ponta a ponta: `serverToLocal` é subtração,
  `clampToWindow` é `min/max`, `squareToWorld` é `(col + 0.5) * SQUARE_SIZE`.
  - **O mini-teleporte ao castar vinha do SERVIDOR, e é deliberado**:
    `unit_stop_walking` com `USW_FIXPOS` (unit.cpp:1732) faz `ud->sx = 8;
    ud->sy = 8;` com o comentário literal *"Stop on cell center"*. O rAthena TEM
    sub-célula (0–15, 8 = centro) e a força ao interromper a caminhada — que é o
    que acontece ao castar (:2477), ao atacar (:2975) e ao parar. O
    `ZC_STOPMOVE` que sai carrega só x/y inteiros.
  - **E não dá para recuperá-la**: `clif_walkok` (ZC_NOTIFY_PLAYERMOVE,
    clif.cpp:2056) manda `WBUFPOS2(..., 8, 8)` **cravado** para o dono do
    personagem; a sub-célula real (`ud.sx, ud.sy`) só viaja para as OUTRAS
    unidades (clif_set_unit_walking, clif.cpp:1414). Para o personagem local o
    protocolo simplesmente não tem posição fracionária.
  - **A divisão certa não é por DISTÂNCIA, é por CAMADA**
    (`preservandoSubCelula`): a CÉLULA é do servidor, sempre, sem tolerância; o
    deslocamento DENTRO dela é do cliente, e mudança de estado não tem o direito
    de tocá-lo. `alvo = celulaDoServidor + (atual − round(atual))`.
    - O caso "não mover" **cai fora da fórmula sozinho** — mesma célula ⇒ o alvo
      É a posição atual. Sem limiar novo e sem exceção escrita à mão.
    - Não é "ignorar diferença menor que uma célula": isso deixaria os dois
      permanentemente divergentes, que foi a objeção certa do usuário à minha
      primeira proposta. Como o offset é limitado a meia célula por construção,
      o `Math.round` da posição — que é o que A*, alcance e colisão leem —
      continua sendo a célula do servidor. Travado em teste.
    - Teleporte (> `FIXPOS_TELEPORTE`) é a única exceção e continua snapando no
      centro: ali não há offset anterior que signifique alguma coisa.
  - **Vale para o MOB também** (`stop`): ele parava no centro do tile a cada
    golpe, com `durationMs: 0` cravado no inteiro — e há dezenas na tela. Isto
    NÃO é sub-célula para monstro: a IA e o movimento deles seguem em células
    inteiras, como no rAthena. É só remoção de snap artificial.
  - Travado em `net/subCelula.test.ts` (conferido: **5 dos 9 casos REPROVAM**
    sem a correção). Um teste antigo de `net/predicao.test.ts` cravava o
    comportamento anterior — deslizar até o CENTRO — e foi reescrito: a premissa
    dele mudou, não o código quebrou.
- **A PREDIÇÃO quebrou três coisas em silêncio, e o sintoma foi "andando longe,
  o personagem trava, VOLTA algumas células e segue"** (next-change-game2.txt de
  2026-08-04). A investigação está no laudo; o resumo é que os chunks — a
  suspeita natural — não têm nada a ver: `grep` em `src/grid/` não tem um único
  import de `worldStore`/`playStore`, e a interpolação é por
  `performance.now()`, então quadro longo faz o personagem ADIANTAR, nunca
  recuar. Chunk e `Context Lost` são o fornecedor de ENGASGO; a causa é outra.
  - **O cliente tomava o PRÓPRIO PALPITE por resposta do servidor**
    (`net/emenda: respostaDoServidor`): `movedAt` é reescrito pelos quatro
    caminhos do `worldStore.causa`, e um deles é `preverMovimento` — chamada
    DENTRO do `emitir`, logo depois de abrir a janela de resposta. A comparação
    de `movedAt` no quadro seguinte via "chegou pacote". `predito` já
    distinguia os dois; faltava consultá-lo. Com isso morriam **o prazo de
    resposta** (e a recusa silenciosa do rAthena, unit.cpp:860, deixava de ser
    detectada — com o cliente já andando para um destino descartado) e **a
    guarda "há pedido no ar" da emenda**.
  - **A emenda virava um laço de 5 Hz**: `quaseLa` é verdadeiro em TODO quadro
    das últimas três células, e sem a guarda o `filaDePedidos` emitia a cada
    200 ms — um A* completo e um `move:to` cada. Precisa de **duas** guardas: a
    de "pedido no ar" NÃO cobre a repetição depois de a resposta chegar (o
    pacote fecha a janela e o quadro seguinte ainda tem `quaseLa`). O dedupe é
    pelo `movedAt` do TRECHO, nunca pelo destino — o destino final é o mesmo na
    caminhada inteira, e é por isso que compará-lo não filtra nada.
  - **A reconciliação estava DESLIGADA justamente quando mais importa**
    (`worldStore.selfMove`): ack antigo com fila não vazia fazia `return s`,
    descartando o pacote INTEIRO. Preservar a trajetória está certo (é reaplicar
    os pendentes do algoritmo clássico), descartar o pacote não — junto iam a
    reancoragem e o `extras`, que é o único lugar onde a deriva é lida de volta.
    E como durante a emenda há sempre pedido no ar, isso valia o tempo todo. As
    duas coisas agora são separadas: **o destino vem da predição mais nova, o
    TEMPO vem do pacote**.
  - **O desenho NUNCA anda de ré** (`servidorAtras` em `selfMove`): bastava o
    trecho do cliente FECHAR (`interpolatedCell` devolve `moving: false`) e o
    desvio passar de `DESVIO_PARADO_MAX` para `origem = from` valer — salto seco
    para a célula do servidor, atrás. Mede-se por quem está mais longe do
    destino; se o `from` tem mais caminho pela frente que a célula desenhada,
    ele descreve um ponto já percorrido. Não há risco: o trecho construído
    TERMINA em `to`, então manter a origem desenhada muda o formato do caminho,
    não o ponto de encontro. A porta continua aberta para a divergência de
    verdade (servidor pondo o personagem de LADO).
  - **`predito` tem de ser zerado por QUEM FALA PELO SERVIDOR** — `selfMove` já
    fazia; `aplicarFixpos` e `setSelfCell` não. Sem isso a janela de resposta
    ficava aberta depois de um fixpos e o prazo matava o destino de uma
    caminhada perfeitamente boa.
  - **O `Context Lost` × 19 do console era o `TargetFrame`** (`hud/PlayerFrame`):
    ele fazia `return null` sem alvo, e o retrato dentro dele é um `<Canvas>` do
    R3F — ou seja, um `WebGLRenderingContext` DESTRUÍDO E RECRIADO a cada
    seleção/deseleção. O `dispose()` do R3F não libera contexto (só
    `forceContextLoss()`, e mesmo assim o objeto fica até o GC); o Chrome mantém
    ~16 vivos e, ao estourar, **força a perda do MAIS ANTIGO — o canvas do
    jogo**. Agora a placa guarda a última ficha e some por CSS.
  - **A pré-carga vazava para dentro do jogo**: a tela de carregamento tem teto
    de tempo (`TETO_PRECARGA_MS`), e ao cair por estouro a fila continuava
    cheia — o `useFrame` do `SquareTerrain` seguia construindo 6 ms POR QUADRO
    enquanto o jogador andava, que é exatamente o desperdício que a tela existe
    para eliminar. `precarregar` passou a valer só enquanto a cortina está no
    ar. E a projeção de memória somava só o TERRENO, ignorando a lâmina d'água
    num cache separado — subestimar VRAM alimenta o item anterior.
  - Travado em `net/caminhadaLonga.test.ts` (conferido: **4 dos 9 casos
    REPROVAM** sem as correções) e `net/emenda.test.ts`, que testa a SEQUÊNCIA
    de quadros — um teste de valor isolado não pegaria nenhum dos dois.
- **O StrictMode desligava o PATHFINDER a sessão inteira, e com ele todo o
  netcode** (next-change-game2.txt, laudo com o flight recorder). `PlayView`
  registra a busca de caminho no RENDER (`useMemo`) e limpa no desmonte
  (`useEffect(…, [])`); em DEV o React monta, DESMONTA e remonta cada
  componente — a limpeza roda e o `useMemo` **não** re-executa no remonte,
  porque as dependências não mudaram. `pathfinder` ficava `null` da entrada no
  mapa até recarregar a página.
  - **Nada quebra, e é isso que o torna perigoso**: sem pathfinder o
    `buildMotion` cai no passo de rei e o jogo continua "funcionando". Some, em
    silêncio: a predição (`temPathfinder() && passos > 0` no `emitir`), o
    caminho do A*, a quebra por `max_walk_path` (`caminho.length` é 0, então
    `0 > trechoMax` nunca é verdade) e a emenda (sem `destinoFinal`).
  - Medido no `/play` com sessão, mesmo mapa e mesmos cliques: **`passos` 0 →
    27, `previstas` 0 → 1/1, `self.path` ausente → presente** só desligando o
    StrictMode. E com ele nulo, três pedidos de **exatamente 32 células** foram
    descartados EM SILÊNCIO pelo servidor (`max_walk_path` = 30) — é o "clique
    não faz nada / trava um instante".
  - **A duração do trecho passa a sair da distância em LINHA RETA** enquanto o
    servidor anda o caminho real, mais longo: o cliente termina cedo, SEMPRE, e
    fica à frente. Deriva mediana medida no dump do usuário: **7,8 células**
    (máx 12,98), contra 3,2 no pior caso com o pathfinder ativo e ping simulado
    de 260 ms.
  - A correção é registrar nos DOIS lugares: no render (a razão de sempre — o
    efeito do FILHO roda antes do efeito do PAI) **e** num efeito com as mesmas
    dependências, que devolve o registro depois de qualquer limpeza. Escrever a
    mesma função duas vezes é idempotente.
- **`clif_fixpos` só é TELEPORTE acima de `FIXPOS_DERIVA_MAX` (8), não acima de
  `FIXPOS_TELEPORTE` (3)**: eram o mesmo número e a faixa entre eles não
  existia, então qualquer correção acima de 3 células virava salto seco — **e o
  salto pulava a guarda `servidorAtras = !teleporte && paraTras`**, que existe
  justamente para não andar de ré. O laudo pegou o caso: `fixpos-teleporte
  {alvo:"265,187", desenho:"265.00,194.00", gap:7, paraTras:true}` e, no quadro
  seguinte, o personagem **7 células atrás, 10,5 ms depois**. O pacote DIZIA que
  o ponto já fora percorrido. Na faixa nova valem as regras de sempre: para trás
  SEGURA (a diferença é paga em tempo pelo `extras` do pacote seguinte), para
  frente DESLIZA. Travado em `net/predicao.test.ts` (2 casos, conferido que
  REPROVAM com o corte antigo). O `stop()` das OUTRAS entidades segue em 3 —
  mob não tem predição, logo não tem adiantamento para justificar a folga.
- **Caixa-preta do cliente: `core/diagnostics/flightRecorder.ts`** (`__voo` no
  console, seção no F9). Uma linha POR QUADRO num anel colunar (`Float64Array`,
  1.800 quadros ≈ 30 s) + anel de 512 eventos com categoria; quando um gatilho
  dispara, os 300 quadros anteriores e os 120 seguintes viram um "caso" com
  timeline e export JSON. Existe porque o defeito era de CORRELAÇÃO: `movDebug`
  conta eventos e `perfProbe` mede o quadro, e nenhum dos dois põe duas séries
  no mesmo instante.
  - **Não importa nada do jogo** — recebe números e strings, nunca um
    `SelfMotion`. Quem conhece o jogo é o chamador.
  - **Nenhum objeto por quadro**: o gravador não pode produzir a pressão de GC
    que ele existe para acusar. Escreve-se num rascunho compartilhado
    (`quadro()`), copiado campo a campo para as colunas em `confirmarQuadro()`.
  - **`walkId`**: uma caminhada longa é vários trechos e dezenas de pacotes; sem
    um id comum, ligar "esta predição" a "este ack" e "este quadro" é
    reconstrução manual. Ele nasce no gravador, não no jogo.
  - **O gatilho de rollback tem de olhar ENTRE trechos**: o detector de recuada
    do `NetPlayer` só compara quadros do mesmo trecho (`ant.movedAt ===
    self.movedAt`) — e o solavanco acontece exatamente na troca, porque o fixpos
    escreve um trecho novo e move o personagem no mesmo quadro. Por isso as três
    primeiras capturas do laudo tiveram de ser MANUAIS. O critério que funciona
    não sabe de trecho: mais de UMA célula num quadro **e** mais do que o tempo
    decorrido permitia (com 50% de folga) — a segunda condição existe porque a
    interpolação é por relógio, e um engasgo de 400 ms avança 2,6 células sem
    que nada esteja errado.
  - **A caixa-preta enxerga o DEVICE** (categoria `renderer`,
    `core/diagnostics/rendererProbe.ts` — leia1.txt): contexto perdido/
    restaurado, canvas e renderer nascendo e morrendo, shader recompilado,
    textura/geometria subindo e descendo, e as colunas `renderMs`, `gpuMs`,
    `memoriaGpuMb`, `heapMb`, `contextosVivos`, `rendererId`. Render e
    movimento são a MESMA investigação: os `Context Lost` × 19 do retrato do
    alvo produziam engasgo, e engasgo é o gatilho do salto de posição — por
    isso tudo cai no mesmo anel em vez de num medidor à parte.
    - **`render` e `renderer` são categorias diferentes**: a primeira é
      propriedade do QUADRO (o marco `quadro-longo`, o próprio `gatilho`), a
      segunda é o ciclo de vida do device.
    - **Gatilhos**: `contextoPerdido` (sempre), `frameLongo` em **200 ms** — em
      50 a carga de mapa dispara de imediato e queima os quatro slots de caso —
      e `rendererRecriado`. Este último era declarado e **nunca disparou**:
      ninguém chamava `avaliarGatilho("frameLongo", …)`.
    - **`rendererRecriado` exige TRÊS condições, e a primeira custou um
      falso-positivo** (pego no primeiro dump de verdade,
      `voo-1785932685455.json`): renderer NOVO por IDENTIDADE (`WeakSet` do
      `gl`), canvas do JOGO, e o anterior tendo vivido mais que
      `VIDA_MINIMA_MS` (1000). A sonda vive num `useEffect`, e **efeito que
      roda de novo não é renderer novo**: o `<Canvas>` fica FORA do
      `<Suspense>` do `PlayView`, mas o `PerfProbe` e a `Scene` ficam DENTRO —
      re-suspender destrói e recria os efeitos dos filhos com o MESMO `gl`. As
      outras duas: abrir a janela de Status não é defeito, e o StrictMode
      recria tudo no boot.
      - **O laudo dizia isso e eu não estava lendo**: `canvasNovo: false` e
        `contextosVivos` parado em 3 do começo ao fim. Nem o elemento nem a
        contagem de contextos tinham mudado — só a subárvore React (geometrias
        166 → 101, texturas 75 → 46, um quadro com 0 draw calls). O remonte
        continua REGISTRADO (`sonda-remontada`), porque ele derruba a cena;
        só não é motivo de captura.
    - **Destruição do renderer é `gl.dispose()`, não a limpeza do efeito** (o
      `dispose` é embrulhado na instância). A limpeza emite `sonda-desligada`,
      que é o que ela de fato sabe. A distinção é o próprio defeito dos
      `Context Lost`: o `dispose()` do R3F **não libera o contexto**, então
      "destruído" e "abandonado" são estados diferentes e é o segundo que
      acumula até o Chrome derrubar o mais antigo.
    - Os retratos do HUD seguem emitindo evento e contando em `contextosVivos`,
      que é o número que denuncia o churn.
    - **A captura precisou de PRAZO** (`LIMITE_CAPTURA_MS` = 2000): ela só
      fechava depois de 120 `confirmarQuadro()`, e o caso que mais importa aqui
      é justamente aquele em que o QUADRO PARA. Fecham-na três caminhos, os três
      necessários — o próprio `confirmarQuadro`, um `setTimeout` (para quando
      não vem quadro nenhum) e o `despejo()`, senão baixar o JSON logo depois de
      provocar a perda devolveria um arquivo sem ela.
    - **`abrirQuadro()` faz o anel girar sem sessão**: quem fechava a linha era
      o `NetPlayer`, e ele só monta com sessão e `mapping` — no preview do
      editor, num mapa sem cena 3D ou na tela de erro o gravador não gravava
      NADA, telas em que uma investigação de render é perfeitamente possível.
    - **Contador vira evento COALESCIDO** (500 ms): a pré-carga são 169 chunks e
      o aquecimento são dezenas de shaders; um evento por mudança expulsaria do
      anel de 512 exatamente a rede e a predição que a captura existe para pôr
      lado a lado. Em regime o delta é 0 e nada é emitido.
    - **`gpuMs` é escrito de VOLTA** (`preencherQuadro`): o
      `EXT_disjoint_timer_query_webgl2` responde vários quadros depois, e
      anotá-lo na linha corrente atribuiria o custo ao quadro errado. `renderMs`
      (CPU) vem de embrulhar `gl.render` na instância e ACUMULA, porque o
      `EffectComposer` do filtro retrô chama uma vez por passe.
      - **E ele é o número que o F9 não respondia**: medido no `prt_fild08` com
        GTX 1660 Ti, **GPU p50 9,0 ms contra CPU 4,0 ms** — a 60 FPS o vsync
        escondia que o custo é mais que o dobro do lado de lá.
      - **A cobertura depende do POOL** (hoje 8): com 4, só 105 de 414 quadros
        saíam com `gpuMs` e havia lacunas de até 22 quadros — o driver demora e,
        com o pool cheio, o quadro seguinte não começa medida nenhuma. Lacuna é
        honesta (`null`), mas série com um quarto dos pontos é ruim para achar
        pico.
    - **A ÁRVORE DA CENA é outra investigação** (categoria `cena`,
      `core/diagnostics/cenaProbe.ts` + `assetProbe.ts` — leia1.txt de
      2026-08-05, referência `desmontando.jpg`): o mundo 3D some por ~1 quadro e
      volta com o device SAUDÁVEL. O overlay do caso é o que orienta: **0 draw
      calls e 0 triângulos**, mas `geo/tex/prog 190/78/20` (geometria toda
      alocada), `renderer #1` (nunca recriado), HUD intacta (ela vive FORA do
      `<Canvas>`). Geometria intacta descarta descarte; e como o `GradientSky` é
      `frustumCulled={false}` (desenha SEMPRE), zero draw calls descarta também
      câmera ruim e culling. Sobra: a cena está invisível.
      - **Re-suspender um `<Suspense>` ESCONDE, não desmonta** (r3f 9.6.1,
        `hideInstance`: `object.visible = false`, e `detach` no que entrou por
        `attach` — o `<fog>`). Bate com a assinatura, e é a HIPÓTESE.
      - **Ela é tratada como hipótese, não como causa**, e a instrumentação foi
        feita para poder derrubá-la. Quatro leituras distinguíveis:
        `cena/suspendeu` com asset em voo (a hipótese, com o `.glb` nomeado);
        suspendeu com `emVoo` vazio (suspendeu por outra coisa); sem suspensão e
        `sceneVisivel: 0` (é o `OcultarCena`); `sceneFilhos: 0` (desmonte de
        verdade); filhos visíveis e `objetosRender: 0` (culling/câmera).
      - **Quem nomeia o asset é o CARREGADOR, não o componente**
        (`assetProbe`): o React não conta O QUE suspendeu. O
        `DefaultLoadingManager` é geral — o `GLTFLoader` do `useGLTF` não recebe
        manager próprio e cai nele —, então uma sonda cobre glb de prop, de
        personagem e textura. `itemStart`/`itemEnd`/`itemError` são propriedades
        de INSTÂNCIA e são embrulhadas, com a regra de SEMPRE chamar o original:
        engasgar ali não atrapalharia a medida, pararia o carregamento.
      - **"Cache hit" são DOIS caches**: `itemStart` disparar já é MISS do cache
        do drei (hit devolve sem tocar no loader). Dentro do miss, `< 30 ms`
        sai rotulado `cache-http` contra `rede` — **heurística, marcada como
        tal**. E `vezes > 1` na mesma url quer dizer que o cache do drei NÃO a
        reteve, que é achado próprio.
      - **O sinal de Suspense é o FALLBACK**, não inferência: `SondaDeSuspense`
        não desenha nada e só existe enquanto o boundary está caído — montar =
        suspendeu, desmontar = revelou. Cada `<Suspense>` passa um NOME, senão
        "qual boundary" fica ambíguo com a cena e o retrato suspendendo juntos.
      - **`-1` como "nunca", não `0`**: `performance.now()` vale 0 no primeiro
        instante da página, e `t > 0` como teste de "foi carimbado" perdia
        exatamente a primeira suspensão da sessão — a da carga, quando mais
        asset está em voo. Pego por teste.
      - **O gatilho é a TRANSIÇÃO para zero, nunca o valor**: com a tela de
        carregamento no ar a cena é apagada de propósito e os draw calls ficam
        em zero por centenas de quadros. Por valor, os quatro slots de caso
        queimariam antes de o jogador ganhar o controle.
      - **Contar por categoria exigiu NOMEAR grupos** (`net-entidades`,
        `skill-vfx`, `chunks`, `agua`, além dos `map-props`/`editor-terrain` que
        já existiam): a classificação é pelo ancestral nomeado mais próximo, e
        heurística por tipo de malha seria adivinhação num laudo. Quem fica fora
        cai em `outros`, que é resposta. Os grupos são inertes — só rótulo.
      - **A varredura é AMOSTRADA a 10 Hz** (completa só no gatilho): a cena
        passa de mil `Object3D` e o gravador não pode pagar o custo que existe
        para acusar. Travado em teste espionando um nó PROFUNDO — na raiz o
        espião contaria também o caminho O(1), que roda todo quadro e deve rodar.
      - **CONFIRMADO pelo primeiro dump, e o arquivo tem nome**
        (`voo-1785937156994.json`). A sequência não deixa margem:
        `cena/suspendeu {boundary:"cena", cache:"miss", emVoo:
        ["/assets/props/Rock_3_M_Color1.gltf"]}` → 177 ms → `cena/revelou` →
        `cena/desmontou` → `cena/montou` → `MUNDOVAZIO`. Um `.gltf` de PROP
        frio, no boundary único que embrulhava a cena inteira.
      - **Mas o apagão NÃO é a suspensão — é o COMMIT do remonte no fim dela.**
        A cena desenhou normalmente durante os 177 ms (169 draw calls no quadro
        anterior); o que houve foi um **buraco de 220 ms sem quadro nenhum**
        entre um quadro e o seguinte, e ao voltar UM quadro desenhou zero. Um em
        414. Era essa a leitura que faltava: "escondida enquanto suspende" era
        palpite meu, e o dado o corrigiu.
      - **O estrago caro é o cache de terreno, não o piscar**: o remonte leva
        junto o `useRef` do `SquareTerrain` — `chunksNoCache` foi de **169 para
        4** e voltou subindo (14, 24, 34…), ou seja ~35 MB e ~450 ms de
        geometria refeitos. O piscar dura um quadro; a reconstrução, segundos.
      - **A correção é DUPLA e as duas partes fazem coisas diferentes**:
        `preloadPropsDoMapa(map.props)` **previne** (baixa as urls distintas do
        mapa — dezenas, não os 105 do catálogo — no render do `PlayView`, com a
        cortina no ar; no render e não em efeito, mesma razão do
        `setPathfinder`), e **um `<Suspense>` por prop** no `/play` **contém** o
        que escapar: falta UM prop por alguns quadros em vez de o mundo inteiro.
        O editor já fazia a segunda desde sempre (`EditorScene.tsx`) — a
        assimetria entre as duas telas era a pista.
      - **Corrigido e CONFERIDO** no dump seguinte (`voo-1785938553239.json`,
        com dois portais e caminhada longa): **`suspensoes: 0`**, nenhum
        `asset-lento`, nenhum `mundoVazio`.
      - **TROCAR DE MAPA NÃO É RECUAR** (`worldStore.geracao`, mesmo dump): o
        detector de rollback do `NetPlayer` guarda a última posição DESENHADA, e
        num portal ela descreve o mapa ANTERIOR enquanto o `self` volta para
        `0,0` — os dois falsos positivos saíram como **rollback de 424 e 101
        células**, com `para: "0.00,0.00"` no próprio evento denunciando que não
        era posição de ninguém, e **queimaram 2 dos 4 slots de captura**.
        `limparEntidades`/`clear` passam a incrementar `geracao`, e quem compara
        posições entre quadros descarta a referência quando ela muda.
        - **Descartar, não filtrar por distância**: o portal pode levar para uma
          célula PRÓXIMA (`@jump` curto, warp interno de NPC) e ali nenhum
          limiar separaria as duas coisas.
      - **`frameLongo` sobrevivente (378 ms) NÃO é da cena**: 6 ms antes dele,
        `renderer/canvas-criado {nome:"retrato", geracao:3, contextos:3,
        canvasNovo:true}` — um contexto WebGL inteiro nascendo, com chunks
        (169), props (446), visibilidade e draw calls (235) inalterados. Cada
        portal destrói e recria os canvases de retrato (gerações 3, 4, 5 no
        mesmo dump, `contextos` indo 3 → 1 → 2 → 3).
        - **"Um canvas nasceu por perto" NÃO é "criar o canvas custou 378 ms"**,
          e a instrumentação da vez existe para não pular esse passo. Entre as
          duas coisas cabem CINCO custos, e eles são medidos separados:
          `contextoMs` (embrulho de `HTMLCanvasElement.prototype.getContext`, só
          tipos WebGL — o `2d` do minimapa e do gerador de textura não entra),
          `descarteMs` (cronômetro dentro do `gl.dispose` já embrulhado),
          `modeloMs` (`fundirSkinned` + `cloneSkinned` no `assets.useCharacter`
          — o `.glb` já está em cache, o custo é CPU e acontece a cada
          montagem), e o que SOBRA do `quadroMs` depois dos três, que é React ou
          coletor. Os três zeram por quadro (são `ACUMULADORES`); o overlay
          mostra o total da sessão, que é o que denuncia churn.
        - **Cada retrato tem DONO** (`dono` no `CharacterPortrait`: jogador,
          alvo, status, char-select): são até três contextos vivos e todos se
          chamavam "retrato" no laudo, então "qual deles nasceu" não tinha
          resposta.
        - **`SondaDeMontagem` é DOM, não R3F**, e carrega um rastro de pilha
          podado: o React não conta por que um componente montou. Marcando `hud`
          e cada retrato com nomes distintos, a ordem dos eventos separa "o HUD
          desmontou e levou os três" de "só a placa do alvo remontou" — e o HUD
          é suspeito porque `{map && !carregando && <Hud/>}` o desmonta enquanto
          a tela de carregamento está no ar, o que num portal acontece.
        - `observarTarefasLongas` (PerformanceObserver `longtask`) responde uma
          pergunta que coluna nenhuma responde: o quadro foi UMA tarefa
          bloqueando a thread ou muitas pequenas somadas. São causas diferentes.
      - **E a decomposição MATOU a hipótese do contexto**
        (`voo-1785940564494.json`). Criar contexto WebGL custa **8,2 e 7,7 ms**
        (os dois `webgl2 300x150`, que são os retratos); os outros nove
        contextos da sessão são `webgl 2048x128` a **0 ms** e nem são nossos —
        são o atlas de glifo do troika, atrás do `<Text>` do drei.
        `descarteMs` deu zero em todo quadro e `modeloMs` zero no quadro longo.
      - **O gargalo é COMPILAÇÃO DE SHADER.** Quadro de **207,6 ms** com
        `renderMs` **190,4** e `gpuMs` **193,9** (92% dentro de `gl.render`),
        `longtask` de 197 ms marcada como UMA tarefa, e `programas` subindo de
        **19 para 20** naquele quadro exato, com props entrando no culling
        (473 → 479). Uma espécie nova trouxe uma variante de material que nunca
        fora desenhada, e o primeiro `draw` pagou o link do programa. Isso
        provavelmente reclassifica os 378 ms de antes: contexto novo nasce com
        cache de programa VAZIO, então a correlação com `canvas-criado` era real
        e o custo era a compilação que vinha atrás — não dá para confirmar, o
        dump não existe mais.
      - **O rastro de pilha FALHOU e a ordem dos eventos resolveu**: o React 19
        entrega `react_stack_bottom_frame ← runWithFiberInDEV ←
        commitHookEffect` no commit de efeito, sem componente nenhum. Quem
        respondeu "quem remontou" foram os nomes: `desmontou-em hud`,
        `retrato:jogador` e `retrato:alvo` saem no MESMO milissegundo, os
        canvases morrem 11 ms depois e renascem 1,5 s adiante.
      - **`contextosVivos` SUBESTIMA**: conta só renderers registrados (máx. 3)
        enquanto 11 contextos nasceram na sessão. Os 9 do troika contam para o
        teto de ~16 do Chrome, que é o mecanismo do `Context Lost`.
    - **As três correções que saíram daí**:
      - **O HUD é ESCONDIDO, não desmontado** (`display: contents` ↔ `none` no
        `PlayView`) — a mesma solução que o `TargetFrame` já usava e pela mesma
        razão. Desmontá-lo levava junto os contextos WebGL dos retratos, e
        contexto novo recompila tudo que desenha. `display: contents` não cria
        caixa, então o bloco de contenção dos filhos não muda e o layout é
        idêntico.
        - **E manter o HUD montado CUSTOU CARO** (`voo-1785946990938.json`):
          o HUD parou de desmontar (4 portais, ZERO `desmontou-em hud`, ZERO
          `canvas-destruido`), mas apareceram **quatro `frameLongo` de 561 a
          633 ms**, um por portal, onde o dump anterior tinha zero em 2 portais.
          Os quatro são idênticos: `sceneFilhos: 0`, `sceneVisivel: 0`, e
          `contextoMs`/`descarteMs`/`modeloMs`/`renderMs` **todos zerados** — o
          custo é o COMMIT que troca a cena, e nenhuma medida existente o
          tocava. Trocar 8 ms de contexto por 600 ms de troca de mapa é um
          negócio ruim, e está em aberto.
        - **`core/diagnostics/medir.ts` existe para NOMEAR isso**: `medir(rotulo,
          fn)` é transparente (devolve o que a função devolveu, deixa o erro
          subir), acumula na coluna `trocaMs` e só vira evento acima de
          `LIMIAR_MS` (15) — laço quente não pode encher o anel de 512.
          Embrulhados hoje: `zod→mapa`, `props→colisão`, `terrainQuery`,
          `legacyMapping`, `minimapa→bitmap`. Adivinhar qual deles custa seria
          fácil e provavelmente errado: foi assim que a hipótese do contexto
          WebGL (8 ms, medido) sobreviveu duas rodadas.
        - **Esconder NÃO BASTOU, e o laudo pegou**: no `voo-1785946077631.json`
          o `desmontou-em hud` continuou saindo em cada portal, com
          `retrato:jogador` e `retrato:alvo` no MESMO milissegundo. A causa é o
          `useMap`, que faz `setMap(null)` assim que o `id` muda — então
          `{map && …}` derrubava a subárvore antes de a condição de `carregando`
          agir. Agora um `ultimoMapa` (mesmo padrão do `ultima` do
          `TargetFrame`) segura o mapa anterior enquanto o novo carrega; ele
          nunca é VISTO, porque com `map` nulo o bloco está em `display: none`.
      - **`play/PreCompilarProps`**: uma instância de cada ESPÉCIE do mapa em
        `Y_DEPOSITO` (−10.000) durante a fase de AQUECIMENTO, mais
        `gl.compileAsync(scene, camera)`. Só no aquecimento porque na construção
        a cena está com `visible = false` e o `compileAsync` percorre por
        `traverseVisible` — ali não compilaria nada. Pelo mesmo motivo as
        instâncias ficam VISÍVEIS e fora do frustum, nunca escondidas: esconder
        seria o jeito óbvio e desligaria a correção em silêncio. O `compile` é
        chamado num `requestAnimationFrame`, porque no efeito os objetos ainda
        não estão na cena. Desmontar depois não desfaz nada — o material vem por
        referência do cache do `useGLTF` e é compartilhado com os props de
        verdade.
      - **Um despejo com ZERO casos tem de PROVAR que estava gravando**
        (`gravacao` + o anel de `eventos` no `despejo`): esse é o resultado
        normal de conferir uma correção, e era justamente nele que o arquivo não
        dizia nada. `casos: []` ficava idêntico se nada de errado aconteceu e se
        ninguém apertou "gravar" — leituras opostas —, e os 512 eventos eram
        descartados junto, levando o `cena/precompilou`, o `vazio-esperado` e os
        portais. Pego conferindo o `voo-1785942580864.json`, que tinha 2,6 KB e
        não bastava para concluir nada.
      - **`mundoVazio` não captura cena morta**: trocar de mapa desmonta a
        `<Scene>` e o `OcultarCena` apaga o resto, então zero draw calls ali é o
        que se pediu. Dois casos falsos queimaram metade dos slots. A separação
        é limpa e sem acoplamento — o defeito real tinha `sceneVisivel: true` e
        dez filhos, o portal tem `false` e zero. Continua saindo EVENTO
        (`cena/vazio-esperado`): trocar falso positivo por ponto cego seria pior.
      - Achados de brinde do dump anterior: `forest_texture.png` passou **5 vezes**
        pelo carregador (o cache do drei não a retém), e o caso `frameLongo`
        (254 ms) do mesmo arquivo é OUTRO fenômeno — sem suspensão e com
        `chunksNoCache` fixo em 169.
    - **Memória de GPU não se inventa**: não há API padrão na web. Lê-se
      `GMAN_webgl_memory` quando existe e escreve-se `NaN` quando não (o despejo
      serializa como `null`, a timeline mostra "—"). `performance.memory` entra
      em coluna com OUTRO nome (`heapMb`) porque é heap de JS — e vale por ligar
      quadro de 200 ms a pausa do coletor.
- **AUDITORIA DE ASSETS: o medo do "200 árvores = 200 GLBs" NÃO se confirma**
  (`core/diagnostics/censo.ts`, `__censo()` no console). O `useGLTF` do drei
  cacheia por url (2.095 props do `prt_fild08` ⇒ **44 downloads**, 44 espécies) e
  o `Object3D.clone` do `PropInstance` copia `geometry` e `material` **por
  referência**. A prova é aritmética e medida: **278 props visíveis contra 135
  geometrias e 59 texturas vivas no renderer inteiro**.
  - **O número que responde a pergunta é a RAZÃO, não a contagem**: "278 malhas"
    e "50 geometrias" separados não dizem nada; `referencias ÷ unicos` diz. O
    censo devolve essa razão para geometria, material, textura e esqueleto —
    reúso 1,0 é a assinatura do desperdício.
  - **Esqueleto por entidade é NECESSÁRIO**, não desperdício: cada personagem
    anima numa pose própria. O `fundirSkinned` já reduziu de 9 para 1–2.
  - **O censo é sob demanda, nunca por quadro**: o grafo passa de mil `Object3D`
    e varrê-lo a 60 Hz seria o medidor pagando o custo que ele acusa.
  - **As texturas de `ShaderMaterial` moram nos UNIFORMS**, fora do alcance de
    uma varredura por chave — e são justamente o terreno, a água e os VFX, os
    maiores consumidores. Perdê-las subestimaria a memória onde ela pesa.
  - **A memória é ESTIMATIVA declarada**: não há API padrão na web (a
    `GMAN_webgl_memory` não existe nesta máquina, `memoriaGpuMb` saiu `null` em
    todo dump). Soma-se o que o grafo DECLARA — bytes de atributo e pixels de
    textura, com o `× 4/3` do mipmap —, e o campo `exclui` diz o que fica de
    fora (driver, render targets, mapa de sombra).
  - **A conferência é o CRUZAMENTO com `gl.info`**: o censo conta o grafo, o
    renderer conta o que está carregado. Divergir é esperado (retratos, UI,
    pendente de descarte) e a diferença sai nomeada. Um censo que batesse exato
    estaria contando o objeto errado.
  - **Coletor, não valor** (`registrarColetorDeMeta` no flightRecorder): o censo
    registrado na montagem descreveria uma cena vazia. O gravador guarda a
    FUNÇÃO e a chama no `despejo()` — continua sem conhecer o jogo, só serializa
    o que voltar.
  - **`animacaoMs` SOMA ao `renderMs`; `matrizMs` é SUBCONJUNTO dele.** A
    animação roda fora de `gl.render` (um `useFrame` por entidade), o
    `updateMatrixWorld` roda dentro. Somar os três contaria a matriz duas vezes.
  - **`scene.updateMatrixWorld` é embrulhado na INSTÂNCIA, não no protótipo**: o
    método desce recursivamente por milhares de nós por quadro, e cronometrar
    cada um custaria mais que o medido. Uma chamada na raiz mede a descida
    inteira.
  - **MAS A TEXTURA ESTÁ DUPLICADA, e esse é o maior desperdício do projeto**
    (`texturasDuplicadas` no censo). `forest_texture.png` tem **48 KB em disco**,
    é 1024×1024 e é referenciado por **101 dos 105 `.gltf`** do pacote Forest.
    Cada `.gltf` é um DOCUMENTO à parte, então o `GLTFLoader` cria um
    `THREE.Texture` novo por arquivo — e o cache do drei é chaveado pela url do
    GLTF, não da imagem, então ele nunca enxerga que são a mesma. Medido:
    **225,12 MB de textura na cena ÷ 5,33 MB = ~42 cópias**. 48 KB viram 224 MB,
    fator de 4.700×.
    - **Eu tinha lido isso como "compartilhado" e estava errado**: `texturas: 59`
      no `gl.info` são 59 OBJETOS, e ~42 deles carregam a mesma imagem. Contagem
      de recurso não distingue reúso de duplicata — só o agrupamento pela FONTE
      distingue, e por isso ele entrou no censo.
    - O sinal já tinha aparecido antes e eu o subestimei: o `assetProbe` registrou
      `forest_texture.png` com `vezes: 5` no `voo-1785932685455.json` e eu o
      tratei como achado secundário.
    - **A fonte é `image.src`, não o nome**: nome igual é pista, url resolvida é
      prova. Em `.glb` com imagem embutida o `src` é um blob diferente a cada
      carga e a duplicata não é detectável assim — o pacote Forest usa `.gltf`
      com png externo, que é o caso que interessa.
    - **Corrigido em `src/gltfTexturas.ts`** (`compartilharTexturas`): um cache
      de módulo por fonte, aplicado à cena do `useGLTF` **antes de qualquer
      clone** — a mesma decisão e o mesmo motivo do `fundirSkinned`, que é o
      vizinho conceitual. Chamado no `PropInstance` e no `assets.useCharacter`.
      - **A identidade vem do `parser.associations`, NÃO de `texture.image.src`**
        (GLTFLoader.js:3347). A primeira versão chaveava pelo `src` e deduplicou
        **zero**: o censo seguinte continuou acusando 40 cópias e 224 MB. A razão
        está em GLTFLoader.js:2682 — no Chrome o loader usa `ImageBitmapLoader`,
        e um `ImageBitmap` **não tem `src`**, então a chave devolvia `null` para
        toda textura e o dedupe saía calado. O parser liga cada textura ao índice
        dela no documento, e dali se chega a `images[n].uri`, que é o arquivo.
        Corolário: o `compartilharTexturas` recebe o GLTF INTEIRO, não a cena.
      - **A chave inclui as CONFIGURAÇÕES** (`wrapS`, `wrapT`, `colorSpace`,
        `flipY`, `channel`), não só a url: duas texturas da mesma imagem com
        `wrap` diferente desenham diferente, e trocar uma pela outra mudaria
        como o prop aparece. Assim a troca é correta por construção e o pior
        caso é simplesmente não deduplicar.
      - **Blob e data-uri devolvem `null`**: imagem embutida ganha url nova a
        cada carga, e ali duas iguais são indistinguíveis de duas diferentes.
      - **Só a ÓRFÃ é descartada.** Descartar a canônica apagaria a textura de
        todos que já apontam para ela. E o `dispose()` costuma ser no-op de GPU:
        a deduplicação roda antes do primeiro desenho, então a duplicata em
        geral nunca chegou a subir.
      - **Resultado MEDIDO** (censo antes → depois): `texturas.unicos` 45 → **7**,
        `reuso` 9,4 → **65,3**, `texturasMb` 224,12 → **17,12**,
        `renderer.texturas` 33 → **17**, memória total 233,74 → **26,8 MB**.
        **−207 MB, −88%.** Os três atlas que sobram (`forest`, `skeleton`,
        `knight`, 5,33 MB cada) são imagens diferentes e estão corretos.
  - **A troca de mapa vazava DOIS materiais e uma textura por portal**
    (`SquareTerrain`): a limpeza do `useEffect` descartava só as geometrias. A
    aquarela da água virou cache de módulo por variante (`aquarelaDe` — são
    quatro PNGs no acervo inteiro, e ela não depende do mapa), e os dois
    materiais ganharam `useEffect(() => () => material.dispose(), [material])`,
    que cobre TAMBÉM a troca de estilo no editor — ali o `useMemo` recria o
    material e o anterior vazava igual.
    - **Isto sobrevive ao StrictMode porque `Material.dispose()` é REVERSÍVEL**,
      a mesma propriedade que já justifica o `Skeleton.dispose()`: ele só solta
      o programa, e o renderer o reconstrói no próximo desenho. O pior caso do
      remonte simulado é uma recompilação, observável na coluna `programas`.
      Algo irreversível ali faria o chão sumir depois do primeiro remonte.
  - **Recurso por ENTIDADE virou recurso de MÓDULO**
    (`net/recursosCompartilhados.ts`): cada `NetEntity` alocava um
    `CylinderGeometry` (área de clique), um material invisível, um
    `ShaderMaterial` de brilho e um `PlaneGeometry`; cada item no chão, mais
    quatro. Com `area_size: 60` é entra-e-sai de mob o tempo todo. Não vazava (o
    descarte existia), era pressão de coletor — Minor + Major + C++ ≈ 226 ms no
    perfil de produção.
    - **Geometria UNITÁRIA + `scale`**, nunca um tamanho por instância: é o que
      permite mob de raio grande e item de raio pequeno dividirem a mesma
      geometria, e o raycast segue correto porque o three transforma o raio para
      o espaço local antes de testar. O cilindro de 10 lados é um decágono, então
      a caixa envolvente dele é `cos(18°)` do diâmetro — o RAIO continua 0,5, que
      é o que a escala multiplica, e a área de clique é idêntica à de antes.
    - **Materiais em cache por COMBINAÇÃO**: duas cores × quatro níveis de força
      × com e sem aro dão um punhado de `ShaderMaterial` para a tela inteira.
    - **A `WorldBar` era a maior parte, e o primeiro corte parou antes dela.**
      Quem mostrou foi uma SÉRIE de censos andando pelo mapa (não um
      antes/depois): dez mobs saindo de cena levavam **25 geometrias e 21
      materiais** junto, ou seja ~2,5 e ~2 por entidade. Os três planos da barra
      — trilho, preenchimento e moldura — criavam geometria e material por
      barra, e há plaquinha em todo mob à vista. O `map` entra na chave pelo
      `uuid`: a moldura muda com a proporção (o `ui/barTexture` já cacheia por
      proporção arredondada) e um material com a textura errada desenharia a
      moldura esticada. O que sobra por entidade é o `<Text>` do troika, que é
      inerente — cada rótulo tem glifos próprios.
    - **Quem usa NÃO descarta — e o `dispose` do `GlowChao` teve de SAIR.** Ele
      existia porque o material era dele; compartilhado, aquele mesmo `dispose`
      na saída de UM mob apagaria o brilho de todos os outros que usam a mesma
      combinação. Está travado em teste, com o porquê escrito.
  - **Prop de mapa não se move, e pagava matriz por quadro**
    (`matrixAutoUpdate = false` no `PropInstance`): o padrão do three é `true`, e
    com ele TODO nó chama `updateMatrix()`/`compose()` a cada quadro — as
    transformações internas de um `.gltf` de árvore são constantes desde o
    arquivo. Medido no perfil de produção: `updateMatrixWorld` custa **1,11 ms
    por quadro**, e os props são a maior população de nós (278 no culling, com
    várias malhas cada).
    - **A RAIZ do clone fica fora do laço** e é tratada num `useLayoutEffect`:
      quem escreve a transform dela é o R3F, no commit, e desligar antes disso
      congelaria o prop na origem. A ORDEM importa — `updateMatrix()` primeiro,
      desligar depois; invertido, a matriz nunca é composta.
    - **Isso corta METADE do custo, não ele todo.** O `updateMatrixWorld` faz
      duas coisas por nó: o `compose` local (eliminado aqui) e a multiplicação
      pela matriz do pai. A segunda continua porque a RAIZ DA CENA tem
      `matrixAutoUpdate` ligado, recompõe a própria matriz todo quadro e isso
      vira `force = true` para a árvore inteira. No perfil, `compose` +
      `updateMatrix` somam ~94 ms dos 187 — é essa parte que sai. A outra metade
      exigiria tornar a raiz estática, que é mudança global.
  - **O outro desperdício é draw call e nó de cena, não memória de asset**:
    props sem `InstancedMesh` no mapa quadrado (o `HexTerrain` já usa), geometria
    e material por ENTIDADE que poderiam ser de módulo (`GlowChao`, hitbox do
    `NetEntity`, `GroundItems`), e os dois materiais + textura de água do
    `SquareTerrain` que a limpeza não descarta na troca de mapa.
- **São TRÊS ordens de vários quadros, e elas disputam a MESMA caminhada**
  (`attackStore` "vou bater", `pickupStore` "vou pegar", `skillWalkStore` "vou
  até o alcance e lanço" — next-change.txt de 2026-08-04). As três existem pelo
  mesmo motivo: o rAthena confere a distância e RECUSA, não se aproxima pelo
  jogador. A terceira nasceu de "clicar com o disco vermelho não faz nada":
  `unit_skilluse_pos2` (unit.cpp:2690) só GUARDA o pedido (`stepaction`) quando o
  personagem **já está andando** — parado e fora de alcance ele devolve 0, calado.
  - **Duas de pé fariam o personagem trocar de destino sozinho**, então toda
    ordem nova mata as outras: `net/acoes` (atacar/pegar) cancela a magia,
    o clique de skill cancela ataque e coleta, o clique no chão cancela as três,
    e WASD, ESC e escolher outra skill cancelam a magia. Travado em
    `net/ordens.test.ts`.
  - **Warp e troca de mapa cancelam as três** (`useGatewayEvents`): a célula da
    magia pendente continuaria PERFEITAMENTE VÁLIDA no mapa novo, e o personagem
    chegaria em Prontera e sairia andando até um ponto que ninguém escolheu. O
    gid do ataque some com as entidades; a célula, não.
  - **A célula de onde se lança NÃO sai do `celulaParaEncostar` do ataque**
    (`celulaNoAlcance`, `net/skillWalkStore`): lá o passo é por EIXO
    (`sign × alcance` em x e em y), o que numa diagonal cai a `raio × 1,41` do
    alvo — ainda fora. Com alcance 1 (arma corpo a corpo) ninguém nota; com os 9
    de uma Storm Gust o personagem andaria, recalcularia e andaria de novo. A
    fração `raio / distância` anda pelo SEGMENTO e cai no círculo de alcance, do
    lado de quem lança: um pedido só, e cada `move:to` a menos é um
    redirecionamento a menos acumulando deriva.
  - **A conta de "já dá" é a do SERVIDOR** (`distanciaDeAtaque`, a
    `distance_client` de path.cpp): `battle_check_range` usa
    `check_distance_client_bl` para jogador. Com `hypot` cru o cliente pararia
    numa célula que o rAthena recusa — e a recusa é silenciosa.
  - **`raioDeAlcance` mora no `net/skillCatalog`**, não no `play/AimPreview`: o
    aro que se DESENHA e a distância que se ANDA têm de ser o mesmo número, senão
    o personagem para num ponto diferente daquele em que o disco deixa de ser
    vermelho.
- **Nunca pedir caminho que o cliente sabe não existir** (`net/moveTarget.ts`,
  next-change.txt de 2026-08-01): era daqui que saía o "dash" — clicar no miolo
  da montanha fazia o personagem atravessá-la correndo em linha reta. A cadeia
  tinha três elos, e o do meio era o defeito: (1) `snapAndavel` procurava chão
  em 4 anéis, não achava numa montanha larga e devolvia a própria célula
  BLOQUEADA; (2) `pedirMovimento` recebia `null` do A* e **emitia `move:to`
  assim mesmo** — a condição `if (caminho && caminho.length > TRECHO_MAX)` é
  falsa tanto para caminho curto quanto para `null`, e os dois caíam no mesmo
  emit; (3) o servidor, com o `map_cache` mais VELHO que o mapa editado, achava
  aquilo chão, aceitava e respondia o movimento — e o cliente, sem caminho,
  caía no passo de rei do `interpolatedCell`, que é uma reta. O próprio
  `findPath` já avisava no comentário: *"quem chama deve manter o personagem
  parado em vez de inventar uma linha reta"*.
  - `destinoAlcancavel` resolve o pedido para a célula alcançável mais próxima
    (varredura por anéis, com teto de tentativas E orçamento de tempo — o caso
    caro é candidata ANDÁVEL mas cercada, em que o A* varre até `MAX_NODES`).
    Medido no `prt_fild08` do usuário: clique no centro do maciço de 268 células
    vindo de 30 células de distância custa 27 ms e devolve o pé da montanha.
  - **Devolve o CAMINHO junto**: sem isso `pedirMovimento` rodaria um segundo A*
    em TODO clique só para quebrar o pedido em trechos de 16 células.
  - `temPathfinder()` existe porque `serverPath` devolve `null` tanto para "não
    há rota" quanto para "ninguém registrou colisão" (preview do editor), e as
    duas querem o oposto: a primeira NÃO pede, a segunda pede.
  - O **WASD** era o segundo caminho para o mesmo dash — emitia a célula 4 à
    frente sem olhar colisão. Agora encurta o passo (4→1) até achar rota, o que
    faz encostar na parede em vez de atravessá-la ou parar 4 células antes. E o
    carimbo de `lastRequest` passou para ANTES da busca: com ele só no emit, o
    intervalo de 200 ms nunca fechava contra a parede e o A* rodava 4× por
    QUADRO.
  - `SNAP_RINGS` foi de 4 para 10, mas ele continua sendo só o palpite
    GEOMÉTRICO (trabalha em coordenada de mundo, não conhece a grade do
    servidor). Célula andável ≠ célula alcançável: uma ilha cercada de parede é
    andável e inútil.
- **O pathfinder é registrado no RENDER, não num efeito** (`views/PlayView`):
  efeito de FILHO roda antes do efeito do PAI, então o `NetPlayer` montava — e
  podia receber pacote de movimento — antes de existir pathfinder; sem ele o
  `buildMotion` cai no passo de rei e desenha reta por cima de parede. A mesma
  janela reabria depois de cada warp, porque a limpeza zera o registro.
- **Cliente e servidor discordarem de colisão é o AMPLIFICADOR de qualquer bug
  de movimento**: o mapa editado só chega ao rAthena com `export:mapcache` +
  restart. Medido antes de reexportar: **3.019 células divergentes** em
  `prt_fild08`, com as 268 da montanha ANDÁVEIS para o servidor. Dá para
  auditar decodificando o zlib do `map_cache.dat` e comparando com o mapa da
  API célula a célula — é assim que se prova que os dois lados concordam.
- **Variante "2" de pacote só com PACKETVER que a pede**: `USE_SKILL_TOGROUND2`
  e afins escrevem o opcode CRAVADO (0x0366) em vez de consultar a tabela de
  versão. Em 20130618 esse número é outro pacote, de 90 bytes: o map-server via
  10, respondia "expected packet length 90" e DERRUBAVA a sessão — parecia que o
  servidor caía ao usar Storm Gust. Skill de chão usa `USE_SKILL_TOGROUND` puro
  (a tabela resolve para 0x096a); as demais variantes têm guarda `>= 20180307`.
- **Só o MODELO gira** (`NetPlayer`/`NetEntity`): a rotação vai num grupo filho,
  nunca no grupo raiz. Barra de HP/SP e plaquinha moram no raiz — no grupo que
  gira elas viravam junto com o boneco a cada curva (o `Billboard` do drei
  compensa o pai com a matriz do frame anterior, então não salva).
- **Nome de classe sai do enum `e_job`** (`mmo.hpp`), nunca de memória:
  `character/jobNames.ts` estava deslocado de 4001 em diante e um Arcano (4055)
  aparecia como "Cavaleiro Rúnico Montado" — o jogador achava que o jogo trocava
  a classe dele. 4054 = Rune Knight, 4055 = Warlock, e por aí.
- **Mapa sem cena 3D tem saída para jogador comum**: `@load` (volta ao ponto de
  salvamento) liberado ao grupo 0 em `rathena-conf/groups.yml` — é o que a Asa
  de Borboleta faz no RO. `conf/import/groups.yml` COMPLETA o grupo do arquivo
  original: repetir um comando que já existe lá ("Group already has command…")
  aborta a leitura do arquivo inteiro, então só entra o que é novo. O
  `start_point` (char_conf) já nasce em prt_fild08; personagem antigo preso em
  `iz_int*`/`prontera` se move por SQL com o char-server PARADO (ele reescreve
  a linha no logout).
- **Nome de skill e tipo de alvo vêm da API** (`net/skillCatalog`,
  `GET /skills/by-id?ids=`): o ZC.SKILLINFO_LIST manda a constante do rAthena
  ("SM_BASH"), não "Bash", e não diz se a skill é de chão. `target` do skill_db
  decide entre mira de célula (`CZ.USE_SKILL_TOGROUND`) e mira de alvo —
  adivinhar por `range === 0` classificava todo auto-buff como área.
- **O editor serve às DUAS grades**: `editor/activeGrid.ts` guarda a grade do
  mapa aberto (`setEditorGrid` em `init`/`newMap`) e o `editorStore` chama
  `editorGrid()` no lugar de `hexToWorld`/`worldToHex`/`HEX_W`/`levelToY` — como
  já fazia com `hexScale`, que também é estado de módulo. Sem isso seria preciso
  passar o mapa por dezenas de funções puras (`wanderPath`, `cellsInRadius`, o
  scatter).
- **Culling do editor acompanha o zoom** (`editor/useEditorViewCenter`): o raio
  sai da distância da câmera ao alvo (160 a 700). Fixo, afastar para ver o mapa
  inteiro mostrava um retângulo de chão e os props boiando fora dele; sem
  culling nenhum, um 400×400 desenha 160.000 células de uma vez.
- **O que é cada bloqueio sai da FORMA da mancha** (`editor/blockedClusters.ts`):
  o `map_cache` só diz "não passa" — quem sabe se é árvore, pedra ou casa é o
  `.rsw` do cliente RO, que não está no repo. Então classifica-se por tamanho
  (change.txt): 1 célula = pequeno, 2–4 em linha/L = médio, quadrado 2×2 =
  grande, acima disso = estrutura. Vizinhança de 4: encostar pela quina são dois
  obstáculos. Medido em `prt_fild08`: 386 manchas viram objeto (28/192/166) e
  **98% das células bloqueadas estão em 5 estruturas**, a maior com 63.982
  células — é o cinturão de mata da borda, que tem edição própria.
- **Escopo de edição é GLOBAL** (`editor/editScope.ts`, seletor na `TopBar`):
  "Dentro" / "Borda" / "Buraco" / "Tudo" valem para TUDO — pincel de terreno,
  asset posto à mão, geração procedural, spawn e prefab. As três regiões são
  DISJUNTAS e o TIPO vence a localização: buraco = `cliff` (o gap tipo 5 do
  rAthena) **onde quer que esteja**, borda = o resto do bloqueio ligado à moldura
  por flood fill de 4, dentro = o resto. A máscara é cacheada num `WeakMap`
  chaveado pelo array `collision` **e conferida contra `surface`** (o rio saiu da
  moldura, ver abaixo), os dois recriados pelo store a cada edição — não há
  invalidação manual.
  - **O canal de rio fica FORA da máscara de borda**, mesmo bloqueado: um rio
    atravessa o mapa de ponta a ponta e encosta na moldura, então contado como
    bloqueio comum o flood fill corria por dentro dele e o rio inteiro — mais o
    que ele tocasse — virava região "Borda", tirando o miolo do mapa do escopo
    "Dentro". Rio é cenário autorado no meio do campo, não moldura.
  - **Por que o tipo vem primeiro**: em `prt_fild08` a mata da beirada cerca as
    ravinas, então **7.306 das 7.899 células de buraco (92,5%) caem dentro do
    cinturão da borda**. Classificando por localização, o escopo "Buraco"
    alcançava 593 células — o relato de que ele "funcionava só numa parte pequena
    do buraco". Divisão medida hoje: buraco 7.899, borda 56.676, dentro 95.425.
  - **Só "Dentro" poupa o bloqueio; "Tudo" alcança as três regiões**: o relevo
    (pincel e procedural) entra em parede e buraco em Borda, Buraco e Tudo —
    antes a permissão era exclusiva de Borda/Buraco e "Tudo" acabava se
    comportando igual a "Dentro", o que contradizia o próprio nome. Medido em
    `prt_fild08`, uma pincelada de raio 6 no mesmo ponto: "Dentro" altera 40
    células (todas do miolo), "Tudo" altera 121 (40 dentro + 75 borda + 6
    buraco), e a colisão não muda em nenhum dos dois. O LAGO procedural é a
    exceção que poupa bloqueio em todo escopo: ele grava `collision: "water"`,
    que é andável no rAthena, e cavar dentro da moldura abriria passagem.
  - **Borda e buraco são CENÁRIO, nunca passagem**: pincel de superfície, peça de
    chão, rio, estrada, relevo procedural e "Limpar terreno bloqueado" foram todos
    fechados para não converter `wall`/`cliff` em andável — o rio era o pior,
    porque água do rAthena é ANDÁVEL (tipo 3) e um canal cortando a moldura
    abria buraco no mapa. Altura, sim, é livre nesses escopos: com "Borda" ou
    "Buraco" escolhido os pincéis de relevo agem no bloqueio (paredão alto,
    ravina funda) e a colisão fica de pé. Em "Dentro"/"Tudo" o relevo não entra
    em célula bloqueada, o que protege a ravina de uma pincelada larga no miolo.
  - **A paleta de superfície mostra a TEXTURA, não um quadradinho de cor**
    (`editor/ToolOptions: SurfaceBtn`): Grama, Terra, Pedra, Areia, Neve e Lago,
    cada um com a miniatura que sai do MESMO pixel que o chão amostra. Nome
    sozinho não diz o que vai aparecer — "pedra" pode ser laje, cascalho ou
    paredão. Água e rio não têm textura (a lâmina é material próprio, colorido
    por profundidade), então a miniatura deles reproduz o degradê com as mesmas
    duas cores do shader.
  - **Superfície NÃO pinta célula bloqueada** — nem a colisão, nem a APARÊNCIA.
    A colisão era a trava antiga (`SURFACE_COLLISION.grass` é "walkable", e uma
    pincelada de grama abria passagem na mata). A aparência virou trava quando a
    paleta ganhou pincel de pedra: pintar "stone" numa mata importada a deixaria
    idêntica a uma montanha nossa, e o "Desfazer ⛏" reconhece montanha por
    `surface === "stone"` — seria porta dos fundos para abrir o bloqueio.
    Bloqueio tem aparência própria (mata, penhasco) e só a Montanha ⛰ muda isso.
  - **A cor de célula bloqueada vem do TIPO, não da superfície**
    (`grid/squareChunks.ts: cellColor`): a primeira pincelada num mapa importado
    materializa `surface` inteira (o `map_cache` não traz superfície), e enquanto
    ela mandava em tudo, mata, penhasco e água perdiam a cor no mesmo instante —
    o mapa inteiro virava verde chapado ao encostar o pincel numa célula só.
    Complemento: `surfaceFromCollision` deriva a superfície inicial da colisão em
    vez de "grass" para tudo, senão a água andável do mapa original perdia o azul.
  - **Serem disjuntas é o que salva o buraco do pincel**: com "dentro" valendo
    "tudo que não é borda", qualquer pincelada larga no miolo apagava a ravina —
    superfície gravava `collision: walkable` (`SURFACE_COLLISION.grass`) e relevo
    gravava nível ≠ 0, que vence o afundamento por TIPO do `visualLevel`. Hoje
    superfície NÃO mexe em colisão de célula bloqueada e relevo (raise/lower/
    flatten/noise/smooth) não entra nela; quem molda bloqueio é `cliffUp`/
    `cliffDown` e quem abre passagem é o painel "Limpar terreno bloqueado". O
    escopo é conferido célula a célula no disco do pincel, não só no centro.
- **O cursor aponta o TOPO, não o plano de y=0** (`play/pickGround.ts`): editor e
  `/play` põem um plano invisível sob o mapa para capturar clique em qualquer
  lugar, e com terreno de altura ele e a célula sob o mouse são pontos
  diferentes — medido num paredão de 6 níveis, o plano indicava a célula (2,0)
  quando o topo era (4,6), **6,3 células de erro**. Dois modos de errar, os dois
  corrigidos: usar `e.point` num handler de GRUPO (sem `stopPropagation` o R3F
  chama o handler uma vez por objeto atingido, e a última chamada — o plano de
  baixo — vencia) e projetar o raio no plano por conta própria (o que o arrasto
  fazia). Vale sempre `nearestHit`, a interseção mais próxima; os grupos
  `map-props`/`editor-terrain` existem para o raycast achá-los.
- **Pincel de relevo é PROPORCIONAL** (`brushFalloff`, slider "Força"): o centro
  do disco se move `brushStrength` níveis e a vizinhança acompanha em degradê
  `smoothstep` — o "Proportional Editing" do Blender. Antes o passo era +1 nível
  cravado em todo o disco, o que só sabia fazer pilar de topo chato. Força default
  0,3 e raio até 12; `smooth`/`flatten`/`noise` também deixaram de arredondar para
  nível inteiro (arredondar devolvia o degrau que o suavizar deveria tirar).
  Medido em `prt_fild08`: uma montanha de ~4,5 níveis sai de três gestos, com
  perfil `0 → 1,25 → 2,53 → 4,55 → 3,38 → 1,26 → 0` e nenhum degrau seco.
- **Montanha e rio são os ÚNICOS pincéis que mexem na passagem** (grupo
  "Passagem" no painel B, só em mapa `square` — change.txt de 2026-07-31):
  - `mountain` grava as três coisas de uma vez — altura (ganho 3× o do "Subir ▲",
    teto 40 níveis), `collision: "wall"` e `surface: "stone"`. É o que o separa
    do morro ANDÁVEL: `isWalkable` e o A* do cliente olham só a colisão, e
    nenhuma regra do projeto relaciona altura com passagem — nem deve, o
    `skill-map-format` proíbe derivar colisão de altura por limiar. Quem decide é
    quem autora.
  - `mountainClear` desfaz, e só age onde `surface === "stone"`. Amarrar num
    escopo não bastaria: um bosque importado no miolo também cai em "Dentro", e o
    pincel viraria porta dos fundos para abrir a mata. Como `surfaceFromCollision`
    só emite "grass" e "water", pedra é sempre coisa pintada aqui.
  - `riverShallow` = água andável (tipo 3 do rAthena, como sempre);
    `riverDeep` = `wall` com altura negativa. A altura autorada vence o palpite
    por tipo em `visualLevel`, então o canal AFUNDA em vez de subir um nível como
    qualquer parede. Nenhum dos dois toca célula já bloqueada que não seja rio
    nosso — sem essa trava havia um caminho de dois passos para abrir a mata
    ("Rio fundo" a converte em `wall`, aparentemente inofensivo, e "Rio raso" em
    seguida a torna água andável).
  - `escopoBloqueio` ganhou uma brecha por `surface === "stone"`: depois da
    primeira pincelada a montanha vira `wall`, e sem ela continuar esculpindo-a
    no escopo "Dentro" — onde se trabalha o miolo — parava de funcionar.
  - `generateRiver` ganhou LARGURA (slider no painel de Água): a distância de
    cada célula até o fio do traçado decide miolo (fundo) e anel (raso). Largura
    0 mantém o fio de água atravessável de antes. Um segundo traçado paralelo não
    serviria — ele não acompanha as curvas do `wanderPath`.
  - Tudo isso chega ao servidor sem código novo: `export:mapcache` já traduz
    "wall" para a célula tipo 1 do rAthena. Precisa reexportar + reiniciar.
- **Lago é BACIA, não leito chapado** (`escavarBacia`, pincel Lago e o lago
  procedural): o fundo desce por ANEL de distância até a terra
  (`LAGO_BEIRA_Y −0,85` na beira, `LAGO_DECLIVE 0,5` por anel, teto
  `LAGO_FUNDO_MAX −2,4`). Com o leito plano de antes a profundidade era a mesma
  do meio à margem — e a lâmina lê o leito para escolher a cor, então saía azul
  chapado de ponta a ponta, o oposto do que a lâmina existe para fazer. Com a
  bacia o turquesa raso encosta na margem e o azul fundo fica no meio, de graça.
  - **A margem desce até a LINHA D'ÁGUA, não até o leito**: `escavarBarranco`
    recebe `LAGO_BEIRA_Y + LAMINA_ACIMA_DO_RASO` — o mesmo nível que
    `nivelDosCorpos` vai dar à lâmina, importado de `grid/squareChunks` em vez
    de copiado (dois números que têm de bater não podem ser digitados duas
    vezes). Mais alto sobra degrau seco sobre a água; mais baixo abre um fosso
    de terra afogada em volta do lago. O RIO continua mirando o leito: a lâmina
    dele fica quase rente ao campo, e mirar nela não abriria barranco nenhum.
  - A bacia é escavada no FIM do traçado, sobre o corpo d'água inteiro ligado ao
    que se pintou — não só nas células do gesto. É o que faz alargar um lago
    aprofundar o meio dele em vez de deixar degrau na emenda com a pincelada
    anterior. Nunca SOBE o leito (`Math.min`): quem afundou o lago à mão fica com
    o fundo que cavou.
  - O barranco passou de 2 para **3 células**. Corolário: lago pintado ANTES
    disso mantém o leito plano e a margem em degrau — quem quiser o perfil novo
    repassa o pincel na borda.
- **Promontório é MORRO BICUDO com ângulo escolhido** (pincel `ledge`,
  "Promontório ◤", referência `ref2.png`): arrasta-se da raiz até onde a ponta
  deve chegar, e o **ângulo da face** (`LEDGE_ANGLES` 25/35/45/55°) é quem
  decide a altura — `altura = meia-largura × tanθ`. Como a meia-largura afunila
  até a ponta, a crista afunila junto e o morro termina em BICO.
  - **É ângulo de verdade**: a conversão passa por `cellWidth()` e pela altura
    de um nível (`levelToY(1) − levelToY(0)`), senão "45°" seria 45° só num
    `hexScale`. Medido: mediana da queda lateral = tan 45° ±10%, e a razão entre
    os picos de 55° e 25° = a razão das tangentes.
  - **Mato em cima, ROCHA embaixo** (`LEDGE_MATO` 0,55): o corte é por altura
    RELATIVA à crista daquela seção, não por distância ao eixo — assim a linha
    entre grama e pedra acompanha o morro afinando em vez de desenhar um
    contorno paralelo à borda.
  - **O ruído recorta o CONTORNO, não a altura**: entrando na conta da subida
    ele mexeria na inclinação célula a célula e a face sairia encaroçada — o
    ângulo deixaria de ser o escolhido (medido: 1,24 em vez de 1,0 em 45°). Fora
    do cone liso a subida é presa em 0, senão o recorte cavaria o terreno.
  - **Teto próprio** (`LEDGE_MAX` 24): em 45° a face sobe 2 níveis por célula, e
    um gesto largo passa dos 12 do teto comum. Cortar ali achataria o topo num
    platô — que era justamente o defeito da versão anterior, que só estendia um
    platô no nível da âncora com uma queda fixa.
  - **Só ERGUE, nunca cava**: passar o gesto por cima de terreno mais alto
    abriria um sulco no platô de onde ele sai. E não toca em colisão nem em
    célula bloqueada — é chão andável, como a terra de onde nasce.
- **Montanha é MASSA DE ROCHA, não cúpula** (`perfilDeRocha` + slider "Aspereza",
  referência `ref3.png`): um pincel com falloff `smoothstep` só sabe fazer morro
  redondo. O perfil soma *ridged noise* (`1 − |2·fbm − 1|`, que faz VINCO onde o
  ruído cruza 0,5 — é dele que vem a aresta viva) com uma oitava fina que quebra
  a crista em blocos, e um piso para o maciço não virar arquipélago de picos
  soltos. Determinístico por célula: duas pinceladas no mesmo lugar reforçam a
  MESMA crista em vez de embaralhar o relevo. Medido: rugosidade média de ~1
  nível entre células vizinhas, contra ~0 da cúpula.
  - **A rocha do cume cresce com a altura** (`MASSA_NO_CUME`): as pedras KayKit
    vêm em escala 1 e a maior tem raio 2,4 — cinco unidades, duas células e meia.
    Numa montanha de vinte células isso lê como cascalho e o amontoado de blocos
    da referência não aparece. Escala vai de ~0,9 na saia a ~8,8 no alto.
- **Rochas na montanha** (`generateMountainRocks`, slider em Relevo): as 43
  rochas do KayKit Forest, matacões no cume e miúdas na saia (a distribuição da
  `ref3`), com a espécie saindo da ALTURA relativa da célula. Candidatas são
  `wall` + `stone` — o scatter comum exige célula ANDÁVEL nos escopos
  "dentro"/"tudo" e nunca povoaria montanha. Usa a mesma chave de camada
  (`escopo:mountain_rock`) das outras camadas procedurais, então 🗑 por camada,
  regeneração e persistência vêm de graça. Espaçamento 3,5 (contra os 7 da pedra
  de campo): com os números do campo aberto um pico de 9×9 células recebia DUAS
  pedras. O `y` sai de `sampleHeight`, não do nível chapado da célula — na
  encosta os dois divergem e a rocha flutuaria.
- **`__editor` no console (DEV)** (exposto no fim de `editor/editorStore.ts`): é
  o próprio store zustand, então vale `__editor.getState()` para ler e
  `__editor.getState().paintCell(...)` para chamar qualquer ação. Foi assim que
  montanha, rochas e rio foram conferidos sem arrastar o mouse. **Não crie um
  segundo** — houve uma tentativa de embrulhá-lo num `useEffect` do `EditorView`,
  e o HMR fazia os dois se sobrescreverem alternadamente.
- **Escultura de terreno** (`grab`/`inflate`/`scrape`, grupo "Escultura" no painel
  B): `grab` puxa a região e a altura vem da DISTÂNCIA do gesto (voltar ao ponto
  de partida desfaz, porque a base é `rampBase`, o relevo de antes); `inflate`
  pesa o passo pela componente Y da normal, então topo plano sobe mais que encosta
  e a forma arredonda em vez de virar pilar; `scrape` só corta o que está ACIMA do
  centro do pincel — nunca preenche depressão, que é a diferença em relação ao
  `flatten`.
- **O marcador de destino VESTE o relevo** (`play/pickGround: moldarMarcador`): a
  malha é um plano subdividido (7×7 vértices) e cada vértice recebe
  `terrain.getHeight` daquele ponto, em coordenada de mundo. Um quad rígido só
  encostava no chão onde a altura batia com a do centro — em rampa e morro ele
  afundava de um lado e espetava do outro ("perde o formato").
- **Clique em prop mira o EIXO do tronco, não o ponto de impacto**
  (`play/pickGround: baseDoProp`): mirar a copa de uma árvore de 35 unidades
  acertava a folhagem 6,1 células fora do tronco e o marcador saltava para lá. Não
  serve usar a posição do nó raiz: medido na cena, o filho direto do grupo de
  props é um `Object3D` VAZIO na origem e a translação mora no nó `Scene` do
  .gltf — por aí o alvo virava a célula (0,0), a 331 células de distância. O
  centro em XZ da caixa que envolve o prop é o tronco em qualquer estrutura, e é
  memoizado num `WeakMap` (prop não anda no `/play`).
- **Rampa é um pincel de DUAS PONTAS** (`editor/rampBrush.ts`, pincel "Rampa ⟋"):
  arrasta-se do nível de baixo ao de cima e a altura vai interpolada ao longo da
  faixa (`h0 + (h1−h0)·t`, com `t` preso em 0..1 para as pontas não continuarem
  subindo). `smooth` não substitui: ele tira média com os vizinhos, o que
  arredonda um degrau mas achata em vez de virar ladeira. A base é o heightmap de
  ANTES do gesto (`rampBase`), senão cada movimento do mouse interpolaria sobre o
  resultado do anterior e a ladeira escorregaria enquanto se arrasta. Medido em
  `prt_fild08`: chão até platô de 6 níveis em 14 células, degrau máximo 1.
- **Hierarquia apaga por CAMADA e respeita o escopo** (`deleteLayer`): cada seção
  (Objetos, Spawns, Gatilhos) tem 🗑 que remove tudo dela dentro do escopo ativo —
  apagar seguindo a mesma regra de criar, senão o botão seria a única ferramenta
  capaz de atravessar o escopo. Shift+clique marca a FAIXA (`selectRange`),
  Ctrl+clique marca um a um, Delete apaga o lote; spawns têm seleção múltipla
  própria (`multiSpawn`), porque o `multi` só valia para props.
- **Camada procedural é por CATEGORIA e por ESCOPO** (`procKey`): quantidade,
  seed e espécies moram em `escopo:categoria`, e o prop gerado leva
  `tags: ["_gen", categoria, escopo]`. Com chave só por categoria, gerar
  vegetação "dentro" apagava a que tinha sido gerada na "borda" (o filtro de
  regeneração removia todas). Relevo/água idem: `terrainFeatures` e
  `terrainSeeds` são `Record<EditScope, …>`.
  - **Nos escopos bloqueados o scatter aceita célula bloqueada**: borda e buraco
    são regiões de parede/cliff por definição, e exigir `walkable` (a regra de
    "dentro") fazia o slider gerar exatamente zero árvore no cinturão de mata.
  - **`generateTerrain` EDITA o mapa importado, não recria**: ele nasceu para
    mapa novo e partia de `fill("walkable")`/`fill("grass")` — rodado num mapa do
    servidor apagava a colisão inteira (parede, buraco e borda viravam campo
    aberto). Com `terrainMode: "square"` ou escopo restrito ele copia a base e
    escreve só no escopo, sem tocar em célula bloqueada.
- **Dois cliques com o botão direito viram a câmera para o NORTE**
  (`play/cameraNorth.ts` + `FollowCamera`): `NORTH_AZIMUTH = π` porque a câmera
  fica em `alvo + r·(sin az, …, cos az)` e o norte é +z (a coordenada y do
  rAthena cresce para o norte). O giro anima o ÂNGULO pelo caminho curto
  (`shortestTurn`) — escrever o azimute de uma vez fazia a `lerp` de POSIÇÃO
  interpolar em linha reta e a câmera atravessava o personagem. Só conta como
  clique se o ponteiro praticamente não andou (`CLICK_SLOP_PX`), senão dois giros
  rápidos seguidos jogavam a visão para o norte no meio do movimento.
- **Mapa editado volta para o servidor** (`export:mapcache`): grava
  `rathena-db-import/map_cache.dat`, que no WSL é `rathena/db/import/`. O
  map-server lê os caches nesta ordem e fica com o PRIMEIRO que tiver cada mapa
  (map.cpp:3920-3970) — `db/import` > `db/re` > `db/` —, então só os mapas
  exportados mudam e nada dentro de `rathena/` é escrito. Formato: header de 8
  bytes (uint32 file_size + uint16 map_count + padding), depois por mapa
  `name[12] + xs + ys + len` e as células em zlib, 1 byte por célula
  (`mapcache.cpp:120-150`). Exige reiniciar o servidor.
- **Prop sólido vira PAREDE no servidor**: o exportador converte cada prop pelo
  RAIO medido do .gltf, célula inteira (`grid/propCells.ts` faz a mesma conta no
  cliente). Sem isso, "o personagem atravessa a árvore": o servidor até barrava,
  mas o A* do cliente não conhecia o prop e desenhava reto por cima. As duas
  pontas têm que usar a MESMA regra — por isso o cliente usa raio→célula aqui, e
  não o polígono do hull (que o servidor não sabe representar).
- **Bloqueio miúdo do mapa importado é LIXO, não decoração**: o painel "Limpar
  terreno bloqueado" (`editor/BlockedPanel`) converte as manchas de 1 a 4
  células em chão andável (`collision: walkable`, `surface: grass`, nível 0) —
  são os arbustos e pedras avulsos do mapa original, que não viram nada em 3D e
  atrapalham quem autora por cima. Em `prt_fild08`: 386 manchas, 1.137 células,
  zero células isoladas depois. **Isso muda a colisão do mapa 3D, não a do
  servidor**: enquanto o `map_cache` não for regerado, o rAthena continua
  barrando essas células.
- **Rascunho do editor tem poda** (`editor/draftStorage`): mapa hex serializado
  passa de 1 MB e o localStorage do domínio tem ~5 MB. Sem limite (3 rascunhos),
  a cota entupia e TODO `setItem` do site passava a falhar — inclusive o da
  barra de habilidades do jogo.
- **Engine simulado removido** (F8): saíram `combat/stats`, `demoMonsters`,
  `monsterRegistry`, a IA/auto-ataque de `Monster`/`Player`,
  `useCharacterLoader`, `engine-core/formulas/**` e o módulo `/balancing`
  inteiro (rota, repos, página). Quem calcula dano, ASPD e taxa é o rAthena;
  taxa de exp/drop agora é `conf/import/battle_conf.txt`. O modo local sobrevive
  só como PREVIEW do editor: `Monster` vira boneco parado no spawn
  (`entities/previewSpawns.ts`) e `Player` só anda.
- **Depuração no console (DEV)**: `__world()` (entidades e o próprio),
  `__netEntities` (onde cada uma foi parar no mundo), `__playStats` (mapa,
  escala, online/net), `__three()` (cena/câmera), `__vfx()` (efeitos vivos),
  `__gateway` (socket — dá para mandar `@comando` de GM por `chat:send`),
  `__editor()` (estado do editor de mapas; `__editor.set` chama qualquer ação),
  `__terrainBuild`/`__terrainStats` (custo de montar os chunks do chão),
  `__gl()` (o WebGLRenderer — `__gl().info.render` é a ÚNICA fonte de draw call
  e triângulo de verdade) e `__perf()` (o instantâneo do medidor abaixo).
- **Desempenho se MEDE, e medir errado é fácil** (`scene/perfProbe.ts` +
  `scene/PerfHud.tsx`, **F9** no `/play`): FPS, p50/p99 do quadro, draw calls,
  triângulos, chunks/s e geometrias/texturas vivas. Só em DEV; a amostra sai de
  dentro do laço do three e o overlay escreve no DOM por `ref` — passar 60
  amostras por segundo por `setState` seria repintar a árvore para medir
  repintura.
  - **Aba fora de foco mente**: medindo por `requestAnimationFrame` de fora, o
    editor deu 33 ms/30 FPS — era o Chrome estrangulando a aba em segundo plano.
    Com a aba em foco, 60 FPS. Toda medida de quadro tem de ser feita na aba
    ATIVA, com um descarte inicial (o primeiro quadro depois de trocar de aba
    chega a 1.000 ms).
  - **O que segura regressão é TESTE, não disciplina** (`src/perf/`,
    `pnpm --filter @ragnarok/game test:perf`): cada operação quente — montar
    chunk, montar lâmina, varrer chunk sujo, A* longo, clique em alvo cercado —
    tem um TETO de custo, e ele roda junto com o resto da suíte. Sem isso, uma
    mudança inocente vira engasgo semanas depois e ninguém liga uma coisa à
    outra (foi o que aconteceu com a construção de chunk em rajada).
    - **O limite é RAZÃO, não milissegundo**: cada custo é dividido pela
      CALIBRAÇÃO (um laço aritmético fixo, medido na mesma rodada, na mesma
      máquina). Milissegundo cravado passa aqui e falha noutro PC, e teste que
      falha sem motivo é teste que alguém apaga. Máquina lenta faz os dois lados
      crescerem juntos. Medido em 3 rodadas: chunk 1,45–1,63; lâmina 0,46–0,63;
      varredura 0,061–0,073; A* 0,08–0,17; clique cercado 0,02–0,034 — os tetos
      ficam com ~3× de folga, então eles pegam PIORA GRANDE, que é o que
      interessa.
    - **A calibração não aloca nada** de propósito: se ela mexesse no heap, o
      coletor de lixo entraria na conta e a "velocidade da máquina" passaria a
      depender do lixo que o teste anterior deixou. E toda medida usa MEDIANA
      com um aquecimento descartado — a média se move com uma pausa do coletor,
      a mediana não.
    - **As invariantes de CONTAGEM valem mais que as de tempo**: "uma pincelada
      suja no máximo 2 chunks" e "o pior chunk custa menos que 8× a mediana" não
      têm ruído nenhum e pegam a CAUSA (invalidação larga demais, caso
      patológico) em vez do sintoma.
    - O relatório sai impresso a cada rodada: é dele que se tira o número novo
      quando um teto precisa subir — e subir um teto pede comentário dizendo o
      que se ganhou em troca.
    - **São DOIS arquivos, e eles fazem perguntas diferentes**:
      `perf/desempenho.test.ts` mede PEÇAS (montar um chunk, um A*, uma
      varredura de chunk sujo) e `perf/cenarios.test.ts` mede o que o JOGADOR
      faz — andar, bater, pegar loot, ter 40 e 120 mobs em volta, ter outros
      jogadores em volta. A segunda pergunta pega outra classe de regressão:
      nenhuma peça precisa piorar para o quadro engasgar, basta alguém passar a
      fazer O(n) onde fazia O(1) por pacote de rede. Medido hoje (razão sobre a
      calibração): andar 0,11 · bater 0,02 · loot 0,18 · 40 mobs 0,10 ·
      120 mobs 0,15..0,37 · 30 players 0,04..0,07.
    - **Só entra aqui o que roda em Node.** Draw call, passe de sombra e shader
      precisam de GPU e de sessão aberta; quem responde por eles é o F9
      (`scene/perfProbe`), com a aba EM FOCO. Um teste que fingisse medir isso
      mentiria — e é por isso que as invariantes de `cenarios.test` são de
      IDENTIDADE e de contagem (um pacote de movimento não toca no objeto das
      outras entidades; entidade que some não deixa gid nem alvo para trás;
      número de dano não se acumula), não de milissegundo.
  - **A 60 FPS o vsync esconde ganho de GPU**: quem responde "isto ficou mais
    barato?" é `EXT_disjoint_timer_query_webgl2`, não o FPS. Medido no editor
    com o mapa inteiro na tela: **4,37 ms de GPU por quadro**, ou seja, sobra
    folga — é por isso que trocar o material do chão para Lambert ou desligar o
    MSAA (4×) NÃO foi feito: comprariam tempo que não está faltando, ao preço de
    mudar a imagem. Quando a tela encher de mob e efeito, reavaliar com o mesmo
    timer.
- **Rapier saiu do `/play`** (o `<Physics>` e o `RigidBody` do `PropInstance`):
  o mundo de física era montado e ninguém o consultava — quem decide passagem é
  o `TerrainQuery` e, online, o map-server. Ele cobrava um passo de simulação
  por quadro e, pior, construía um collider `hull` no instante em que um prop
  ENTRAVA no culling, ou seja, no meio da caminhada. `colliderType` continua no
  schema e continua sendo lido pela query e pelo `export:mapcache`. O
  `/spectator` é a única tela que ainda monta `<Physics>`, e por isso o
  `MapTerrain` ganhou a prop `fisica` — um `RigidBody` FORA de um `<Physics>`
  explode na montagem.
- **Sombra que não ilumina nada não se desenha**: a luz do EDITOR tinha
  `castShadow` com mapa de 2048² e SEM `shadow-camera` própria — o frustum
  padrão do three é ±5 unidades em volta da ORIGEM, uma mancha de 10 unidades
  num mundo de 800. Tirar o `castShadow` de lá derrubou a GPU de **4,37 para
  3,38 ms (−23%)** sem tirar uma sombra sequer da tela (conferido em print). O
  `/play` mantém as dele: lá o `SunRig` acompanha o jogador e a câmera de sombra
  é dimensionada de propósito.
  - **Mas a do `/play` estava dimensionada para um mundo que ninguém vê**
    (`views/PlayView`): mapa **2048²** sobre um frustum de meia-largura **95** —
    190 unidades de lado —, rasterizado A CADA QUADRO, porque o `SunRig` move a
    luz e o alvo no `useFrame` e todo personagem e todo prop é `castShadow`. Só
    que a névoa fecha em ~120 unidades e o alcance de desenho é ~130, medidos do
    PERSONAGEM: metade daquele frustum caía em terreno que a névoa já apagou. O
    que decide NITIDEZ é texel por unidade (`mapa / 2×raio`), não o tamanho do
    mapa: **1024² com raio 55** dá 9,3 contra os 10,8 de antes — 14% menos
    nítido por ¼ da rasterização.
    - **O alvo da sombra anda em PASSOS de um texel** (`SHADOW_TEXEL`): a câmera
      é ortográfica e o mapa dela é uma grade fixa, então mover o alvo por fração
      de texel faz a borda de cada sombra "ferver" enquanto o jogador anda. É a
      mesma conta de arredondar que o `useViewCenter` já faz com o centro de
      visão, e sai de graça. Luz e alvo têm de andar o MESMO tanto, senão a
      direção do sol muda.
    - **`shadows="percentage"`, não o default**: `shadows` sozinho herda
      `PCFSoftShadowMap`, o filtro mais caro do three (várias amostras do mapa
      por fragmento). Num visual low-poly com sol duro a borda macia quase não
      aparece, e a conta é paga em cada pixel de chão da tela.
- **O RETRATO do HUD é uma cena 3D inteira, e havia até TRÊS**
  (`hud/CharacterPortrait`): `<Canvas>` próprio, com personagem skinado clonado e
  `AnimationMixer`, montado SEMPRE pela placa do personagem, de novo pela placa
  do ALVO quando há algo mirado, e de novo pela janela de Status — três
  contextos WebGL a 60 Hz, com `antialias` e `dpr` até 1,5, para animar um
  `idle` num círculo de ~94 px. Agora `dpr: 1`, `antialias: false`,
  `powerPreference: "low-power"` e **`frameloop="demand"` pulsado a 24 Hz**
  (`RETRATO_FPS` + o componente `Pulso`). O pulso é obrigatório: em `demand` o
  R3F só desenha quando alguém chama `invalidate()`, e quem anima o busto é um
  `useFrame` — que só roda em quadro que existe.
- **Entidade fora de vista não anima** (`assets.useCharacter(url, speed,
  ativoRef)`): o `NetEntity` já apagava o mob além da névoa com
  `visible = false`, e o three pula sozinho o invisível no desenho e no passe de
  sombra — mas o `AnimationMixer` é NOSSO e continuava correndo. Com
  `area_size: 60` o servidor anuncia um quadrado de 121×121 células, várias
  vezes mais fundo que o raio da névoa: dezenas de esqueletos eram animados por
  quadro para ninguém ver. É um REF, não estado (quem sabe da visibilidade é o
  `useFrame` da entidade); o hook do mixer é registrado ANTES, então ele lê o
  valor do quadro anterior — um quadro de atraso numa animação não tem
  consequência.
  - **E as actions são criadas SOB DEMANDA** (`pegarAction`): os dois glb
    compartilhados somam 26 clips, e `mixer.clipAction` monta as ligações
    osso↔faixa de cada um. Um mob usa `idle` e `walk`; o retrato usa só `idle`.
    Criar 26 por entidade era trabalho jogado fora vezes o número de bichos na
    tela.
- **Componente do mundo assina a FATIA DE RENDER, nunca a entidade inteira**
  (`net/entityRenderSlice`): o `move` do `worldStore` cria um objeto novo por
  pacote — está certo, o store é imutável —, mas o `NetEntityView` assinava
  `s.entities[gid]` inteiro, então cada passo de cada mob re-renderizava a
  subárvore toda dele (área de clique, brilho de chão, plaquinha e a barra de
  três malhas). Pior: o `<Text>` do drei chama `troikaMesh.sync()` num
  `useLayoutEffect` **sem array de dependências**, então o atlas de glifo era
  re-sincronizado em cada um desses renders. A POSIÇÃO nunca passou por render
  nenhum — ela é escrita no `group.position` dentro do `useFrame`, lendo o store
  por `getState()`. A fatia é `{kind, job, name, level, hp, maxHp}`; mesma
  correção no `TargetFrame` do HUD, que arrastava o `CharacterPortrait` do alvo
  junto a cada pacote de movimento dele.
  - Travado dos DOIS lados em `perf/cenarios.test.ts`: um pacote de movimento
    não pode mudar a fatia, **e** mudar HP, nome ou nível PRECISA mudá-la. Sem o
    segundo teste, uma fatia vazia passaria no primeiro e esconderia a barra de
    vida.
- **`useFrame` registrado é `useFrame` que roda** (`play/AimPreview`): o
  `return null` que esconde a mira vem DEPOIS do hook, então dois uniforms eram
  incrementados e `terrain.getHeight` era chamado duas vezes por quadro, durante
  a partida inteira, para alimentar uma malha que não está na cena. A saída cedo
  vai DENTRO do callback. No mesmo espírito, o `GroundInteract` só remolda o
  marcador de destino (49 vértices + esfera envolvente) ao MUDAR de célula — com
  o mouse parado, o resultado era idêntico ao do quadro anterior.
- **`dpr` do `<Canvas>` tem teto** (`[1, 1.5]`, os dois): sem ele o canvas nasce
  no `devicePixelRatio` da tela e um notebook hi-dpi rasteriza 4× de pixels para
  desenhar o mesmo quadro. Nesta máquina o valor é 1 e nada muda — é seguro
  contra "no outro PC trava".
- **Ruído do chão sem `sin`** (`scene/groundNoise.glsl.ts`): o hash clássico
  `fract(sin(dot(p,k))*grande)` gasta uma transcendental por amostra, e são 4
  amostras × 3 oitavas = **12 `sin` em cada pixel de chão** — e o chão cobre a
  tela. O hash novo usa só multiplicação e `fract`. Não é a mesma sequência de
  números (nenhum hash é), é a mesma coisa: ruído branco em [0,1). No mesmo
  espírito, a segunda camada de textura só é amostrada quando PESA
  (`pesoB > 0.004`) — no miolo de uma região uniforme as duas amostras dela
  eram jogadas fora pela mistura.
- **Props do editor também são cullados** (`propsVisiveis` em `EditorScene`): o
  terreno era recortado pelo alcance de visão e os props não — `map.props.map`
  desenhava TODOS, e cada um é uma cópia da cena do glTF (não há instanciação).
  Num mapa com vegetação gerada é o custo dominante do editor, em desenho e em
  reconciliação de React. O raio é o MESMO do terreno (`useEditorViewCenter`,
  que acompanha o zoom) mais um chunk de folga, então afastar para ver o mapa
  inteiro traz todos de volta — ali eles estão em cena porque estão sendo
  olhados.
- **Prop do editor não assina o store** (`EditorProp`): eram OITO
  `useEditorStore` por prop, e cada `set()` — uma pincelada faz dezenas por
  segundo — mandava o zustand avaliar os oito seletores em CADA prop do mapa.
  Sobrou uma assinatura, a da seleção, que é a única que muda o desenho;
  `tool`/`camMove`/ações são lidos com `getState()` dentro do handler, que é
  quando o valor importa. Pelo mesmo motivo, `setHover` só publica quando a
  célula sob o mouse MUDA: ele roda em todo `pointermove` (~100×/s) e criava um
  objeto novo a cada vez, reconciliando `TopBar` e `EditorToolbar` à toa.
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
- **Pendências conhecidas**: editor de classes ainda não escreve YAML (só skill
  escreve, via `db/import`); spawn de mob continua sendo script de NPC do
  rAthena (não há tela para isso); modelo por classe/monstro é o placeholder
  KayKit; hotkeys do servidor (ZC.SHORTCUT_KEY_LIST) ainda não são usadas — a
  barra mora no navegador.
