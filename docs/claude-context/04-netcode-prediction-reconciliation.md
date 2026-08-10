# Netcode: client-side prediction, server reconciliation, snapshot interpolation

Scope: the full network-latency-hiding stack for player movement, built on
top of the A* pathfinder from `01-rathena-connection-and-world-sync.md`.

- Simulated ping/jitter test harness (`net/pingSimulado`, `?ping=&jitter=`,
  `__ping()` console, localStorage-persisted so it survives navigation).
- Server clock estimation (`net/relogioDoServidor`) — `gettick()` arrives in
  `ZC_NOTIFY_MOVE`/`moveStartTime`, median-estimated offset to
  `performance.now()`, clamped to never return a future instant.
- Client-side prediction (`preverMovimento` + `emitir` in `NetPlayer`) — walk
  starts immediately on click, safe only because the client pathfinder
  already mirrors the server's acceptance rules (reachability, walk-path
  cap).
- Server reconciliation — the pre-existing "deriva" mechanism
  (`celulasExtras` stretching `stepEnds`) already was a reconciliation; the
  missing piece was a **pending-request queue** (`previstos` in
  `worldStore`), matched by destination (no sequence numbers in
  `CZ_REQUEST_MOVE`), with a timeout (`PREVISTO_VALIDO_MS`) since the
  rAthena server silently drops rejected walk requests.
- The mid-walk cast/attack "mini-teleport to cell center" — this is a real
  rAthena behavior (`unit_stop_walking(USW_FIXPOS)`, sub-cell `sx=8,sy=8`,
  literal comment "Stop on cell center"), not a client bug. Client-side
  epsilon (`FIXPOS_EPSILON` 0.05) and heading-based (not distance-based)
  "is this behind me" check, because after a fixpos the walked-distance-from-
  origin metric becomes mathematically zero.
- `clif_fixpos` handling in general — comparing against the ORIGIN of the
  current leg (not raw distance) to detect "server point already passed" vs
  "real divergence", because prediction runs the client ~half an RTT ahead
  by construction. Threshold split: below `FIXPOS_DERIVA_MAX` (8) hold and
  pay the gap over time; above it, and only above it, teleport-snap (below
  8 but above `FIXPOS_TELEPORTE`=3 used to snap too, causing a visible
  backward jump — fixed).
- Snapshot interpolation for OTHER entities (`ATRASO_DE_INTERPOLACAO`=100ms)
  — render 100ms in the past via a delayed anchor (not a delayed clock read),
  requires a one-deep "next leg" queue so a packet arriving before the
  current leg finishes doesn't overwrite and skip it. Never applied to the
  local player.
- Debugging surface: `__mov().recuadas`/`porCausa` (rollback detector,
  compares within the same leg only) and `__mov().predicao.taxaDeErro`.
- Self repositioning (teleport/knockback within the same map) —
  `ZC_STOPMOVE`/`ZC_HIGHJUMP` map to `self:warp` in the gateway contract;
  inside a map the player's block-id is the ACCOUNT id, not the char `gid`.
- Click-target visibility (`visible={false}` breaks THREE.js raycasting —
  the click cylinder must stay invisible via material tricks, not
  `visible=false`).
- SMART TARGET / aim assist (`play/aimAssist` + `play/softLockStore`) —
  screen-pixel-space scoring (not world-space), projecting entity body
  center (not ground point), score formula
  `-distPx − min(12, distJogador×1.5) + 14 se atacando`, on-screen/in-fog as
  a hard gate not a bonus, single per-frame evaluation shared by highlight
  and click, `__mira()` console debug.
- Click-to-walk stopping at the first hit prop (`play/GroundInteract`
  raycasts against `map-props` group, not just a y=0 ground plane) plus
  click-into-obstacle ring-search fallback.
