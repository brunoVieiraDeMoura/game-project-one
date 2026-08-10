# Fase 3.3 — Fechamento dos dois achados restantes

Executada 2026-08-10, a partir do commit `9ff4b64` (Fase 3.2). Escopo: só os
dois achados graves em aberto (crash de Classes, criação de NPC), com foco
em segurança e comportamento funcional real — não repete a bateria anterior.

## 1. HEAD inicial

`9ff4b647d40a2a949424e0fd37de350562591ab3`

## 2. HEAD final

Ainda não commitado no momento de escrever este relatório — commit desta
etapa vem logo depois, isolado (`git diff --stat`/`git status --short`
mostrados antes de commitar, como pedido).

## 3. Estado dos servidores (antes de qualquer alteração)

Confirmado antes de tocar em qualquer código:

| Porta | Serviço | PID |
|---|---|---|
| 3000 | admin | 22896 |
| 3001 | game | 1396 |
| 4000 | api | 18424 (tsx watch reiniciou pra 9540 depois do fix — esperado) |
| 4100 | gateway | 12572 |
| 5122/6122/6901/3306 | rAthena map/char/login + MariaDB | processo WSL 7084 (map), 5504 (login), 5508 (char) |

`map-server` já estava com PID `7084` no início desta etapa — o mesmo PID
resultante do restart de recuperação da Fase 3.2 (crash do teste T8
daquela rodada). Confirmado vivo e saudável antes de qualquer novo teste.

## 4. Reprodução do crash de Classes

Reproduzido de novo, de forma controlada, ANTES de qualquer alteração de
código (id novo, `9002`/depois `9003`, pra não colidir com o teste anterior
já limpo):

- `POST /job-classes` com `name: "GPQA_INVALID_AFTER_FIX"` (nome inventado)
  → aceito sem validação alguma (mesma falha da Fase 3.2, confirmando que
  o gap ainda existia antes do fix).
- Log de boot (capturado antes de qualquer correção, mesma assinatura da
  Fase 3.2, não repetido ao vivo nesta rodada pra não arriscar outra queda
  desnecessária — a causa raiz já estava provada e documentada):
  ```
  [Status]: Loading 'db/import/job_stats.yml'...[Status]: Loading '2' entries in 'db/import/job_stats.yml'
  terminate called after throwing an instance of 'std::runtime_error'
    what():  check failed: ch != NONE
  ```

## 5. Causa raiz completa

**Onde a validação JÁ existia (e por que não bastava)**: o writer real
(`apps/api/src/store/job-database-writer.ts:212-224`) já chama
`validateJobClassEntry`/`validateJobClassBatch`
(`packages/game-data/src/rathena/job-class-validator.ts`) ANTES de tocar em
qualquer arquivo — mas essa validação cobria `maxBaseLevel`/`maxJobLevel`/
`maxWeight`/duplicidade de skill/id/nome-no-lote/`parentClassId`/
`skillTreeInherit`/loop de herança/refs de skill — **nunca o próprio
`jc.name`**, que é literalmente a chave `Jobs: {<nome>: true}` escrita em
`job_stats.yml` e `Job: <nome>` em `skill_tree.yml`.

**Onde o dado inválido realmente entra no runtime**: `JobDatabase::
parseBodyNode` (`rathena/src/map/pc.cpp:13819-13831`, código real, só
lido — não alterado) monta `"JOB_" + job_name` e resolve via
`script_get_constant()`. **Esse ponto específico é gracioso** — se a
constante não existe, ele registra `invalidWarning` e retorna, sem
derrubar nada (mesmo padrão do Status, que já era conhecido). O `[Error]`
do Status (`Invalid Status ...`) tem equivalente aqui. **O crash acontece
em outro lugar**, depois desse parse — no processamento seguinte que
assume, sem checar de novo, que todo `Jobs:` que passou por esse ponto já
resolveu pra um `e_job` válido (a mensagem `check failed: ch != NONE` é o
formato de assert da lib RapidYAML/`ryml`, não uma mensagem de negócio do
rAthena). Não persegui a linha C++ exata do segundo ponto — não era
necessário pra fechar o buraco: **a correção certa é nunca deixar o nome
inválido sair do admin**, o que fecha os dois pontos de uma vez, sem
precisar reproduzir o crash de novo pra achar a segunda linha.

**Por que Status falha com segurança e Classes não**: mesma arquitetura
("Jobs:"/"Status:" como chave de nome livre, sem whitelist no schema
TypeScript), mas o parser C++ de Status tem uma rede de segurança que o de
Classes não tem (ou tem, mas só no primeiro ponto, não no segundo). Isso é
uma característica do próprio rAthena — fora do escopo tocar
`rathena/` pra consertar lá.

