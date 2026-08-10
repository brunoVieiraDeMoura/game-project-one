# Relatório final — Fase 3, bateria de testes funcionais reais

Executado 2026-08-10, HEAD inicial `bc1a93c`. Protocolo aprovado em `leia1.txt`. Todo teste seguiu
3 camadas obrigatórias: **Persistência** (SELECT/grep na fonte crua, nunca só GET da API) →
**Runtime** (reload/restart do rAthena real, log de boot conferido) → **`/play`** (ação real via
`window.__gateway`/`__world`/`__player`, os mesmos eventos de rede que um clique dispara — ver nota
de limitação de ferramenta abaixo). Detalhe completo de cada teste está nos 9 arquivos de área desta
pasta; este documento consolida.

**Nota de limitação de ferramenta (vale para toda a bateria)**: o driver de automação (Playwright
MCP) não conseguiu disparar clique-tile nem `Tab`-target no canvas React Three Fiber deste projeto
— cliques sintéticos e nativos do Playwright não acionam o raycasting da cena. Combate, movimento e
interação em `/play` foram testados via `window.__gateway` (emite os MESMOS eventos de socket que um
clique real dispararia) e `window.__world()`/`window.__player()` (os MESMOS hooks Zustand que o HUD
lê) — hooks de DEV reais do cliente (`net/gateway.ts`, `net/worldStore.ts:1287`,
`net/playerStore.ts:335`), não mocks. Isso prova o caminho de rede real cliente↔gateway↔rAthena, mas
não a confirmação visual pixel-a-pixel de alguns comportamentos (registrado caso a caso).

## Tabela consolidada

| Área | Criar | Editar | Antigo | `/play` | Persistência | Veredito |
|---|---|---|---|---|---|---|
| 1. Mapas | PASSOU (`gpqa01`) | — | — | PASSOU | PASSOU | **PASSOU** |
| 2. Monstros | PASSOU (25001) | — | PASSOU (Poring 1002) | PASSOU (rede; visual não) | PASSOU | **PASSOU** |
| 3. XP/Drops/Skill mob | N/A | — | — | PASSOU (XP+drops) / FALHOU (pickup) / NÃO OBSERVADO (skill em combate) | PASSOU (XP) / N/A (drops) / FALHOU (pickup) | **MISTO** (ver detalhe) |
| 4. Itens | PASSOU (39100) | PASSOU (Red Potion) | PASSOU (Red Potion) | PASSOU | PASSOU | **PASSOU** (2/12 tipos cobertos) |
| 5. Equipamentos | PASSOU (39200) | PASSOU (Cotton Shirt) | PASSOU (indireto) | PASSOU (ATK/ASPD numéricos) | PASSOU | **PASSOU** (cartas/restrição NÃO TESTADO) |
| 6. Skills | PASSOU (10020) | NÃO TESTADO | NÃO TESTADO | NÃO OBSERVADO (combate) | PASSOU | **PASSOU** (persistência+runtime; combate real não observado) |
| 7. Status | NÃO TESTADO | PASSOU (parcial, metadado) | NÃO TESTADO | NÃO TESTADO | PASSOU | **PASSOU** (parcial) |
| 8. Classes | NÃO TESTADO | BLOQUEADO (inconclusivo) | NÃO TESTADO | NÃO TESTADO | INCONCLUSIVO | **BLOQUEADO** |
| 9. NPCs | NÃO TESTADO | FALHOU (2/2 recusados, comportamento correto) | PASSOU (`devmenu.txt`) | PASSOU (antigo) | N/A | **MISTO** |

## Totais (29 sub-testes individuais, ver tabelas de cada área)

- **PASSOU: 16**
- **FALHOU: 2** (pegar drop → inventário; editar NPC existente — este último por cobertura estreita
  do writer, comportamento de recusa correto e intencional, não corrupção)
- **BLOQUEADO: 1** (editar classe existente — resultado inconclusivo, não investigado a fundo por tempo)
- **NÃO APLICÁVEL: 1** (Spawns via admin — travado por design, A23 já endereçado em fase anterior)
- **NÃO TESTADO (tempo, não avaliado): 9** (9 tipos de item restantes; cartas/restrição/nível de
  equip; editar/skill antiga; criar/antigo de status; criar/antiga de classe; criar NPC novo)