- Path-chaining progress requirement (`net/NetPlayer` re-chains only when
  the new leg gets closer to `destinoFinal`, to avoid wandering when the
  full path can't reach an unreachable cell).
- Basic Attack as a persistent MODE (`net/ataqueBasico`, negative synthetic
  skill id `-1` in the skill bar) — walk-to-target-and-attack-until-dead/
  deselect/mode-off, reusing the multi-frame order machinery.
- TAB target cycling (`play/cicloDeAlvo` + `play/AlvoPorTab`) — pure
  ordering function weighted by camera-forward alignment
  (`PESO_CAMERA`=12 cells), distinct question from aim-assist (ordering vs.
  filtering), ties broken by `gid`, empty field keeps current target.
- Ground glow under a mob (`net/GlowChao`) — three independent signals:
  hover highlight, aim-assist lock, and selected-target ring.
- Loot toast (`hud/lootStore`) — single slot, newest replaces, quantity
  grouping keyed by remount only on a genuinely different item.
- Inventory grid: 4 columns (not 5), name truncation, scroll instead of
  cramming — shares the chat scrollbar component parameterized by gap width.
- F9 perf panel docks LEFT of the minimap (not top-left, to avoid covering
  the player frame bars) and imports `MINIMAP_WIDTH` rather than
  hardcoding it.
- First `idle` animation plays with no `fadeIn` (weight-zero bind pose is
  the T-pose bug source) — `mixer.update(0)` before first render.
- `/login` and `/char-select` skin (see file 03 for full UI details; the
  session/route-gating aspects belong conceptually here too).
- CASTING BLOCKS MOVEMENT (`net/castStore: estaCastando`) — mirrors
  `unit_can_move` (`unit.cpp:1813`); a click during cast is DISCARDED, never
  queued, because rAthena would otherwise resurrect it as a delayed walk to
  a stale destination once casting ends. Compared against `fim` (a clock),
  never against `atual !== null`, so an uncleared cast state can't
  permanently block movement. `SA_FREECAST` is explicitly out of scope.
- CONTINUOUS SUB-CELL POSITION — the architecture was already continuous
  end-to-end (`interpolatedCell` returns fractional cells; all the
  `Math.round` calls only ever produce the logical cell for pathing, never
  write back to the physical position). The real fix was to stop obeying
  the server's forced-center-of-cell snap by splitting position into a
  server-owned CELL layer and a client-owned sub-cell OFFSET layer
  (`preservandoSubCelula`, `alvo = celulaDoServidor + (atual − round(atual))`),
  because `clif_walkok` hardcodes sub-cell 8,8 for the local player and the
  real value is never sent to them. Only true teleports
  (`> FIXPOS_TELEPORTE`) still snap to cell center. Applies to the player
  only — mobs keep integer-cell snapping, matching the server's own AI.
- THE PREDICTION SILENT-BREAKAGE INVESTIGATION (three bugs found together,
  symptom: "walking far, character stutters, jumps BACK a few cells, then
  continues") — full root-cause chain:
  1. The client was mistaking its OWN prediction for a server ack
     (`movedAt` was rewritten by `preverMovimento` too; fixed by checking
     `predito` before treating a `movedAt` change as "packet arrived"),
     which silently broke both the ack-timeout detection (masking rAthena's
     silent walk-request rejection) and the "request in flight" guard on
     path-chaining.
  2. Chaining without that guard became a 5Hz emit loop near the end of
     every 16-cell leg (`quaseLa` stays true for the whole tail) — needs
     BOTH an in-flight guard AND a dedupe keyed on the CURRENT LEG's
     `movedAt` (never on final destination, which stays constant for an
     entire long walk).
  3. Reconciliation was fully disabled (`return s`, dropping the whole
     packet) whenever an ack was "old" with a non-empty pending queue —
     correct for keeping the predicted trajectory, wrong for discarding the
     packet's TIMING info (`extras`/deriva correction) along with it; fixed
     by splitting "destination comes from newest prediction" from "timing
     comes from the packet." Also added `servidorAtras` — the drawn
     position must never visibly walk backward: if the server's `from` has
     MORE path remaining than the currently-drawn point, that point is
     already-walked ground and gets ignored geometrically (the leg still
     ends at the same `to`).
  Also fixed as part of this investigation: `entity:move` was hardcoding
  `speed: 0` (packet 0x86 has no such field) so mob speed never updated
  after spawn; and `predito` must be cleared by every code path that speaks
  authoritatively for the server (`selfMove` already did; `aplicarFixpos`
  and `setSelfCell` did not, leaving stale ack-timeout windows open).
  Locked down in `net/caminhadaLonga.test.ts` and `net/emenda.test.ts`
  (sequence-of-frames tests — a single-value test would not catch either
  bug).
- THE STRICTMODE PATHFINDER BUG — `PlayView` registered the pathfinder in a
  `useMemo` and unregistered it in a bare `useEffect(() => cleanup, [])`;
  React StrictMode's mount→unmount→remount in dev runs the cleanup but the
  memo does NOT re-run (deps unchanged), so the pathfinder stayed `null` for
  the entire session unless the page was reloaded. Silent failure mode: with
  no pathfinder, `buildMotion` falls back to a straight "king's move" and
  the game "keeps working" — prediction, chaining, and the
  `max_walk_path` split all silently no-op. Fix: register in BOTH the
  render-phase `useMemo` (child effects run before parent effects — the
  reason of always) AND a matching-deps `useEffect` that re-registers after
  any cleanup runs; writing the same registration twice is idempotent.
- THREE MULTI-FRAME ORDER SYSTEMS competing for the same walk
  (`attackStore`, `pickupStore`, `skillWalkStore` — "walk into range and
  attack/pick up/cast") exist because rAthena REJECTS out-of-range actions
  rather than auto-approaching; each new order cancels the other two, and
  warp/map-change cancels all three (the target skill cell would otherwise
  remain valid on the new map). The in-range-check for skills is the SAME
  formula the server uses (`distanciaDeAtaque`, ported from
  `check_distance_client_bl`/`distance_client` in `path.cpp`) — a raw
  `hypot` would stop the client one cell too far in some geometries, and
  the rejection is silent. The stop-cell for a ranged skill approach uses a
  fractional segment interpolation toward the caster, not a per-axis
  `sign × range` step (which overshoots on diagonals).
- `net/moveTarget.ts` — never issue a move request the client already knows
  is impossible (the old "dash through mountains" bug): `snapAndavel`
  returning the original blocked cell on failure, combined with
  `pedirMovimento` emitting anyway on a `null` path, combined with a stale
  `map_cache` accepting the bogus request server-side, produced a straight-
  line dash through solid terrain. `destinoAlcancavel` (ring search with a
  time/node budget) now resolves to the nearest reachable cell AND returns
  the path with it, avoiding a redundant second A* per click.
  `temPathfinder()` exists because `serverPath` returning `null` is
  ambiguous ("no route" vs. "no pathfinder registered yet" in the editor
  preview) and the two cases need opposite behavior. The WASD dash (now
  removed, see file 08) had the same bug via a second code path.
- Camera double-right-click snaps to north (`play/cameraNorth.ts` +
  `FollowCamera`), animated via shortest-turn azimuth interpolation (never
  a raw position lerp, which would swing the camera through the character),
  gated by a click-not-drag pointer-movement threshold.

HISTÓRICO + regra atual: several entries above are literally titled as post-
mortems of a specific bug ("A PREDIÇÃO QUEBROU..."); the fix described in
each is the current, permanent behavior, and the surrounding measured
numbers (thresholds, ms, cell counts) are load-bearing constants, not
illustrative examples.

Full verbatim content below.

---

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
