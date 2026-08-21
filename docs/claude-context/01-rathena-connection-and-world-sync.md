# rAthena connection, protocol handshake, and world-authority basics

Scope: how the client connects to the real rAthena server (WSL2 setup, ports,
packet versioning, licensing), the login→char→map session flow, the
architectural principle that the server owns the simulation, and the client's
own two-grid rendering split (square/rAthena maps vs hex/editor maps). Also
covers the client-side A* pathfinder that mirrors the server's pathing rules
(`net/pathfind.ts`), the server's silent 17/30-cell walk-path limit, click
debounce window, path chaining, click-range fog clamp, mid-path redirect
handling, same-map teleport packets, and fractional-cell interpolation math.

This is HISTÓRICO + regra atual misturados: most bullets describe a bug found
and the fix that is now the permanent behavior. Treat present-tense
descriptions ("o cliente refaz...") as current rules; phrases like "era o
motivo de..." or "-CORRIGIDO" mark a fixed historical bug, not a TODO.

Full verbatim content below, extracted from the project's CLAUDE.md history.

---

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
- **`rathena/` ganhou uma EXCEÇÃO à regra "nada é tocado" (2026-08-21)**: as
  duas structs que anunciam item no chão (`packet_dropflooritem`,
  `PACKET_ZC_ITEM_ENTRY`, `packets_struct.hpp`) ganharam um campo custom
  `uint16 mob_id` no FIM, preenchido em `clif_dropflooritem`/
  `clif_getareachar_item` a partir de `flooritem_data.mob_id` — dado que o
  servidor já calculava (`mob_setdropitem`, `map.hpp:495`) e simplesmente
  descartava antes de chegar a qualquer pacote/log/tabela (nem `picklog`
  guarda). Objetivo único: o cliente saber qual monstro gerou aquele drop
  específico, pra cruzar com `GET /monsters/:id` (mesma tabela `mob_db_re`
  que o admin edita) e achar a % REAL daquela entrada de loot — camada visual
  de raridade de item (`vfx/loot/`), nunca gameplay. Os dois structs são
  `__attribute__((packed))` e o tamanho do pacote é sempre `sizeof(p)` (nunca
  uma tabela estática), então acrescentar o campo no fim é seguro. Espelhado
  em `packages/ro-protocol/src/vendor/Network/PacketStructure.js`
  (`PACKET.ZC.ITEM_ENTRY`/`ITEM_FALL_ENTRY2`, +1 `readUShort()` e `.size +2`
  nos dois branches de PACKETVER) e em `apps/gateway` (`GroundItem.mobId`,
  `protocol.ts`/`session.ts`). **Qualquer novo patch em `rathena/` precisa
  disto**: depois de editar, rodar `wsl-setup.sh` de novo antes de
  `wsl-build.sh` — o build compila a ÁRVORE DE DENTRO DO WSL
  (`~/game-project/rathena`), não o `rathena/` do Windows direto; sem o
  resync o binário novo não tem a mudança.
  - **2º campo custom, `fresh_drop` (2026-08-21)**: mesmos dois pacotes
    ganharam mais 1 byte (`uint8 fresh_drop`) depois de `mob_id` — `true` =
    drop veio de rolagem de verdade na tabela do monstro, `false` = re-drop
    de item que um monstro LOOTER (`mode_looter`, ex. Poring) tinha pego do
    chão antes e devolveu ao morrer. Diferente de `mob_id`, este dado
    PRECISOU de um 3º arquivo C++ além de `clif.cpp`: `map_addflooritem`
    (`map.cpp:2007`) já recebia esse booleano como parâmetro
    (`canShowEffect`, usado só pro efeito de pilar do drop retail,
    PACKETVER≥20180418) mas nunca o guardava — o patch acrescenta
    `fitem->fresh_drop = canShowEffect;` dentro da própria função e um campo
    novo em `struct flooritem_data` (`map.hpp:495`), pra persistir o valor
    além do instante do drop. Isso importa porque `clif_getareachar_item`
    (item que já estava no chão quando você entrou em vista) não tem
    `canShowEffect` NENHUM no rAthena original — sem persistir no struct, um
    jogador que chega depois do momento do drop nunca saberia se era
    fresco ou re-drop, e a aura de raridade sumiria pra qualquer um que não
    estivesse olhando no instante exato do kill. `mob_id` continua correto
    através de um re-drop (rAthena propaga o id do depositante ORIGINAL,
    não do looter — `mob_setlootitem`, `mob.cpp:2528`), então a % resolvida
    seria a mesma; é só o "mostrar o efeito de novo" que precisa ser calado.
    Mesmo padrão de replicação: `packets_struct.hpp` (+1 byte nos 2
    structs), `PacketStructure.js` (+1 `readUChar()`, `.size` +1 nos 4
    branches), `apps/gateway` (`GroundItem.freshDrop`), cliente
    (`GroundItemData.freshDrop` → `LootRarityAura`: `freshDrop === false`
    nunca mostra aura nem toca som, `undefined` continua permissivo).
  - **São DOIS caches, e o servidor lê os dois** (map.cpp:3920):
    `db/re/map_cache.dat` tem só os 8 mapas específicos de renewal (entre eles
    `prt_fild08` e `prontera`) e `db/map_cache.dat` tem o acervo inteiro — 1.288
    mapas, 106 milhões de células. Migrar só o primeiro era o motivo de todo
    portal de borda cair em "mapa sem cena 3D": o vizinho (`moc_fild01`,
    `prt_fild07`) mora no outro arquivo. `--cache base|re|pre-re` escolhe, e o
    base EXIGE `--only` — sem filtro seriam ~1 GB de JSON. Migrar só os destinos
    dos warps do mapa em uso é o caminho: `prt_fild08` tem 6 warps para 4 mapas.
