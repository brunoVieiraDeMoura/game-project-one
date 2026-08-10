# Combat orders, dash prevention, and misc client/server edge cases

Scope: a grab-bag of tightly related fixes between the netcode file and the
map-editor file — the three-multi-frame-order system detailed fully (walk-
into-range for attack/pickup/skillcast), the `moveTarget.ts` dash-prevention
rule, pathfinder registration timing, and several small protocol/rendering
correctness rules: client/server collision mismatch as a bug amplifier,
packetver-gated packet variants, entity model rotation isolated to a child
group (never the root, or HP bars spin with the character), server-sourced
class names via the `e_job` enum (never derived client-side), the `@load`
GM-command escape hatch for maps with no 3D scene, and server-sourced skill
name/target-type resolution (never inferred from `range === 0`).

HISTÓRICO + regra atual: these are short, standalone invariants — treat all
of them as current rules.

Full verbatim content below.

---

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