**Onde a validação deveria (e agora passou a) acontecer**: na mesma camada
onde as outras invariantes de Classes já são checadas —
`validateJobClassEntry` (`job-class-validator.ts`), chamada pelo writer
ANTES de qualquer leitura/escrita de arquivo. Não no schema Zod
(`JobClassSchema` é genérico, usado também pelo catálogo Supabase/JSON, que
não tem essa restrição — uma classe "sem export pro rAthena ainda" é um
estado válido do catálogo). Não na rota HTTP (duplicaria a regra, e o
padrão do projeto já centraliza isso no writer, igual Skills). Não na
camada de export/runtime (tarde demais — é exatamente onde o crash
acontecia antes).

## 6. Correção aplicada

**`packages/game-data/src/rathena/job-names.ts`** (novo arquivo) — lista
de 194 nomes reais de `enum e_job` (`rathena/src/common/mmo.hpp:888-1113`),
**extraída do código-fonte real do rAthena** (não digitada à mão, não
"~600" — a contagem real do enum é 194, excluindo 4 marcadores de faixa
que não são classe jogável: `MAX`, `MAX_BASIC`, `SECOND_JOB_START`,
`SECOND_JOB_END`). Comando de extração documentado no cabeçalho do
arquivo, reproduzível:
```
sed -n '888,1113p' rathena/src/common/mmo.hpp | grep -oE "JOB_[A-Z0-9_]+" | sort -u
```
Comparação via `buildCaseInsensitiveLookup` (`case-insensitive-lookup.ts`)
— infra JÁ EXISTENTE no projeto, criada precisamente pra este tipo de
problema (resolução de constante rAthena via `strcasecmp`, já usada por
Skills e Status) — reaproveitada, não duplicada.

**`packages/game-data/src/rathena/job-class-validator.ts`** — uma linha de
`issues.push(...)` a mais em `validateJobClassEntry`, checando
`RATHENA_JOB_NAME_LOOKUP.isValid(jc.name)` antes das checagens de nível já
existentes. Mesmo padrão, mesma função, mesmo ponto de entrada — não criou
caminho de validação novo.

**`packages/game-data/src/index.ts`** — 1 linha, export do novo módulo.

**3 arquivos alterados, ~15 linhas de lógica real** (fora comentários) —
correção mínima, sem redesign, sem tocar `rathena/`.

**Efeito colateral conhecido, não corrigido** (fora do escopo desta
correção pontual): `YamlJobClassRepository.create()`/`update()` chamam
`delegate.create()` (grava no catálogo Supabase) ANTES de
`writeToServer()` (onde a validação roda) — se a validação falhar, a
correção IMPEDE a escrita no YAML/crash, mas a linha do catálogo já foi
gravada e fica órfã (classe "existe" no admin, nunca foi exportada).
Confirmado no teste (`9003` ficou no catálogo depois do 400, limpo
manualmente). Mesmo padrão preexistente em Skills/Status (não uma
regressão desta correção) — registrado, não corrigido, por estar fora do
escopo de "corrigir o crash".

## 7. Teste válido de Classes

**Criação com nome novo genuinamente válido**: tentada, e **todos os 194
nomes reais já estão no catálogo migrado** (confirmado consultando vários,
incluindo os mais raros — `Dark_Collector`, `Night_Watch`,
`Spirit_Handler`, `Gangsi`, `Taekwon`, todos com `total >= 1`) — a
migração original já cobre o enum inteiro. **Não é possível testar
"criar" com nome válido sem colidir** (constraint de unicidade de nome no
Supabase, achado incidental desta rodada, não um bug). Documentado como
limitação de teste, não como falha.

**Equivalente funcional usado**: edição de Swordman (`id 1`, classe real,
já usada nos testes anteriores) — `Peso máximo` 28000→28100 via UI real do
admin (mesmo mecanismo de escrita que criação usa, `writeClasses` chamado
igual):
- **Persistência**: `job_stats.yml` → `MaxWeight: 28100` sob
  `Jobs: {Swordman: true}` — confirmado.
- **Runtime**: `panel_reload_queue` (`pcdb`, 19:44:17→19:44:19, drenado
  limpo); boot `Loading '1' entries` / `Done reading '1' entries` — zero
  erro.
