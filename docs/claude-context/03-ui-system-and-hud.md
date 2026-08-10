# UI skin system (TravelBookLite) and HUD/session wiring

Scope: session gating for `/play` (redirect to `/login`, seeding stats from
the character list, HUD reading server-pushed state, no silent fallback to
the local hex demo world), hotkeys (Alt+A/E/S/Q/Z/M/U/O), and the entire
painted-UI skin system built on the "TravelBookLite" pixel-art book asset
pack plus the later hand-painted packs (Crusenho / ui_definitiva /
ui-change.txt / next-change.txt sourced art):

- Character frame (`hud/PlayerFrame.tsx`, `ui/charFrame.ts`) and the shared
  `StatPlate` used for both the player and the targeted mob/player, including
  the 9-slice runtime-built bar frame (`ui/nineSlice.ts`), portrait rendering
  via a real 3D bust (`hud/CharacterPortrait`), and head-bone-based framing.
- Menu bar buttons (`hud/MenuBar.tsx`, `ui/toolIcons.ts`) — whole-image
  buttons, no 9-slice.
- Chat (`hud/ChatFrame.tsx`, `ui/chatFrame.ts`, `hud/ChatScrollbar.tsx`) —
  non-9-slice corner-anchored frame, tab persistence, per-channel packet
  routing (map/party/guild/global channel via whisper-to-channel trick).
- Skill bar and cast bar (`hud/SkillBar.tsx`, `ui/skillBar.ts`,
  `hud/CastBar.tsx`) — art-relative layout, server-driven cooldown
  (`ZC_SKILL_POSTDELAY`), XP bar minimum width/decimal precision, paginator
  "D-shape" plate assembly.
- Minimap (`hud/Minimap.tsx`, `ui/minimap.ts`) and notification bell — circle
  measured by largest per-row/per-column gap, shared collision canvas cache.
- Inventory window (`hud/InventoryWindow.tsx`, `ui/bag.ts`) — dedicated
  chrome (not the generic `Panel`), content-rectangle-relative layout.
- Status window (`hud/StatusWindow.tsx`, `ui/status.ts`) — forest-scene
  opaque backdrop, server-sourced class name, draggable 3D portrait rotation,
  staged attribute-point allocation (`CZ_STATUS_CHANGE` one point at a time).
- Skills window (`hud/SkillsWindow.tsx`, `ui/skills.ts`) — book scale factor
  `SK_BOOK_K`, left-margin class ribbons keyed off the aegis-name prefix,
  four-frame page-turn animation anchored at the spine, server-driven
  learnable/level-up via `CZ_UPGRADE_SKILLLEVEL`.
- World HP/SP bars (`net/WorldBar`, `ui/barTexture.ts`) — canvas-composited
  9-slice frame cached by rounded aspect ratio, distinct from the CSS
  `nineSlice.ts` path used by HUD chrome.
- `CurvedBox` layout rule: content styling goes on `inner`, never on the
  outer `style` (documented after a bug in `hud/LootToast`).
- Quests window (`hud/QuestsWindow.tsx`, `ui/quest.ts`) — mock quest data
  (`QUEST_MOCK`, no gateway wiring yet), normalized plate scale, dual light/
  dark tinting for list panel vs detail scroll panel, independent scrollbars.
- Quest tracker (`hud/QuestTracker.tsx`, `hud/questStore.ts`) — single
  tracked quest, shares column with minimap.
- Map window (`hud/MapWindow.tsx`, `ui/mapWindow.ts`, Alt+M) — reused chat
  frame at a third scale, JPEG world-map art, shared collision canvas with
  minimap, pan/zoom clamped to map bounds, no player-position marker on the
  painted world map (no region-mapping table exists).
- `ui/windowChrome.ts` — the single `WINDOW_SCALE` (1.40) shared by
  inventory/status/friends so a given art-pixel always maps to the same
  screen-pixel across those three windows (replaced three divergent
  per-window scales).
- Friends list (`hud/FriendsWindow.tsx`, `ui/friends.ts`,
  `net/friendStore.ts`) — first window with no dedicated background PNG (pure
  `CurvedBox` chrome), protocol limits (no level/class/map field in
  PACKETVER 20130618 friend list — guild member list is the complete one),
  "recently seen" is client-only memory, add-friend is invite/response not
  direct write.
- Login and char-select screens (`ui/login`, `ui/LoginChrome`, `/login`,
  `/char-select`) — reused chat-frame corners at a larger scale, JPEG
  background, same HUD bar components for the character sheet preview.

Also in this slice: the gateway name-query bugfix (crash-on-full-server-
death from a bad `setInterval` throw), skill/NPC VFX conventions, gateway
snapshot replay on `world:ready` (stats/status/inventory/skills/entities),
the `world:ready`-fires-on-session-map-entry timing rule, the
one-cell-equals-one-character-scale constant (`charScale` default 1), the
`area_size` battle_conf tuning paired with client fog-far (server
"who exists" radius vs client "who's drawn" radius, and the historical vs
pre-renewal `prt_fild08` monster spawn count correction via
`npc/scripts_custom.conf` load-order requirement), mob nameplate-on-request
(`CZ.REQNAME` polling queue), and the "entering a map forgets what's behind"
bug/fix (`worldStore.limparEntidades` on `world:enter`, distinct from full
`clear()` at session end).

HISTÓRICO + regra atual: art measurements, pixel offsets, and md5-verified
"shared asset" notes are permanent facts about the current asset pipeline,
not historical trivia — don't re-derive them from scratch if the art hasn't
changed.

Full verbatim content below.

---

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