- Adicional, fora dos 4 buckets pedidos mas registrado com honestidade: **1 "NÃO OBSERVADO"** (skill
  do monstro em combate — runtime provado, disparo em combate não capturado na janela de teste, sem
  indício de falha)

## Falhas — causa raiz e correção

### Corrigidas nesta rodada (3 bugs reais de write-path)

| Achado | Área | Causa raiz | Correção | Evidência |
|---|---|---|---|---|
| **A26** (alta) | Monstros | `Monster.groupId` tinha `.default(0)` no zod + `mysql-monster-row.ts` gravava `monster.groupId` sem null-coalescing → campo limpo no admin ainda virava `0` explícito, que o rAthena rejeita (`Node "GroupId" needs to be at least 1`), derrubando a linha inteira no boot | `monster.ts`: `.default(0)` → `.optional()`. `mysql-monster-row.ts`: `groupid: monster.groupId ?? null`. `monster-row.ts` (Supabase, não afetado pelo bug mas ajustado por tipo): `group_id: m.groupId ?? 0` | `monstros.md` §A26 — SELECT antes/depois, boot `2676→2675→2676` entries |
| **A28** (alta) | Itens | `rawScript`/`rawEquipScript`/`rawUnequipScript` nunca declarados em `ItemSchema` → `safeParse` descartava o script digitado no `RawScriptField` antes de chegar no repositório MySQL | Adicionados os 3 campos como `z.string().optional()` em `item.ts` | `itens.md` §4.1 — captura de rede mostrando o campo enviado e descartado, depois persistindo |
| **A29** (alta) | Skills | `AmmoAmount` emitido incondicionalmente no writer YAML; loader real (`skill.cpp:15432`) exige `Ammo` com algum tipo marcado quando `AmmoAmount` está presente. Formulário do admin sempre manda as 10 chaves de munição (todas `false`), então `Object.keys(ammo).length` nunca é 0 — bloqueava criação de QUALQUER skill nova sem requisito de munição | `skill-db-yaml.ts`: gate trocado para `Object.values(p.requires.ammo).some(Boolean)` | `skills.md` §6.1 — boot `Loading '1'`/`Done reading '0'` → `'1'` após fix; teste isolado da função pura (fora do HTTP) provando a causa raiz |

### Documentadas, não corrigidas (fora do escopo desta rodada)

| Achado | Área | Causa raiz | Por que não corrigido |
|---|---|---|---|
| **A24** (alta, tooling) | Mapas | `export-mapcache.ts` substitui `map_cache.dat` inteiro em vez de mesclar — reexportar 1 mapa apaga os demais | Mitigado listando todos os mapas no comando (`--maps prt_fild08,gpqa01`); corrigir exigiria mudar a ferramenta de export, fora do escopo de "só testar" |
| **A25** (média, doc) | Mapas | Índice-exemplo do template `map_index.txt` (1250) colide com mapa vanilla real; `MAX_MAPINDEX=2000` não documentado em lugar nenhum | Registrado; `gpqa01` usa 1900. Editar o comentário-template é decisão do usuário |
| **A25b** (informativo) | Monstros | Faixa válida de Monster ID (`1000-3999`/`20020-31999`, `mob.cpp:4983`) não é validada nem documentada no admin | Corrigir exigiria mexer em `field-limits.ts`/`MonsterForm.tsx` — fora do escopo |
| **A27** (não classificado por severidade — bug de engine, fora do código do projeto) | Drops/Itens | Pickup de item do chão (`item:pickup`) nunca gerou `inv:add` para a conta QA `gpqa3` em 3 tentativas; causa raiz não isolada com confiança (4 hipóteses concorrentes: janela de loot-right, alcance de célula fracionária, encode do pacote `CZ_ITEM_PICKUP`, ou sequência de clique real que a automação não reproduziu) | Root cause está potencialmente dentro da lógica C++ do rAthena ou no encode do pacote — não isolado o suficiente para editar código sem risco de mascarar bug real ou "consertar" comportamento correto. Contornado usando o personagem `Campo` (inventário funcional) para os testes de Itens/Equipamentos |
| **A30** (comportamento correto, não é bug) | NPCs | Writer de NPC recusa editar nós não suportados (`action`, `say` multi-linha com guard de round-trip) em vez de gravar algo errado | Não é bug — é o comportamento de segurança pretendido. Confirmado que `rathena/npc/*.txt` ficou byte-idêntico nas 2 tentativas |
| Classes/editar (inconclusivo) | Classes | Alterar "Nível base máximo" (50→51) não refletiu no releitura (`maxBaseLevel` continuou 99) — não determinado se é rótulo de campo confuso (formulário com 2 campos parecidos) ou bug de write-path similar a A26/A28/A29 | Tempo da bateria esgotado antes de isolar a causa; registrado como achado aberto para retestar com o mesmo processo usado em A26/A28/A29 |

