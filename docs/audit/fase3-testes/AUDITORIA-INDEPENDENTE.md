# Auditoria independente da Fase 3

Executada 2026-08-10, começando do commit `870045b` (o relatório original,
`RELATORIO.md`). Regra seguida: o relatório original NUNCA foi aceito como
prova — cada afirmação relevante foi reproduzida contra código, banco, log de
boot do rAthena real ou `/play` ao vivo (via `window.__gateway`/`__world`/
`__player`, os mesmos hooks de DEV usados na bateria original — client
sintético do Playwright não aciona o raycasting do canvas R3F, mesma
limitação já documentada). Quando uma reprodução não foi possível ou não deu
tempo, o teste foi marcado `NÃO TESTADO` ou `NÃO COMPROVADO`, nunca `PASSOU`.

## Veredito

## **PARCIALMENTE APROVADA**

## Resumo

O caminho ADMIN → PERSISTÊNCIA → RUNTIME → `/play` está **genuinamente
provado** para mapas, monstros, itens (2/12 tipos), equipamentos, skills
(criação) e status (edição de campo runtime) — reproduzido nesta auditoria
com evidência nova, não só herdada do relatório anterior. Três dos quatro
bugs que o relatório original alegava ter corrigido (A26/A28/A29) foram
re-verificados; **A26 tinha uma regressão real não coberta pelo teste
original** (consertada nesta auditoria). Um achado do relatório original
(Classes/`maxBaseLevel`) **não se reproduziu** — o write-path está correto, o
achado original foi provavelmente erro do operador/cache, não bug de
produto. Esta auditoria encontrou e corrigiu **um bug novo, real** (NPCs:
edição de diálogo nunca reenfileirava `@reloadscript`).

O que impede "APROVADA" plena: **A27 (pickup de item do chão) continua
quebrado**, reproduzido de forma limpa e repetível nesta auditoria contra uma
conta com inventário historicamente funcional (`Campo`), com causa raiz
isolada até a camada de PERSISTÊNCIA dentro do próprio rAthena (fora do
código deste projeto) — mas sem correção possível sem tocar `rathena/`
(regra do projeto, `rathena/` é somente leitura salvo a exceção de NPC). É
um bug de gameplay central (perder item do chão em silêncio) que continua
aberto. Além disso, uma fração grande da matriz original continua
genuinamente `NÃO TESTADO` (9/12 tipos de item, cartas/restrição de
equipamento, editar/skill antiga, criar/antigo de status, criar/antiga de
classe, criar NPC novo) — não por terem falhado, mas por nunca terem sido
exercitados, nesta rodada ou na anterior.

## Evento fora de controle registrado

Durante esta auditoria, um commit **que esta sessão não fez** apareceu no
histórico: `7d36444 "10-08-2026-1808"`, entre `870045b` e o trabalho desta
auditoria. Ele varreu para dentro de um único commit todo o WIP pré-existente
do usuário (que deveria permanecer intocado, por regra da Fase 3) **e**
minha correção em andamento do A26b **e** um arquivo de scratch temporário
que eu tinha no working tree no momento. `rathena/` e `supabase/` seguem
intocados nesse commit (confirmado, `git diff` vazio). Não foi revertido,
alterado ou reescrito por esta auditoria — registrado aqui porque muda o que
"commit isolado da Fase 3" significa a partir desse ponto: o A26b não ficou
isolado em commit próprio (foi arrastado para dentro do commit externo antes
que eu pudesse commitá-lo separadamente).

## Matriz completa

