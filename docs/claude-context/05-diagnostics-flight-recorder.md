# Diagnostics: the flight recorder and asset/texture audit

Scope: `core/diagnostics/flightRecorder.ts` (`__voo` console command, F9
overlay section) — a per-frame black-box recorder built specifically because
render-cost bugs and movement-rollback bugs turned out to share root causes
and needed to be correlated on the same timeline. Covers: the columnar
per-frame ring buffer and event ring, trigger-based case capture (300 frames
back / 120 forward), `walkId` correlation across legs/acks/frames, the
rollback trigger (cross-leg movement + elapsed-time check, since the
same-leg-only detector in `NetPlayer` misses the exact frame where a fixpos
writes a new leg and moves the character in the same frame), the renderer/
device probe (`core/diagnostics/rendererProbe.ts` — context-lost/restored,
canvas/renderer lifecycle, shader recompiles, `renderMs`/`gpuMs`/
`memoriaGpuMb`/`heapMb`/`contextosVivos` columns, the `rendererRecriado`
trigger's three required conditions and the false-positive it produced from
Suspense remounts reusing the same `gl` instance, the 2-second capture
deadline, the coalesced-counter-events pattern), the scene-tree probe
(`core/diagnostics/cenaProbe.ts` + `assetProbe.ts` — the `desmontando.jpg`
investigation into a scene going invisible for ~1 frame with a healthy
device: ruling out disposal/culling/camera via draw-call and geometry
counts, forming and then testing the Suspense-remount hypothesis via a named
per-boundary fallback probe, the `-1`-means-never timestamp convention, the
transition-to-zero (never absolute-zero) trigger rule, sampled-at-10Hz scene
walks, and the eventual confirmed root cause: a cold prop `.gltf` suspending
the single map-wide Suspense boundary and the boundary's remount blowing
away the terrain chunk cache — fixed by `preloadPropsDoMapa` during the
loading-screen curtain plus a per-prop Suspense boundary in `/play` to
contain any future miss), the follow-on findings about the HUD being hidden
via `display: contents` instead of unmounted (and the 600ms cost that traded
in for, still open), `core/diagnostics/medir.ts` (a named, threshold-gated
instrumentation helper used to eliminate five suspects and then removed),
`play/PreCompilarProps` (off-screen warm-instance compile pass), the
GPU-memory-estimation caveats (no standard web API; grep-based estimate from
declared attributes/textures with an explicit `exclui` field).

Also in this file: the asset/texture reuse audit (`core/diagnostics/
censo.ts`, `__censo()` console) — proving `useGLTF` caching + `Object3D.clone`
reference-sharing already avoids "200 trees = 200 GLBs", the ratio-not-count
metric, the confirmed real waste (per-`.gltf`-document texture duplication:
`forest_texture.png` loaded ~42 times because the drei cache keys on GLTF
url not image url — fixed by `compartilharTexturas` deduplicating on
`parser.associations` + `images[n].uri` + sampler settings, NOT on
`image.src` which is null for `ImageBitmap`-loaded textures in Chrome;
measured 224MB → 17MB, −88%), the terrain-material-leak-on-map-change fix,
the per-entity-to-per-module resource sharing for click hitboxes/glow
materials/ground-item planes (`net/recursosCompartilhados.ts`), and the
`matrixAutoUpdate = false` optimization for static map props (halves
`updateMatrixWorld` cost; the other half is the scene root's own
`matrixAutoUpdate`, a global change left undone).

HISTÓRICO + regra atual: this file is largely an investigation log. The
instrumentation described (flight recorder, censo) is a PERMANENT tool that
still exists in the codebase; the specific bugs it caught and the fixes
applied are the current state of the code, not open issues.

Full verbatim content below.

---

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
          Adivinhar qual suspeito custa seria fácil e provavelmente errado: foi
          assim que a hipótese do contexto WebGL (8 ms, medido) sobreviveu duas
          rodadas.
        - **Instrumentação de CAÇA é desligada quando a caça acaba.** Os cinco
          `medir()` (`zod→mapa`, `props→colisão`, `terrainQuery`,
          `legacyMapping`, `minimapa→bitmap`) somaram **28 ms no caso inteiro** e
          cumpriram o papel de ELIMINAR cinco suspeitos; o sexto
          (`terreno→descarte`) nunca disparou; e a `SondaDeRender` (`<Profiler>`)
          mediu 39 ms e eliminou a fase de render do React. Todos foram
          desembrulhados depois disso. Manter o `<Profiler>` montado seria somar
          `performance.measure` ao caminho quente EXATAMENTE onde o problema era
          esse tipo de sobrecarga. **Os módulos ficam** — embrulhar de novo é um
          import e uma linha, e desembrulhado o custo é zero.
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
      - **E tem de trazer o RESUMO das colunas** (`resumo`: p50/p95/máximo de
        cada uma, sobre o anel). Sem caso, a série de quadros sumia inteira — e
        zero caso é o resultado NORMAL de medir um custo em regime. Pego ao
        tentar ler `matrizMs` depois de desligar o `matrixAutoUpdate` dos props:
        o arquivo tinha eventos, censo e estado de gravação, e **nenhuma das 48
        colunas**. Mediana pela mesma razão do `perf/orcamento` (pausa do
        coletor envenena a média), com `p95`/`max` ao lado para o pior quadro
        não desaparecer nessa robustez. `NaN` sai da conta em vez de virar zero.
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
    - **CONFERIDO** no `voo-1785966296680.json` (`resumo.matrizMs`):
      **p50 1,11 → 0,50 ms**, p95 0,8, máx 1,1. Metade exata, como o modelo
      previa — a leitura do three estava certa.
    - **Acumulador que só zera com o gravador ligado MENTE.** O `medir()` soma
      sempre em DEV, mas quem zerava a coluna era uma chamada dentro do
      `if (ativo())` do `amostrarCena`: um período com o voo parado empilhava
      tudo e despejava o total no PRIMEIRO quadro gravado. Saiu como
      `trocaMs.max = 514,5 ms` num dump **sem um único evento `cena/custo` e sem
      portal nenhum** — pico fantasma, do tipo que já mandou esta investigação
      atrás de causa errada. A escrita foi para fora do `if`; escrever no
      rascunho com o gravador parado é inofensivo, porque aquela linha nunca é
      confirmada. (Os acumuladores do `rendererProbe` já zeravam fora do `if`.)
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
