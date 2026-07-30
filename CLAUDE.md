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
pnpm --filter @ragnarok/game props:measure # re-mede o footprint dos assets → radius nos catálogos
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
  caminho. O cliente pede em trechos de 16 e encadeia ao chegar (medido: 55
  células em 4 pedidos).
- **Redirecionar no meio do caminho parte da posição VISUAL**: o pacote novo traz
  a célula em que o servidor acha que o personagem está, atrás de onde ele é
  desenhado; recomeçar dali dava a "travadinha" ao clicar de novo à frente.
  Medido: maior salto entre frames 0,275 célula (o passo normal).
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
- **Plaquinha do mob vem de PERGUNTA, não do spawn**: o pacote de spawn traz só
  o nome; `Lv.`/`HP:` chegam no campo de nome de PARTY do ACK_REQNAMEALL, e só
  para quem manda CZ.REQNAME (`show_mob_info: 5` = HP absoluto + nível,
  `monster.conf`). O gateway pergunta de toda entidade nova, numa fila (4 a cada
  120 ms) com UMA repetição 1,5 s depois — perguntado no instante do spawn, o
  mob responde só com o nome. Spawn manda `hp: -1` para "não sei": repassar isso
  apagava o HP já conhecido, então vira `undefined` no gateway e no store.
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
  chaveado pelo array `collision`, que o store recria a cada edição — não há
  invalidação manual.
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
  `__gateway` (socket — dá para mandar `@comando` de GM por `chat:send`).
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
- **Movimento duplo**: `createMovementController(mode, terrain)` em
  engine-core é o ÚNICO ponto que escolhe implementação; modo vem de
  config (ServerConfig.defaultMovementMode / personagem), nunca hardcoded.
  Ambos os controllers consomem o MESMO `TerrainQuery` (sem duplicar colisão).
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
  e WASD tinham que andar igual (next-change-game.txt).
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