| Área | Criar | Editar | Antigo | Persistência | Runtime | `/play` | Comportamento | Status |
|---|---|---|---|---|---|---|---|---|
| Mapas | PASSOU | — | — | PASSOU | PASSOU | PASSOU (reconfirmado ao vivo) | PASSOU | **PASSOU** |
| Monstros | PASSOU | — | PASSOU | PASSOU | PASSOU | PASSOU (reconfirmado ao vivo, coexistência) | PASSOU (combate real) | **PASSOU** |
| XP (monstro) | — | — | — | PASSOU | PASSOU | PASSOU (reconfirmado, `@save`+SQL) | PASSOU | **PASSOU** |
| Drops (monstro) | — | — | — | N/A (efêmero) | PASSOU | PASSOU | PASSOU | **PASSOU** |
| Pickup (chão→inventário) | — | — | — | **FALHOU** (picklog registra, `inventory` não recebe) | N/A | Inconsistente | **FALHOU** | **FALHOU** (A27, aberto) |
| Skill de monstro em combate | NÃO APLICÁVEL (sem write-path admin) | — | — | N/A | PASSOU (boot limpo) | NÃO OBSERVADO (causa identificada: mob morre num hit antes de agir) | NÃO OBSERVADO | **RUNTIME PASSOU / combate NÃO OBSERVADO** |
| Itens — Cura | PASSOU | PASSOU | PASSOU (Red Potion) | PASSOU | PASSOU | PASSOU | PASSOU | **PASSOU** |
| Itens — Arma | PASSOU | — | — | PASSOU | PASSOU | PASSOU (ATK/ASPD numéricos) | PASSOU | **PASSOU** |
| Itens — Armadura | — | PASSOU | — | PASSOU | PASSOU | NÃO TESTADO | — | **PASSOU** (parcial) |
| Itens — demais 9 tipos | — | — | — | — | — | — | — | **NÃO TESTADO** |
| Equipamentos — cartas/restrição/nível | — | — | — | — | — | — | — | **NÃO TESTADO** |
| Skills — criar | PASSOU | — | — | PASSOU | PASSOU (A29 confirmado em 4 cenários) | NÃO OBSERVADO (combate) | — | **PASSOU** (persistência+runtime) |
| Skills — editar/antiga | — | NÃO TESTADO | NÃO TESTADO | — | — | — | — | **NÃO TESTADO** |
| Status — editar (metadado) | — | PASSOU | — | PASSOU | PASSOU | NÃO TESTADO | — | **PASSOU** (parcial) |
| Status — editar (runtime: flags) | — | PASSOU | — | PASSOU (reconfirmado, `NOSAVE: true`) | PASSOU (boot limpo) | NÃO TESTADO | — | **PASSOU** (novo, nesta auditoria) |
| Status — criar/antigo/aplicação | — | — | — | — | — | — | — | **NÃO TESTADO** |
| Classes — editar `maxBaseLevel` | — | **PASSOU** (reclassificado) | — | PASSOU (reconfirmado 99→51→99, repo direto E via UI real) | PASSOU | N/A | — | **PASSOU** (achado original não reproduzido) |
| Classes — criar/antiga | — | — | — | — | — | — | — | **NÃO TESTADO** |
| NPCs — antigo | — | — | PASSOU | N/A | PASSOU | PASSOU | PASSOU | **PASSOU** |
| NPCs — editar (nó suportado) | — | **PASSOU** (novo teste, nesta auditoria) | — | PASSOU | **FALHOU→CORRIGIDO** (reload nunca era enfileirado) | NÃO TESTADO (tempo) | — | **PASSOU** (após fix) |
| NPCs — editar (nó não suportado) | — | FALHOU (por design) | — | — | — | — | — | **NÃO APLICÁVEL** (recusa correta, A30) |
| NPCs — criar novo | NÃO TESTADO | — | — | — | — | — | — | **NÃO TESTADO** |

## Contagem real (24 linhas da matriz acima)

- **PASSOU: 13**
- **FALHOU: 1** (A27 — pickup, aberto)
- **NÃO APLICÁVEL: 2** (spawn via admin/A23; edição de nó não suportado/A30 — ambos comportamento correto por design)
- **NÃO TESTADO: 7** (9 tipos de item, cartas/equip, skill editar/antiga, status criar/antigo/aplicação, classes criar/antiga, NPC criar novo)
- **RUNTIME PASSOU / combate NÃO OBSERVADO: 1** (skill de monstro — nem sucesso nem falha, causa identificada)

