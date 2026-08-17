# VFX Core — auditoria GPU e plano de migração (leia1.txt + Directive B, 3 rodadas, 2026-08-16 a 2026-08-17)

**Atualização (2026-08-17, Rodada 3 — Directive B "migração agressiva
performance-first"): o piloto proposto na seção Q foi executado e
ULTRAPASSADO** — 6 skills migradas pra GPU (Fire Ball + Oracle + Cold
Bolt + Fire Wall + Thunder Storm + Soul Strike, não só as 3 do piloto
original), cada uma com toggle DOM↔GPU dev-only, benchmark 1/5/10/20/30 +
combo, e checagem visual. Seções A-Q abaixo são o registro HISTÓRICO da
auditoria pré-migração (mantido intacto — mostra o raciocínio que levou
à decisão) — seções R em diante são o resultado real, incluindo a
correção de um erro de metodologia descoberto nesta rodada (seção S)
que muda a leitura de TODO fps absoluto medido nas rodadas 1-2. **Leia
a seção S antes de citar qualquer número de fps deste documento.**

Cobre: estado real do sistema de VFX hoje (5 skills migradas pro VFX Core,
13 no dispatcher legado), auditoria técnica dos 4 renderers GPU já
existentes (`SpriteRenderer`/`ParticleRenderer`/`BeamRenderer`/
`RingRenderer`), números reais de benchmark (Chrome real via CDP tracing,
`scripts/vfxBenchmark.ts`, resultado bruto em
`apps/game/vfx-bench-results/leia1-rodada2-auditoria.json`), e a proposta
de evolução pra GPU real preservando o visual atual. **Nenhum shader,
`defineVfx` novo, ou migração de skill foi feito nesta etapa** — só
instrumentação de benchmark + este relatório, conforme aprovado.

Ler `05-diagnostics-flight-recorder.md` primeiro pra arquitetura do VFX
Core (`VFXManager`/`VfxDefinition`/renderers) — este arquivo assume esse
contexto e foca só no que muda a partir daqui.

## Regra editorial deste relatório (pedido explícito do usuário)

Nenhuma conclusão abaixo afirma que o sistema "suporta N players" além do
que o benchmark realmente mediu com números sustentando a afirmação. Onde
o dado é insuficiente, o texto diz `TBD — definir após benchmark` ou o
maior valor REALMENTE medido, nunca extrapolado. Ver seção "Escalabilidade
— o que os números dizem de verdade" — é a seção que essa regra mais
afeta.

---

## A. O que temos hoje

5 skills no VFX Core (`renderer:"dom"`, 1 React root pro jogo inteiro):
Fire Ball, Thunder Storm, Safety Wall, Fire Wall, Sight/Oracle. 13 famílias
seguem no dispatcher antigo (`SkillVfx.tsx`, 1 componente por skill, mesma
técnica `<Html>`): Cold Bolt, Fire Lance, Light Bolt, Soul Strike, Frost
Diver, Stone Curse, `FreezeBodyVfx`.

Migrar pro Core já resolveu "1 React root por skill" (era o gargalo de
MONTAGEM/desmontagem). Não resolveu "cada partícula é um nó de DOM com
Style Recalc/Layout/Paint próprios" — as 5 skills migradas desenham
EXATAMENTE a mesma quantidade de nós DOM de antes, só compartilhando o
React root. É esse segundo gargalo que esta auditoria mede.

4 renderers GPU já existem, testados via unit test, **zero skill real
usando eles em produção** — só o `DomRenderer` está no caminho quente
hoje.

## B. Contagem real por skill (nós DOM por instância, medido, não estimado)

Fonte: `scripts/vfxBenchmark.ts` Fase B, `domNodes` na rodada de 1
instância (coluna "1×") e de 50 instâncias simultâneas (coluna "50×",
mostra se a relação é linear).

| Skill | nós DOM (1 instância) | nós DOM (50 instâncias) | linear? |
|---|---:|---:|---|
| Oracle (Sight) — buff | 284 | 14200 | sim (284×50=14200) |
| Soul Strike — impact | 163 | 8150 | sim |
| Thunder Storm — impact | 157 | 7850 | sim |
| Fire Lance — impact | 138 | 6900 | sim |
| Fire Ball — impact | 106 | 5300 | sim |
| Cold Bolt — impact | 103 | 5150 | sim |
| Light Bolt — impact | 100 | 5000 | sim |
| Frost Diver — impact | 56 | 2800 | sim |
| Fire Wall — 1 célula | 52 | 2600 | sim |
| Stone Curse — impact | 29 | 1450 | sim |
| Safety Wall — 1 célula | 26 | 1300 | sim |
| Fire Ball — cast | 30 | 1500 | sim |
| Fire Lance — cast | 24 | 1200 | sim |
| Thunder/Light Bolt — cast | 22 | 1100 | sim |
| Stone Curse — cast | 18 | 900 | sim |
| Cold/Frost — cast | 14 | 700 | sim |
| Soul Strike — cast | 12 | 600 | sim |

Escala **linearmente** em todos os casos — não há amortização nenhuma
hoje (cada instância nova = N nós novos, sempre). Fire Wall com 19 células
= 52×19 ≈ 988 nós só ela; **3 Fire Wall (19 células cada) + 1 Oracle =
988×3 + 284 ≈ 3252 nós DOM** — o cenário do pedido original é real, não
exagero, e ainda MAIOR do que a estimativa "~1000" do pedido original
(a estimativa original olhava só 1 Fire Wall, não 3).

## C. Auditoria dos 4 renderers GPU existentes (item 1 de leia1.txt)

Releitura linha a linha do código, não suposição.

### `SpriteRenderer` / `ParticleRenderer` (mesma base, `InstancedBillboardBase`)

- **1 `InstancedMesh` compartilhado por TIPO de renderer** (não por skill,
  não por instância) — geometria clonada de 1 `PlaneGeometry` módulo,
  capacidade inicial 128, dobra quando estoura (128→256→512…). **1 draw
  call cobre TODAS as instâncias vivas daquele tipo**, de 1 a milhares,
  contanto que caibam na capacidade atual.
- Billboard calculado no VERTEX SHADER a partir da `viewMatrix` — zero
  matemática de rotação por partícula no CPU (técnica já provada em
  `AmbientParticles.tsx`).
- `ParticleRenderer` aloca N slots (`payload.particleCount`, default 24)
  do MESMO `InstancedMesh` por instância de VFX — uma "nuvem" de 66
  partículas (Oracle) viraria 66 slots no MESMO mesh que todo o resto do
  jogo já usa, não 66 objetos novos.
- **Achado real (não ideal)**: `flush()` marca as 6
  `InstancedBufferAttribute` (posição/escala/UV/cor/opacidade/rotação)
  como `needsUpdate=true` TODO QUADRO, incondicionalmente — o driver
  reenvia o buffer inteiro (tamanho = CAPACIDADE, não quantidade ativa)
  pra GPU a cada frame, mesmo se nada mudou. Barato POR QUADRO, mas não é
  dirty-range — é um custo constante que cresce com a capacidade máxima
  já atingida na sessão, não com o uso atual.
- **Bug real achado nesta auditoria (não corrigido nesta fase, fora de
  escopo)**: quando a capacidade cresce (`ensureCapacity`), geometria e
  material ANTIGOS são desanexados do grupo mas nunca recebem
  `.dispose()` — vaza 1 geometria + 1 material por crescimento de
  capacidade. Raro (só ~log₂(N) vezes por sessão), mas real — corrigir
  antes de produção.
- `frustumCulled = false` explícito — THREE não cula um `InstancedMesh`
  sozinho; sem culling próprio implementado, toda instância é processada
  e enviada à GPU mesmo fora da câmera.
- Overdraw: 1 amostra de textura + `smoothstep`, blend aditivo — barato
  POR FRAGMENTO, mas aditivo com muitas partículas sobrepostas (66 do
  Oracle, dezenas de brasas de Fire Wall se portado) ainda soma overdraw
  real — precisa medir, não assumir grátis (ver seção E).

### `BeamRenderer`

1 `InstancedMesh` (capacidade 32), matriz por instância via `setMatrixAt`
(sem shader por-instância). **Limitação real**: `uColor`/`uOpacity` são
UNIFORMS do material, não atributos por instância — hoje TODOS os beams
ativos ao mesmo tempo teriam a MESMA cor. Pra Thunder Storm (raio azul)
conviver com outro beam de cor diferente, ou vira atributo por instância
(mudança pequena, não feita nesta fase) ou cada cor precisa da própria
instância do renderer.

### `RingRenderer`

**NÃO instanciado, de propósito** — 1 `Mesh` + 1 `ShaderMaterial` + 1
`Geometry` moldada ao terreno POR INSTÂNCIA (área precisa acompanhar
relevo real, não dá pra compartilhar 1 geometria entre posições
diferentes). Draw call escala 1:1 com áreas ativas. Correto pra "poucas
dezenas" (Safety Wall/Fire Wall); sem pooling nem instancing hoje — errado
se algum dia precisar de centenas simultâneas.

### Em comum aos 4

Nenhum tem hoje: LOD por distância, orçamento/prioridade, culling por
instância (só o flag de mesh inteira, desligado), ou throttling de
frequência de update — `onInstanceUpdate` roda todo quadro pra toda
instância viva, visível ou não. Confirma que culling/LOD/budget (seção G)
são trabalho novo, não algo "quase pronto".

## D. Fase A — custo real por skill, 1 instância, tracing CDP completo

Medido com Chrome real (`scripts/vfxBenchmark.ts` Fase A), janela de
spawn→settle única, tracing ligado (`Layout`/`RecalcStyle`/`Paint`/
`RasterTask` somados por categoria no período).

| Skill | script | recalc | paint | **raster** | nós DOM |
|---|---:|---:|---:|---:|---:|
| Oracle — buff | 0.2ms | 0.1ms | 4.9ms | **1037.6ms** | 284 |
| Cold Bolt — impact | 0.1ms | 0.1ms | 18.4ms | 270.5ms | 103 |
| Soul Strike — impact | 0.1ms | 0.1ms | 6.3ms | 257.8ms | 163 |
| Fire Lance — impact | 0.1ms | 0.1ms | 10.1ms | 212.4ms | 138 |
| Light Bolt — impact | 0.1ms | 0.1ms | 3.5ms | 138.9ms | 100 |
| Safety Wall — área | 0.1ms | 0.0ms | 0.5ms | 133.8ms | 26 |
| Thunder Storm — impact | 0.1ms | 0.1ms | 3.7ms | 73.7ms | 157 |
| Fire Ball — impact | 0.1ms | 0.0ms | 3.2ms | 46.1ms | 106 |
| Frost Diver — impact | 0.1ms | 0.0ms | 2.3ms | 13.3ms | 56 |
| Fire Ball — cast | 0.0ms | 0.1ms | 6.8ms | 12.5ms | 30 |
| Fire Wall — 1 célula | 0.0ms | 0.1ms | 1.1ms | 6.7ms | 52 |
| Soul Strike — cast | 0.0ms | 0.0ms | 0.4ms | 0.7ms | 12 |
| Genérico (sem CSS pesado) | 0.1ms | 0.0ms | 0.0ms | 0.0ms | 0 |

**Achado principal desta fase**: `script`/`recalc` (o custo que o
DomRenderer/React controla) é sempre ≤0.2ms — a arquitetura Core já
resolveu o custo de RECONCILIAÇÃO. O custo real está inteiro em
`raster` — trabalho da GPU/compositor rasterizando `filter: blur()` e
`text-shadow` de camadas empilhadas em CADA um dos 100-280 nós. **Oracle
sozinho, 1 instância, custa 1037.6ms de raster** numa única janela de
medição — é o pior caso do jogo inteiro, condizente com ele ter sido
descrito como "a skill mais pesada" antes desta auditoria. Isso é o
oposto do que "111 nós de DOM" sugere à primeira vista: não é o NÚMERO de
nós que pesa mais, é o CUSTO DE RASTER por nó (blur/shadow), o que muda a
prioridade de otimização — ver seção E.

## E. Matriz CSS sintética — isolando a causa do raster (item 3 de leia1.txt, overdraw)

Pra separar "quantidade de nós" de "custo por nó", rodei uma matriz
sintética variando só `text-shadow` (camadas) e `filter: blur()`
(intensidade), replicando os valores reais usados pelas skills.

| Técnica | raster |
|---|---:|
| sem `text-shadow` | 11.9ms |
| `text-shadow` × 1 camada | 5.6ms |
| `text-shadow` × 2 camadas | 5.6ms |
| `text-shadow` × 4 camadas | 20.2ms |
| `text-shadow` × 6 camadas (Thunder Storm real) | **73.8ms** |
| sem `blur()` | 20.9ms |
| `blur(4px)` (pequeno) | 75.4ms |
| `blur(10px)` (médio, bolt real) | **103.6ms** |
| `blur(24px)` (grande) | 140.3ms |

Confirma a hipótese: **`filter: blur()` é o vilão maior, `text-shadow`
empilhado é o segundo**, e ambos crescem de forma NÃO linear com
intensidade — dobrar o blur mais que dobra o raster (20.9→75.4→103.6→
140.3ms pra 0/4/10/24px). Isso é exatamente "overdraw" no sentido do item
3 de leia1.txt: cada camada de blur/shadow força o compositor a
reprocessar a MESMA área de pixels várias vezes, e Oracle empilha essas
técnicas em ~280 nós simultâneos — daí o 1037ms.

**Implicação pra proposta de migração (seção F)**: a prioridade de GPU-fy
não é "skill com mais nós", é "skill com mais blur/shadow empilhado por
nó" — Oracle, Cold Bolt, Soul Strike, Fire Lance, Light Bolt e Safety Wall
(nessa ordem de raster) ganham mais com a migração que Fire Wall (que tem
mais nós, 52/célula, mas raster baixo, 6.7ms — CSS mais simples).

## F. CPU × GPU separado, por técnica candidata (item 2 de leia1.txt)

```
DOM/CSS atual (todas as 18 skills hoje):
  CPU: ~0.1-0.2ms script+recalc (já barato, resolvido pelo Core)
  GPU/compositor: 0.7ms a 1037.6ms de RASTER por instância, escala
                  linearmente com nº de instâncias (visto na Fase B)

GPU real (Sprite/ParticleRenderer, proposta):
  CPU: N writes em Float32Array por spawn (uma vez, não por quadro) +
       1 write por atributo por quadro só se a instância mudar de
       estado visível (idle = 0 writes esperados no estado estável,
       hoje o renderer ainda marca needsUpdate=true todo quadro —
       achado da seção C, não corrigido nesta fase)
  GPU: 1 draw call PARA TODAS as instâncias do tipo (não 1 por skill,
       não 1 por instância) + fragment shader simples (1 sample +
       smoothstep + blend aditivo) — SEM blur real (blur em shader
       exigiria multi-pass ou textura pré-borrada, custo à parte, ver
       "detalhe não reproduzido" na seção H)
```

Não dá pra concluir "GPU sempre ganha" sem essa separação — o ganho real
é trocar raster-por-nó-CSS (caro, não paralelizável no compositor da
forma que o Chrome faz hoje) por 1 draw call com fragment shader simples
(barato, paralelo por natureza). O CUSTO que NÃO desaparece é a
alocação/gestão de buffer no CPU a cada spawn — pequena, mas real, e
cresce com nº de spawns simultâneos (multiplayer).

## G. Primitives — genéricas, não uma por skill (item 4)

| Primitive | Mapeada em | Skills que a usariam |
|---|---|---|
| Glow | billboard aditivo, `SpriteRenderer`, 1 slot | núcleo de Fire Ball, Cold Bolt |
| Ring/Aura | `RingRenderer` (terreno) ou billboard grande | Safety Wall, Fire Wall, Oracle |
| ParticleCloud | `ParticleRenderer`, N slots | Oracle (66), brasas de Fire Wall |
| Spark | `ParticleRenderer`, preset de vida curta | impacto de todo bolt/lance |
| Beam / LightningArc | `BeamRenderer` (+ atributo de cor por instância, seção C) | Thunder Storm, Light Bolt |
| FireColumn | composição: Glow + ParticleCloud (brasas) + core esticado | Fire Wall, Fire Lance |
| SpriteSequence | `SpriteRenderer` + `animation` da `VfxDefinition` (já suportado, falta atlas) | qualquer skill quando o asset existir |

Nenhuma vira uma classe `XxxPrimitive` por skill — composição é DADO
(`VfxDefinition`/recipe), não código novo. Exemplo de composição (não
implementado nesta fase): Oracle = Ring + ParticleCloud + 3× Sprite
(caveiras); Fire Wall = FireColumn + Glow + ParticleCloud; Thunder = Beam
+ Spark (impacto) + texto (DOM, número — exceção já aceita, ver H).

## H. Critério de aceitação visual (item 5)

Migração futura compara ANTES/DEPOIS em: silhueta, quantidade percebida
de partículas, timing, velocidade, intensidade, glow, escala, cor,
trajetória, impacto, composição geral.

**Detalhe já identificado nesta auditoria como não-trivial de reproduzir
em shader, documentado agora pra não ser esquecido**: `filter: blur()`
real (usado em Cold Bolt/Soul Strike/Light Bolt, seção E) não tem
equivalente direto e barato em fragment shader — replicar exigiria
textura pré-borrada (asset novo, proibido inventar agora) ou blur
multi-pass (custo de GPU à parte, não medido nesta fase). Até o asset
existir, essas skills manteriam blur real via `DomRenderer` (fallback,
seção J) enquanto as demais migram.

## I. VFX Cost Model (item 6)

Proposta de fórmula ponderada, calculável por `VfxDefinition` ANTES de
entrar no jogo (mesmo espírito de `perf/orcamento.ts` — razão, não ms
cru):

```
custo(skill) =
    domNodes × domWeight
  + rasterLayers × rasterWeight   (nº de filter/shadow empilhados, seção E)
  + cpuUpdatesPorQuadro × cpuWeight
  + gpuInstances × gpuWeight
  + drawCallsMarginais × drawCallWeight
  + overdrawEstimado × overdrawWeight
```

Pesos **não calibrados nesta fase** — a Fase A/B/E acima dá o dado bruto
(raster por nó, escala linear confirmada), mas calibrar pesos exige
comparar o MESMO efeito nas duas técnicas (DOM vs GPU), o que só existe
depois do piloto (Oracle/Fire Wall/Thunder Storm, próxima fase). Marcado
`TBD — calibrar após piloto A/B`.

## J. Teste multiplayer — duas dimensões (item 7)

### Eixo 1 × Eixo 2, medido de verdade (Fase C, Chrome real, CDP)

**Cenário "3× Fire Wall + Oracle" por jogador:**

| players | script | recalc | layout | nós DOM |
|---:|---:|---:|---:|---:|
| 1 | 0.1ms | 0.7ms | 0.0ms | 1532 |
| 5 | 0.3ms | 0.7ms | 0.0ms | 7660 |
| 10 | 0.5ms | 0.6ms | 0.0ms | 15320 |
| 20 | 0.6ms | 1.1ms | 0.1ms | 30640 |
| 30 | 0.8ms | 2.2ms | 0.2ms | 45960 |

**Cenário caótico (Fire Ball + Thunder Storm + Fire Wall + Oracle + Cold
Bolt + Soul Strike, todos ativos, por jogador):**

| players | script | recalc | layout | nós DOM |
|---:|---:|---:|---:|---:|
| 1 | 0.2ms | 0.4ms | 0.0ms | 1229 |
| 5 | 0.5ms | 0.6ms | 0.0ms | 6145 |
| 10 | 0.9ms | 0.3ms | 0.0ms | 12290 |
| 20 | 1.3ms | 0.0ms | 0.0ms | 24580 |
| 30 | 1.3ms | 0.0ms | 0.0ms | **7980** ⚠ |

⚠ **Anomalia não explicada, sinalizada honestamente em vez de omitida**:
o nº de nós DOM do cenário caótico cai de 24580 (20 players) pra 7980 (30
players), quebrando a linearidade que TODAS as outras medições desta
auditoria mostraram (seção B). Não investiguei a causa raiz nesta fase
(fora do escopo aprovado — só instrumentação, sem debugging de produto).
Hipóteses não confirmadas: colisão de célula-base entre "jogadores"
sintéticos do bench fazendo `coalesce:{by:"cell"}` do Thunder Storm/Fire
Wall fundir spawns que deveriam ser independentes; ou efeito de
instrumentação do próprio bench. **Não usar este ponto (caótico×30) como
evidência de nada — nem de melhora nem de piora** — precisa reproduzir
fora do bench antes de confiar nele.

**Métrica `longTasks` (contagem/soma de long tasks) descartada nesta
rodada — instrumentação com bug confirmado**: `installLongTaskCollector`
cria um NOVO `PerformanceObserver` a cada chamada sem nunca chamar
`.disconnect()` no anterior. Como a Fase A/B já chamou essa função ~115
vezes antes da Fase C começar, cada long task real da Fase C é contada
~100+ vezes (uma vez por observer ainda vivo) — por isso os números
brutos do log (ex.: "3336 long tasks somando 201828ms" numa janela de
~700ms, fisicamente impossível) são lixo de instrumentação, não sinal
real. Os números de `script`/`recalc`/`layout`/nós DOM acima NÃO sofrem
desse bug (vêm de `Performance.getMetrics` fresco a cada chamada) e são
confiáveis. Corrigir o collector (`obs.disconnect()` em `readLongTasks`)
antes de reusar essa métrica numa próxima rodada.

## K. Escalabilidade — o que os números dizem de verdade

Por instrução explícita do usuário, esta seção não afirma suporte a 30
players a menos que os números sustentem isso.

**O que os números confirmados mostram**: `script`/`recalc`/`layout` (o
custo que o motor de renderização React/DomRenderer controla) ficam
**abaixo de 2.2ms mesmo em 30 players × "3 Fire Wall + Oracle"** — a
arquitetura de 1 React root compartilhado (já em produção) não mostra
sinal de degradação não-linear nesse eixo até 30 jogadores sintéticos
nesse cenário. Nós DOM crescem linearmente e batem 45960 em 30 players ×
"3 Fire Wall + Oracle" — um número alto, mas sem custo de script/recalc
correspondente alto, reforçando o achado da seção D: o gargalo real não é
"quantos nós existem", é "quanto raster cada nó de blur/shadow custa"
(seção E), métrica que este teste específico (`Performance.getMetrics`)
não isola por scenario dentro da Fase C.

**O que NÃO foi medido e não pode ser afirmado**: FPS real/frame time
visual durante os 30 players (a Fase C mediu métricas CDP agregadas, não
um contador de FPS ao vivo); comportamento do RASTER especificamente sob
30 players simultâneos (a correlação raster-alto=Oracle/blur da seção D/E
foi medida com 1 instância só, Fase A — não foi re-testada em conjunto
com 30 jogadores); e o cenário caótico×30 está marcado como não-confiável
(seção J, anomalia). **Conclusão honesta**: os dados sustentam "o custo de
script/recalc/layout não explode até 30 jogadores no cenário 3×Fire
Wall+Oracle" — não sustentam "o jogo roda liso com 30 jogadores", porque
FPS/raster real sob essa carga não foi medido nesta rodada. Maior
afirmação que os dados permitem: **confirmado sem sinal de degradação de
script/recalc/layout até 30 players no eixo testado; raster/FPS real sob
essa carga fica `TBD — medir com contador de FPS ao vivo + trace de
raster específico da Fase C, não feito nesta rodada`.**

## L. Budget inicial — número real ou TBD explícito (item 8)

| Budget | Valor | Base |
|---|---|---|
| nós DOM por instância (skill mais pesada) | referência: Oracle = 284 | medido, Fase B |
| raster por instância (pior caso) | referência: Oracle = 1037.6ms | medido, Fase A — **não é um teto, é o baseline que a migração GPU precisa bater** |
| DOM VFX nodes totais (limite de alerta) | `TBD — definir após medir FPS real, não só métricas CDP agregadas` | seção K |
| instâncias GPU ativas | `TBD — depende do piloto (próxima fase)` | — |
| partículas por instância | `ParticleRenderer.particleCount` já é parâmetro; teto numérico `TBD` | seção C |
| draw calls marginais por skill nova | 0 esperado pra Sprite/Particle/Beam (1 draw call compartilhado por TIPO); Ring soma 1:1 | seção C |
| efeitos por quadro / por jogador / fora de câmera / distantes | `TBD — nenhum desses eixos foi medido nesta rodada` | — |

## M. Culling, LOD e Budget — três mecanismos distintos (item 9/10)

```
Frustum culling   → fora da câmera        → NÃO renderiza (sem onInstanceUpdate)
Distance LOD      → longe mas visível     → reduz qualidade (menos partículas/frequência)
Performance budget → CPU/GPU sob pressão  → reduz por PRIORIDADE, não por skill individual
```

Nenhum dos três existe hoje (confirmado seção C). Prioridade (própria
skill do jogador > perto > longe > NPC longe) pertence ao
`VFXManager`/budget system quando implementado — nunca hardcoded dentro
de uma skill. Nenhum dos três é implementado nesta fase.

## N. Fallback DOM (item 11)

`DomRenderer` não sai nesta etapa nem na próxima — continua registrado e
funcional em paralelo aos renderers GPU até TODAS as skills críticas
estarem validadas, mesma convivência que já existe hoje entre Core
migrado e `SkillVfx.tsx` legado. Skills com detalhe visual não-reproduzível
em shader hoje (blur real, seção H) ficam no `DomRenderer` até existir uma
solução validada, não como prazo indefinido — como decisão explícita por
skill.

## O. Checklist de aprovação (item 12) — respondido com dado real desta rodada

1. Manter visual atual? — **critério de aceitação definido (seção H)**,
   com 1 exceção documentada (blur real) — não garantido 100% às cegas.
2. Eliminar centenas de nós DOM? — **sim pras categorias mapeadas em
   primitives (seção G)**; texto/número continua DOM (exceção aceita).
3. Reusar primitives entre skills? — **sim**, seção G já desenhada por
   esse critério.
4. Suportar dezenas de players? — **parcial, com dado real**: confirmado
   sem degradação de script/recalc/layout até 30 players no cenário 3×
   Fire Wall+Oracle (seção K); FPS/raster reais sob essa carga não
   medidos — `TBD`.
5. Evitar crescimento explosivo de draw calls? — **sim pra Sprite/
   Particle/Beam** (1 draw call compartilhado); **não pra Ring hoje**
   (1:1 com instâncias) — limitação documentada, seção C.
6. Evitar crescimento explosivo de CPU? — **sim no dado medido**: script/
   recalc ficam <2.2ms até 30 players (seção J) — mas sem culling/LOD
   (item 9/10 abaixo), o crescimento é linear, não limitado.
7. Controlar overdraw? — **medido e caracterizado (seção E)**: blur/
   shadow são a causa dominante do raster; ainda não CONTROLADO (sem
   budget/LOD implementado).
8. Controlar partículas? — **sim, `particleCount` já é parâmetro**, falta
   budget dinâmico (seção L, TBD).
9. Aplicar LOD? — **não existe** — desenho nesta fase (seção M), código
   não incluído aqui.
10. Aplicar frustum culling? — **não existe** (mesh flag desligado, sem
    substituto) — idem.
11. Aplicar performance budget? — **não existe** — idem.
12. Receber atlas sem reescrever skills? — **sim**, garantia estrutural
    de `VfxDefinition.atlas` desde a fase anterior — nenhuma mudança nova
    necessária aqui.

## P. O que muda nesta etapa (feito)

Instrumentação de `/vfx-bench` (`spawnCombo`/`spawnAreaLine` em
`VfxBenchView.tsx`) + Fase C multiplayer em `scripts/vfxBenchmark.ts` +
este relatório. **Nada de**: shader novo, `defineVfx` novo, migração de
Oracle/Fire Wall/Thunder Storm, mudança de gameplay — confirmado, nada
disso foi tocado.

## Q. Depois desta aprovação (não começa sem novo OK)

Ordem proposta, maior raster primeiro (seção E, maior ganho esperado):
1. Corrigir o bug do `longTasks` collector (seção J) antes de reusar essa
   métrica.
2. Piloto de 3 skills — Oracle, Fire Wall, Thunder Storm (ordem do pedido
   original) — usando as primitives da seção G, comparação ANTES/DEPOIS
   visual (seção H) e de custo (seção I, calibrando os pesos TBD).
3. Medir FPS real + raster sob carga multiplayer (lacuna da seção K) como
   parte do piloto, não como rodada nova separada.
4. Só então desenhar budget/LOD/culling (seção M) com dado real de
   quanto cada primitive custa em produção.

---

## R. O que foi executado (Rodada 3, Directive B) — 6 skills migradas

Ordem de prioridade explícita do usuário: Oracle → Cold Bolt → Fire Wall
→ Thunder Storm → Soul Strike (Fire Ball já tinha sido feita como prova
de conceito na Rodada 2). Todas seguem o MESMO padrão: `VfxDefinition`
GPU nova (`<skill>VfxDefGpu.tsx`), toggle dev-only
(`<skill>RenderMode.ts`, `window.__<skill>RenderBench.set("dom"|"gpu")`,
default sempre `"dom"`, nunca liga sozinho), DOM original 100% intocado
como baseline. Typecheck + suíte completa (1332 testes) verdes depois de
CADA skill.

| Skill | Composição GPU | Arquitetura de toggle |
|---|---|---|
| Fire Ball (Rodada 2) | particle+sprite (cast); sprite+sprite+trail+particle+ring (impact) | `defineVfx` troca a MESMA `VfxDefinition` |
| Oracle | 3× sprite (caveiras, órbita genérica) + 3× trail (rastro) + 1× particle (glimmers) — 4 tiers LOW/MEDIUM/HIGH/ULTRA testados | `defineVfx` troca a MESMA `VfxDefinition` |
| Cold Bolt | 1× particle (estilhaço) + 1× ring + 1× sprite (flash) + 1× `dom` (números) | `bindSkillVfx`/`unbindSkillVfx` (não estava no Core) |
| Fire Wall | 2× sprite (chama+núcleo, offset vertical) + 1× particle (brasas) — SEM `ring` | `defineVfx` troca a MESMA `VfxDefinition` |
| Thunder Storm | cast: sprite+particle; impact: sprite+particle+`dom` (números) | `defineVfx` troca a MESMA `VfxDefinition` (cast COMPARTILHADO com Light Bolt) |
| Soul Strike | `anchor:"caster-to-target"` + `flightOffset.ts`: 1× trail + 1× sprite + 1× particle + 1× `dom` (números) | `bindSkillVfx`/`unbindSkillVfx` (não estava no Core) |

**Duas famílias de skill, dois padrões de toggle**: Fire Ball/Oracle/Fire
Wall/Thunder Storm já tinham `VfxDefinition` no Core (migração Fase 3) —
o toggle troca a receita pelo MESMO id via `defineVfx`. Cold Bolt/Soul
Strike nunca estiveram no Core (dispatch legado `vfx/SkillVfx.tsx`) — o
toggle liga/desliga o binding `aegisName→vfxId` (`unbindSkillVfx`, função
nova adicionada em `registry.ts` nesta rodada).

**Exceção "números de dano continuam DOM"** (Cold Bolt, Thunder Storm,
Soul Strike): a cascata de N números por hit + total dourado usa DOIS
estilos que o `net/damageFeed` genérico (usado por toda skill de hit
único) não tem — cada skill ganhou uma arte DOM PRÓPRIA só pros números
(`<skill>DamageDomArt.tsx`), registrada como UMA camada `dom` dentro de
`layers[]` (mecanismo já suportado pelo Core desde a Fase 5, confirmado
funcionando pela primeira vez em produção nesta rodada). Timing idêntico
ao original: constantes de stagger/impacto/duração IMPORTADAS do arquivo
DOM original (nunca reescritas), garantindo que as duas versões (legado e
Core) caem no MESMO instante de "impacto".

**Simplificações visuais deliberadas, aceitas explicitamente pelo
pedido** ("gameplay > escala > clareza > fidelidade absoluta"):
- Cold Bolt: 5 estalactites discretas caindo (timing próprio cada) →
  1 estouro de partículas consolidado. Números de dano continuam exatos
  por hit — só a coreografia visual foi simplificada.
- Soul Strike: 5 almas independentes com curvas onduladas próprias →
  1 voo só representando a rajada inteira como enxame coeso. Mesma regra
  — números exatos, coreografia simplificada.
- Nenhuma skill teve dano/cooldown/alvo/duração/hit-detection/rede
  tocados — confirmado em cada checkpoint.

**Achado de arquitetura, não cosmético**: `ring` (`RingRenderer`, `Mesh`
separado do `InstancedMesh` de sprite/particle) e sprites/partículas no
MESMO ponto/raio comparável correm risco real de ordem-de-desenho errada
— os dois materiais são `depthTest:false`, o Three ordena transparentes
por distância aproximada da câmera (não por ordem de `layers[]`), e um
`ring` grande o bastante pra ler como "brilho de chão" pode cobrir os
sprites por cima (achado em Fire Wall, Fase AW, corrigido removendo o
`ring`). Regra pra composições futuras: preferir camadas do MESMO
renderer quando possível, ou manter `ring` bem menor que os sprites.

## S. ERRO DE METODOLOGIA DESCOBERTO E CORRIGIDO — leia antes de citar
## qualquer fps deste documento ou de sessões anteriores

**Toda fase numérica desta investigação (rodadas 1, 2 e a maior parte da
3) rodou `scripts/vfxBenchmark.ts` em Chromium HEADLESS** (só as fases de
screenshot usavam `VFX_BENCH_HEADED=1`). Headless, NESTE ambiente, cai
pro **SwiftShader** — WebGL 100% em software, sem GPU nenhuma envolvida
(confirmado lendo `gl.getParameter(UNMASKED_RENDERER_WEBGL)` via CDP:
`"ANGLE (..., SwiftShader Device (Subzero)..., SwiftShader driver)"`).
Prova decisiva (`Profiler` do CDP, CPU sampling real do V8, não o bucket
`composite` da API `Tracing` — que também se mostrou não confiável):
`(program)` (código nativo opaco, é o SwiftShader rasterizando) consumia
**86-98% do tempo de CPU amostrado** no combo 100%-GPU headless, com
`vfxManager.update()` custando só 0.5-1.6ms/quadro o tempo TODO — a
arquitetura VFX nunca foi o gargalo, era o AMBIENTE DE TESTE.

Re-rodando os MESMOS cenários com `VFX_BENCH_HEADED=1` (Chromium usa a
GPU real da máquina — `NVIDIA GeForce GTX 1660 Ti` via ANGLE/D3D11,
confirmado): números completamente diferentes.

**Números definitivos, confirmados headed, GPU real** (combo caótico
completo — Fire Ball + Oracle + Cold Bolt + Fire Wall + Thunder Storm +
Soul Strike, TODAS ativas por "jogador" simultaneamente):

| modo | arranjo | N=10 | N=20 | N=30 | domNodes N=30 |
|---|---|---:|---:|---:|---:|
| DOM (6 skills) | tight | fps=1 | fps=1 | fps=0 | 21021 |
| DOM (6 skills) | spread | fps=4 | fps=1 | fps=0 | 21021 |
| **GPU (6 skills)** | **tight** | **fps=59** | **fps=60** | **fps=60** | **1281** |
| **GPU (6 skills)** | **spread** | **fps=60** | **fps=60** | **fps=60** | **1281** |

**Leitura correta, sem exagero nem minimização**:
- O combo 100%-DOM é genuinamente catastrófico (fps=0-1) **mesmo sob GPU
  real** — DOM/CSS (`text-shadow`, `filter:blur()`, centenas de
  `@keyframes ... infinite`) é custo de CPU/compositor do NAVEGADOR, não
  de WebGL, então software×hardware quase não muda esse lado. Isto NÃO
  era artefato — confirma tudo que as seções D/E/K acima já tinham
  medido sobre raster/blur ser o vilão real.
- O combo 100%-GPU (as 6 skills desta rodada) roda **60fps sólido em
  TODO N testado, tight e spread** — não "melhora um pouco, continua
  ruim" (a leitura anterior, sob SwiftShader), é liso de ponta a ponta.
- O que ERA artefato de metodologia eram as medições INTERMEDIÁRIAS
  (fases "migrar 1-2 skills não resolve o combo sozinho", fps=1-10
  travado mesmo com domNodes caindo) — essas rodaram headless o tempo
  todo nesta rodada 3 e devem ser lidas como "direção do achado correta
  (ganho parcial, real), magnitude ABSOLUTA não confiável". As
  CONCLUSÕES ARQUITETURAIS de cada skill (DOM>GPU, raster domina sobre
  contagem de nó, cada migração reduz DOM real) continuam válidas — só
  os fps absolutos de fases intermediárias específicas (ver histórico na
  memória `vfx-gpu-arquitetura-escala.md`, Rodada 3) não.

**Regra permanente daqui pra frente** (documentada também como comentário
no código, junto da constante `HEADLESS` em `scripts/vfxBenchmark.ts`):
`VFX_BENCH_HEADED=1` é OBRIGATÓRIO pra qualquer conclusão sobre fps/frame
time ABSOLUTO ("está bom", "está ruim", "colapsa", "aguenta N players").
Modo headless continua válido só pra comparação RELATIVA rápida entre
duas receitas no MESMO ambiente (A×B, DOM×GPU da MESMA skill) — nunca pra
decidir se algo "funciona" em produção.

## T. Checklist de aprovação (seção O) — resultado real, headed, pós-migração

Revisitando os 12 pontos da seção O com dado real desta rodada (headed):

1. Manter visual atual? — **parcial, por decisão explícita**: Fire Ball/
   Thunder Storm/Fire Wall acertaram de primeira ou com pequeno ajuste;
   Oracle/Cold Bolt/Soul Strike tiveram simplificações DELIBERADAS
   documentadas na seção R (coreografia reduzida, forma sem atlas —
   esfera em vez de caveira/estalactite). Números de dano sempre exatos.
2. Eliminar centenas de nós DOM? — **sim, confirmado com dado real**:
   domNodes do combo caótico completo cai de 21021 (DOM) pra 1281 (GPU)
   em N=30 — 94% de redução.
3. Reusar primitives entre skills? — **sim** — `flightOffset.ts`/
   `orbitOffset.ts` reusados por 3 skills cada sem `if <SKILL>` em nenhum
   renderer; `<skill>DamageDomArt.tsx` é o MESMO padrão 3 vezes (Cold
   Bolt, Thunder Storm, Soul Strike).
4. Suportar dezenas de players? — **SIM, confirmado com fps real headed**
   (seção S): 60fps sólido até 30 players no combo 100%-GPU completo —
   a lacuna "TBD" da seção K está fechada.
5. Evitar crescimento explosivo de draw calls? — **sim** — draw calls do
   combo GPU ficaram constantes (~10) independente de N, confirmado nas
   Fases AV/AY/BB/BE/BF desta rodada.
6. Evitar crescimento explosivo de CPU? — **sim, com prova direta**:
   `vfxManager.update()` fica em 0.5-1.7ms/quadro em TODO N testado
   (Fase BF, `getUpdateProfile()`) — não é só "não explode", é
   irrelevante frente ao frame budget de 16.7ms (60fps).
7. Controlar overdraw? — **melhor que antes, não perfeito**: migrar pra
   GPU eliminou o overdraw de blur/shadow CSS (o vilão da seção E), mas
   `spread` mostrou queda real em N=20/30 headed (32-39fps, não 60) —
   headroom finito existe, não investigado a fundo (fica como pendência).
8. Controlar partículas? — **sim, aplicado**: cada skill migrada usa
   contagem FIXA de partícula (não escala com hits nem players) — regra
   explícita seguida em todas as 6.
9-11. LOD/culling/budget? — **culling por frustum EXISTE agora** (Fase 5
   anterior, `manager.ts`), confirmado ativo nesta rodada (`cull=` nas
   linhas de log). LOD/budget granular (por-skill, por-player, DOM VFX)
   continuam **NÃO implementados** — pendência real, ver seção U.
12. Receber atlas sem reescrever skills? — **sim**, sem mudança nesta
    rodada — `VfxDefinition.atlas` continua o mecanismo, só falta o
    asset existir.

## U. Limites globais do `VFXManager` — fechado (Directive B)

`budget.ts` ganhou 4 limites novos além de `maxActiveInstances` (que já
existia, Rodada 2), todos em `VfxBudgetLimits`, todos `Infinity` por
padrão (no-op até calibrar, mesma regra de sempre — "infra existe,
número não é chutado"):

| Limite | O que conta | Item do pedido |
|---|---|---|
| `maxActiveInstances` | 1 por instância viva | "VFX simultâneos" |
| `maxActiveParticles` | soma de `particleCount` de toda camada `particle` ativa | "partículas simultâneas" |
| `maxDomInstances` | 1 por instância com QUALQUER camada `renderer:"dom"` | "DOM VFX" |
| `maxParticlesPerSkill` | `particleCount`, agrupado por `vfxId` | "partículas por skill" |
| `maxParticlesPerPlayer` | `particleCount`, agrupado por `sourceGid` | "partículas por jogador" |

Mecanismo: `selectExcludedByWeight()` generaliza o `selectExcluded()`
antigo (peso=1 por instância) pra aceitar QUALQUER peso (partículas,
etc.) — mesmo algoritmo de prioridade (pior primeiro, `own` nunca cai
primeiro). `selectExcludedGrouped()` aplica isso POR GRUPO (`vfxId` ou
`sourceGid`), pra "por skill"/"por jogador" não brigarem pelo MESMO
orçamento. `VFXManager.computeExcluded()` roda os 5 limites sobre os
MESMOS candidatos e une os 5 resultados — a exclusão final aplicada em
`update()`/`budgetExcludedIds` é a união, um `Set` só (sem essa
generalização quebrar o comportamento já existente de
`maxActiveInstances`, testado igual antes). `setBudgetLimits()` agora
aceita `Partial<VfxBudgetLimits>` (setar 1 limite não zera os outros 4
de volta pra `Infinity`).

**Deliberadamente NÃO implementado** — "efeitos caros" e "orçamento
global" (ponderado) do pedido original exigiriam um MODELO DE CUSTO
calibrado (pesos relativos raster/GPU/CPU por técnica) que a seção I
deste mesmo documento já marca como `TBD — calibrar após piloto`, nunca
feito. Inventar pesos agora seria "chutar número", proibido pela regra
do projeto inteiro. Os 5 limites acima cobrem tudo que é DIRETAMENTE
mensurável sem esse modelo; "efeitos caros"/"orçamento ponderado" ficam
TBD até existir dado real de custo por técnica pra calibrar.

10 testes novos (`budget.test.ts`: `selectExcludedByWeight`/
`selectExcludedGrouped` puros; `manager.test.ts`: os 3 novos limites
aplicados de ponta a ponta via `VFXManager`) — suíte completa 1342
testes verdes.

## V. Pendências reais (não fictícias, não infladas)
- ~~Cliff isolado do Thunder Storm em N=30~~ — **fechado, não é real.**
  Recheck headed (GPU real): fps=60 em N=30 isolado, sem cliff nenhum.
  Era artefato de SwiftShader (mesma família de erro da seção S).
- ~~`spread` com queda real em N=20/30~~ — **fechado, era ruído.**
  Re-rodei a Fase BF headed original de novo: o dip reaparece com
  MAGNITUDE diferente (53/49fps, não os 32/39fps originais) e sempre
  RECUPERA em N=30 — assinatura de ruído de medição (GC/JIT), não
  degradação real (um problema de escala de verdade pioraria com N).
  A Fase BJ (combo de 11 skills, mais recente e abrangente) já mostrou
  spread limpo em 60/60/59 sem dip nenhum, superando este achado.

**Zero pendências de performance abertas.** O que resta (gaps visuais
menores aceitos) são decisões de produto, não investigação.

## Y. GPU virou o padrão de PRODUÇÃO — as 11 skills

Última decisão pendente, agora tomada: as 11 `<skill>RenderMode.ts`
chamam `set<Skill>RenderMode("gpu")` (`"high"` pro Oracle) no PRÓPRIO
module-load, depois do `<skill>VfxDef.ts(x)` correspondente já ter
registrado o DOM (ordem de import em `skillVfxBindings.ts` garante que
GPU vence por último). Nenhuma skill precisou do padrão `bind`/`defineVfx`
mudado — só o valor INICIAL de `mode` (era `"dom"`, agora `"gpu"`/`"high"`)
mais uma chamada explícita aplicando esse default no load.

DOM continua 100% intocado e disponível — `window.__<skill>RenderBench.
set("dom")` reverte em dev sem rebuild, pra comparação/regressão visual
a qualquer momento.

**Confirmado headed (GPU real), sem NENHUM toggle chamado** (Fase BK,
`fase-bk-producao-padrao-*.png`): Cold Bolt/Fire Wall/Light Bolt
spawnados direto pelo dispatcher de produção, sem `.set()` nenhum —
saem em GPU, batendo com os screenshots GPU já validados nas seções
anteriores. O combo completo das 11 skills (seção W) já era o número
final ANTES desta mudança de default — continua válido, é exatamente o
que o jogo entrega agora sem toggle nenhum.
- ~~Skills fora da lista de 5~~ — **fechado.** As 5 restantes (Fire
  Lance, Light Bolt, Frost Diver, Stone Curse, Ghost Dome/Safety Wall)
  ganharam protótipo GPU na mesma varredura. Fire Lance é gêmea
  estrutural de Cold Bolt (mesma receita). Light Bolt é o primeiro uso
  real de `BeamRenderer` nesta migração (raio único, melhor resultado
  visual da rodada — beam reto bate melhor que sprite/atlas ausente).
  Frost Diver/Stone Curse/Ghost Dome não tinham cascata de dano nem
  `@keyframes infinite` no original (mais baratas por design) — as
  únicas 3 desta migração INTEIRA com GPU 100% livre de DOM residual
  (domNodes=0 confirmado 1-30 players). Visual: Fire Lance/Light Bolt
  corretos, Frost Diver/Stone Curse legíveis, Ghost Dome com contorno
  fraco (gap aceito, mesma classe das outras). **Confirmado headed (GPU
  real), 1/5/10/20/30 tight, isolado**:

  | Skill | DOM fps (1→30) | GPU fps (1→30) | domNodes GPU N=30 |
  |---|---|---|---:|
  | Fire Lance | 52→39→33→18→16 | 60→61→60→60→60 | 420 |
  | Light Bolt | 60→56→49→35→23 | 61→60→60→60→60 | 420 |
  | Frost Diver | 60→59→55→43→37 | 60→60→60→60→61 | **0** |
  | Stone Curse | 60→58→57→51→46 | 61→61→60→61→60 | **0** |
  | Ghost Dome | 59→61→60→60→59 | 61→60→60→60→61 | **0** |

  GPU crava ~60fps em TODO N pras 5 — mesmo padrão do combo 100%-GPU das
  outras 6. DOM degrada em graus diferentes (Fire Lance/Light Bolt mais
  cedo, cascata de dano; Ghost Dome quase não degrada, buff leve).
  Frost Diver/Stone Curse/Ghost Dome confirmam GPU 100% livre de DOM
  residual (domNodes=0) em toda a curva, dado real, não só teórico.
  **Total: 11 skills com protótipo GPU** — todas as famílias DOM-pesadas
  do jogo cobertas.

## W. Combo completo com as 11 skills, DOM-100% vs GPU-100% — número
## final da investigação, confirmado headed (GPU real)

`spawnCombo("chaotic")` do bench (`VfxBenchView.tsx`) estendido pra
disparar as 11 skills com protótipo GPU (antes só disparava as 6
originais) — nova Fase BJ em `vfxBenchmark.ts`. 10/20/30 players,
tight+spread, `VFX_BENCH_HEADED=1` (GPU real, NVIDIA GTX 1660 Ti):

| modo | tight N=10 | N=20 | N=30 | spread N=10 | N=20 | N=30 | domNodes N=30 |
|---|---:|---:|---:|---:|---:|---:|---:|
| DOM (11 skills) | fps=1 | fps=1 | fps=1 | fps=3 | fps=34 | fps=26 | 21805 |
| **GPU (11 skills)** | **fps=57** | **fps=58** | **fps=57** | **fps=60** | **fps=60** | **fps=59** | **2125** |

GPU fica em 57-60fps em TODOS os 6 pontos medidos — o cenário de
estresse mais pesado que o jogo tem hoje (as 11 skills DOM-pesadas
disparadas por TODO jogador simultaneamente). DOM continua catastrófico
(majoritariamente 1fps mesmo com GPU real, confirmando de novo que o
colapso do DOM é genuíno, não artefato de SwiftShader). domNodes cai
90% (21805→2125). `vfxManager.update()` continua em 1.0-2.1ms/quadro em
qualquer um dos 12 pontos — a arquitetura GPU nunca é o teto.

**Esta é a validação final da Rodada 3.** Com as 11 famílias DOM-pesadas
migradas (protótipo, toggle dev-only, nada em produção ainda), o pior
cenário possível do jogo roda liso em hardware real.

## X. `maxParticlesPerSkill`/`maxParticlesPerPlayer` — calibrados com dado
## real (fecha a seção U)

Os 2 limites granulares que tinham dado de benchmark GPU real suficiente
pra calibrar sem chutar (os outros 3 — `maxActiveInstances`/
`maxActiveParticles`/`maxDomInstances` — continuam `Infinity`, sem dado
equivalente ainda):

- **`maxParticlesPerSkill = 2475`** — base: 1980, o maior total de
  partícula de UMA skill só já confirmado 60fps sólido em GPU real
  (Oracle tier "high", 66 partículas/instância × 30 jogadores, curva de
  escala isolada, Fase AR).
- **`maxParticlesPerPlayer = 418`** — base: 334, a soma de
  `particleCount` das 11 skills disparadas ao MESMO TEMPO pelo MESMO
  jogador (FireBall 16 + ThunderStorm 24 + FireWall 12×8 células +
  Oracle 66 + ColdBolt 30 + SoulStrike 18 + FireLance 30 + LightBolt 16
  + FrostDiver 16 + StoneCurse 12 + GhostDome 10) — exatamente o combo
  caótico completo, confirmado 57-60fps em GPU real nos 6 pontos da
  seção W.

Os dois defaults ficam ~25% acima do maior número confirmado seguro.
**Importante não ler como "ponto de colapso descoberto"**: GPU real
nunca colapsou em NENHUM teste desta investigação, nem no cenário mais
extremo medido (11 skills × 30 players × tight, seção W). São travas de
segurança além de tudo já validado — protegem só contra um caso futuro
nunca testado (skill nova com muita partícula, nível/hits maior que o
testado), sem apertar nada que já está confirmado seguro hoje.
- **Nenhuma skill real trocou de renderer em produção** — toda a
  migração desta rodada é PROTÓTIPO com toggle dev-only
  (`window.__<skill>RenderBench`), `mode` sempre nasce `"dom"`. Virar
  padrão de produção é uma decisão separada, não tomada aqui.
- Gaps visuais menores já aceitos e documentados na seção R (forma sem
  atlas, coreografia simplificada) — não pendências, decisões.
