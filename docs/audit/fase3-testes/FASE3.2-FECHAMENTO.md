# Fase 3.2 — Fechamento dos gaps funcionais

Executada 2026-08-10, a partir do commit `2751575` (auditoria independente,
`AUDITORIA-INDEPENDENTE.md`). Objetivo: fechar os testes ainda `NÃO TESTADO`/
`NÃO OBSERVADO`, e investigar o A27 até a causa raiz. Regra seguida: sempre o
fluxo real primeiro (código → banco → runtime → `/play`), sem redesign, sem
funcionalidade nova, sem tocar `rathena/` sem causa comprovada.

## 1. Veredito

## **PARCIALMENTE APROVADA**

Não por causa do A27 (que se resolveu — não é bug) — por causa de dois
achados NOVOS e reais desta rodada: um bug que **derruba o map-server
inteiro** (Classes, sem correção mínima possível) e um bug confirmado
(NPC/criar, sem write-path real), mais uma fração ainda genuinamente não
testada (skill de monstro em combate observado, algumas interações de
status). O núcleo (mapas/monstros/itens/equipamentos/cartas/skills-criar/
status-editar/NPC-editar) está solidamente provado.

## 2. A27 — resolvido, não é bug

**Causa encontrada**: `atcommand.cpp:960` — `ACMD_FUNC(save)` chama
`chrif_save(sd, CSAVE_NORMAL)`. `CSAVE_NORMAL = 0x00`
(`chrif.hpp:20`) nunca liga o bit `CSAVE_INVENTORY = 0x08`
(`chrif.hpp:24`). Em `chrif_save` (`chrif.cpp:299-300`):

```c
if (flag&CSAVE_INVENTORY)
    intif_storage_save(sd,&sd->inventory);
```

`@save` só seta o ponto de respawn e salva status/pet — **nunca** o
inventário. A persistência real de inventário só acontece em: `pc_autosave`
(temporizador periódico, `pc.cpp:13030`, `chrif_save(sd,
CSAVE_INVENTORY|CSAVE_CART)`, intervalo padrão `5min / (jogadores online+1)`
— `map.hpp:288`), logout/quit (`CSAVE_QUIT|CSAVE_INVENTORY`), troca de
**map-server** (`CSAVE_CHANGE_MAPSERV|CSAVE_INVENTORY` — não dispara em
`@warp` dentro do MESMO map-server, que é o único que este projeto tem), ou
interações de trade/vending/storage/cart/pet.

**Camada**: nenhuma das suspeitas do relatório original — não é cliente
(recebe ack correto), não é gateway/protocolo (decodifica certo), não é
persistência quebrada. É **a arquitetura de save do próprio rAthena**, por
design: save é em lote/intervalo, não por ação.

**Evidência**: reproduzido com personagem `Campo` (não QA):
1. Pickup de Jellopy (817→818 no cliente) → SQL imediato → **817** (não
   persistiu ainda, confirmando o comportamento).
2. Logout real (navegação que derruba o socket, dispara `CSAVE_QUIT|
   CSAVE_INVENTORY`) → SQL → **818** (persistiu, via o mecanismo correto).

**Pode ser corrigido sem tocar `rathena/`?** Não há nada a corrigir — não é
bug. O comportamento é correto e universal a qualquer rAthena. O único
risco real e genérico (não deste projeto) é perda de itens picked-up entre
uma queda de processo e o próximo autosave/logout — risco inerente ao motor,
fora do escopo deste código.

## 3. Matriz completa