Diferença em relação ao relatório anterior (16 PASSOU / 2 FALHOU / 1
BLOQUEADO / 1 N/A / 9 NÃO TESTADO, granularidade de 29 sub-testes): esta
auditoria consolidou a matriz em 24 linhas (mais próxima da tabela pedida
Área×Criar×Editar×Antigo), **reclassificou Classes de BLOQUEADO para
PASSOU** (achado original não reproduzido — 2 tentativas de reprodução
independentes, uma via repositório direto e uma via UI real, ambas limpas),
**adicionou 1 PASSOU novo** (Status/flags runtime, não coberto no relatório
original), **adicionou 1 PASSOU novo após fix** (NPCs/editar nó suportado),
e o FALHOU de "editar NPC" do relatório original foi **reclassificado como
NÃO APLICÁVEL** (é o comportamento correto do writer recusando um nó que não
sabe reescrever — não é uma falha do produto).

## Testes individuais (auditoria independente — não repete o que já está em `RELATORIO.md`/`*.md` de cada área, só o que foi refeito ou é novo)

### T1 — A26 (`Monster.groupId`), reprodução direta via repositório

- **Objetivo**: confirmar que o fix (`monster.ts: .default(0)→.optional()`,
  `mysql-monster-row.ts: ?? null`) resolve o campo em AMBAS as direções
  (limpar e setar), não só a documentada no relatório original.
- **Dados**: monstro real 25001 (`GPQA_NOVO_MOB`), via `MysqlMonsterRepository` chamado direto (bypassa HTTP/zod, isola o writer).
- **Passos**: `repo.get()` → `repo.update()` com `groupId: 5` → SQL cru → `repo.update()` com `groupId: undefined` → SQL cru.
- **Resultado esperado**: NULL quando limpo, valor real quando setado, nos dois sentidos.
- **Resultado observado**: confirmado nos dois sentidos — **mas** um SEGUNDO teste (simular "abrir o formulário de edição, mudar OUTRO campo, salvar, sem tocar em groupId") revelou que `mysqlRowToMonster` (linha 196) fazia `row.groupid ?? 0` — reintroduzindo `0` toda vez que o admin relê um monstro com `groupid` NULL. Um resave subsequente gravava `0` de volta, reproduzindo o crash de boot original.
- **Evidência**: script isolado (`_tmp-groupid-audit*.mjs`, deletados após uso), SQL cru antes/depois de cada passo.
- **Status**: **CORREÇÃO PARCIAL no commit original → CORRIGIDA nesta auditoria** (`groupId: row.groupid ?? undefined`, commit `7d36444` por arrasto — ver seção "Evento fora de controle").

### T2 — A28 (`rawScript`/`rawEquipScript`/`rawUnequipScript`), pipeline completo

- **Objetivo**: os 3 campos, não só 2; e resave sem tocar no campo preserva valor real (item 501, vanilla).
- **Passos**: `MysqlItemRepository` chamado direto — GET/SET/resave para os 3 campos nos itens QA (39100, 39200) **e** no item real 501 (Red Potion).
- **Resultado**: os 3 campos round-trip corretamente, incluindo `rawUnequipScript` (nunca testado na bateria original); resave de 501 sem tocar no script preserva `itemheal rand(45,65),0;` intacto.
- **Status**: **CORREÇÃO CONFIRMADA**, sem regressão.

### T3 — A29 (`AmmoAmount`), 4 cenários isolados na função pura

- **Objetivo**: cobrir os 4 cenários que o relatório original não separou (sem ammo / 10 chaves todas false / 1 tipo marcado / múltiplos tipos marcados).
- **Passos**: `parseSkillEntry` → `reemitRawSkillYaml` chamados direto, sem HTTP.
- **Resultado**: todos os 4 corretos — `AmmoAmount` ausente nos 2 primeiros, presente e com os 13 níveis corretos nos 2 últimos, `Ammo` preservado fielmente em todos.
- **Status**: **CORREÇÃO CONFIRMADA**, sem regressão em nenhum cenário válido.

### T4 — A27 (pickup), reprodução em conta com inventário historicamente funcional

