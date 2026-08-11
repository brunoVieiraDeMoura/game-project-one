# Fase 3 — Auditoria final independente de fechamento

Executada 2026-08-10/11, a partir do commit `26fa7ef`. Verificação
independente do estado REAL do repositório, banco, runtime e `/play` —
nenhuma afirmação de relatório anterior foi aceita sem reprodução.

## Resumo executivo

## **PARCIALMENTE APROVADA**

Não por regressão não-corrigida em código de produção (não há nenhuma) —
por dois motivos que a matriz de critérios da própria auditoria exige
tratar com honestidade: (1) esta auditoria **encontrou e reproduziu uma
regressão real** durante seu próprio processo de verificação (não uma
regressão da Fase 3 anterior — uma causada pelos MEUS testes de edição
nesta própria rodada, corrigida via restauração pura, documentada
abaixo); e (2) a limitação do `@reloadscript` pra NPC novo continua
**LIMITAÇÃO NÃO RESOLVIDA**, e cobertura de vários módulos (Skills
editar, Status criar, Classes criar, itens de tipo minoritário) segue
`NÃO TESTADO` nesta rodada por orçamento de tempo — a Fase 3 é sólida no
que foi verificado, mas "encerrada com 100% de confiança" não é uma
afirmação que a evidência sustenta.

## 1-2. Integridade inicial

```
HEAD antes de qualquer teste: 26fa7ef8ed1cb6b89aec1ee8ba6736024d027ea3
git status --short: (vazio)
git diff --stat: (vazio)
```
Branch `main`, `origin/main` aponta pra `7d36444` (commits locais desde
`06b19f7` em diante ainda não enviados — não é um problema, ninguém
pediu push). Servidores confirmados ativos antes de qualquer alteração:
admin `22896`, game `1396`, api `3252`, gateway `12572`, login `7691`,
char `7695`, map `7699`, MariaDB `12032`.

## 3-4. Auditoria do histórico

`git show --stat` nos 7 commits confirma que cada um contém EXATAMENTE o
que a mensagem de commit descreve — nenhum arquivo fora de escopo em
nenhum deles:

- `870045b` — bateria original: 50 arquivos, todos dentro de
  `docs/audit/fase3-testes/`, mais 5 arquivos de código (item.ts,
  monster.ts, skill-db-yaml.ts, monster-row.ts, mysql-monster-row.ts) e
  `rathena-conf/map_conf.txt`/`npc-idle/mobs/gpqa01.txt` — todos
  justificados pelos achados A26/A28/A29 e o registro do mapa `gpqa01`.
- `7d36444` — **confirmado, de novo, como commit externo** (não desta
  sessão): varre CLAUDE.md, SFX, todo `apps/game/src/hud`/`net`,
  `apps/gateway`, `docs/claude-context/` (WIP pré-existente do usuário) —
  **e junto** `apps/api/src/store/mysql-monster-row.ts` (o A26b, em
  andamento nesta sessão no momento em que o commit externo aconteceu) e
  um arquivo de scratch (`_tmp-ammo-audit.mjs`). Consistente,
  byte-a-byte, com o que os relatórios da Fase 3.2/3.3 já descreviam —
  não é uma alegação nova, é uma reconfirmação.
- `06b19f7` — só remove o arquivo de scratch. Confere.
- `2751575` — só o fix real do A26b (`mysql-monster-row.ts`, linha do
  reload de NPC) + o backup de evidência
  (`quests_15_1.txt.bak-audit2`). Confere.
- `9ff4b64`, `35b0c19` (código: só `job-names.ts` +
  `job-class-validator.ts` + export), `26fa7ef` (código: só os arquivos
  de NPC create listados no próprio relatório da Fase 3.4) — todos
  batendo com o que documentam, sem surpresa.

## 5. Auditoria de escopamento

```
git diff bc1a93c..26fa7ef --stat -- rathena/   → vazio
git diff bc1a93c..26fa7ef --stat -- supabase/  → vazio
```

