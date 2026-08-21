# Otimização: heurísticas de escala do cliente 3D

Plano completo em `C:\Users\Bruno\.claude\plans\twinkling-tickling-marshmallow.md`
(auditoria linha a linha do que já existe, o que é parcial, e por que algumas
heurísticas do relatório externo foram rebaixadas para este projeto — `area_size:
60` já faz interest management no servidor, ~25 entidades na tela, GC medido em
226ms de pico).

Ordem escolhida para nunca voltar num arquivo já fechado: substrato de
importância → LOD (VFX/animação/entidade) → orçamento global (livro-caixa, não
gerente — ver contrato em T5a) → GC → HUD → assets.

## Status

| # | Task | Status | Notas |
|---|---|---|---|
| T0 | Linha de base medida (`test:perf`) | ✅ concluído | ver tabela abaixo; bench headed (`VFX_BENCH_HEADED=1`) diferido pro momento de calibrar thresholds reais (T2/T3/T4), não antecipado sem consumidor |
| T1 | `core/importancia.ts` — módulo puro de tier/taxa | ✅ concluído | `core/importancia.ts` + teste (12 casos); zero consumidor ainda, por design |
| T2 | Ligar mecanismo de LOD de VFX | ✅ concluído (escopo corrigido) | só `ParticleRenderer` ganhou `activeCountFor` (mesmo padrão do `TrailRenderer`, que já existia) — **Sprite/Ring/Beam/Cage são 1 slot/mesh por instância, sem "contagem" pra reduzir**; auditado código antes de tocar, plano original superestimava (ver nota abaixo). Thresholds continuam `Infinity` (no-op) até benchmark real calibrar — mesma regra de `lod.ts` |
| T3 | Animation LOD (taxa por distância, não binário) | ✅ concluído | `assets.ts: useCharacter` — `ativoRef` (booleano) virou `taxaHzRef` (Hz); acumula `dt` e chama `mixer.update` só a cada intervalo, sem mudar a VELOCIDADE da animação. `net/NetEntity.tsx` calcula o tier por `useFrame` (distância até câmera + crítico=alvo/ameaça nunca degrada) e escreve a taxa no ref. Thresholds/taxas em `ANIMATION_LOD_*` continuam no-op (60Hz sempre) até calibração real — 1578/1578 testes verdes, typecheck limpo |
| T4 | Buckets de frequência de entidade (plaquinha/barra/GlowChao) | ⏭️ pulado (auditado, sem candidato) | ver nota abaixo — não force trabalho que não existe |
| T5a | Contrato do `FrameBudget` validado (teste de semântica) | ✅ concluído | `perf/frameBudget.ts` (`beginFrame/consume/remaining/shouldDegrade`, SEM `reservar()` — não tem consumidor que precise) + `perf/frameBudget.test.ts` (15 testes: aritmética, reserva≠consumo, prioridade 0 nunca degrada, fallback sem o módulo, guarda "zero import") |
| T5b | Terreno/VFX consultam o `FrameBudget` | ⏭️ **não aplicável na forma proposta** — auditado com `arquivo:linha`, sem implementação | ver seção "T5b — decisão arquitetural"; `moveTarget` sai do escopo (execução é ORA dentro ORA fora do frame, não por acaso — depende do timing do clique); terreno+VFX têm frame real em comum mas sem ponto de entrada com ordem garantida hoje |
| T6 | Passada de GC (matar `.clone()`/alocação em `useFrame`) | ✅ concluído | `views/PlayView.tsx` (`AssistenciaDeMira`): closure `candidato()` recriada por quadro + 1 objeto `Candidato` novo por mob/item por quadro (~25 entidades × 60fps) viraram `escreverCandidato()` (função de módulo, zero closure) escrevendo em pools reusados (`candidatoDoPool`); os 2 `.clone()` de Vector3 no laço de exclusão por obstáculo (linhas antigas 606/643) removidos — `temLinhaDeVisada` é síncrona e não retém a referência (conferido em `play/pickGround.ts`). `mobs.filter()` no laço de exclusão NÃO tocado (caminho frio, só roda quando o vencedor está atrás de obstáculo — ver nota). `Object.values(items)` NÃO tocado (mexeria em `worldDropStore`, fora do escopo). 1593/1593 testes verdes, typecheck limpo, `test:perf` sem regressão |
| T7 | Consolidar rAF do HUD num tick único | ✅ concluído | `hud/hudTick.ts` (substitui `statusTick.ts`) — 8 loops → 1. Ver seção "T7 — consolidação do rAF do HUD" abaixo para detalhe por componente, frequência, e os testes de lifecycle |
| T8 | Assets: descarte por mapa + KTX2/Draco/meshopt | ✅ concluído (escopo corrigido) | descarte por mapa implementado (só RAM, não VRAM — motivo abaixo); KTX2/Draco/meshopt auditado como NÃO ACIONÁVEL nesta passada (falta pipeline de recompressão de asset, não é mudança de código) — ver seção "T8 — assets" |
| T9 | Entity LOD visual / occlusion / workers — só se T0 provar necessidade | ⏭️ **gate checado, não atendido — não iniciada** | ver seção "T9 — gate checado" |