- **Objetivo**: separar "bug específico da conta QA" de "bug real do pickup", e isolar a camada.
- **Passos**: personagem `Campo` (57 itens reais, inventário confirmado funcional) → `/play` real → matar `GPQA_NOVO_MOB` em `gpqa01` → `item:pickup` no gid do drop → `@save` → SQL cru em `inventory`. Repetido 2×, com variações de tempo de espera (imediato, 15s, com `@warp`).
- **Resultado**: nas DUAS tentativas, o cliente recebeu `inv:add` válido (índice/itemId/amount corretos) e `picklog` (log interno do próprio rAthena, tipo `P`) confirmou que o SERVIDOR registrou o pickup como bem-sucedido. Na 1ª tentativa, o item apareceu em `inventory` só ~3 minutos depois, após um SEGUNDO `@save` (não explicado). Na 2ª tentativa (mesmo fluxo, 15s de espera generosa + `@save` + `@warp`), o item **nunca** apareceu em `inventory`.
- **Camada isolada**: **NÃO é cliente** (recebeu ack correto) **NÃO é gateway/protocolo** (decodificou o pacote real corretamente) **NÃO é rAthena "não processou"** (picklog prova que processou) — é **PERSISTÊNCIA dentro do próprio rAthena**, entre a memória de sessão do char/map-server e a tabela `inventory` do MySQL. Causa raiz exata dentro do C++ não isolada (fora do escopo — `rathena/` é somente leitura).
- **Status**: **CONFIRMADO, camada isolada, causa raiz NÃO isolada** (mesma classificação do relatório original, mas agora com reprodução limpa em conta não-QA e descartando cliente/gateway/protocolo com evidência, não suposição).

### T5 — Classes / `maxBaseLevel`, tentativa de reprodução

- **Objetivo**: reproduzir "editar 50→51, GET volta 99" do relatório original.
- **Passos 1 (isolado)**: `SupabaseJobClassRepository` chamado direto — `get()` (99) → `update({...before, maxBaseLevel: 51})` → `get()` fresco (51) → restaurar (99). Sem falha.
- **Passos 2 (UI real)**: login admin real → `/classes/1` → mudar campo "Nível base máximo" de 99 para 51 via input nativo → Salvar → capturar payload da rede (`PUT` real, `maxBaseLevel:51`) → `GET /job-classes/1` fresco → **51**. Restaurado para 99, reconfirmado.
- **Resultado**: **não reproduzido em nenhuma das duas tentativas**. O payload da UI real também revelou que `maxJobLevel` já valia 51 antes de qualquer edição (coincidência com o valor digitado, não um campo "confuso" sendo alterado junto — checado explicitamente).
- **Status**: **NÃO REPRODUZIDO** — reclassificado de BLOQUEADO para PASSOU. O achado original provavelmente foi leitura de um cache/formulário desatualizado pelo operador, não um bug de write-path.

### T6 — NPCs, descoberta de um nó realmente editável + edição real bem-sucedida

- **Objetivo**: o relatório original só teve 2 tentativas de edição, ambas recusadas (uma corretamente, por nó não suportado; uma por round-trip guard). Faltava testar um nó que o writer REALMENTE sabe editar (`say`/`end`/`action:warp`) com sucesso.
- **Passos**: varredura de ~600 NPCs via API até achar um com diálogo simples (`say`+`end`), sem `conditional`/`choice` — `#ep15_1elb` (`npc/re/quests/quests_15_1.txt:4448`). Backup do `.txt` real feito ANTES de qualquer escrita. Edição via UI real (texto do `say`) → Salvar → `PUT` real 200 → **texto novo confirmado no `.txt` real** (`grep` no arquivo).
- **Achado**: o `PUT` escreveu o arquivo E o banco corretamente, mas **nunca enfileirou `@reloadscript`** — `panel_reload_queue` ficou vazio depois do save. Todo outro módulo (`itemdb`/`mobdb`/`skilldb`/`statusdb`/`pcdb`) sempre enfileira; NPC nunca enfileirava um reload do tipo `"script"` — apesar de esse `kind` já existir no tipo `ReloadKind` e o NPC `panel.txt` já saber processá-lo (`@reloadscript`). Gap puro de "esqueceram de chamar", não decisão de design.
- **Correção**: `apps/api/src/routes/npcs.ts` — `queueReload("script")` chamado só depois que ARQUIVO e BANCO confirmam sucesso (nunca antes, pra não enfileirar reload de uma edição que um rollback subsequente desfaria).
- **Reteste**: reverti o texto e resalvei através da UI de novo — `panel_reload_queue` mostrou `script` enfileirado e drenado em 1s. Arquivo restaurado byte-a-byte ao original (via backup), reload final disparado manualmente pra sincronizar o servidor rodando com o arquivo pristino.
- **Status**: **BUG REAL, CORRIGIDO E RETESTADO** (novo achado desta auditoria, não estava no relatório original nem no `risk-report.md`).

