# Square terrain rendering: chunks, textures, water, fog, height, chunk budget

Scope: everything about how the rAthena-derived square map (`terrainMode:
"square"`) becomes a 3D scene. Covers: the dual map_cache sources
(`db/re/map_cache.dat` vs `db/map_cache.dat`) and the `--cache`/`--only`
migration flags; map JSON parse-cost budget; the chunked terrain mesh
(`grid/squareChunks.ts` + `SquareTerrain.tsx`, 32×32 cells/chunk, per-vertex
color); the terrain texture pipeline (`scripts/make-terrain-textures.mjs`,
CC0 photo vs procedural sourcing, HSL restyling, contrast targeting,
thumbnail-divides-texture-size rule, manifest-driven catalog); per-map
`terrainStyle` (schema v6) and the `_blocks` API stash allowlist; corner-color
blending across surface boundaries; water rendering (river vs lake regimes,
per-corner water level via flood fill, margin/foam via blurred isoline alpha,
depth-based color, bank/barranco excavation, lake basin/bowl shape); height
field at corners (not per-cell) with group-aware averaging (passable vs
blocked groups don't blend into ramps); wall/cliff visual level heuristics
(`visualLevel`) with authored-height priority; chunk geometry cache
invalidation on render (not in an effect); the per-frame chunk-build budget
(`ORCAMENTO_MS`) and its queue, draining nearest-first; the two-phase loading
screen (construir → aquecer) that hides the scene and warms shaders behind a
curtain, gated on `gl.info.programs.length` plateauing with a hard timeout;
sky-color fog blending via the shared `fog_fragment` ShaderChunk (sRGB-space
constants, screen-height varying); the fog-fraction-of-render-distance rule
(`fogNearFrac`/`fogFarFrac` off `renderDistance`) and its auto-converting
legacy schema (`fogFar` → fraction); and the per-entity texture/skeleton
memory-leak fix (`SkeletonUtils.clone` merging skinned meshes, disposing
skeletons and glow materials).

HISTÓRICO + regra atual: bug narratives ("era o motivo de...", "medido
antes/depois") document why a rule exists; the numbers and mechanism
described are the CURRENT implementation unless explicitly marked as
superseded elsewhere.

Full verbatim content below.

---

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