Legenda: ⬜ pendente · 🔄 em andamento · ✅ concluído · ⏭️ pulado (com motivo)

## T0 — linha de base (`pnpm --filter @ragnarok/game test:perf`, 2026-08-20)

Custo relativo à calibração (razão, não ms — ver `perf/orcamento.ts`; teto de
cada teste está no arquivo, não repetido aqui):

```
chunk de terreno                      1.388
lâmina d'água                         0.497
varredura de chunk sujo               0.021
A* longo                              0.093
clique em alvo cercado                 0.01
pior chunk ÷ mediana                   5.67
andar (caminho + 60 quadros)          0.227
bater (40 golpes)                     0.126
loot (40 caem, 40 pegos)              0.132
40 mobs (1 s de jogo)                 0.206
120 mobs (1 s de jogo)                0.272
30 players (1 s de jogo)              0.161
manager.update 200 instâncias (entity)    0.035
manager.update 200 instâncias (cell)    0.037
play+update(poda) 200 instâncias efêmeras    0.225
pool acquire/release 1000             0.017
pulse 200x no mesmo alvo              0.092
```

45/45 testes verdes. Todos os subsistemas folgados em relação ao próprio teto
hoje — confirma que o gargalo não é "operação lenta", é GC/alocação (226ms
medidos em produção, `net/recursosCompartilhados.ts:20`) e a ausência de
coordenação entre orçamentos, exatamente o que T1–T8 atacam.

## T5b — decisão arquitetural (auditoria, zero implementação)

Rastreei o caminho real de execução (nenhum arquivo consumidor tocado;
`perf/frameBudget.ts` intacto desde T5a). Achados com `arquivo:linha`:

**1–2. Onde o frame começa, e quem roda dentro dele.** `<Canvas>` em
`views/PlayView.tsx:1771` é o único Canvas da sessão de jogo. `<SquareTerrain>`
(`PlayView.tsx:1074`), `<NetEntities>`/`<NetPlayer>` (`:1205`/`:1215`) e
`<VfxRoot>` (`:1267`) são todos montados dentro do MESMO
`<Fragment key={mapId}>`, dentro do mesmo `<Suspense>`, dentro do mesmo
`<Canvas>` — logo, os `useFrame` deles rodam no MESMO tick de
`requestAnimationFrame` do R3F. Isso é fato, não suposição: confirmado pela
árvore JSX.

**3–5. Onde cada trabalho roda.**
- Terreno: `useFrame` próprio dentro de `SquareTerrain.tsx` (não citado por
  número aqui pois não foi reaberto nesta rodada — já mapeado na sessão
  anterior, loop com `orcamentoMs`).
- VFX: `vfx/core/VfxRoot.tsx:95-99` — `useFrame((_, dt) => { ...
  vfxManager.update(dt); })`.