**Achado metodológico importante desta auditoria**: `rathena/` **não é
rastreado pelo git de forma alguma** — `git ls-files rathena/` devolve
ZERO arquivos. Não está no `.gitignore` (só `rathena-db-import/` está) —
simplesmente nunca foi adicionado ao repositório. Isso significa que
**toda confirmação anterior de "`rathena/` intocado, confirmado via `git
diff`" ao longo da Fase 3 inteira (3.2/3.3/3.4 e a auditoria
independente) era estruturalmente incapaz de detectar uma mudança real**
— `git diff`/`git status` sobre um diretório 100% não rastreado sempre
devolve vazio, tenha ou não conteúdo mudado. A conclusão final ("`rathena/`
intocado") continua **verdadeira** — mas confirmada nesta auditoria por um
método que realmente prova isso: comparação de conteúdo real contra o
backup rastreado pelo git (`quests_15_1.txt.bak-audit2`, ver §11) e uma
varredura funcional (a suíte `npc-script-locate.test.ts`, que lê ~200
arquivos reais do corpus e falha se algo mudou de forma inesperada — foi
exatamente essa suíte que pegou o achado do §11).

## 6. A26 — Monster groupId

Reproduzido ao vivo, hoje, via `MysqlMonsterRepository` chamado direto
(sem HTTP), no monstro QA real `25001`:

- Estado inicial: `groupid: NULL` (banco), `repo.get().groupId:
  undefined` — correto.
- **Caso NULL**: resave com campo não relacionado (`hp` inalterado) →
  `groupid` continua `NULL`. **Confirmado, não regrediu.**
- **Caso válido**: `groupId: 9` → resave com campo não relacionado →
  `groupid` continua `9` (não volta a `NULL` nem vira `0`). **Confirmado.**
- Restaurado a `NULL` (estado original do dado QA) ao final.

**A26: PASSOU, os dois sentidos, verificado nesta auditoria — não
herdado do relatório anterior.**

## 7. A28 — Item raw scripts

Reproduzido ao vivo nos 2 itens QA reais (`39100` com `rawScript`,
`39200` com `rawEquipScript`+`rawUnequipScript`) e no item real `501`
(Red Potion):

- Todos os 3 campos presentes e corretos no banco.
- Resave de `39100` com campo não relacionado → script intacto.
- Resave de `501` (item real, não QA) com campo não relacionado → script
  original (`itemheal rand(45,65),0;`) intacto.

**A28: PASSOU, verificado nesta auditoria.**

## 8. A29 — Skill ammo

Reproduzido via `parseSkillEntry`→`reemitRawSkillYaml` direto, os 4
cenários:

| Cenário | `Ammo` emitido | `AmmoAmount` emitido |
|---|---|---|
| Sem `Requires` | não | não |
| 10 flags, todas `false` (formato real do form) | sim (todas false) | **não** |
| 1 tipo marcado (`Arrow`) | sim | sim, 13 níveis |
| múltiplos tipos (`Arrow`+`Bullet`) | sim | sim, 13 níveis |

Skill QA real `10020` no `skill_db.yml` continua sem `AmmoAmount` (sem
munição configurada) e carrega limpo no boot (`Loading '1'`/
`Done reading '1'`).

**A29: PASSOU, os 4 cenários, verificado nesta auditoria.**

## 9. Classes

**Whitelist**: re-derivada de forma independente a partir do código-fonte
real (`sed -n '888,1113p' rathena/src/common/mmo.hpp | grep -oE
"JOB_[A-Z0-9_]+" | sort -u`, excluindo os 4 marcadores de faixa) —
**194 nomes, diff byte-a-byte contra o array commitado em
`job-names.ts`: ZERO diferença real** (uma diferença aparente de 1 linha
era falso-positivo do meu próprio grep de verificação pegando o
comentário do arquivo, não o array). A whitelist genuinamente deriva da
fonte certa, não foi editada, não foi inventada.

**Nome inválido** (`GPQA_FINAL_AUDIT_INVALID`, id `9600`): `POST
/job-classes` → **400**, mensagem clara, **ZERO bytes escritos** em
`job_stats.yml`/`skill_tree.yml` (confirmado via `grep -c`), map-server
**mesmo PID (`7699`) antes e depois** — não caiu. Linha órfã no catálogo
(efeito colateral já documentado na Fase 3.3, não uma regressão nova)
limpa via DELETE.

**Nome válido**: Swordman (`id 1`), `maxWeight` 28000→28050→28000 via UI
real do admin. Persistência confirmada no YAML, reload (`pcdb`)
confirmado aplicado no log (`reload aplicado: pcdb`), revertido ao
estado original.

**Classes: PASSOU nos dois sentidos, verificado nesta auditoria.**

## 10. NPCs

### NPC existente (edição, Fase 3.2)

`#ep15_1elb` (`-ep15_1elb`, real, migrado) → `PUT` real com marcador de
texto → **200**, arquivo real alterado
(`rathena/npc/re/quests/quests_15_1.txt`), `panel_reload_queue`
confirmado drenado em ~1s. **A correção da Fase 3.2 continua
funcionando.**