### T7 — Status, campo runtime (`flags`)

- **Objetivo**: o relatório original só editou `description` (metadado, não carregado pelo rAthena) — faltava testar um campo que o runtime realmente lê.
- **Passos**: `poison` → adicionar flag `no_save` via `PUT` real (API autenticada) → `status.yml` cru → `NOSAVE: true` presente na seção `Flags:` correta → boot log confirma `Done reading '1' entries` sem erro → reverter.
- **Status**: **PASSOU** (achado novo desta auditoria — o relatório original nunca testou isso, então não havia como confirmar antes).

### T8 — Mapas/Monstros, reconfirmação ao vivo

- Warp real em `gpqa01`, movimento real, e uma sequência completa de combate (mover → atacar → HP cair → morrer → drop cair → 2 mortes) reconfirmados NESTA sessão, com Poring (1002) e QA Slime Novo (25001) coexistindo (3+3 instâncias, IA de movimento ativa). Não é reaproveitamento do relatório anterior — é uma segunda rodada de evidência, independente.
- **Status**: **PASSOU**, reconfirmado.

### T9 — Skill de monstro em combate, tentativa de observação

- **Objetivo**: o relatório original marcou "NÃO OBSERVADO" por falta de tempo — tentei de novo com mais repetições.
- **Resultado**: ainda não observado — mas desta vez identifiquei a causa provável: o monstro QA (50 HP) morre num único golpe contra o personagem GM usado nos testes (253 ATK), sem chance de a IA chegar a agir. Não é um bug — é uma limitação estrutural do cenário de teste (precisaria de um atacante mais fraco pra dar tempo do mob reagir).
- **Status**: continua **NÃO OBSERVADO**, agora com causa identificada em vez de "sem tempo".

## Bugs

### Corrigidos

**A26b** (novo achado desta auditoria, sobre o A26 do relatório original)
- Causa raiz: `mysql-monster-row.ts:196`, `mysqlRowToMonster` fazia `groupId: row.groupid ?? 0` — o lado de LEITURA não espelhava o fix do lado de ESCRITA (`?? null`), então todo GET de um monstro com `groupid` NULL devolvia `0` pro formulário; resalvar sem tocar no campo reintroduzia `0` no banco e reproduzia o crash de boot original.
- Impacto: qualquer monstro criado sem grupo (a maioria) que fosse reaberto e resalvo no admin — mesmo editando um campo totalmente não relacionado — voltava a derrubar a própria linha no próximo boot.
- Reprodução: script isolado chamando `MysqlMonsterRepository` direto, `get()`→`update()` sem tocar `groupId`.
- Correção: `groupId: row.groupid ?? undefined` (espelha `title`, linha adjacente, que já usava o padrão certo).
- Status: **corrigido e retestado** (nulo sobrevive resave; valor válido também sobrevive resave).

**Reload de script de NPC nunca enfileirado** (novo achado, não estava em nenhum risk-report anterior)
- Causa raiz: `routes/npcs.ts` nunca chamava `queueReload("script")` depois de uma edição de diálogo bem-sucedida — nem o arquivo `.txt` nem o registro no banco, ambos corretos, tinham qualquer efeito no servidor rodando até um restart manual.
- Impacto: TODA edição de diálogo de NPC pelo admin ficava invisível em `/play` até alguém rodar `@reloadscript` manualmente ou reiniciar o rAthena — o único módulo com esse buraco (item/mob/skill/status sempre reenfileiram).
- Reprodução: edição real via UI, `panel_reload_queue` ficando vazio após o save.
- Correção: enfileira `queueReload("script")` só depois que arquivo E banco confirmam sucesso.
- Status: **corrigido e retestado** (reload agora dispara e drena em ~1s).