- `moveTarget`: **NÃO tem um único ponto de execução.** Rastreei todos os
  chamadores de `pedirMovimento` (`net/NetPlayer.tsx`):
  - `NetPlayer.tsx:993` — `fila.current.tick(now, pedirMovimento)`, DENTRO do
    `useFrame` do próprio jogador (`:961`) → mesmo frame que terreno/VFX.
  - `NetPlayer.tsx:954` — `fila.current.pedir(cell, performance.now(),
    pedirMovimento)`, dentro de um `useEffect` que reage a `moveTarget`
    mudar no `playStore` (clique do jogador) → roda no commit do React
    disparado pelo clique, **fora** do `useFrame`/RAF do Canvas.
  - `net/filaDePedidos.ts:61-67` — `pedir()` **emite IMEDIATO** (chama
    `pedirMovimento` de forma síncrona, ali mesmo) sempre que a janela de
    200 ms está aberta; só guarda e adia pro `tick()` quando fechada. Ou
    seja: o mesmo pedido de movimento ora roda dentro do frame de render
    (via `tick`), ora roda fora dele (via `pedir` direto do clique) —
    **depende do estado de uma janela de tempo, não da arquitetura**.

**6. Trabalho síncrono fora do ciclo de render hoje contado no orçamento de
`moveTarget`.** Sim — confirmado acima: o caminho `pedir()`→emite-na-hora
(`filaDePedidos.ts:61-67`) roda dentro do `useEffect` reativo ao clique
(`NetPlayer.tsx:954`), que é o commit do React pelo clique, não o
`useFrame` do Canvas. O A* de até 8 ms (`net/moveTarget.ts: orcamentoMs`)
já acontece HOJE fora do frame de render na maioria dos cliques reais
(spam de clique é o caso raro que cai no `tick()`).

**7–8. Existe um ponto único e estável pra `beginFrame()`, sem virar
manager?** Verificado dois candidatos:
- **Ordem de subscrição do `useFrame`** (quem roda "primeiro" no tick):
  R3F não garante isso pra prioridade default (todos os 3 `useFrame` daqui
  usam prioridade default — `grep` confirma **zero uso de
  `renderPriority`/prioridade numérica em `useFrame` em todo `apps/game/
  src`**). A ordem real depende de ordem de MONTAGEM dos componentes, que
  passa por `<Suspense>` — não determinística entre sessões/recarregamentos
  de mapa. Usar isso seria exatamente a "suposição" que a task pede pra
  não fazer.
- **`useFrame(cb, prioridade)` com prioridade explícita**: resolveria a
  ordem, mas ligar QUALQUER prioridade não-zero tira o R3F do modo de
  render automático (ele passa a exigir que alguém chame `gl.render()`
  manualmente) — é uma mudança de comportamento de renderização do Canvas
  INTEIRO, não uma adição inócua de livro-caixa. Grande demais e fora de
  propósito pra esta task.

Nenhum dos dois é um ponto seguro hoje.

## Resposta à pergunta arquitetural

```
render frame                          input/evento síncrono
├── terrain      (useFrame, sempre)   └── moveTarget (~metade das vezes:
├── VFX          (useFrame, sempre)        clique com janela ABERTA →
└── moveTarget   (só quando a janela        síncrono no useEffect do clique,
    de filaDePedidos está FECHADA          fora de qualquer useFrame)
    no instante do clique)
```

**Não existe hoje um orçamento de frame único semanticamente correto pros
três.** Terreno e VFX sim compartilham o mesmo tick de verdade — mas
`moveTarget` só entra nesse tick ÀS VEZES (depende do timing do clique
contra a janela de 200 ms), e na maioria dos cliques reais roda FORA dele.
Colocar `moveTarget` no mesmo orçamento seria ora correto, ora uma mentira
silenciosa — pior que não integrar, porque pareceria certo com o clique
espaçado e mentiria com o clique rápido, sem nenhum sinal do erro.

## Menor ponto de integração possível hoje

Terreno + VFX têm um par legítimo: os dois vivem 100% dentro do
`useFrame`/RAF do Canvas, sem exceção condicional. Mas mesmo esse par não
tem HOJE um chamador de `beginFrame()` seguro sem resolver a ordem (ver
acima) — e resolver a ordem por `renderPriority` está fora do escopo de
"só um livro-caixa".

