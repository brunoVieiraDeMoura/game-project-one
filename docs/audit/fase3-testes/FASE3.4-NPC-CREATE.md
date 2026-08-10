# Fase 3.4 — Criação real de NPC pelo admin

Executada 2026-08-10, a partir do commit `35b0c19`. Objetivo: transformar o
gap confirmado na Fase 3.3 ("`POST /npcs` só grava catálogo, nunca produz
NPC jogável") numa capacidade real — ADMIN → banco → arquivo → reload →
rAthena → `/play` → interação — sem tocar `rathena/`, sem redesign.

## 1. Estado inicial

HEAD `35b0c194995f86ac8a4ef024539d82edf67fdffd`, árvore limpa. Servidores:
login `5504`, char `5508`, map `7084` (o PID sobrevivente do restart de
recuperação da Fase 3.3). Confirmado antes de qualquer alteração.

## 2. Arquitetura encontrada (auditoria pré-implementação)

- **Schema** (`packages/game-data/src/npc.ts`): `Npc.legacyRef` já é
  `optional()` — um NPC sem arquivo real já era um estado representável no
  schema, só nunca produzido corretamente pela API.
- **Writer de EDIÇÃO** (`npc-script-writer.ts`, `planNpcWrite`): opera por
  DIFF — recebe `before` (grafo lido de um `.txt` já existente, via
  `mapNpcScriptWithUnits(parseNpcScript(...))`) e `after` (o que o admin
  mandou), reconstrói só os trechos que mudaram por fatia de byte. **Não
  existe "before" pra um NPC que ainda não existe** — confirmado lendo o
  código inteiro, não só a assinatura: não há, em lugar nenhum, uma função
  que escolha um arquivo de destino e escreva um NPC do zero.
- **`locateNpcScript`** (`npc-script-locate.ts`): exige `legacyRef` já
  apontando pra um arquivo REAL existente — não serve pra criação.
- **`POST /npcs`** (antes desta Fase): `repo.create(body.data)` puro, sem
  chamar nenhum writer — confirmado por leitura direta, sem suposição.
- **`PUT /npcs/:id`** (Fase 3.2, já corrigido): chama `applyNpcScriptEdit`
  → `planNpcWrite`, escreve em `rathena/npc/...` (raiz `npcScriptRoot`,
  única exceção deliberada à regra "`rathena/` é somente leitura") e
  enfileira `queueReload("script")` só depois que arquivo E banco
  confirmam sucesso.
- **Fluxo alternativo de criação já usado pelo projeto**: nenhum — todo
  NPC customizado (`devmenu.txt`, `panel.txt`, `mobs/gpqa01.txt` da Fase
  3) foi escrito à mão. `tools/legacy-migration` só faz `.txt` → JSON,
  nunca o inverso.
- **NPC real de exemplo estudado**: `npc-idle/devmenu.txt:17` —
  `prt_fild08,170,373,4\tscript\tMestre do Teste#idlenarok\t4_M_ALCHE_C,{`
  — cabeçalho `mapa,x,y,dir⇥script⇥Nome#sufixo⇥SPRITE,{`, corpo indentado
  com 1 tab, fecho `}` na própria linha. O `#sufixo` depois do nome nunca
  aparece pro jogador (convenção real do rAthena, confirmada em
  `Mestre do Teste#idlenarok` exibindo só "Mestre do Teste" em `/play`).

## 3. Limitações encontradas (documentadas, não contornadas)

- `applyNpcScriptEdit`/`planNpcWrite` são fundamentalmente um EDITOR, não
  um CRIADOR — reaproveitados só nos pedaços PUROS (impressão de folha:
  `printLeaf`/`escapeString`, exportados desta rodada, reaproveitados sem
  duplicar lógica), nunca no motor de diff inteiro (que pressupõe
  "antes").
- **`@reloadscript` não pega arquivo novo confiavelmente** — achado ao
  vivo (não estava documentado antes): mesmo com o arquivo já registrado
  em `map_conf.txt` desde o boot (vazio, carregado com 0 NPCs), anexar
  conteúdo novo e mandar `@reloadscript` NÃO tornou o NPC visível em
  `/play` (confirmado: `window.__world()` não listava a entidade). Só
  depois de um RESTART COMPLETO o NPC apareceu. Isto é DIFERENTE do que a
  Fase 3.2 provou pra EDIÇÃO (onde `@reloadscript` sozinho bastou,
  repetidamente) — a diferença aparente é "nó modificado dentro de um
  script já carregado" vs. "declaração de NPC inteira nova". Registrado
  como limitação real do fluxo de criação, não corrigido nesta rodada
  (exigiria investigar o C++ do `@reloadscript`, fora do escopo — `não
  mexer em rathena/`).

## 4. Decisão do MVP

Escopo implementado: NPC de diálogo simples, cadeia LINEAR
`say → say/action:warp → end`, com `next;` entre páginas de texto e
`close;` quando um `say` cai direto num `end`. **Não implementado**
(recusado com motivo explícito, nunca uma tentativa de gerar sintaxe
nova): `choice` (ramificação com reconvergência — extensão real de
escopo, não a base pedida), `conditional`, `legacyScript`, `shop`, NPC do
tipo `warp`, `duplicateOf`, `eventHandlers`. `action:warp` SUPORTADO
(reaproveita `printLeaf`, mesma folha que a edição já sabe imprimir).

## 5. Arquivos alterados

```
packages/game-data/src/rathena/npc-script-generate.ts   (novo — gerador puro)
packages/game-data/src/rathena/npc-script-writer.ts      (export de escapeString/printLeaf, sem mudar comportamento)
packages/game-data/src/index.ts                          (+1 export)
apps/api/src/store/npc-script-create.ts                  (novo — ponte fs, anexa+rollback)
apps/api/src/store/npc-script-create.test.ts              (novo — 6 testes unitários)
apps/api/src/routes/npcs.ts                               (POST reescrito; PUT ganhou seleção de raiz)
apps/api/src/routes/npcs.test.ts                          (atualizado pra semântica nova — ver §18)
apps/api/src/server.ts                                    (novo dep npcCreateRoot; mapRepository reordenado)
rathena-conf/map_conf.txt                                 (+1 linha: registra npc-idle/admin-created.txt)
npc-idle/admin-created.txt                                (novo — arquivo real onde NPCs criados vivem)
```

**Nenhum arquivo em `rathena/` alterado.**

## 6. Fluxo ADMIN → DB → FILE → RELOAD → RUNTIME → `/play`

1. `POST /npcs` valida schema, checa id duplicado (`repo.get` antes de
   escrever), valida `mapId`/coordenada contra o catálogo real de mapas
   (`mapRepository`, achado novo — rejeita mapa inexistente e coordenada
   fora dos limites, `width`/`height` reais).
2. `generateNpcScript` (puro, `game-data`) gera cabeçalho + corpo,
   recusando qualquer estrutura fora do MVP (§4) com motivo explícito.
3. `applyNpcScriptCreate` (fs) anexa ao FIM de `npc-idle/admin-created.txt`
   (nunca edita o que já está lá), calcula `legacyRef` real
   (`"admin-created.txt:N"`, N = linha exata do cabeçalho — verificado em
   teste unitário).
4. `repo.create()` grava o catálogo com o `legacyRef` computado (nunca o
   que o cliente mandou — sempre recalculado pelo servidor).
5. Se o banco falhar depois do arquivo já escrito: `rollbackNpcScriptCreate`
   restaura o arquivo pro estado anterior (mesmo padrão do PUT).
6. `queueReload("script")` — confirmado DRENADO (`done_at` setado, não só
   enfileirado) via SQL direto.
7. **Runtime**: confirmado que o reload sozinho NÃO bastou (§3) — precisou
   de restart completo pra o NPC aparecer.
8. **`/play`**: NPC confirmado na lista de entidades reais
   (`window.__world()`), interação completa via os mesmos eventos de rede
   de um clique real (`npc:talk`→`npc:dialog`).
9. **Edição posterior**: `legacyRef` sem prefixo `"npc/"` → `PUT` agora
   sabe rotear pra `npcCreateRoot` em vez de `npcScriptRoot` — o mesmo
   Writer da Fase 3.2/3.3 passa a servir NPC criado pelo admin também, sem
   duplicar lógica de edição.

## 7-13. NPC criado (evidência real)

- **ID**: `GPQA_NOVO_NPC`
- **Nome**: `QA Novo NPC` (exibido em `/play` como
  `QA Novo NPC#GPQA_NOVO_N` — truncamento de EXIBIÇÃO do cliente no nome
  completo com sufixo, não do dado real; texto do diálogo em si não foi
  truncado, confirmado abaixo)
- **Mapa**: `gpqa01`
- **Coordenadas**: `[65, 65, 0]`, direção `4`
- **Sprite**: `4_M_ALCHE_C` (mesmo sprite real de `devmenu.txt`, já
  comprovadamente válido)
- **Script gerado** (`npc-idle/admin-created.txt:10`):
  ```
  gpqa01,65,65,4	script	QA Novo NPC#GPQA_NOVO_NPC	4_M_ALCHE_C,{
  	mes "Ola! Eu sou um NPC criado pelo admin.";
  	close;
  }
  ```
- **Evidência de banco**: `GET /npcs/GPQA_NOVO_NPC` → todos os campos
  batendo, `legacyRef:"admin-created.txt:10"`.
- **Evidência de arquivo**: `cat -A` confirmou tabs/sem CRLF, linha 10 é
  exatamente o cabeçalho esperado.
- **Evidência de reload**: `panel_reload_queue` linha `script`,
  `requested_at`/`done_at` ambos setados (~2s de drenagem).
- **Evidência de runtime**: após restart completo, `window.__world()`
  lista a entidade real (`gid 110000004, tipo:"npc", celula:[65,65]`).
- **Evidência de `/play`**: `npc:talk` → `npc:dialog` real com
  `{kind:"text", text:"Ola! Eu sou um NPC criado pelo admin."}` seguido de
  `{kind:"close"}` — texto EXATO configurado, close automático (sem
  `next;` intermediário, porque só havia 1 página de texto).

## 14-17. Testes

| # | Teste | Status |
|---|---|---|
| 1 | Geração pura round-trip (gerar→reparsear→grafo idêntico) — say/end | **PASSOU** |
| 2 | Geração pura round-trip — cadeia com `action:warp` | **PASSOU** |
| 3 | Geração recusa `choice` com motivo explícito | **PASSOU** |
| 4 | Geração recusa `say` sem `.next` (grafo incompleto) | **PASSOU** |
| 5 | `applyNpcScriptCreate` recusa quando arquivo de destino não existe | **PASSOU** |
| 6 | `applyNpcScriptCreate` anexa bloco correto, `legacyRef` aponta pra linha certa | **PASSOU** |
| 7 | `applyNpcScriptCreate` NÃO toca o arquivo quando geração é recusada | **PASSOU** |
| 8 | `applyNpcScriptCreate` recusa id inseguro (`#sufixo` com espaço) sem tocar arquivo | **PASSOU** |
| 9 | Múltiplas criações sequenciais não se atropelam | **PASSOU** |
| 10 | Rollback restaura conteúdo exato pré-escrita | **PASSOU** |
| 11 | `POST /npcs` real (dialogueNpc) → 201, listagem/filtro/busca corretos | **PASSOU** |
| 12 | `POST /npcs` com `legacyRef` já presente (reimportação) preserva comportamento antigo (catálogo puro) | **PASSOU** |
| 13 | `POST /npcs` id duplicado → 409 | **PASSOU** |
| 14 | `POST /npcs` warp-type (sem geração suportada) → 422, catálogo intocado | **PASSOU** |
| 15 | **Ao vivo**: criar `GPQA_NOVO_NPC` → banco/arquivo/reload confirmados | **PASSOU** |
| 16 | **Ao vivo**: `/play`, entidade visível após restart | **PASSOU** (com ressalva: reload sozinho não bastou, §3) |
| 17 | **Ao vivo**: `/play`, interação completa (`npc:talk`→texto real→`close`) | **PASSOU** |
| 18 | **Negativo**: mapa inexistente → 400, nada escrito | **PASSOU** |
| 19 | **Negativo**: coordenada fora dos limites do mapa → 400, nada escrito | **PASSOU** |
| 20 | **Negativo**: id duplicado (ao vivo) → 409 | **PASSOU** |
| 21 | **Negativo**: campo obrigatório ausente → 400 | **PASSOU** |
| 22 | **Regressão**: map-server continua vivo após todos os negativos | **PASSOU** |
| 23 | **Regressão**: NPC antigo (`Mestre do Teste`) continua funcionando | **PASSOU** |
| 24 | **Regressão**: edição de NPC (Fase 3.2) não quebrou | **PASSOU** (suíte automatizada, `npcs-writer.test.ts` 12/12) |
| 25 | `choice`/`conditional`/`eventHandlers`/`shop`/`warp`-NPC criáveis | **NÃO APLICÁVEL** — fora do MVP declarado, recusados com motivo, não uma falha |
| 26 | Personagem interagindo com NPC criado dentro de uma quest real | **NÃO TESTADO** — fora do escopo (NPC criado não tem `questTriggers` configurados) |

## 18. Problemas encontrados e corrigidos DURANTE esta implementação

**Achado 1 — heurística de raiz por prefixo `"npc/"` era falso-positiva.**
Primeira versão de `scriptRootFor` decidia a raiz (`npcScriptRoot` vs.
`npcCreateRoot`) por `legacyRef.startsWith("npc/")`. Fixtures de teste
(`npcs-writer.test.ts`) usam nomes de arquivo arbitrários (`"a.txt"`) sem
esse prefixo — a heurística mandava esses testes pra
`npcCreateRoot` (default: `npc-idle/`, o diretório REAL do projeto) em vez
do tmpdir isolado do teste. **Resultado real observado**: rodar a suíte de
testes escreveu dezenas de blocos de teste (`n1#n1`, `na#na`, texto "ola
EDITADO" etc.) dentro do `npc-idle/admin-created.txt` de verdade.
Corrigido pra uma checagem POSITIVA exata
(`legacyRef.startsWith("admin-created.txt:")`) antes de qualquer teste
rodar de novo com sucesso; arquivo real limpo manualmente (restaurado ao
cabeçalho original) depois de cada rodada de teste até a correção pegar.
Confirmado, com `md5sum` antes/depois, que a suíte completa RODANDO DE
NOVO já não toca mais o arquivo real.

**Achado 2 — `POST /npcs` com `legacyRef` já presente quebrava o uso
existente de reimportação.** `npcs-writer.test.ts` usa `POST` pra SEMEAR
um NPC que já tem `legacyRef` apontando pro `.txt` de teste (simulando
reimportação/migração), não pra criar um script novo. A primeira versão
do `POST` sempre tentava gerar um script novo, ignorando um `legacyRef`
já enviado — quebrando esse uso legítimo (12 testes falhando). Corrigido:
`POST` agora ramifica — `legacyRef` presente no payload = catálogo puro
(comportamento pré-Fase-3.4, preservado); `legacyRef` ausente = criação
de verdade (geração de script). Nenhum código de produção fora dos testes
dependia do comportamento antigo diretamente, mas a ramificação é
necessária pra não quebrar o padrão de reimportação que o projeto já usa.

Os dois achados foram encontrados e corrigidos DENTRO desta mesma etapa,
antes de qualquer teste ao vivo contra o servidor real — nenhum dos dois
chegou a afetar `rathena/` nem a base MySQL/Supabase de produção.

## 19. Funcionalidades ainda não suportadas (evidência, não suposição)

- `choice`/`conditional`/`eventHandlers`/`shop`/NPC tipo `warp`/
  `duplicateOf` — recusados explicitamente por `generateNpcScript`
  (`unsupported-node-kind`), nenhuma tentativa de gerar sintaxe pra eles.
- `@reloadscript` sozinho não é suficiente pra um NPC CRIADO (precisa de
  restart completo) — diferente de EDIÇÃO, onde já é suficiente (Fase
  3.2). Causa raiz não investigada (C++ do rAthena, fora do escopo).

## 20-21. Estado de `rathena/` e `supabase/`

`git diff bc1a93c HEAD --stat -- rathena/ supabase/` — **ambos vazios**,
cobrindo toda a história desde antes da Fase 3, incluindo esta etapa.

## 22. Migrations

Nenhuma.

## 23. Estado dos servidores (final)

| Porta | Serviço | PID |
|---|---|---|
| 3000/3001/4000/4100 | admin/game/api/gateway | inalterados (api reiniciou via tsx watch, esperado) |
| 6901/6122/5122 | login/char/map | `7691`/`7695`/`7699` — **1 restart completo** feito de propósito nesta etapa (registrar `admin-created.txt` em `map_conf.txt` exige boot, não só reload — igual ao que a Fase 3 fez pra `gpqa01.txt`) + **1 segundo restart** pra confirmar a hipótese do §3 (reload sozinho não bastou pro NPC aparecer). Ambos limpos, boot completo (`Map Server is now online`), zero jogador online durante os dois. |

## 24. Testes automatizados

- `pnpm -r typecheck` — **9/9 pacotes limpos**.
- `@ragnarok/api test` — **121 passando** (era 114 antes desta Fase — +7:
  6 novos em `npc-script-create.test.ts`, +1 novo em `npcs.test.ts`), 1
  falha pré-existente e não relacionada (`map-row.test.ts`).
- `@ragnarok/game-data test` — 11/12 (1 falha pré-existente, mesma de
  sempre).
- `@ragnarok/ro-protocol test` — 5/5.
- `@ragnarok/engine-core test` — 16/16.
- `@ragnarok/game test` — 894/894.
- Confirmado: A26/A26b, A28, A29, reload de NPC (Fase 3.2/3.3) continuam
  corretos — `npcs-writer.test.ts` (edição) 14/14, `npc-script-sync.*`
  14/14.

## 25. Dados QA criados/modificados

- NPC `GPQA_NOVO_NPC` — criado, real, funcional, deixado no ar (evidência
  viva, mesma convenção de dado QA das fases anteriores).
- 4 tentativas negativas (`GPQA_NEG_MAP`, `GPQA_NEG_COORD`,
  `GPQA_NOVO_NPC` duplicado, `GPQA_NEG_FIELD`) — nenhuma persistiu (todas
  rejeitadas antes de qualquer escrita), nada a limpar.
- `npc-idle/admin-created.txt` — arquivo novo, permanente, contém só o
  cabeçalho + o bloco real do `GPQA_NOVO_NPC` (confirmado limpo de
  qualquer resíduo de teste via `md5sum` antes/depois da suíte completa).

## 26. Nada a restaurar

Nenhum dado de fases anteriores foi tocado. `rathena-conf/map_conf.txt`
ganhou 1 linha nova (registro permanente, não uma mudança de teste) — não
há "estado anterior" a restaurar ali, é uma adição definitiva de
configuração do projeto.
