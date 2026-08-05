# Plano — `next-change-editor.txt`

Dez itens. Três são defeitos com causa já localizada no código, quatro são
reescritas de sistema, dois são investigação e um é tela nova no admin.

Ordem: **defeito antes de reescrita**. Um sistema reescrito por cima de um bug
esconde o bug, e aí ele volta como "a reescrita quebrou".

---

## Fase 1 — Defeitos com causa localizada

### 1.1 Quadrado cinza ao criar/desfazer algo grande

**Causa encontrada** (`grid/SquareTerrain.tsx:248-254`): numa edição grande, o
`chunksSujos` marca dezenas de chunks; o código **descarta e apaga todos do
cache imediatamente**, e a reconstrução é limitada a `orcamentoMs` (6 ms) por
quadro. Entre o descarte e a reconstrução o chunk simplesmente não existe — e o
que se vê no lugar dele é o vazio. Desfazer troca os três arrays de uma vez, o
que suja o mapa inteiro: daí o quadrado ser grande.

**Correção:** construir ANTES de trocar. O chunk sujo entra na fila de
reconstrução mas a geometria velha continua no cache e **continua sendo
desenhada** até a nova ficar pronta; só então a velha é descartada. Um quadro de
terreno desatualizado é invisível; um buraco não é.

`grid/SquareTerrain.tsx`, no bloco de invalidação e no `useFrame` que drena.
Teste em `perf/desempenho.test.ts` (já existe a invariante "uma pincelada suja no
máximo 2 chunks"): somar "chunk sujo nunca sai do desenho antes de ter
substituto".

### 1.2 "Rio fundo" andável / lago com textura de rio fundo

Dois enganos diferentes com o mesmo sintoma aparente.

- **O pincel de rio já grava certo** (`editorStore.ts:2991-3002`): `riverDeep`
  escreve `collision: "wall"`. Suspeita a confirmar: a célula bloqueada só
  aceita rio se já for rio (`if (bloqueada && surface[i] !== "river") continue`),
  então repassar "Rio fundo" por cima de rio raso funciona, mas **pintar rio
  fundo onde já havia rio fundo** não muda nada e parece "virou raso".
- **O LAGO é o defeito real**: `SURFACE_COLLISION.water = "water"`
  (`editorStore.ts:1297`), e água do rAthena é ANDÁVEL (tipo 3). O pincel de lago
  grava `surface: "water"` + colisão andável, e a lâmina o desenha com a
  profundidade do leito — que a bacia escavada deixa fundo. Resultado: parece rio
  fundo e se anda em cima.

**Correção:** separar **profundidade visual** de **passagem**, que hoje estão
amarradas pela superfície.

| superfície | colisão | lâmina |
|---|---|---|
| `river` raso | `water` (anda) | rasa |
| `river` fundo | `wall` (não anda) | funda |
| `water` (lago) raso na beira | `water` (anda) | rasa |
| `water` (lago) fundo no meio | `wall` (não anda) | funda |

O lago passa a ter **miolo intransponível e beira andável**, que é o que a lâmina
já desenha (turquesa raso, azul fundo). Quem decide é a profundidade do leito
contra um limiar, no mesmo lugar onde `escavarBacia` já calcula o anel.

`editor/editorStore.ts` (pincel de lago e `escavarBacia`), e o `export:mapcache`
já traduz `wall` para célula tipo 1 — o servidor herda de graça.

### 1.3 Suavizar a raiz da montanha

O pincel de montanha (`perfilDeRocha`) ergue e para: o encontro com o campo é um
degrau. Já existe a peça certa — a média de canto de `grid/heightField` e o
`smooth` do pincel de relevo.

**Correção:** depois de aplicar o perfil, passar um `smooth` de um anel nas
células da BORDA do gesto (as que têm vizinho fora da montanha), com peso
proporcional à distância. Não toca no miolo, que é onde a aspereza tem de ficar.
Trava em `editor/mountainRocks.test.ts`: "o degrau na fronteira da montanha é
menor que N".

### 1.4 Textura do promontório: grama em cima, terra embaixo

Hoje é `LEDGE_MATO` = 0,55 separando mato (topo) de ROCHA (face). O pedido é
grama em cima e TERRA embaixo.

Uma linha em `editor/editorStore.ts` (o `surface` da face passa de `stone` para
`dirt`), mais o teste de `promontorio.test.ts` que hoje afirma rocha na face.

---

## Fase 2 — Investigação (o item 2 do arquivo)

### 2.1 O mapa do rAthena limitando a edição no editor

**Hipótese forte, a confirmar com número:** não é interferência, é o **escopo**.
`editor/editScope.ts` divide o mapa em três regiões DISJUNTAS — dentro, borda,
buraco. Num `prt_fild08` importado, a colisão do `map_cache` já classifica
**56.676 células como borda e 7.899 como buraco** (medido e registrado no
`CLAUDE.md`), sobrando 95.425 para "Dentro". Editando com "Dentro" escolhido, o
pincel ignora as outras duas — exatamente o "como se já houvesse diretrizes
dizendo onde é a borda".

**O que fazer:**
1. confirmar medindo de novo no mapa atual (script de auditoria, como o do
   `map_cache`);
2. **tornar isso visível**, que é o que falta: um realce no editor mostrando a
   região do escopo ativo. Hoje a regra existe e é invisível, e regra invisível
   parece bug;
3. conferir se o mapa LIMPO (o `clearAll`) zera as três regiões — se `collision`
   vira toda `walkable`, "borda" e "buraco" ficam vazias e "Dentro" passa a ser o
   mapa inteiro. Se não estiver assim, é bug do `clearAll`.

E responder a segunda metade da pergunta: **o editor leva isso para o `/play`?**
Sim, e por um caminho só — `export:mapcache` + reiniciar o servidor. Enquanto não
se exporta, cliente e servidor divergem (já documentado: 3.019 células
divergentes medidas uma vez). Vale um aviso no editor quando o mapa tem edição
não exportada.

### 2.2 Renderização de cada asset no mapa

Varredura: para cada entrada do catálogo, conferir que o `.gltf` carrega, que o
raio medido (`props:measure`) bate com a silhueta e que a escala padrão não
enterra nem faz flutuar. Sai como relatório, não como código.

---

## Fase 3 — Auto-renderização (Vegetações & Construções)

Hoje o scatter tem UMA regra para todas as categorias
(`editorStore.generateScatter:470-500`): fora de água/terra/pedra e vizinhas,
célula andável. Não há regra por categoria, nem de inclinação, nem de neve.

**Vira uma tabela por categoria** — as categorias já existem em
`props/registry.tsx:111`:

| categoria | proibido |
|---|---|
| `tree`, `grass`, `bush` | areia, neve, pedra, montanha, água (lago/rio raso/rio fundo), **inclinação**, sobre outro asset |
| `tree_bare` (árvore seca) | **grama**, água, inclinação, pedra, sobre outro asset → sobra terra e areia |
| `rock`, `mountain` | montanha, água, sobre outro asset |
| `building` | água, inclinação, sobre outro asset |

Duas peças novas, as duas testáveis sem DOM:

- **`podeNascer(cat, celula)`** — pura, recebe superfície, colisão e inclinação e
  devolve sim/não. É a tabela acima em código, num lugar só;
- **inclinação** — não existe hoje. Sai do heightmap: a maior diferença entre a
  célula e os oito vizinhos, contra um limiar. É o mesmo dado que
  `grid/heightField` já lê.

"Sobre outro asset" já funciona (`occupied.blocks` + `SOLID_CATEGORIES`); o que
falta é o resto.

Teste novo `editor/podeNascer.test.ts`, com um caso por linha da tabela.

---

## Fase 4 — Relevo, água e estrada

### 4.1 Colinas e montanhas por slider

Hoje `generateTerrain` tem `hill` e `lake`; o painel de montanha é
`generateMountainRocks` (rochas, não relevo). O pedido:

- **Colinas**: espalhar colinas pelo mapa inteiro; o slider controla **altura e
  quantidade** juntos;
- **Montanhas**: idem, com o perfil de rocha que o pincel já usa
  (`perfilDeRocha`) — o slider controla altura e quantidade;
- **Lagos: REMOVER** do gerador (o pincel de lago continua).

`editor/editorStore.ts` (`generateTerrain`, `TerrainFeatures`) e
`editor/TerrainPanel.tsx`. Sai um campo do tipo `TerrainFeatures`, o que exige
migração do rascunho salvo — mapa antigo com `lake > 0` passa a ignorar o campo.

### 4.2 Estradas com textura escolhida

O sistema de nós já existe (`roadCells`, `generateRoads`). Falta **escolher a
textura**: areia, pedra, grama, terra. Hoje a estrada grava uma superfície fixa.

Vira um campo no estado do editor (`roadSurface`) + seletor no painel, no mesmo
molde da paleta de superfície que já mostra a miniatura da textura
(`editor/ToolOptions: SurfaceBtn`).

### 4.3 Rio gerado com nós, textura e largura

O `generateRiver` de hoje traça de borda a borda com largura por slider. O pedido
é aproximá-lo da estrada: **nós** (o traçado que o usuário aponta), **textura da
água** e **largura em células**.

- os nós reusam a mesma máquina do `roadCells`;
- a largura já existe;
- a "textura da água" é o `terrainStyle` — hoje ele é por MAPA (schema v6). Para
  ser por rio, ou o rio vira uma variante do estilo, ou é escolha global. **Isto
  precisa de decisão**: por rio exige campo novo no `GameMap` e no `_blocks` do
  `map-row.ts` (a lista é fixa, ver `CLAUDE.md`).

---

## Fase 5 — Criar mapa no admin

`/maps` hoje tem só "+ Novo mapa 3D" apontando para `/maps/new`. O pedido: poder
escolher **nome** e **dimensão** ali, e ter onde editar essas opções depois.

- formulário com nome (texto) e dimensão (select com os tamanhos usuais —
  128×128, 256×256, 400×400 como o `prt_fild08`, 512×512);
- a API já aceita (`POST /maps`, `apps/api/src/routes/maps.ts:44`), então é tela;
- "editar essas opções" = o mapa aberto poder ser renomeado e redimensionado.
  **Redimensionar tem consequência**: os três arrays (`collision`, `surface`,
  `heightmap`) mudam de tamanho e o conteúdo precisa ser recortado ou preenchido.
  Proposta: manter o canto superior-esquerdo e preencher o resto com campo
  andável, avisando na tela que o excedente é perdido.

---

## Verificação

```bash
pnpm --filter @ragnarok/game test
pnpm --filter @ragnarok/game test:perf
pnpm --filter @ragnarok/game typecheck
pnpm --filter @ragnarok/api test
```

No editor, por fase:

1. desfazer uma geração grande — nenhum quadrado vazio em nenhum quadro;
2. pincel "Rio fundo" — o personagem não atravessa no `/play` **depois de
   `export:mapcache` + reiniciar**; lago com beira andável e meio não;
3. escopo "Dentro" num mapa limpo alcança as 400×400;
4. gerar vegetação — nenhuma árvore em areia, neve, pedra, água ou ladeira;
   árvore seca só em terra e areia;
5. colinas e montanhas pelo slider; lago sumiu do gerador;
6. estrada e rio com nó e textura escolhida;
7. criar mapa 256×256 pelo admin e abri-lo no editor.

---

## O que precisa de decisão sua

1. **Textura da água por RIO ou por MAPA** (4.3). Por rio é campo novo no schema
   e no stash do `map-row.ts`; por mapa é o que já existe.
2. **Redimensionar mapa existente** (5): recortar mantendo o canto, ou proibir e
   deixar só o tamanho na criação?
3. **Inclinação** (fase 3): qual desnível já conta como ladeira. Proponho
   **meio nível entre células vizinhas** — acima disso, nada de árvore.