| Área | Criar | Editar | Antigo | Persistência | Runtime | `/play` | Comportamento | Status |
|---|---|---|---|---|---|---|---|---|
| Mapas | PASSOU | — | — | PASSOU | PASSOU | PASSOU | PASSOU | **PASSOU** |
| Monstros | PASSOU | — | PASSOU | PASSOU | PASSOU | PASSOU | PASSOU | **PASSOU** |
| Itens (9 tipos restantes) | PASSOU (9/9 criados) | — | — | PASSOU (9/9) | PASSOU (9/9, boot limpo) | PASSOU (todos deram `@item`; `usable` consumido ao usar; `ammo`/`shadow_gear` equip testado) | PASSOU (defBonus/atkBonus numéricos batem) | **PASSOU** |
| Equipamentos — cartas | PASSOU | — | — | PASSOU (SQL após logout real) | PASSOU | PASSOU (aplicar+equipar+persistir) | PASSOU | **PASSOU** |
| Equipamentos — requisito de nível | — | PASSOU (bloqueio e liberação) | — | PASSOU | PASSOU | PASSOU (`success:false` no nível insuficiente, `success:true` após corrigir) | PASSOU | **PASSOU** |
| Equipamentos — restrição de classe | — | — | — | — | — | — | — | **NÃO TESTADO** (mesmo mecanismo do nível, não testado isoladamente) |
| Skills — editar existente | — | PASSOU (SpCost 20→35) | — | PASSOU | PASSOU (boot limpo) | NÃO OBSERVADO (delta de SP em combate) | — | **PASSOU** (persistência+runtime) |
| Skills — antiga (Bash) | — | — | NÃO OBSERVADO | — | — | NÃO OBSERVADO | — | **NÃO COMPROVADO** |
| Skills — monstro em combate | — | — | — | PASSOU | PASSOU | NÃO OBSERVADO (mesmo após corrigir causa estrutural) | — | **NÃO OBSERVADO** |
| Status — criar novo | FALHOU (loader rejeita) | — | — | PASSOU (admin aceita, grava) | **FALHOU** (`[Error]: Invalid Status`) | — | — | **NÃO APLICÁVEL** (arquitetura não suporta — nomes fixos do C++) |
| Status — aplicar via item (antigo) | — | — | NÃO COMPROVADO | PASSOU (script gravado) | PASSOU (boot limpo) | NÃO COMPROVADO (item consumido, efeito não confirmado) | — | **NÃO COMPROVADO** |
| Classes — criar nova | **FALHOU** (crash) | — | — | PASSOU (admin aceita, grava) | **CRASH** (`terminate`/`ch != NONE`) | — | — | **FALHOU** (bug grave, ver §6) |
| Classes — personagem com classe antiga | — | — | NÃO TESTADO | — | — | — | — | **NÃO TESTADO** (bloqueado pelo risco do achado acima) |
| NPCs — criar novo | **FALHOU** (sem write-path) | — | — | PASSOU (só catálogo) | **FALHOU** (nunca gera `.txt`, nunca enfileira reload) | **FALHOU** (0 NPCs no mundo, confirmado) | — | **FALHOU** (bug confirmado, ver §6) |

## 4. Todos os testes executados (com evidência)

### T1 — Itens: 9 tipos restantes

- **Dados**: `39301`(usable) `39302`(etc) `39303`(pet_egg) `39304`(pet_armor)
  `39305`(ammo) `39306`(delay_consume) `39307`(shadow_gear) `39308`(cash)
  `39309`(card).
- **Persistência**: `SELECT id,name_aegis,type FROM item_db_re WHERE id
  BETWEEN 39301 AND 39309` → os 9 com o `type` correto.
- **Runtime**: `panel_reload_queue` (9 linhas `itemdb`, staggered ~5s cada,
  todas com `done_at`); boot confirma `Loading '29367'` /
  `Done reading '29367'` — zero perdidos.
- **`/play`**: `@item <id> 1` para os 9 → todos aparecem no inventário real
  de `Campo`. `usable` (39301): `item:use` → `inv:remove` (consumido).
  `shadow_gear` (39307): `item:equip` → `equipped:true`, `defBonus: 5`
  (bate com `defense:5` configurado). `ammo` (39305): `item:equip` →
  `success:false` — **correto**, Campo não está com arco equipado
  (`pc_isequip`, restrição real de arma pra munição, não bug).
  `delay_consume` (39306): `item:use` não removeu o item nem produziu
  evento — **NÃO COMPROVADO** (item sem script, causa não isolada, baixo
  valor de investigação adicional).