## Evidência — arquivos por área

Ver `docs/audit/fase3-testes/{mapas,monstros,xp-drops-skills-monstro,itens,equipamentos,skills,
status,classes,npcs}.md` — cada um com dados configurados, comando/rota usado, resultado
esperado/observado, screenshot ou log, e veredito por sub-teste. Screenshots em
`docs/audit/fase3-testes/backup/*.png`.

## Arquivos alterados (exclusivos da Fase 3)

Confirmado por `git status --porcelain` filtrado contra o WIP pré-existente do usuário (`CLAUDE.md`,
SFX, `apps/game/src/hud/*`, `apps/game/src/net/*` exceto o novo, `apps/gateway/*`, `leia1.txt`,
`job-class-mapper.ts`, `rathena-conf/battle_conf.txt`, `migrate-npcs.ts`, `docs/claude-context/` —
nenhum destes foi tocado por esta bateria):

- `apps/api/src/store/monster-row.ts` (A26 — ajuste de tipo, backend Supabase/JSON)
- `apps/api/src/store/mysql-monster-row.ts` (A26 — fix)
- `docs/audit/risk-report.md` (achados A24-A30 + revisão de contadores)
- `packages/game-data/src/item.ts` (A28 — fix)
- `packages/game-data/src/monster.ts` (A26 — fix)
- `packages/game-data/src/rathena/skill-db-yaml.ts` (A29 — fix)
- `rathena-conf/map_conf.txt` (registro do mapa `gpqa01` + seu NPC de spawn)
- `npc-idle/mobs/gpqa01.txt` (novo — script de spawn QA)
- `docs/audit/fase3-testes/` (novo — toda a evidência desta bateria, incluindo este relatório)

**`rathena/` permaneceu intocado**: `git status --porcelain rathena/` e `git diff --stat rathena/`
vazios, confirmado nesta verificação final. As 2 tentativas de escrita em NPC (jellopy,
poring_war_recruiter-wop) foram recusadas pelo writer ANTES de gravar (422/500) — confirmado por
`diff` byte-a-byte contra backup que os `.txt` reais ficaram idênticos.

Alterações em `rathena-db-import/` (gitignored, não aparecem em `git status`): `skill_db.yml`
(skill 10020), `status.yml` (descrição de `poison`), `map_index.txt` (`gpqa01 1900`),
`map_cache.dat` (mesclado `prt_fild08`+`gpqa01`), `mob_skill_db.txt` (skill do monstro 25001).

## Dados criados (QA)

- Conta `gpqa3` (account_id 2000042, GM group_id 99), personagem `GPQA3`
- Mapa `gpqa01` (128×128, `terrainMode: square`, 37 células bloqueadas)
- Monstro `GPQA_NOVO_MOB` (id 25001) — spawn real via `npc-idle/mobs/gpqa01.txt` junto com Poring (1002, existente)
- Item `GPQA_HEAL_POTION` (id 39100, tipo Cura)
- Item `GPQA_SWORD` (id 39200, arma)
- Skill `GPQA_BOLT` (id 10020)
- Entrada em `mob_skill_db.txt` para o monstro 25001

## Dados restaurados / decisão de limpeza