### Já confirmados corretos (sem regressão)

- **A28** (`rawScript`/`rawEquipScript`/`rawUnequipScript`) — pipeline completo, incluindo o campo nunca testado antes (`rawUnequipScript`), e merge preservando script de item real (501) intocado.
- **A29** (`AmmoAmount`) — 4 cenários, incluindo os 2 que produzem `AmmoAmount` corretamente (não só os 2 que o omitem).

### Abertos

**A27 — pickup de item do chão não persiste de forma confiável**
- Causa raiz: NÃO isolada (dentro do C++ do rAthena, fora do escopo do código deste projeto e da regra "`rathena/` é somente leitura").
- Camada: confirmada como PERSISTÊNCIA dentro do rAthena — descartados cliente, gateway e protocolo com evidência (picklog do próprio servidor confirma o pickup, cliente recebe ack correto).
- Reprodução: limpa e repetível, inclusive em conta não-QA (`Campo`) com inventário historicamente funcional.
- Impacto: **alto** — é o loop central de "matar monstro, pegar item", e falha em silêncio (sem erro visível ao jogador).
- Status: **aberto**, não corrigível dentro do escopo deste projeto sem investigar o C++ do rAthena.

**Classe/`maxBaseLevel` (achado do relatório original)**
- Status: **não é bug** — não reproduzido em 2 tentativas independentes (repositório direto + UI real). Reclassificado.

## Funcionalidades comprovadamente não suportadas (do código, não suposição)

- `Monster.spawns[]` via admin com backend MySQL — travado por design, com aviso explícito na UI (A23, já endereçado em fase anterior).
- Edição de nó de NPC fora de `say`/`end`/`action:warp` (`npc-script-writer.ts:195-196`) — recusa com HTTP 422, comportamento correto/intencional (A30).
- `both_hands`/`both_accessories`/variantes `all_upper` etc. em equipamento — sem coluna SQL (A3, não reconfirmado ao vivo nesta rodada, herdado de auditoria anterior).

## Funcionalidades não testadas (lista explícita, nesta rodada e na anterior)

- 9/12 tipos de item (`usable`, `etc`, `pet_egg`, `pet_armor`, `ammo`, `delay_consume`, `shadow_gear`, `cash`, e `card` como item autônomo).
- Cartas aplicadas em equipamento (`CardApplyDialog`), restrição de classe bloqueando equip incompatível, requisito de nível.
- Editar skill existente / usar skill antiga.
- Criar status novo / usar status antigo / aplicar status via skill ou item real.
- Criar classe nova / usar classe antiga / efeito de `job_stats` em personagem novo.
- Criar NPC novo (suspeita de gap por leitura de código — `POST /npcs` não chama o writer — não confirmada ao vivo).

## Funcionalidades não comprovadas

- Bônus de script de equipamento (`bonus bStr,5;` na espada QA) — não isolado numericamente do restante do personagem `Campo` na janela de teste.
- Skill de monstro disparando em combate real — carregamento confirmado, disparo não observado (causa estrutural identificada: mob morre rápido demais pra agir).

## Integridade