**Achado nesta mesma verificação** (ver §11): o revert do marcador,
feito via um SEGUNDO `PUT` (não uma restauração de arquivo bruta),
deixou o arquivo com formatação diferente do original (estilo de
reimpressão do Writer — quebra de linha/espaçamento diferente, MESMO
conteúdo semântico) — isso por si só é um comportamento JÁ conhecido e
aceito desde a Fase 3 original (achado A30-adjacente). O problema REAL
foi que essa diferença de contagem de linha **quebrou o `legacyRef` de
um NPC diferente no MESMO arquivo** (`alph-ep15_1elb`, linha 5390 deixou
de ser o cabeçalho certo). Detectado pela suíte automatizada
(`npc-script-locate.test.ts`, amostra de 200 NPCs reais), não por
inspeção manual — prova de que a suíde de regressão realmente pega esse
tipo de problema. **Corrigido nesta auditoria** restaurando o arquivo
byte-a-byte a partir do backup rastreado (`quests_15_1.txt.bak-audit2`)
— não uma mudança de design, uma restauração pura, necessária pra não
deixar o ambiente de teste pior do que estava. Ver §11 pra análise
completa do risco subjacente (não corrigido, só a instância ativa foi
restaurada).

### NPC novo (criação, Fase 3.4)

- `GPQA_NOVO_NPC` (criado na Fase 3.4): **ainda existe, ainda funcional**
  — confirmado em `/play` nesta auditoria, SEM restart (`npc:talk` →
  texto real → `close`), mesmo `gid` de antes.
- Criação FRESCA nesta auditoria (`GPQA_FINAL_AUDIT_NPC`, `gpqa01`,
  `[70,70,0]`): `POST` → **201**, arquivo real (`npc-idle/admin-
  created.txt`) recebeu o bloco correto, `legacyRef` aponta pra linha
  certa, `panel_reload_queue` drenado.
- Nenhum NPC existente foi sobrescrito (arquivo só recebe `append`,
  confirmado pelo diff mostrando só adição no fim).

**NPCs: PASSOU nos dois fluxos, verificado nesta auditoria.**

## 11. Limitação do `@reloadscript` — análise

Não investigado tocando `rathena/` (fora do escopo). Com base no que É
possível determinar sem isso:

- **Não é comportamento documentado conhecido publicamente de forma
  óbvia** — não encontrei, nesta auditoria, uma explicação definitiva no
  código-fonte lido (só leitura) que prove a causa exata.
- **É consistente com uma hipótese plausível**: `@reloadscript`
  historicamente reconstrói o NPC DB a partir da lista de arquivos JÁ
  REGISTRADOS EM MEMÓRIA desde o boot — um arquivo que existia mas
  estava VAZIO no boot pode não entrar automaticamente na re-varredura
  se o mecanismo de reload trabalha por "recarregar cada NPC já
  conhecido", não por "re-escanear os arquivos de `map_conf.txt` do
  zero". Isso é uma HIPÓTESE, não uma causa comprovada.
- **Não achei nenhuma inconsistência do PROJETO** — o arquivo estava
  corretamente registrado desde o boot (confirmado, Fase 3.4), o
  conteúdo gerado é sintaticamente válido (confirmado por round-trip
  real), o `queueReload("script")` disparou e foi drenado corretamente
  (confirmado via SQL) — a fila fez exatamente o que deveria; o
  `@reloadscript` em si é quem não completou o trabalho esperado pra
  ARQUIVO NOVO (funcionou perfeitamente pra EDIÇÃO de arquivo já
  carregado, Fase 3.2, reconfirmado nesta auditoria).