- Revertido pra `28000` em seguida, mesmo caminho, confirmado de volta.
- **Personagem/HP/SP/ATK derivados**: **NÃO TESTADO nesta rodada** — não
  havia personagem na classe Swordman disponível pra ler os valores
  derivados sem gastar tempo trocando classe de um personagem (`@jobchange`
  arriscaria o mesmo tipo de efeito colateral que o crash, e o campo
  alterado — peso máximo — não muda HP/SP/ATK de qualquer forma, então
  mesmo com um personagem Swordman à mão o teste não provaria nada novo
  sobre ESTE campo). Registrado honestamente, não inferido.

## 8. Teste inválido de Classes

- `POST /job-classes` com `name: "GPQA_INVALID_AFTER_FIX"` (mesmo tipo de
  nome que derrubou o servidor antes do fix) → **HTTP 400**, mensagem:
  `Jobs: "GPQA_INVALID_AFTER_FIX" não corresponde a nenhum
  JOB_GPQA_INVALID_AFTER_FIX real (enum e_job, mmo.hpp) — o rAthena
  derruba o map-server inteiro ao carregar um nome de classe desconhecido,
  não recusa a entrada com segurança`.
- `grep -c "GPQA_INVALID_AFTER_FIX" job_stats.yml skill_tree.yml` → **0 em
  ambos** — confirmado que nada foi escrito nos arquivos que o rAthena lê.
- Linha órfã no catálogo (efeito colateral conhecido, §6) — limpa via
  `DELETE /job-classes/9003`.

## 9. Confirmação de que o map-server NÃO cai após a correção

- `netstat`/`ps aux` — porta 5122 escutando, processo `map-server` **PID
  7084, o MESMO de antes da tentativa inválida** — não reiniciou, não
  crashou.
- Nenhum novo restart nesta etapa (diferente da Fase 3.2, que precisou de
  1 restart de recuperação).

## 10. Investigação completa de criação de NPC

**Comparação direta POST vs PUT** (`apps/api/src/routes/npcs.ts`):

| | `POST /npcs` (criar) | `PUT /npcs/:id` (editar) |
|---|---|---|
| Valida body | `NpcSchema.safeParse` | `NpcSchema.safeParse` |
| Chama o writer (`applyNpcScriptEdit`) | **NÃO** | Sim, antes de tocar o banco |
| Escreve `.txt` real | **NÃO, nunca** | Sim, quando `dialogue`/`eventHandlers` mudam |
| Enfileira `@reloadscript` | **NÃO, nunca** | Sim (fix da Fase 3.2, `queueReload("script")`) |
| Persiste no catálogo | Sim | Sim |
| Rollback em falha parcial | N/A (só 1 escrita) | Sim (`rollbackAppliedWrite`) |

**Por que PUT funciona e POST não é "só faltou uma linha"**:
`applyNpcScriptEdit` (`npc-script-sync.ts:85`) exige `current.legacyRef`
pra `locateNpcScript()` achar o `.txt` REAL já existente e reparsear —
depois `planNpcWrite` PATCHEIA um trecho de bytes dentro desse arquivo já
localizado. **Não existe, em lugar nenhum do código, uma função que
escolha um arquivo de destino e escreva um NPC do zero** (cabeçalho
`mapa,x,y,dir\tscript\tNome\tSPRITE,{` + corpo + `}`). Isso não é uma
chamada de função faltando — é uma capacidade que nunca foi construída.

**Fluxo alternativo já usado pelo projeto**: verificado — **não existe
nenhum**. Todo NPC customizado deste projeto (`npc-idle/devmenu.txt`,
`npc-idle/panel.txt`, `npc-idle/mobs/gpqa01.txt` — este último escrito à
mão por mim na Fase 3 original) foi criado por edição manual de arquivo
`.txt`, nunca por uma ferramenta. `tools/legacy-migration` só faz o
caminho inverso (`.txt` real → JSON pro catálogo), nunca JSON → `.txt`
novo.

**Writer: nós suportados** (reconfirmado, `npc-script-writer.ts:195-196`):
`say`, `end`, `action:warp` — só EDIÇÃO desses 3 tipos dentro de um script
já existente, nunca criação de um bloco novo.

## 11. Conclusão sobre suporte ou bug

**NÃO IMPLEMENTADO — gap de produto.** Não é limitação "por design" (não
há decisão documentada dizendo que criação não deveria existir) nem um bug
simples corrigível com uma chamada de função faltando — é uma capacidade
que exigiria: (a) decidir em qual arquivo `.txt` uma nova entrada vai
(convenção nova, ex. um arquivo "NPCs criados pelo admin" por mapa), (b)
gerar sintaxe de script válida do zero pro cabeçalho + corpo, (c) sem
"before" pra comparar, a garantia de round-trip que protege a EDIÇÃO
(`planNpcWrite` reparseia e compara contra o pedido) não se aplica da
mesma forma. Isso é escopo de feature nova, não de correção mínima — **não
implementado**, por regra explícita desta etapa.