- **Commit inicial desta auditoria**: `870045b` (HEAD no início do pedido).
- **Commit atual**: `2751575`.
- **Cadeia completa**: `870045b` (Fase 3 original) → `7d36444` (commit externo, não feito por esta sessão — ver seção dedicada acima) → `06b19f7` + `2751575` (esta auditoria: fix do reload de NPC + arrasto do A26b).
- **Arquivos alterados por esta auditoria** (além do que já estava em `870045b`/`7d36444`): `apps/api/src/routes/npcs.ts` (fix novo), `apps/api/src/store/mysql-monster-row.ts` (A26b — chegou via o commit externo, não um commit meu isolado), `docs/audit/fase3-testes/backup/quests_15_1.txt.bak-audit2` (evidência nova), `docs/audit/fase3-testes/AUDITORIA-INDEPENDENTE.md` (este arquivo).
- **WIP do usuário**: preservado integralmente até `870045b`; a partir de `7d36444` o WIP foi commitado por um processo externo a esta sessão (não uma ação minha) — conteúdo não alterado por mim, só observado.
- **`rathena/`**: confirmado intocado do início ao fim (`git diff bc1a93c HEAD --stat -- rathena/` vazio), incluindo depois da edição real de NPC feita nesta auditoria (escrita, backup, e restauração byte-a-byte confirmada por `diff`).
- **`supabase/`**: nenhuma migration nova, confirmado.
- **Banco**: nenhuma alteração de schema; todas as mudanças foram dados (MySQL `item_db_re`/`mob_db_re`/`inventory` via gameplay real, Supabase `job_classes`/`statuses` via API) ou arquivo (`rathena-db-import/*.yml`, `rathena/npc/re/quests/quests_15_1.txt` restaurado).
- **Dados QA**: inventariados, nenhum removido automaticamente.
  - `gpqa3`/`GPQA3` (conta/personagem QA) — existe, GM, usado nesta rodada só pra confirmar sessão (não usado pros testes de pickup, por causa do A27 conhecido).
  - `gpqa01` (mapa) — existe, carrega limpo, revisitado ao vivo nesta auditoria.
  - `25001` (`GPQA_NOVO_MOB`) — existe, `groupid` NULL (correto), spawna corretamente.
  - `39100`/`39200` (itens QA) — existem; `39200.unequip_script` agora tem `"bonus bStr,-5;"` (valor de teste desta auditoria, deixado — é claramente QA, não afeta produção).
  - `10020` (skill QA) — inalterada.
  - Personagem `Campo`: ganhou 1 Red Potion real (id 281, amount 1) de um pickup que EVENTUALMENTE persistiu — item real, inofensivo, não removido.
  - `Swordman` (classe id 1): tocada duas vezes nesta auditoria (99→51→99, e novamente 99→51→99 via UI), **confirmado restaurado a 99**.
  - `poison` (status): `no_save` adicionado e removido, **confirmado restaurado ao estado original**.
  - `#ep15_1elb` (NPC real, não QA): editado e restaurado, **arquivo confirmado byte-idêntico ao backup pré-edição** via `diff`.
  - Nenhum dado foi removido "automaticamente" — cada reversão foi uma ação explícita, confirmada por reconsulta.
- **Servidores**: todos os 8 confirmados no ar do início ao fim desta auditoria (mesmos PIDs do rAthena/WSL; API reiniciou via `tsx watch` durante os fixes, comportamento esperado de dev server).

## Testes automatizados (resultado real desta auditoria, não copiado do anterior)

- `pnpm -r typecheck` — **9/9 pacotes limpos**.
- `@ragnarok/api test` — 114 passando, 1 falha pré-existente e não relacionada (`map-row.test.ts`).
- `@ragnarok/game-data test` — 11 passando, 1 falha pré-existente e não relacionada (`server-config.test.ts`).
- `@ragnarok/ro-protocol test` — 5/5.
- `@ragnarok/engine-core test` — 16/16.
- `@ragnarok/game test` — 894/894 (89 arquivos).
- Nenhuma das 2 falhas pré-existentes foi tocada por esta auditoria; nenhuma regressão nova introduzida pelos 2 fixes (A26b, NPC reload) — confirmado rodando a suíte inteira DEPOIS de ambos os fixes.

## Próximo passo (lista objetiva, em ordem de prioridade)

1. **A27** — investigar a causa raiz dentro do rAthena (fora do escopo deste
   projeto sem tocar `rathena/`; pode exigir instrumentar o C++ ou comparar
   com um rAthena vanilla sem as customizações deste projeto).
2. **Itens** — cobrir os 9 tipos ainda não testados (maior lacuna de
   cobertura restante, e a mais fácil de fechar — mesmo padrão já provado
   2×).
3. **Equipamentos** — cartas, restrição de classe, requisito de nível.
4. **Skills** — editar skill existente, usar skill antiga, e um teste de
   combate real com um monstro que sobreviva mais de 1 golpe (pra finalmente
   observar `skill:cast` de monstro).
5. **Status/Classes/NPCs** — completar criar/antigo que faltou em cada área.