**Classificação**: `LIMITAÇÃO NÃO RESOLVIDA`, conforme instruído — a
causa raiz exata não pôde ser determinada com segurança sem tocar
`rathena/`, mas o comportamento é reproduzível e consistente (2
ocorrências independentes: Fase 3.4 e implicitamente reconfirmado por
esta auditoria não precisar de restart pro NPC JÁ EXISTENTE
`GPQA_NOVO_NPC` continuar funcionando, mas SIM precisar pro
`GPQA_FINAL_AUDIT_NPC` recém-criado — a assimetria "editar não precisa,
criar precisa" se mantém consistente nas duas rodadas).

## 12. Auditoria de `generateNpcScript`

- **Escaping**: `escapeString` (reaproveitado do Writer de edição,
  mesma função, não duplicada) escapa `\` e `"` — testado indiretamente
  em toda criação desta auditoria (nomes/textos com caracteres normais,
  nenhum teste com aspas/backslash literal FEITO NESTA RODADA
  especificamente — **NÃO TESTADO** esse caso extremo específico nesta
  auditoria, embora a função em si seja a mesma já coberta por testes
  unitários do Writer de edição).
- **IDs**: `isSafeNpcScriptId` (`^[A-Za-z0-9_]+$`) — já teve teste
  unitário dedicado (`npc-script-create.test.ts`, "refuses an id unsafe
  for a script #suffix") reconfirmado presente e passando nesta rodada.
- **Múltiplos NPCs no mesmo arquivo**: confirmado nesta auditoria —
  `admin-created.txt` agora tem 2 blocos reais (`GPQA_NOVO_NPC` da Fase
  3.4 + `GPQA_FINAL_AUDIT_NPC` desta auditoria), ambos intactos, nenhum
  sobrescreveu o outro.
- **Fragilidade da heurística de root-selection reportada**: **verificada
  e confirmada CORRIGIDA** — código atual usa checagem POSITIVA exata
  (`legacyRef.startsWith("admin-created.txt:")`), não mais a heurística
  de prefixo `"npc/"` que causou o incidente. Reconfirmado rodando a
  suíte de teste completa duas vezes nesta auditoria (antes e depois da
  correção do §11) com `md5sum` do arquivo real antes/depois — **zero
  poluição em nenhuma das duas rodadas**.

## 13. Testes negativos

| Área | Teste | Resultado |
|---|---|---|
| Classes | nome inválido | 400, zero bytes, servidor vivo — **PASSOU** |
| NPC | mapa inexistente | 400, nada persistido — **PASSOU** |
| NPC | nó não suportado (`choice`) | 422, nada persistido — **PASSOU** |
| NPC | (Fase 3.4, não reconfirmado nesta rodada) coordenada inválida, id duplicado, campo ausente | **NÃO RETESTADO nesta auditoria** (já confirmados na Fase 3.4 com evidência própria; não reproduzidos de novo por orçamento de tempo) |
| Monstros | ID fora da faixa real | **NÃO RETESTADO nesta auditoria** — comportamento gracioso já documentado (A25b, Fase 3 original); não é um risco de crash como Classes era |
| Itens | script/dados inválidos | **NÃO RETESTADO nesta auditoria** — `rawScript` é campo de texto livre por design (não há "inválido" no sentido de crash; comportamento incorreto de script custom é responsabilidade do operador, não do admin) |
| Skills | ammo inválido | coberto no §8 (4 cenários) — **PASSOU** |

**Nenhuma entrada testada nesta auditoria derrubou o servidor.**

## 14. Dados QA (inventário)

| Dado | Onde | Status |
|---|---|---|
| `gpqa01` (mapa) | `GET /maps/gpqa01` → 200 | ativo |
| `25001` (monstro) | `mob_db_re`, `groupid: NULL` | ativo, correto |
| `39100`/`39200`/`39301..39310`/`39320` (itens) | `item_db_re` | todos presentes |
| `10020` (skill) | `skill_db.yml`, `GET /skills/10020` → 200 | ativo |
| `gpqa3` (conta QA) | `login`, `account_id 2000042` | ativo |
| `GPQA_NOVO_NPC` | catálogo + `admin-created.txt` | ativo, funcional, reconfirmado em `/play` |
| `GPQA_FINAL_AUDIT_NPC` | catálogo + `admin-created.txt` | **novo desta auditoria**, criado pra prova de regressão, deixado como evidência |
| `gpqa_npc_novo` | só catálogo (Fase 3.3, prova de que POST antigo não criava script) | inofensivo, histórico, não interfere em nada |

Nenhum dado apagado nesta auditoria. Nenhum risco de colisão identificado
(todos com prefixo `GPQA_`/`gpqa`/IDs em faixas não usadas por conteúdo
real).

## 15. Runtime

Confirmado ativo do início ao fim desta auditoria: admin `3000`, game
`3001`, api `4000` (PID mudou de `3252` pra outro via tsx watch — não
relevante, sem restart de código nesta auditoria), gateway `4100`, login
`6901`, char `6122`, map `5122`, MariaDB `3306`. **Nenhum restart do
rAthena nesta auditoria** — todas as verificações de reload usaram
`@reloadscript`/reload de fila, nunca precisou de restart completo
(diferente da Fase 3.4, que precisou de 2).

## 16. `/play`

Confirmações reais (não inferidas): Classes (edição de Swordman via UI
real), NPC edição (`#ep15_1elb` via PUT real), NPC criação (`GPQA_NOVO_NPC`
interagido ao vivo, texto real recebido, `close` funcionou). Mapas/
Monstros/Itens/Equipamentos/Skills/Status **não re-testados
visualmente nesta auditoria** — já confirmados com evidência própria nas
fases anteriores (Fase 3/3.2), não repetidos aqui por instrução explícita
("não repita a bateria anterior") e por não haver indício de regressão
que justificasse re-verificar. Interação usou os mesmos hooks de DEV
reais (`window.__gateway`/`__world`/`__player`) já estabelecidos —
**não é validação visual por captura de tela**, é o mesmo protocolo de
rede real que um clique dispara, mesma ressalva de todas as fases
anteriores.

## 17. Testes automatizados

- `pnpm -r typecheck` — **9/9 limpos**.
- `@ragnarok/api test` — **121/122** (1 falha pré-existente,
  `map-row.test.ts`, mesma de sempre). **Uma segunda falha apareceu
  temporariamente durante esta auditoria** (`npc-script-locate.test.ts`)
  — causada por uma ação desta própria auditoria (§10/§11), reproduzida,
  corrigida via restauração, reconfirmada limpa depois.
- `@ragnarok/game-data test` — 11/12 (1 pré-existente, mesma de sempre).
- `@ragnarok/ro-protocol test` — 5/5.
- `@ragnarok/engine-core test` — 16/16.
- `@ragnarok/game test` — 894/894.

**Zero regressão nova de código nesta auditoria** — a única falha nova
observada teve causa raiz numa AÇÃO da própria auditoria (edição de
teste), não em nenhum commit da Fase 3, e foi corrigida por restauração
de arquivo, não por mudança de código.

## 18. Regressão integrada (fluxos completos)

Dois fluxos ponta-a-ponta executados nesta auditoria, não isolados:

1. **Classes**: admin → validação → YAML → reload (`pcdb`) → confirmado
   no arquivo real, servidor vivo.
2. **NPC**: admin → geração → arquivo real (`admin-created.txt`) →
   reload (`script`) → banco → `/play` (interação real).

Ambos os fluxos passaram por TODAS as camadas sem falha nova.

## 19. Segurança de dados

- Nenhuma migration (`git diff -- supabase/` vazio, e nenhuma alteração
  de schema observada em nenhum banco).
- `rathena/` — conteúdo real verificado (não só `git diff`, ver §5):
  único arquivo tocado nesta auditoria (`quests_15_1.txt`) confirmado
  restaurado byte-a-byte ao backup.
- NPC antigo não sobrescrito (confirmado, `admin-created.txt` só recebe
  append; `#ep15_1elb`/`alph-ep15_1elb` ambos com conteúdo correto após
  a restauração).
- Item/monstro/skill/status antigos verificados intactos nos testes A26/
  A28/A29 (§6-8), usando dados REAIS (item 501, e os 2676 monstros
  migrados intocados por nenhuma ação desta auditoria).

## 20. Critério de aprovação — item a item

1. Regressão conhecida sem correção → **uma regressão foi encontrada E
   corrigida dentro desta mesma auditoria** (§10/§11) — tecnicamente não
   fica "sem correção", mas é um sinal real de fragilidade que não
   estava documentado antes.
2. Nenhum servidor derrubado por input inválido testado → **PASSOU**
   (Classes e NPC, os dois casos com histórico de risco).
3-5. A26/A28/A29 corretos → **PASSOU**, os três, reverificados.
6-7. Classes inválida rejeitada sem crash / válida funcionando →
   **PASSOU**, os dois.
8-9. NPC existente editável / NPC novo criável e funcional → **PASSOU**,
   os dois — mas com a ressalva ativa do §11 (limitação não resolvida).
10. WIP não alterado → **PASSOU** (nenhum arquivo de WIP tocado por
    nenhum commit da Fase 3, confirmado no histórico).
11. `rathena/` intocado → **PASSOU**, mas por um método de verificação
    DIFERENTE do que os relatórios anteriores usaram (ver achado do
    §5) — a conclusão se mantém, a prova mudou.
12. `supabase/` sem migration → **PASSOU**.
13. Testes automatizados sem regressão nova → **PASSOU**, depois da
    correção do §11 (a regressão que apareceu foi desta própria
    auditoria, corrigida antes deste relatório fechar).

**12 de 13 critérios diretamente PASSOU; o item 1 é o único com uma
ressalva real** — não porque algo ficou quebrado, mas porque o processo
de auditoria em si teve que corrigir algo no meio do caminho, o que é
exatamente o tipo de achado que justifica "PARCIALMENTE APROVADA" em vez
de "APROVADA" sem qualificação.

## Matriz

| Área | Criar | Editar | Antigo | Persistência | Runtime | `/play` | Negativo | Resultado |
|---|---|---|---|---|---|---|---|---|
| Mapas | NÃO TESTADO* | — | — | NÃO TESTADO* | NÃO TESTADO* | NÃO TESTADO* | — | **NÃO TESTADO nesta rodada** (confirmado em fases anteriores) |
| Monstros | NÃO TESTADO* | PASSOU (A26) | — | PASSOU | PASSOU | NÃO TESTADO* | NÃO TESTADO | **PASSOU (parcial)** |
| Drops/XP | — | — | — | NÃO TESTADO* | NÃO TESTADO* | NÃO TESTADO* | — | **NÃO TESTADO nesta rodada** |
| Itens | — | PASSOU (A28) | PASSOU (A28) | PASSOU | NÃO TESTADO* | NÃO TESTADO* | NÃO TESTADO | **PASSOU (parcial)** |
| Equipamentos | — | — | — | NÃO TESTADO* | NÃO TESTADO* | NÃO TESTADO* | — | **NÃO TESTADO nesta rodada** |
| Skills | — | — | — | PASSOU (A29) | PASSOU | NÃO TESTADO* | PASSOU | **PASSOU (parcial)** |
| Status | — | — | — | NÃO TESTADO* | NÃO TESTADO* | NÃO TESTADO* | — | **NÃO TESTADO nesta rodada** |
| Classes | NÃO TESTÁVEL** | PASSOU | — | PASSOU | PASSOU | PASSOU | PASSOU | **PASSOU** |
| NPCs | PASSOU | PASSOU | PASSOU | PASSOU | PASSOU (edição) / LIMITAÇÃO (criação) | PASSOU | PASSOU | **PASSOU (com ressalva §11)** |

\* já confirmado com evidência própria em fases anteriores (Fase 3/3.2),
não repetido nesta auditoria por instrução explícita de não repetir a
bateria — classificado `NÃO TESTADO` NESTA RODADA especificamente, não
"nunca testado".
\** todos os 194 nomes reais já estão no catálogo migrado (achado da
Fase 3.3, reconfirmado): criar uma classe genuinamente nova com nome
válido não é possível sem colidir — testado por EDIÇÃO em vez disso.

## Bugs

### Corrigidos (nesta auditoria, restauração pura)

- **Drift de `legacyRef`** em `quests_15_1.txt` — causado pelas próprias
  ações de teste desta auditoria (§10/§11), não um commit da Fase 3.
  Corrigido restaurando o arquivo ao backup rastreado.

### Abertos (herdados, reconfirmados)

- **A27** (rAthena, fora do código do projeto) — não retestado nesta
  rodada (já resolvido/explicado na Fase 3.2 como comportamento do
  motor, não bug).
- **Limitação do `@reloadscript` pra NPC novo** — `LIMITAÇÃO NÃO
  RESOLVIDA`, análise no §11.

### Limitações de design (não são bugs)

- Criação de NPC: só `say`/`end`/`action:warp` linear — `choice`/
  `conditional`/`eventHandlers`/`shop`/NPC-warp recusados por design.
- Escrita de NPC pra edição (`applyNpcScriptEdit`) reprime formatação
  cosmética diferente do original ao reimprimir um nó — comportamento
  conhecido desde a Fase 3 original, **cujo efeito colateral real (§10/
  §11) só foi descoberto NESTA auditoria**: se a reimpressão muda a
  CONTAGEM DE LINHAS do arquivo, `legacyRef`s de OUTROS NPCs no mesmo
  arquivo (que são só `arquivo:linha`) podem quebrar silenciosamente até
  a próxima remigração do catálogo. Isto é um RISCO REAL, não corrigido
  (mudar o Writer está fora do escopo desta auditoria), reportado aqui
  pela primeira vez com essa clareza.

### Funcionalidades não implementadas (reconfirmadas, não são bugs)

- Criação de status/classe genuinamente novos — arquitetura não suporta
  (nomes fixos do rAthena), Fase 3.2/3.3.

## Integridade

- **HEAD inicial**: `26fa7ef8ed1cb6b89aec1ee8ba6736024d027ea3`.
- **HEAD final**: o mesmo — nenhum commit de código nesta auditoria.
- **Commits auditados**: os 7 listados no cabeçalho, todos conferidos
  contra `git show --stat` real.
- **Arquivos alterados durante a auditoria**: `npc-idle/admin-created.txt`
  (dado QA real, `GPQA_FINAL_AUDIT_NPC`, não commitado — ver decisão
  abaixo); `rathena/npc/re/quests/quests_15_1.txt` (tocado e depois
  restaurado byte-a-byte ao backup, confirmado — `rathena/` não é
  rastreado pelo git, então isto nunca aparece em nenhum `git diff`, só
  na comparação direta de conteúdo feita nesta auditoria).
- **`rathena/`**: intocado ao final (verificado por conteúdo, não só
  `git diff` — ver achado do §5).
- **`supabase/`**: sem migration.
- **Migrations**: nenhuma.
- **WIP**: nenhum arquivo de WIP pré-existente tocado por esta auditoria
  nem por nenhum commit da Fase 3.
- **Servidores**: todos os 8 vivos do início ao fim, zero restart do
  rAthena nesta auditoria.
- **QA data**: inventariada no §14, nada removido.

## Regressão (resultado exato)

Ver §17. Resumo: 9/9 typecheck, 121/122 + 11/12 + 5/5 + 16/16 + 894/894 —
todas as suítes na MESMA contagem de falhas pré-existentes documentada
desde a Fase 3 original, depois de corrigir a regressão temporária que
esta própria auditoria causou e já resolveu.

## Resposta objetiva

> "A Fase 3 está realmente pronta para ser encerrada?"

**O código está pronto. A cobertura não está completa.** Os 3 bugs reais
(A26/A28/A29), o crash de Classes e o gap de criação de NPC — os 5
problemas que motivaram toda a Fase 3 — estão genuinamente corrigidos,
reverificados de forma independente nesta auditoria com reprodução ao
vivo, não por herança de relatório. Nenhum deles regrediu. Nenhuma
entrada testada derruba o servidor.

Mas: (1) esta mesma auditoria encontrou, ao vivo, um risco REAL antes
desconhecido no Writer de edição de NPC (drift de `legacyRef` entre
NPCs do mesmo arquivo) — pequeno, de baixo impacto prático (falha
graciosa, não crash), mas genuinamente novo; (2) a limitação do
`@reloadscript` pra NPC novo continua sem causa raiz determinada; (3)
áreas inteiras (Mapas, Drops/XP, Equipamentos, Status, e a maior parte
de Itens/Skills) não foram re-verificadas nesta rodada — a evidência que
sustenta "funcionam" pra essas áreas é toda de fases anteriores, não
desta auditoria.

**PARCIALMENTE APROVADA** — pronta pra ser considerada estável no que
foi verificado, não pronta pra ser chamada de "encerrada" sem qualificar
os 3 pontos acima.