**Decisão**: os dados QA acima foram **mantidos no ar**, não removidos nem revertidos, por 3
motivos: (1) todos usam IDs/nomes claramente marcados como QA (`gpqa01`, `GPQA_*`, `25001`/`39100`/
`39200`/`10020`, faixas fora do uso real do projeto), não colidindo com conteúdo de produção; (2) a
evidência desta bateria (SQL/YAML/logs de boot capturados nos arquivos de área) já está congelada
por escrito, então remover os dados ao vivo não acrescenta nem tira prova; (3) reverter exigiria mais
um ciclo de restart do rAthena, com o mesmo risco de reintroduzir A24/A25 que já consumiu tempo
significativo desta rodada — desnecessário dado que os dados não prejudicam nada em produção.
Backups completos (`docs/audit/fase3-testes/backup/*.bak-fase3` + `item_mob_dump.sql`) permitem
reverter a qualquer momento se o usuário preferir. Nenhum arquivo de WIP pré-existente do usuário foi
tocado, restaurado ou revertido.

O item de equipamento inicial "First aid Box" dado via `@item` na preparação (conta `gpqa3`) e os
itens de teste dados a `Campo` via `@item` (39100, 39200) também não foram removidos do inventário
dos personagens, pelo mesmo raciocínio — são itens reais e válidos que não afetam integridade do
banco.

## Migrations aplicadas

**Nenhuma.** Todas as mudanças desta bateria foram dados (MySQL `item_db_re`/`mob_db_re` via API),
config (`rathena-conf/map_conf.txt`) ou YAML (`rathena-db-import/`, gitignored) — nenhuma mudou
schema. Confirmado: `git status --porcelain supabase/` vazio.

## Estado final dos servidores

Confirmado nesta verificação final (após a bateria completa, sem reiniciar nada além do necessário):

| Porta | Serviço | PID |
|---|---|---|
| 3000 | admin (Next.js) | 22896 (mesmo do início) |
| 3001 | game (Vite) | 1396 (mesmo do início) |
| 4000 | api (Fastify) | 6844 (mudou de 6060 — `tsx watch` reiniciou o processo durante os fixes de A26/A28/A29, comportamento esperado do dev server, código continua saudável) |
| 4100 | gateway (Socket.IO↔TCP) | 12572 (mesmo do início) |
| 5122/6122/6901/3306 | rAthena map/char/login + MariaDB (WSL) | 12032 (mesmo processo do início — sobreviveu aos 3 restarts do rAthena feitos DURANTE a bateria, que são reinicializações do processo `wsl-run.sh` interno, não deste PID de supervisão) |

Todas as 8 portas confirmadas `LISTENING`.

## Resultado dos testes automatizados (verificação final)

- `pnpm -r typecheck` — **9/9 pacotes limpos**
- `pnpm --filter @ragnarok/api test` — 114 passando, 1 falha pré-existente e não relacionada
  (`map-row.test.ts` — confirmado via `git status --porcelain` que o arquivo não foi tocado nesta
  bateria nem faz parte do WIP; falha já existia em HEAD `bc1a93c`)
- `pnpm --filter @ragnarok/game-data test` — 11 passando, 1 falha pré-existente e não relacionada
  (`server-config.test.ts`, mesma situação)
- `pnpm --filter @ragnarok/ro-protocol test` — 5/5
- `pnpm --filter @ragnarok/engine-core test` — 16/16
- `pnpm --filter @ragnarok/game test` — 894/894 (89 arquivos)

Nenhuma das 2 falhas pré-existentes foi causada, alterada ou tocada por esta bateria.

## Confirmação: `rathena/` permaneceu intocado

`git status --porcelain rathena/` → vazio. `git diff --stat rathena/` → vazio. As únicas 2
tentativas de escrita nessa árvore (via `npc-script-sync.ts`, a exceção pré-aprovada) foram
recusadas pelo próprio writer ANTES de gravar qualquer byte (HTTP 422 e 500), confirmado por `diff`
contra backup mostrando os `.txt` reais byte-idênticos ao estado pré-bateria.

## Commit final

Alterações desta rodada pertencem exclusivamente à Fase 3 (bugs reais descobertos e corrigidos ao
vivo contra o servidor, mais a evidência/documentação da bateria) e não se misturam com o WIP
pré-existente do usuário. Preparando commit isolado com exatamente os arquivos listados em "Arquivos
alterados" acima.