## Por que isso não vira `GlobalManager` mesmo se resolvido depois

A pergunta em aberto é só "quem chama `beginFrame()` uma vez, em que
ordem" — não "quem decide o que terreno/VFX fazem com a resposta". Mesmo
com a ordem resolvida (ex.: um componente-âncora, montado uma vez, cuja
ÚNICA função é `beginFrame()` numa prioridade conhecida), ele continuaria
sem conhecer terreno/VFX/moveTarget por nome — só publicaria o
`FrameBudgetState` (ex.: via contexto ou um módulo com um getter) pra quem
quisesse ler. Isso não foi implementado agora porque a ORDEM ainda não tem
resposta sem suposição — não porque o design em si viraria manager.

## Veredito

**T5b não é aplicável na forma originalmente proposta** ("terreno +
moveTarget + VFX consultam um relógio compartilhado"): `moveTarget` sai do
escopo por natureza (confirmado com `arquivo:linha`, não por princípio
geral). Terreno+VFX têm um frame real em comum, mas falta uma resposta sem
suposição pra "quem chama `beginFrame()` primeiro" — critério de conclusão
da task não satisfeito. T5b fica **parada aqui**, sem implementação.

## Verificação (T5b — só auditoria, zero mudança de comportamento)

- `pnpm --filter @ragnarok/game typecheck` — limpo.
- `pnpm --filter @ragnarok/game exec vitest run` — 1578/1578 verdes (nenhum
  arquivo consumidor tocado, nenhuma regressão possível).
- `pnpm --filter @ragnarok/game test:perf` — 60/60 verdes, `frameBudget.ts`
  intacto desde T5a.

(Nota antiga desta seção — escrita antes da auditoria linha-a-linha —
substituída pela seção "T5b — decisão arquitetural" acima, que tem
`arquivo:linha` real em vez de suposição. A conclusão prática é a mesma
[não implementar agora]; o motivo do `moveTarget` ficou mais preciso: não é
"roda síncrono, ponto" — é "roda síncrono ÀS VEZES, dependendo da janela de
200ms de `filaDePedidos`", o que é uma razão mais forte pra não juntar.)

## T7 — consolidação do rAF do HUD

### O que existia antes

`hud/statusTick.ts` já era o padrão certo (1 rAF compartilhado, referência
contada) mas só para `StatusEffectIcons`/`MobCastBadge`. Fora dele, **5
componentes tinham `requestAnimationFrame` PRÓPRIO**, alguns com um gate
manual de taxa reimplementado toda vez (`now - ultimo < intervalo`):

| Componente | rAF próprio | Gate manual | Taxa antiga |
|---|---|---|---|
| `CastBar` | sim | não | todo quadro |
| `SkillBar: Cooldown` | sim — **1 por SLOT com recarga ativa** | não | todo quadro |
| `SkillsWindow: PulsoDaEscolhida` | sim | não | todo quadro |
| `Minimap` | sim | sim (`ultimoDesenho`/`intervalo`) | 12fps |
| `MapWindow` | sim | sim (`ultimo`/`intervalo`) | 20fps |

Pior caso real: HUD com Alt+M aberto + minimapa + barra de skills com 3+
recargas simultâneas + status ativo = **8 `requestAnimationFrame`
independentes rodando ao mesmo tempo**, cada um perguntando ao navegador a
mesma coisa.

### `hud/hudTick.ts` — o que mudou de design em relação a `statusTick.ts`

- Generalizado: `subscribeHudTick(fn, hz?)` — `hz` omitido (ou `>= 60`) =
  sem throttle, roda todo quadro (idêntico ao rAF cru, e ao comportamento
  ORIGINAL de `statusTick.ts` — zero mudança pros 2 assinantes que já
  existiam). `0 < hz < 60` ativa um acumulador de `dt` que só dispara
  quando o intervalo da taxa já passou, resetando ao disparar (mesma
  semântica que `Minimap`/`MapWindow` já tinham com `ultimoDesenho = now`
  — comportamento efetivo idêntico ao de antes, só o loop por baixo mudou).
- Sentinela de "primeiro quadro desde o (re)início" é `-1`, nunca `0` — bug
  pego pelo PRÓPRIO teste antes de chegar em qualquer componente real:
  `agoraMs` (o timestamp que o `requestAnimationFrame` passa) pode
  legitimamente valer `0`, e usar `0` como sentinela confundiria esse
  quadro de verdade com "ainda não rodou".
- Não importa `core/importancia.ts`: a convenção de `hz` de lá (`0` =
  nunca atualiza, é sobre VISIBILIDADE) é o oposto semântico do que este
  módulo precisa (`hz` alto/omitido = MÁXIMA frequência) — forçar reuso
  teria confundido os dois significados de "hz" em vez de simplificar.

### Migração por componente (auditoria antes de cada uma)

| Componente | rAF/cancelAnimationFrame antigos | Gate/acumulador antigo | Cleanup antigo | Chamada síncrona antes de assinar? | Migrado para | Taxa preservada |
|---|---|---|---|---|---|---|
| `StatusEffectIcons` | (já usava `statusTick`) | — | `subscribeStatusTick` retorno | sim (`passo()` antes de `return subscribeStatusTick`) | `subscribeHudTick(passo)` | todo quadro |
| `MobCastBadge` | (já usava `statusTick`) | — | idem | sim | `subscribeHudTick(passo)` | todo quadro |
| `CastBar` | `requestAnimationFrame`/`cancelAnimationFrame` próprios | nenhum | `cancelAnimationFrame(raf)` | não | `subscribeHudTick(passo)` | todo quadro |
| `SkillBar: Cooldown` | idem, **1 por slot** | nenhum | idem | não | `subscribeHudTick(passo)` | todo quadro |
| `SkillsWindow: PulsoDaEscolhida` | idem | nenhum (usava o `t` do rAF como fase do seno) | idem | não | `subscribeHudTick(passo)` — `t` virou `performance.now()` chamado dentro do `passo` | todo quadro |
| `Minimap` | idem | `ultimoDesenho`/`intervalo = 1000/MINIMAPA_FPS`, `if (now-ultimoDesenho<intervalo) reagenda` | idem | não | `subscribeHudTick(loop, MINIMAPA_FPS)`, gate manual REMOVIDO (o tick já faz a conta) | **12fps, confirmado pelo teste "só chama quando o intervalo da taxa já passou"** |
| `MapWindow` | idem | `ultimo`/`intervalo = 1000/MAPA_FPS`, mesmo gate | idem | não | `subscribeHudTick(loop, MAPA_FPS)`, gate manual REMOVIDO | **20fps, mesma garantia** |

Nenhuma chamada temporal antiga foi removida sem entender o que ela
protegia: `Minimap`/`MapWindow` protegiam contra redesenhar Canvas2D caro
(varredura de toda entidade + `drawImage`) a 60Hz sem necessidade — essa
proteção agora é do `hudTick` (testada isoladamente, não por inspeção
visual), não perdida.

### rAF antes → depois

**Antes**: até 8 `requestAnimationFrame` simultâneos possíveis (1
`statusTick` + `CastBar` + N×`Cooldown` + `PulsoDaEscolhida` + `Minimap` +
`MapWindow`, N = skills em recarga ao mesmo tempo).
**Depois**: **1** `requestAnimationFrame` (`hud/hudTick.ts`), sempre —
confirmado pelo teste "dois assinantes simultâneos compartilham o MESMO
`requestAnimationFrame`". `grep -rn "requestAnimationFrame(\|cancelAnimationFrame("
apps/game/src/hud` devolve só as 2 ocorrências dentro do próprio
`hudTick.ts` (o scheduler em si) — zero loop independente restante, zero
exceção.

### Testes de lifecycle (`hud/hudTick.test.ts`, 9 casos)

Sem throttle (2) · com throttle, incluindo "sem rajada de recuperação após
pausa longa" (2) · **nasce no primeiro inscrito, morre quando o último sai,
sem reagendar depois de vazio** (1) · **remount: desinscrever + inscrever
de novo pede rAF NOVO, zero chamada fantasma do unmount** (1) · **novo
consumidor depois do scheduler ficar órfão reinicia `dt` do zero, sem
salto/disparo imediato** (1) · dois assinantes compartilham o mesmo rAF (1)
· desinscrever um não afeta o outro que continua rodando (1). Nenhum callback
pós-unmount, nenhuma assinatura duplicada, nenhum rAF duplicado, nenhum
scheduler órfão — todos os quatro checados explicitamente por teste, não só
por leitura de código.

### Verificação

- `pnpm --filter @ragnarok/game typecheck` — limpo.
- `pnpm --filter @ragnarok/game exec vitest run` — **1602/1602** (era
  1593 antes de T7; +9 do `hudTick.test.ts`), 148 arquivos.
- `pnpm --filter @ragnarok/game test:perf` — 60/60, sem regressão (nenhuma
  das razões medidas toca HUD; confirma que nada em `grid`/`vfx/core`/
  `net` foi afetado por uma mudança que ficou inteira em `hud/`).

### Exceção

Nenhuma. Os 8 loops (`statusTick` + 5 próprios de componente, contando
`Cooldown` como 1 representante do padrão "N por slot") viraram 1.

## T8 — assets: descarte por mapa + KTX2/Draco/meshopt

### Descarte por mapa — implementado, com escopo corrigido

Auditado antes de codar (mesma disciplina de T2/T4/T5b): `props/registry.tsx`
já tinha `urlsDoMapa`/`preloadPropsDoMapa` (baixa só as espécies que O MAPA
usa, não o catálogo inteiro) — mas **nada em lugar nenhum do repo chamava
`useGLTF.clear`**, nem existia contrapartida de descarte. Confirmado por
grep (`useGLTF\.clear|dispose\(\)` em `apps/game/src`): o cache do drei
(`suspend-react`, chaveado por URL) cresce pra sempre — todo mapa visitado
numa sessão deixa o `.gltf` PARSEADO de cada espécie presa em memória, até
o mapa ser fechado. `gltfTexturas.ts: zerarTexturasCompartilhadas()` (o
cache de dedup de textura) tem o MESMO problema — só é chamado por teste,
nunca em produção.

**Achado que reduziu o escopo real da task**: li a implementação de
`useGLTF.clear`/`useLoader.clear` no `@react-three/fiber` instalado
(`node_modules/.pnpm/@react-three+fiber@9.6.1.../events-*.js:1298`) — ela só
remove a ENTRADA do `Map` de cache do `suspend-react`. **Não chama
`.dispose()` em nada.** Pra VRAM ser liberada de verdade, alguém precisa
chamar `.dispose()` em cada `BufferGeometry`/`Material`/`Texture` do glTF —
e prop/vegetação/hex tile COMPARTILHAM essa geometria entre milhares de
instâncias via `InstancedMesh` (`VegetationInstancer`, `PropInstance`,
`HexTerrain` — a mesma regra "quem usa não descarta" de
`net/recursosCompartilhados.ts`). Descartar sem saber se outra instância
ainda usa a MESMA geometria compartilhada corromperia a cena — exigiria
contagem de referência entre os três consumidores, um refactor bem maior
que "chamar uma função de limpeza no troca de mapa", e fora do raio que os
arquivos-alvo da task (`vite.config`, `assets.ts`) cobriam.

**O que foi implementado**: `props/registry.tsx: descartarPropsForaDoMapa`
— na troca de mapa, `useGLTF.clear()` só nas urls que o mapa ANTERIOR usava
e o ATUAL não usa mais (diff de dois `urlsDoMapa`, mesma fonte de verdade
do preload). Ganho real é **RAM (heap JS)**, não VRAM: libera o documento
glTF parseado de espécies que não aparecem mais em nenhum mapa visitado
desde então, sem risco nenhum pra geometria/textura ainda em uso (essas
nunca são tocadas — só a entrada do CACHE some, e só depois que nada mais
teria motivo pra reconsultá-la). Efeito colateral aceito: se o jogador
voltar pro mesmo tipo de mapa depois, a espécie é reparseada do zero — é a
troca de "sempre em RAM" por "RAM só enquanto usada recentemente".

Ligado em `views/PlayView.tsx` — `useEffect` com um `ref` guardando o
`urlsMapa` do mapa anterior, chamando `descartarPropsForaDoMapa(anterior,
novo)` e atualizando o ref. Ref, não state: só compara entre renders, nunca
dispara um.

### KTX2/Draco/meshopt — auditado, NÃO acionável nesta passada

`useGLTF` do drei já suporta os três nativamente
(`useGLTF(path, useDraco?, useMeshopt?, extendLoader?)` — conferido no
`.d.ts` instalado) — ou seja, **não falta código pra LIGAR o suporte**.
Falta o que teria suporte pra ligar: os 347 pares `.gltf`+`.bin` e 361
`.png` do repo (confirmado no inventário do `README.md`) são glTF/PNG
**crus**, nunca passados por `gltf-transform`/Draco/KTX2 na autoria. Ligar
`useDraco`/`useMeshopt` num asset que não foi comprimido com essas
ferramentas não muda nada — os loaders decodificam o que o arquivo tem, e o
arquivo não tem geometria Draco nem textura Basis/KTX2 dentro.

Fazer isso de verdade exigiria um passo de RECOMPRESSÃO de todo o acervo —
um script novo (no molde de `terrain:textures`/`props:measure`, que já
regeneram asset a partir de `assets-new/`), rodando sobre 114 MB de
`public/assets`, e decidir onde as texturas de terreno GERADAS
(`terrain:textures`) e o atlas de VFX entram nesse pipeline. Isso é uma
iniciativa de asset pipeline própria — maior que "configurar vite.config" —
e não estava pedida além do nome da task. Não implementada aqui; registrada
como candidata a T9 se algum dia o tamanho de download/VRAM virar gargalo
medido (hoje o ambiente é local/WSL2, não CDN público — ver rebaixamento
originais no plano aprovado).

### Verificação

- `pnpm --filter @ragnarok/game typecheck` — limpo.
- `pnpm --filter @ragnarok/game exec vitest run` — **1606/1606** (era 1602;
  +4 de `props/catalogo.test.ts: descarte de props fora do mapa`).
- `pnpm --filter @ragnarok/game test:perf` — 60/60, sem regressão.

## T9 — gate checado

Regra do plano aprovado: entity LOD visual/impostor, occlusion culling e
Web Workers só entram **se T0 provar necessidade**. Checando contra os dados
que existem hoje, sem rodar nada novo:

- **`test:perf` (T0 + toda re-execução em T2/T3/T5b/T6/T7/T8)**: nenhuma
  razão medida chegou perto do próprio teto em NENHUMA rodada da sessão —
  chunk de terreno ~1.0-1.4, cenário de 120 mobs 0.2-0.7, `manager.update`
  de VFX 0.03-0.08. É um sinal de CPU (razão contra calibração), não de
  fps/VRAM, mas é o único dado real disponível, e não aponta pressão.
- **O motivo original de rebaixar entity LOD/instancing** (plano aprovado,
  não só T0): ~25 entidades em tela (`net/recursosCompartilhados.ts`,
  `area_size:60` + raio de detalhe) e só **2 modelos de monstro** no
  acervo (`entities/mobModels.ts`) — instancing/impostor de entidade
  rende pouco com essa escala e essa variedade, independente de qualquer
  benchmark.
- **Occlusion culling**: mapas de campo abertos do RO, raio de detalhe
  ~130u, névoa fecha antes, sombra já para em 55u — poucos oclusores reais
  pra amortizar o custo do mecanismo.
- **O benchmark que FALTA pra decidir de verdade** (`VFX_BENCH_HEADED=1`,
  Playwright + Chrome real) nunca rodou nesta sessão — foi diferido em T0
  ("pro momento de calibrar thresholds reais") e nenhuma das tasks
  seguintes precisou dele (T2/T3 ficaram com thresholds `Infinity`
  deliberadamente, sem número calibrado). Sem ele, não há dado de fps/VRAM
  real — só as razões de CPU do `test:perf`.

**Veredito**: gate não atendido. Nenhum dado desta sessão mostra pressão
que justifique entity LOD visual, occlusion culling ou Web Workers. T9
continua parada. O que destravaria: rodar o benchmark headed com um
cenário realista (N mobs + combo de skills) e ele mostrar fps abaixo do
alvo — só aí calibrar os thresholds que T2/T3 deixaram em `Infinity` E
reavaliar T9 com número de verdade, não achismo.

## Nota de escopo — T6

Duas alocações que ficaram DE FORA, de propósito:

- `mobs.filter((m) => !excluidos.has(m.gid))` dentro do laço de exclusão por
  obstáculo — o próprio docblock ao lado já explica por quê é raro: "só roda
  para o VENCEDOR, e só de novo se ele for excluído". Não é o caminho de
  60fps × N-entidades que motivou T6 (esse já foi resolvido); é um `.filter`
  de no máximo 6 iterações, só quando o alvo está atrás de uma montanha.
  Trocar por algo sem alocação exigiria mudar a assinatura de `melhorAlvo`
  em `play/aimAssist.ts` (módulo puro, testado isoladamente) por um ganho
  que não aparece em nenhuma medição — não fiz.
- `Object.values(useGroundItems.getState().items)` — aloca um array por
  quadro (de REFERÊNCIAS a itens já existentes, não objetos novos). Resolver
  de verdade pediria mudar o formato interno do `worldDropStore` (de objeto
  chave→item pra algo iterável sem `Object.values`), um raio de mudança
  maior que "matar `.clone()`" e fora dos arquivos que T6 mirava.

## Nota de correção — T4

Antes de tocar, li `EntityLabel.tsx`/`WorldBar.tsx`/`GlowChao.tsx`:

- `EntityLabel`/`WorldBar` **não têm `useFrame` próprio** — são React puro,
  redesenhados só quando `hp`/`maxHp`/`name`/`level`/`targeted` MUDAM de
  verdade (a fatia rasa de `net/entityRenderSlice`). Já é event-driven, não
  polling — não existe frequência pra reduzir.
- `GlowChao` tem `useFrame`, mas já é dirty-flagged: só recalcula a
  inclinação quando a "amostra" de posição (arredondada) muda
  (`inclinadoEm.current === chave` → sai cedo). Custo por quadro sem
  mudança é uma comparação de string.
- O resto do `useFrame` de `NetEntity.tsx` (posição, rotação de quem anda,
  checagem de pulso de combate) ou precisa rodar a 60 Hz pra não gerar pop
  visual (posição/rotação), ou já é `Map.get` O(1) (`net/combatAnim.pulsoDe`)
  — reduzir a frequência DESTE especificamente arrisca perder uma transição
  de animação real (um pulso mais curto que o intervalo throttled) por um
  ganho que não existe (já é O(1)).

Não havia trabalho de polling pra colocar em bucket. Forçar uma taxa aqui
seria degradar sem medir — exatamente o que a correção do T2 já evitou.
T4 fechado como "auditado, sem candidato" em vez de trabalho inventado.

## Nota de correção — T2

O plano aprovado listava "Sprite/Particle/Ring/Beam/Cage consumirem
`instance.lod`". Antes de mexer, li os 5 renderers: `TrailRenderer` (já
tinha o mecanismo) e `ParticleRenderer` alocam **N slots por instância**
(partículas), então "reduzir quantos ficam ativos" é uma redução real e
grounded. `SpriteRenderer`/`RingRenderer`/`BeamRenderer`/`CageRenderer`
alocam **1 slot/mesh por instância** — não existe "contagem" ali pra o LOD
reduzir sem inventar um comportamento novo (ex.: congelar frame de atlas,
pular update de shader) sem nenhum dado medido por trás. Isso seria exatamente
o "reduzir visual arbitrariamente" que o pedido original (`vfx/core/lod.ts`)
proíbe. Escopo de T2 ajustado pra só `ParticleRenderer`; os outros 4 continuam
cobertos por frustum culling (já tinham) e ficam candidatos a um mecanismo
de LOD PRÓPRIO (não herdado deste) se um benchmark real algum dia apontar
necessidade.