- **Veredito**: **PASSOU** (8/9 confirmados ponta a ponta; 1/9 — delay_consume
  sem script — NÃO COMPROVADO, não afeta o veredito geral porque o
  mecanismo de persistência/runtime já está provado nos outros 8).

### T2 — Equipamentos: cartas

- **Achado de metodologia (não é bug)**: primeira tentativa aplicou a carta
  no item ERRADO (Knife 1201 em vez da espada QA equipada) — investigado no
  código real (`clif.cpp:7114-7115`,
  `if (sd->inventory.u.items_inventory[i].equip > 0) continue;`
  — rAthena **recusa listar itens JÁ EQUIPADOS** como alvo de composição de
  carta, por design; é preciso desequipar primeiro. Refeito corretamente.
- **Passos corretos**: criar espada com 1 slot (`39310`) → dar carta QA
  (`39309`, com `locations` configurado) → desequipar a espada →
  `card:list` (index 68) → servidor retorna `equipIndexes: [59, 67]`
  (a espada desequipada e o shadow gear) → `card:insert` (cardIndex 68,
  equipIndex 59) → `success:true`, `cards:[39309,0,0,0]` → equipar de novo.
- **Persistência real**: logout (força `CSAVE_QUIT|CSAVE_INVENTORY`) → SQL
  `SELECT card0,equip FROM inventory WHERE nameid=39310` → **`card0=39309,
  equip=2`** — confirmado depois de um save de verdade, não `@save`.
- **Veredito**: **PASSOU**.

### T3 — Equipamentos: requisito de nível

- **Dados**: espada `39310`, `equipLevelMin` alternado entre `0` e `201`
  (Campo é nível 200 — impossível de atingir 201, teste de bloqueio limpo).
- **Passos**: desequipar → setar `equipLevelMin:201` → tentar equipar →
  `item:equip-result {success:false}`, continua desequipado. Reverter pra
  `0` → tentar equipar de novo → `success:true`, `equipped:true`.
- **Veredito**: **PASSOU**, os dois sentidos confirmados numericamente.
- **Restrição de classe**: não testada isoladamente (mesmo mecanismo de
  servidor `pc_isequip`, já provado funcionando pelo teste de nível) —
  marcado **NÃO TESTADO** em vez de inferido, por regra do protocolo.

### T4 — Skills: editar existente

- **Dados**: skill `10020` (GPQA_BOLT), `Custo de SP` 20→35 via UI real do
  admin.
- **Persistência**: `skill_db.yml` → `SpCost: [{Level:1,Amount:35}, ...]`
  em todos os 13 níveis.
- **Runtime**: boot `Loading '1' entries` / `Done reading '1' entries` —
  limpo.
- **`/play`**: múltiplas tentativas de `skill:use` (a skill QA e depois
  `Bash`, id 5, uma skill vanilla) contra um monstro adjacente não
  produziram `skill:cast`, mudança de SP nem dano — **sem erro no console**.
  Não foi possível isolar a causa (poderia ser precondição de estado do
  personagem, cooldown residual de tentativas anteriores, ou limitação da
  automação — mesma dificuldade que a bateria original já registrou pra
  observação de skill via Playwright).
- **Veredito**: **PASSOU** (persistência+runtime, evidência sólida) —
  efeito em combate real **NÃO COMPROVADO**.

### T5 — Skills: monstro em combate (causa estrutural encontrada)

- **Achado real**: o monstro QA (`25001`) tinha `mode_canattack = NULL`
  (falso) e `mode_aggressive = NULL` (falso) desde a criação original da
  Fase 3 — **o monstro nunca poderia atacar**, então a skill configurada
  com `state: attack` (`mob_skill_db.txt`) é estruturalmente inalcançável,
  não importa quanto HP ele tenha ou quanto tempo o combate dure. Isto é
  mais preciso que a conclusão anterior ("mob morre rápido demais") — o mob
  NUNCA teria disparado a skill, mesmo com HP infinito.
- **Correção de configuração** (dado, não código): `aiMode: "aggressive"`,
  `modes: [...,"canattack","aggressive"]`, `hp: 3000` (era 50) — aplicado
  via `MysqlMonsterRepository.update()`, mesmo write-path real do admin.
- **Reteste**: mob agressivo sobreviveu 4 hits reais (3000→2437→1079→
  515→morto) mas **ainda não atacou de volta nem dsparou a skill** — HP do
  jogador ficou intocado. Causa desta segunda falha não isolada dentro do
  orçamento restante (possível cadência de decisão de IA mais lenta que a
  cadência de ataque do script de teste).
- **Veredito**: continua **NÃO OBSERVADO**, mas agora com uma causa raiz
  REAL e CORRIGIDA para o primeiro obstáculo (modo passivo) — o monstro QA
  ficou config, corretamente, capaz de atacar (dado alterado, documentado
  aqui, não revertido — é uma correção útil pro dado de teste).

### T6 — Status: criar novo (arquitetura, não bug)

- **Tentativa**: `POST /statuses` com `id: "gpqa_novo_status"` (nome
  inventado) → **201, aceito sem validação**.
- **Persistência**: gravado em `status.yml` como `Status:
  Gpqa_Novo_Status`.
- **Runtime**: `[Error]: Invalid Status Gpqa_Novo_Status.` — o loader real
  do rAthena rejeita graciosamente (`Loading '2' entries` →
  `Done reading '1' entries`, só a entrada válida sobrevive).
- **Causa**: nomes de status são um enum fixo compilado em C++
  (`status.hpp`, ~1028 valores) — a mesma arquitetura de "sobrepor por
  nome" que Skills usa, **não** um espaço de ID livre como Item/Monster.
  `StatusSchema.id`/`RawStatusYamlSchema.Status` são `z.string()` livre,
  sem lista de nomes válidos — o admin aceita qualquer string, só o
  rAthena real rejeita, tarde, no boot.
- **Veredito**: **NÃO APLICÁVEL** — criação de status genuinamente novo não
  é suportada pela arquitetura (nem pelo rAthena em si). Limpo do YAML e do
  catálogo depois do teste; reload final confirma `1/1` limpo.

### T7 — Status: aplicar via item real (não GM command)

- **Dados**: item `39320` (`GPQA_POISON_POTION`, tipo usable,
  `rawScript: "sc_start SC_POISON,10000,1;"`).
- **Persistência/Runtime**: item criado, `itemdb` recarregado sem erro.
- **`/play`**: `@item 39320 1` → `item:use` → item CONSUMIDO (confirmado,
  saiu do inventário) mas **nenhum evento `self:status` observado, HP não
  mudou em 7.2s de observação**. Causa não isolada dentro do orçamento
  (hipóteses não descartadas: imunidade de GM a debuff, nome de evento
  errado no teste, ou falha real do script — não investigado a fundo).
- **Veredito**: **NÃO COMPROVADO**.

### T8 — Classes: criar nova (BUG GRAVE — derruba o servidor)

- **Dados**: `POST /job-classes` com `id:9001, name:"GPQA_CLASSE"` (nome
  inventado, não é um `JOB_` real do rAthena).
- **Persistência**: aceito, `201`, gravado em `job_stats.yml` E
  `skill_tree.yml` (dois arquivos, ambos usam `Jobs:`/`Job:` como chave por
  NOME, mesma arquitetura de Skills/Status).
- **Runtime**: no boot seguinte, ao processar `Jobs: {GPQA_CLASSE: true}`
  em `job_stats.yml`, o parser real do rAthena **derrubou o processo
  inteiro**:
  ```
  [Status]: Loading 'db/import/job_stats.yml'...[Status]: Loading '2' entries in 'db/import/job_stats.yml'
  terminate called after throwing an instance of 'std::runtime_error'
    what():  check failed: ch != NONE
  ```
  Confirmado via `ps aux` (processo `map-server` ausente) e `netstat`
  (porta 5122 não escutando) — **o servidor inteiro caiu**, não só a
  entrada rejeitada (diferente do comportamento de Status, que rejeita
  graciosamente).
- **Causa raiz**: `JobClassSchema.name`/o campo `Jobs:`/`Job:` nos YAMLs de
  classe (`job_stats.yml`, `skill_tree.yml`) são strings livres, sem
  validação contra os nomes reais de `enum e_job` do rAthena — igual ao
  Status (T6), mas aqui o parser C++ correspondente **não tem um caminho de
  erro gracioso** pra "job desconhecido": ele assume que o nome sempre
  resolve pra um `e_job` válido e trava com um `check failed` (assert) em
  vez de pular a entrada.
- **Recuperação**: entradas inválidas removidas manualmente de
  `job_stats.yml` e `skill_tree.yml` (arquivos gerados, fora do controle de
  versão), classe removida do catálogo (`DELETE /job-classes/9001`),
  `scripts/wsl-run.sh` reexecutado (login/char já rodando, só subiu o
  map-server) — **PID novo (7084), boot completo confirmado limpo, zero
  jogadores afetados** (nenhum estava logado durante a queda).
- **Correção mínima possível?** **Não** dentro do escopo desta rodada — o
  fix real seria uma lista de validação de ~600 nomes `JOB_` reais no
  schema do admin (`JobClassSchema`/writer), pra recusar ANTES de escrever
  no YAML. Isso é mais que "correção mínima" (é uma tabela de dados nova,
  não uma linha de lógica) — não implementado, registrado como bug aberto
  de alta severidade.
- **Veredito**: **FALHOU** — bug real, grave, reproduzido, causa raiz
  identificada, correção fora do escopo desta rodada.
- **Decisão de escopo**: "personagem com classe antiga" (@jobchange) não
  foi tentado nesta rodada — qualquer classe REAL existente (não
  inventada) usaria o mesmo caminho SEM crashar (Swordman já provado
  funcionando em T5 da auditoria anterior), então o risco é só em
  NOMES INVENTADOS — mas dado o custo de uma queda de servidor, não
  arrisquei um segundo teste de criação nesta rodada.

### T9 — NPCs: criar novo (bug confirmado, sem write-path)

- **Código**: `apps/api/src/routes/npcs.ts`, `app.post("/")` chama só
  `repo.create(body.data)` — **nunca** chama `applyNpcScriptEdit` (que só
  está no `PUT`). Confirmado por leitura direta do código antes de
  qualquer teste ao vivo (a suspeita do relatório original era correta).
- **Teste ao vivo** (seguro — não toca YAML/loader, só catálogo):
  `POST /npcs` com `id:"gpqa_npc_novo"`, `mapId:"gpqa01"` → `201`.
- **Persistência**: só no catálogo (Supabase) — confirmado.
- **Runtime**: `panel_reload_queue` sem NENHUMA linha `script` nova
  depois do POST; `git status rathena/` vazio — nenhum `.txt` escrito.
- **`/play`**: `@warp gpqa01` → `window.__world().entidades` filtrado por
  `tipo === 'npc'` → **array vazio**. O NPC não existe no mundo, ponto.
- **Veredito**: **FALHOU** — confirmado nas 3 camadas (código, banco,
  `/play`) que `POST /npcs` nunca produz um NPC jogável.
- **Correção mínima possível?** **Não** — implementar isso exigiria um
  writer novo capaz de CRIAR um `.txt` do zero (escolher arquivo, formatar
  a linha de spawn, etc.), não só reescrever um nó existente. Isso é
  funcionalidade nova de verdade, fora da regra "não implementar
  funcionalidade nova". Registrado como bug aberto, mesma categoria do A23
  original (funcionalidade exposta sem write-path real).

## 5. Testes ainda não executados (lista explícita)

- Equipamentos: restrição de classe isolada (mecanismo já provado via
  nível, mas não testado separadamente).
- Skills: efeito de SP/dano em combate observado ao vivo (persistência e
  runtime já provados).
- Status: aplicação efetivamente confirmada (item consumido, efeito não
  visto); interações com monstro/skill.
- Classes: personagem com classe antiga (`@jobchange` + ler HP/SP/ATK) —
  não tentado por decisão de risco após o crash do T8.
- Itens: `delay_consume` com script real (o item de teste não tinha
  script).

## 6. Bugs encontrados

### Corrigidos (código, commit anterior `06b19f7`/`2751575` — nenhum código novo nesta rodada)

Nenhuma correção de CÓDIGO nesta rodada — os dois bugs novos (T8, T9) têm
correção fora do escopo de "mínima" (ver justificativa em cada um). A22b
(NPC reload) e A26b (groupId) já estavam corrigidos e foram apenas
reconfirmados pela suíte de regressão.

### Abertos — NOVOS desta rodada

**Classes: nome inventado derruba o map-server inteiro** (severidade ALTA,
o mais grave desta auditoria em dois rounds)
- Causa raiz: `job_stats.yml`/`skill_tree.yml` chaveiam por NOME de job
  (`Jobs:`/`Job:`), sem validação contra o `enum e_job` real do rAthena; o
  parser C++ trava com `assert` (`check failed: ch != NONE`) em vez de
  rejeitar graciosamente.
- Impacto: qualquer classe criada pelo admin com nome que não bate
  EXATAMENTE com um `JOB_` real derruba o servidor pra TODOS os jogadores
  no próximo boot/reload — não é uma falha isolada, é uma queda total.
- Reprodução: limpa, 1 tentativa, evidência completa (log de crash, PID
  antes/depois, restart documentado).
- Correção: não aplicada (validação de ~600 nomes reais é funcionalidade
  nova, fora do escopo desta rodada) — recomendado como prioridade máxima
  pra próxima rodada de correções.

**NPCs: `POST /npcs` nunca produz NPC jogável**
- Causa raiz: rota de criação não invoca o writer (`applyNpcScriptEdit`),
  só grava no catálogo.
- Impacto: admin pode "criar" um NPC que nunca aparece no jogo, sem aviso.
- Reprodução: limpa, confirmada em 3 camadas.
- Correção: não aplicada (exigiria um writer de criação-do-zero,
  funcionalidade nova) — mesma categoria do A23 histórico (Monster.spawns);
  recomendação mínima seria replicar o MESMO padrão de honestidade já usado
  pro A23 (travar a seção "Criar" com aviso, em vez de aceitar em silêncio).

### Não reproduzidos / não são bugs

- **A27** (pickup) — não é bug, é a arquitetura de save do rAthena (§2).
- **Status: criar novo** — não é bug, é limitação arquitetural real
  (nomes fixos), igual a Skills.

## 7. Funcionalidades não suportadas (evidência no código)

- Criação de status genuinamente novo (`status.hpp`, enum fixo compilado —
  `StatusSchema`/writer não validam, mas o rAthena real recusa).
- Criação de classe genuinamente nova com nome não reconhecido
  (`enum e_job` fixo — pior que Status, pois o rAthena real **crasha** em
  vez de recusar).
- Criação de NPC jogável via `POST /npcs` (`routes/npcs.ts` — código
  confirma, não invoca o writer).

## 8. Integridade

- **HEAD inicial desta rodada**: `f73bfa0` (idêntico ao HEAD final —
  nenhum código novo commitado nesta rodada).
- **HEAD final**: `f73bfa0` (sem mudanças de código; `git status`
  confirmadamente limpo ao longo de toda a rodada).
- **Arquivos de código alterados**: nenhum.
- **Arquivos fora do git alterados** (gitignored, `rathena-db-import/`):
  `job_stats.yml`, `skill_tree.yml`, `status.yml` — cada um recebeu uma
  entrada QA temporária que foi removida manualmente depois do teste;
  estado final confirmado limpo (boot sem erros relacionados).
- **`rathena/`**: intocado do início ao fim desta rodada —
  `git status --porcelain rathena/` vazio, `git diff bc1a93c HEAD --stat
  -- rathena/` vazio (cobre TODA a história desde antes da Fase 3).
- **`supabase/`**: nenhuma migration nova.
- **Banco**: nenhuma mudança de schema. Dados: 9 itens QA novos
  (`39301`-`39309`), 1 espada com slot (`39310`), 1 item de status
  (`39320`), 1 classe QA criada-e-removida (`9001`), 1 status QA
  criado-e-removido (`gpqa_novo_status`), 1 NPC QA catálogo-só
  (`gpqa_npc_novo`, deixado — inofensivo).
- **Dados QA anteriores**: `gpqa01`, `25001` (HP/modo alterados
  nesta rodada — documentado em T5), `39100`, `39200`, `10020` (SpCost
  editado nesta rodada — documentado em T4), `GPQA3` — todos preservados,
  nenhum removido sem necessidade.
- **Servidores**: **1 restart do map-server** nesta rodada.
  - **Motivo**: crash real causado pelo teste T8 (Classes).
  - **PID antes**: ausente (processo morto, confirmado via `ps aux`
    e `netstat` — porta 5122 não escutava).
  - **PID depois**: `7084` (login-server `5504` e char-server `5508`
    inalterados — `scripts/wsl-run.sh` detectou e pulou os dois).
  - **Resultado**: boot completo, limpo, confirmado (`2676/2676` mob,
    `29367/29367` item, `1/1` job_stats, `1/1` skill_tree, `1/1` status,
    `1/1` skill, zero jogadores online no momento da queda — nenhum
    impacto real a usuários).

## 9. Testes automatizados

- `pnpm -r typecheck` — **9/9 pacotes limpos**.
- `@ragnarok/api test` — 114 passando, 1 falha pré-existente e não
  relacionada (`map-row.test.ts`).
- `@ragnarok/game-data test` — 11 passando, 1 falha pré-existente e não
  relacionada (`server-config.test.ts`).
- `@ragnarok/ro-protocol test` — 5/5.
- `@ragnarok/engine-core test` — 16/16.
- `@ragnarok/game test` — 894/894 (89 arquivos).
- Confirmado: A26/A26b, A28, A29, reload de NPC — todos ainda corretos
  (suíte completa rodada depois de todos os testes desta rodada, sem
  nenhuma regressão nova).

## 10. Próximo passo (lacunas restantes, em ordem de prioridade)

1. **Classes: validar nome de job antes de aceitar o POST/PUT** — maior
   prioridade absoluta; sem isso, qualquer operador pode derrubar o
   servidor sem querer. Requer tabela dos ~600 `JOB_` reais (fora do
   escopo desta rodada, é trabalho de implementação real).
2. **NPCs: travar "Criar" com aviso** (mesmo padrão já usado no A23) até
   existir um writer de criação-do-zero.
3. **Status: aplicar de fato e observar** (não só consumir o item) — via
   um segundo item com script mais simples, ou investigar por que
   `self:status` não disparou.
4. **Skills: observar disparo real em combate** — precisa de um cenário de
   IA de monstro com cadência de decisão compatível com o teste
   automatizado (o fix de modo desta rodada não foi suficiente sozinho).
5. **Equipamentos: restrição de classe isolada** — teste rápido, mesmo
   mecanismo já provado, só falta o teste dedicado.
6. **Classes: personagem com classe antiga real** (`@jobchange` numa
   classe VÁLIDA, ex. Knight) — seguro de tentar (não usa nome inventado),
   não feito nesta rodada só por gestão de tempo depois do T8.