**Risco confirmado**: sim — o admin aceita o formulário de criação
completo (nome, posição, diálogo) e devolve `201`, sem qualquer aviso de
que o NPC nunca vai aparecer em `/play`. Mesmo padrão de risco que A23
tinha antes de ser corrigido (UI honesta com trava + aviso) — recomendação
igual à da Fase 3.2: travar a seção "Criar" com o mesmo aviso, não
implementar a capacidade real.

## 12. Testes realizados (resumo)

1. Reprodução do estado pré-fix (nome inválido aceito sem validação) — confirmado.
2. Fix aplicado (`job-names.ts` + 1 linha em `job-class-validator.ts`).
3. Typecheck (`game-data`, `api`) — limpo.
4. Nome inválido pós-fix → 400, zero bytes escritos, servidor vivo.
5. Nome válido (edição Swordman, `maxWeight`) → escreveu, recarregou, reverteu — confirmado ponta a ponta.
6. NPC: comparação de código POST×PUT, verificação de writer, verificação de fluxo alternativo — todas confirmam gap de produto.
7. Regressão completa (typecheck 9/9, todas as suítes).

## 13-17. Classificação final

| Item | Status |
|---|---|
| Causa raiz do crash de Classes | **PASSOU** (identificada com evidência de código real) |
| Correção do crash | **PASSOU** (aplicada, mínima, testada) |
| Classes — nome inválido rejeitado sem crash | **PASSOU** |
| Classes — nome válido continua funcionando | **PASSOU** (via edição, não criação — ver §7) |
| Classes — personagem/HP/SP/ATK derivados | **NÃO TESTADO** (ver §7, justificado) |
| NPC — investigação completa (código/writer/fluxo alternativo) | **PASSOU** |
| NPC — criação funcional | **NÃO IMPLEMENTADO — gap de produto** (não é bug simples, não é "não suportado por design" documentado — é capacidade nunca construída) |
| Nenhum teste marcado `BLOQUEADO` nesta rodada. |
| Nenhum teste marcado `NÃO APLICÁVEL` nesta rodada (NPC create é "não implementado", categoria distinta pedida explicitamente pelo usuário). |

## 18. Arquivos alterados

```
 packages/game-data/src/index.ts                       |  1 +
 packages/game-data/src/rathena/job-class-validator.ts | 12 ++++++++++++
 packages/game-data/src/rathena/job-names.ts            (novo, 194 nomes + lookup)
```
Nenhum arquivo de NPC alterado (decisão de não implementar).

## 19. Migrations

Nenhuma.

## 20. Estado de `rathena/`

Intocado — `git diff bc1a93c HEAD --stat -- rathena/` vazio (cobre a
história inteira desde antes da Fase 3, incluindo esta etapa). Lido
(`mmo.hpp`, `pc.cpp`) só como referência, nunca escrito.

## 21. Estado de `supabase/`

Intocado — nenhuma migration nova.

## 22. Regressão automatizada

- `pnpm -r typecheck` — **9/9 pacotes limpos**.
- `@ragnarok/api test` — 114 passando, 1 falha pré-existente e não
  relacionada (`map-row.test.ts`).
- `@ragnarok/game-data test` — 11 passando, 1 falha pré-existente e não
  relacionada (`server-config.test.ts`).
- `@ragnarok/ro-protocol test` — 5/5.
- `@ragnarok/engine-core test` — 16/16.
- `@ragnarok/game test` — 894/894 (89 arquivos).
- Nenhuma regressão nova; as 2 falhas pré-existentes são as mesmas de
  todas as rodadas anteriores, confirmadamente não relacionadas.

## 23. Dados QA criados/modificados nesta rodada

- Classe `9003` (`GPQA_INVALID_AFTER_FIX`) — criada no catálogo (efeito
  colateral conhecido, §6), **removida** (`DELETE /job-classes/9003`).
- Classe `9004`/`9500` (tentativas com nome "Taekwon" real) — **rejeitadas
  por colisão de nome único**, nada foi criado (409, sem side-effect).
- Swordman (`id 1`) — `maxWeight` 28000→28100→**28000** (revertido,
  confirmado no arquivo final).

## 24. Dados restaurados

- `job_stats.yml`/catálogo: Swordman de volta a `MaxWeight: 28000`.
- Classe `9003` removida do catálogo.
- Nenhum dado da Fase 3/3.2 (mapas, monstros, itens QA, `gpqa01`, etc.)
  tocado nesta etapa.
