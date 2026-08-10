# Map editor: dual-grid support, edit scopes, terrain brushes, and editor perf

Scope: everything specific to `apps/admin`'s / the editor's map-authoring
tools layered on top of an imported rAthena square map. Covers:

- Dual-grid support in the editor (`editor/activeGrid.ts` module-level state,
  mirroring the `hexScale` pattern) so shared pure functions (`wanderPath`,
  `cellsInRadius`, scatter) don't need the map threaded through them.
- View-distance culling tied to camera zoom (`editor/useEditorViewCenter`).
- Blocked-cell shape classification (`editor/blockedClusters.ts`) — since
  `map_cache` only says "impassable" with no semantic type, clusters are
  classified by SIZE (1 cell = small, 2-4 in a line/L = medium, 2×2 square =
  large, bigger = structure), 4-neighbor adjacency, measured on `prt_fild08`
  (386 clusters → 28/192/166 split, 98% of blocked cells in 5 structures).
- EDIT SCOPE (`editor/editScope.ts`, TopBar selector) — "Inside" / "Edge" /
  "Hole" / "All", applied GLOBALLY to every tool (brush, hand-placed asset,
  procedural generation, spawns, prefabs). The three regions are disjoint,
  classified by TYPE first (a `cliff` gap is always "Hole" regardless of
  location) then by 4-connected flood fill to the map border for "Edge" —
  type-first matters because on `prt_fild08` 92.5% of hole cells sit inside
  the edge forest belt, so location-first classification made the "Hole"
  scope nearly useless. River channels are explicitly excluded from the edge
  mask even when blocked (a river is mid-map authored scenery, not border).
  Terrain color/relief/generation tools all respect this scope; only
  "Inside" (and "All") protect existing blocked cells from being turned
  walkable, with the procedural lake as the sole deliberate exception since
  it writes `collision: "water"` on purpose.
- Ground/prop click picking (`play/pickGround.ts`) — the invisible ground
  plane at y=0 used to be raycast-hit even where terrain is elevated,
  producing multi-cell click errors on cliffs; fixed via group-handler
  `e.point` usage and always taking the nearest hit across `map-props`/
  `editor-terrain` groups. Prop click targets the trunk's bounding-box XZ
  center (cached per-prop in a `WeakMap`), not the root node (often an empty
  `Object3D` at the origin) or the visually-clicked canopy point.
- Relief brush: PROPORTIONAL falloff (`brushFalloff`, "Força" slider,
  Blender-style proportional editing, `smoothstep`), replacing the old
  flat +1-level-everywhere brush that could only make flat-topped mesas.
- Terrain-passability brushes (mountain, river — the ONLY brushes that touch
  collision, "Passagem" group, square maps only): `mountain` sets height +
  `collision: "wall"` + `surface: "stone"` together (deliberately decoupled
  from walkability, since no rule in the project derives passability from
  height); `mountainClear` undoes it, gated on `surface === "stone"` so it
  can't be used to clear naturally-imported forest; `riverShallow` = walkable
  water (rAthena type 3); `riverDeep` = `wall` with negative authored
  height (wins over the type-based `visualLevel` guess); river width slider
  drives a shallow/deep band from distance-to-traced-path.
- Lake as a BASIN, not a flat bed (`escavarBacia`) — ring-distance-to-land
  falloff (`LAGO_BEIRA_Y`, `LAGO_DECLIVE`, `LAGO_FUNDO_MAX`), because the
  water shader reads bed depth to pick color and a flat bed produced a flat
  turquoise-to-navy-blue lake with no depth gradient. The shore excavates
  down to the WATER LINE (not the bed), sharing one helper with river-bank
  excavation so the two never diverge. Basin re-carves the whole connected
  water body on every stroke (never raises a hand-deepened bed).
- Promontory brush (`ledge`, "Promontório ◤") — drag from root to tip, tip
  height derived from a chosen FACE ANGLE (`LEDGE_ANGLES` 25/35/45/55°,
  `altura = meia-largura × tanθ`) so the ridge tapers to a point as the
  brush narrows; grass-above/rock-below split by height RELATIVE to the
  local ridge crest (not distance to axis); noise recesses the silhouette
  only (never the slope, to preserve the chosen angle); own height cap
  (`LEDGE_MAX` 24); raise-only, never carves, never touches collision.
- Mountain as a ROCK MASS, not a dome (`perfilDeRocha`, "Aspereza" slider) —
  ridged noise (`1 − |2·fbm − 1|`) plus a fine block-breaking octave plus a
  floor so the massif doesn't fragment into an archipelago of peaks;
  deterministic per-cell so repeated strokes reinforce the same ridge.
  Summit rock scale grows with height (`MASSA_NO_CUME`).
- Mountain rock scatter (`generateMountainRocks`) — 43 KayKit Forest rocks,
  boulders at the summit / pebbles on the flank, species from relative
  height; candidates require `wall` + `stone` (opposite of the normal
  walkable-only scatter rule); own layer key (`escopo:mountain_rock`,
  trash/regen/persistence for free); tighter spacing (3.5 vs. 7) than the
  open-field rock scatter; y sampled via `sampleHeight` (never the flat
  per-cell level, which would float the rock on a slope).
- `__editor` console (DEV) — the live zustand store, `__editor.getState()` /
  `.paintCell(...)`. Do not create a second one (an attempted `useEffect`
  wrapper caused HMR double-registration).
- Terrain sculpting (`grab`/`inflate`/`scrape`, "Escultura" group) — `grab`
  drags a region from a fixed `rampBase`; `inflate` weights the push by the
  normal's Y component so flat tops rise more than slopes (avoiding pillar
  shapes); `scrape` only cuts material ABOVE the brush center, never fills
  depressions (the distinction from `flatten`).
- Destination marker conforms to relief (`play/pickGround: moldarMarcador`)
  — a 7×7 subdivided plane sampling `terrain.getHeight` per vertex, instead
  of a rigid quad that only touched down where height matched the center.
- Ramp brush (`editor/rampBrush.ts`, "Rampa ⟋") — two-point drag, height
  interpolated along the drag axis (`t` clamped 0..1), based on the
  PRE-STROKE heightmap (`rampBase`) so repeated mouse movement doesn't
  compound into a sliding slope; `smooth` cannot substitute (it averages
  with neighbors, flattening rather than ramping).
- Layer deletion by CATEGORY, respecting scope (`deleteLayer`) — each
  hierarchy section (Objects/Spawns/Triggers) has a trash icon that removes
  everything in that category within the active edit scope, mirroring the
  creation rule. Range-select (Shift+click) and multi-select (Ctrl+click)
  plus a dedicated multi-spawn selection mode.
- Procedural layer keys are per-CATEGORY and per-SCOPE (`procKey` =
  `escopo:categoria`) so regenerating vegetation in one scope doesn't wipe
  another scope's generated content; generated props carry
  `tags: ["_gen", categoria, escopo]`. In blocked scopes (edge/hole) the
  scatter accepts blocked cells (they ARE wall/cliff by definition);
  requiring `walkable` there produced zero trees. `generateTerrain` EDITS an
  imported map in place rather than recreating it from scratch when the mode
  is `"square"` or scope is restricted — running it unconditionally used to
  wipe existing wall/cliff/border collision on imported maps.
- Editor props are also view-distance culled (`propsVisiveis` in
  `EditorScene`, same radius+chunk-margin as terrain), since the raw
  `map.props.map(...)` rendered every prop unconditionally regardless of
  distance and dominated editor cost on maps with generated vegetation.
- Editor props don't subscribe to the store (`EditorProp`) — dropped from
  eight `useEditorStore` selectors per prop (each brush stroke does dozens
  of `set()` calls per second) to just the one that matters (selection);
  everything else reads via `getState()` inside the handler. `setHover`
  only publishes on actual cell change (not every ~100Hz pointermove) to
  avoid needless reconciliation of TopBar/EditorToolbar.
- Camera snaps to north on two right-clicks (belongs conceptually here too
  even though it lives in `04-netcode-prediction-reconciliation.md`; see
  that file for the mechanism).
- Exporting an edited map back to the server (`export:mapcache`) — writes
  `rathena-db-import/map_cache.dat` (WSL: `rathena/db/import/`), which the
  map-server loads FIRST in its cache-precedence chain
  (`db/import` > `db/re` > `db/`), so only exported maps change and nothing
  under `rathena/` is touched. Format: 8-byte header (file_size u32,
  map_count u16, padding) then per-map `name[12]+xs+ys+len` and zlib-
  compressed 1-byte-per-cell collision (`mapcache.cpp:120-150`). Requires a
  server restart.
- Solid props become WALLS server-side — the exporter converts each prop by
  its measured `.gltf` radius into whole blocked cells (`grid/propCells.ts`
  does the identical math client-side), so the client's A* and the
  server's collision agree; using the hull polygon instead was rejected
  because the server has no way to represent it.
- "Limpar terreno bloqueado" panel (`editor/BlockedPanel`) — converts 1-4
  cell blocked clusters (junk shrubs/rocks from the original 2D map, which
  render as nothing in 3D and clutter authoring) into walkable ground.
  Measured on `prt_fild08`: 386 clusters, 1,137 cells cleared, zero isolated
  cells left. This changes the 3D map's collision only; the live rAthena
  server keeps blocking those cells until `map_cache` is regenerated.
- Editor draft autosave has a cap (`editor/draftStorage`, 3 drafts) —
  serialized hex maps exceed 1MB and the domain's localStorage quota is
  ~5MB; without a cap, quota exhaustion broke every `setItem` on the site,
  including the in-game skill bar.

The legacy hex-grid terrain system (tile heightfields, bridges, hexScale,
gameplay distance fields) is documented in
`08-data-database-config-and-hex-legacy.md`, not here — it's still used by
the editor and `/spectator` but wasn't part of this file's source slice.

HISTÓRICO + regra atual: brush mechanics and the export pipeline are
current, load-bearing rules.

Full verbatim content below.

---

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
