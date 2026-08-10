# 2. Monstros — evidência de teste funcional real

Protocolo: PERSISTÊNCIA → RUNTIME → `/play`, fluxo real (admin autenticado → MySQL `mob_db_re` →
fila de reload → rAthena vivo → mapa `gpqa01` da seção 1).

## Teste 2.1 — Monstro novo `GPQA_NOVO_MOB` (id 25001)

- **Dados**: nível 5, HP 50, ATK 5, EXP base 999 / job 444, alcance 1, velocidade 250ms/célula,
  delay 1000ms, 2 drops a 100% (Red Potion 501, Jellopy 909).
- **Fluxo**: login admin → `/monsters/new` → preencher via formulário real → Salvar (`POST
  /monsters`, backend `MysqlMonsterRepository` confirmado — `hasRoDatabase()` ativo).

### Camada 1 — Persistência

`SELECT` direto em `mob_db_re` (não a API) confirma todos os campos gravados corretamente —
ver tabela acima. **PASSOU.**

### Camada 2 — Runtime

- Reload automático no save + reload manual (botão "Monstros" em `/` → fila `panel_reload_queue`
  drenada em <1s pelo NPC `panel.txt`).
- Boot do map-server: `Loading '2676' entries in 'mob_db_re'` → `Done reading '2676' entries` —
  **zero linhas descartadas**, monstro novo carregado em memória sem erro. **PASSOU** (após 2
  correções, ver "Achados" abaixo).

### Camada 3 — `/play`

Confirmado via `window.__world()` (debug hook real do cliente, `net/worldStore.ts:1287`, não
inventado para o teste) — o cliente recebeu do servidor, em tempo real, a entidade:
`{"gid":110027796,"tipo":"mob","job":25001,"nome":"QA Slime Novo","nivel":5,"hp":"50/50",
"celula":[65,57]}`. **PASSOU** (spawn reconhecido pelo cliente via pacote de rede real).

**Limitação de ferramenta registrada, não do produto**: não foi possível confirmar visualmente o
modelo 3D do mob nem executar combate por clique via Playwright MCP neste mapa — cliques
sintéticos (`PointerEvent`) e `Tab` no canvas React Three Fiber não disparam o handler de
clique-tile/target do jogo (o raycasting do R3F parece exigir eventos de ponteiro genuinamente
confiáveis do SO, que a automação não reproduz). Screenshots em
`docs/audit/fase3-testes/backup/{08..12}*.png` mostram o mapa carregado e o HUD correto, mas não o
modelo do mob em quadro. A prova funcional desta seção vem da camada 2 (boot limpo) + `window.__world()`
(estado de rede real do cliente), não de uma captura de tela do combate.

## Teste 2.2 — Monstro existente `Poring` (id 1002) no mesmo mapa

- Nenhuma edição — usado como está (nível 1, HP 55).
- **PASSOU** (mesma evidência de `window.__world()`: 3 Poring vivos, posições mudando entre
  consultas — IA de movimento rodando de verdade no servidor, não estático).

## Teste 2.3 — Coexistência no mesmo mapa

`window.__world()` capturado duas vezes (intervalo ~1 min) mostra 3× `QA Slime Novo` (job 25001) +
3× `Poring` (job 1002) simultaneamente em `gpqa01`, com células mudando entre as duas capturas
(prova de IA rodando, não snapshot congelado):

```
1ª leitura: QA Slime [50,59] [77,56] [65,57] · Poring [90,55]→[94,52] [72,18]→[67,11] [25,66]→[20,65]
2ª leitura: QA Slime [50,59] [77,56] [65,57] · Poring [71,64]→[71,66] [69,24] [19,63]→[17,69]
```

**PASSOU.**

## Teste 2.4 — Spawns via admin (A23)

Seção "Spawns" do `MonsterForm` está travada (campo desabilitado) com aviso explícito: *"Este
servidor lê monstros direto do MySQL (mob_db_re), que não tem coluna pra spawn — spawn real do
rAthena é script NPC. Editar aqui não é gravado; a seção está travada pra não fingir que salvou."*
Confirma que o achado A23 do `risk-report.md` já foi endereçado nesta rodada de Fases anteriores —
não como write-path novo, mas como HONESTIDADE de UI (trava + aviso, em vez de aceitar edição que
seria descartada em silêncio). **NÃO APLICÁVEL** (por design, com evidência).

Caminho real usado para o spawn (fora do admin, como o aviso já indica): `npc-idle/mobs/gpqa01.txt`
+ `npc:` em `rathena-conf/map_conf.txt` + restart. Ver seção 1 (mapas) para o registro completo.

## Achados desta seção

### A26 (alta, CONFIRMADO e CORRIGIDO nesta rodada) — `Monster.groupId`: campo limpo no admin ainda gravava 0, não `undefined`

**Este é exatamente o "requisito mais importante da Fase 1"** citado em `leia1.txt` ("bug
`num("") -> 0`") — e a bateria de testes provou, ao vivo contra o rAthena, que ele **não estava
resolvido para este campo**, apesar do aviso já presente na UI ("0 = nenhum grupo... deixe vazio").

- **Reprodução**: criar monstro com `GroupId` no valor-padrão exibido ("0") e salvar → boot do
  map-server rejeita a linha inteira: `[Error]: Node "GroupId" needs to be at least 1.` →
  `Loading '2676' entries` / `Done reading '2675' entries` — **1 monstro inteiro desaparece do
  servidor rodando, sem nenhum erro visível no admin** (o `POST` retorna 200/201 normalmente).
- **Causa raiz** (2 pontos, achados em conjunto):
  1. `packages/game-data/src/monster.ts:113` — `groupId: z.number().int().default(0)`. Mesmo que o
     `NumberField` do formulário emita `undefined` corretamente ao limpar o campo, o `.default(0)`
     do zod reintroduz `0` no boundary do `parse()` — tanto no client (submit) quanto no server
     (`POST`/`PUT`), então a chave nunca chega de fato ausente em lugar nenhum.
  2. `apps/api/src/store/mysql-monster-row.ts:245` — `groupid: monster.groupId,` sem
     null-coalescing, então mesmo se o zod permitisse `undefined`, o valor passado pro driver mysql2
     seria `undefined` (comportamento não garantido) em vez do `null` que a coluna espera.
- **Evidência de que era regressão isolada, não sistêmica**: `SELECT COUNT(*), SUM(groupid=0),
  SUM(groupid IS NULL) FROM mob_db_re` nos ~2676 monstros reais (migrados, nunca editados por este
  admin) → **2669 NULL, 0 com groupid=0** antes deste teste. Só a linha criada NESTA bateria tinha
  `groupid=0`. Confirma que o pipeline de import original (yaml2sql) sempre gravou NULL
  corretamente; o bug é específico do write-path do admin.
- **Correção aplicada** (mínima, escopo do requisito mais importante da Fase 1):
  - `packages/game-data/src/monster.ts:113`: `.default(0)` → `.optional()`.
  - `apps/api/src/store/mysql-monster-row.ts:245`: `groupid: monster.groupId ?? null,`.
  - `apps/api/src/store/monster-row.ts:99` (backend Supabase/JSON, não afetado pelo bug mas
    precisava de ajuste de tipo): `group_id: m.groupId ?? 0,` (preserva o comportamento anterior
    nesse backend, que não tem a restrição "0 é rejeitado" do rAthena).
- **Reteste**: campo limpo via UI real (`fill('')` no `NumberField`, clique em Salvar) → `SELECT
  groupid FROM mob_db_re WHERE id=25001` → **NULL**. Boot seguinte: `Loading '2676'` /
  `Done reading '2676'` — **zero linhas perdidas**. Confirmado também por PUT direto via `fetch()`
  autenticado (bypass do formulário), isolando que o fix vale tanto no schema quanto no writer.
- **Verificação de regressão**: `pnpm --filter @ragnarok/game-data typecheck`,
  `pnpm --filter @ragnarok/api typecheck` — limpos. `pnpm --filter @ragnarok/api test` —
  `mysql-monster-row.test.ts` (3 testes) passa; 1 falha pré-existente e não relacionada
  (`map-row.test.ts`, ver `verificacao-final.md`).
- Adicionado ao `docs/audit/risk-report.md` como **A26**.

### A25b (informativo) — faixa válida de `Monster ID` para script de spawn não documentada em lugar nenhum do projeto

Ao tentar spawnar o monstro novo (primeira tentativa com id 39001, escolhido por estar bem acima
do maior id em uso na época, 22668), o boot rejeitou: `[Error]: Invalid monster ID 39001, must be
in range 1000-3999 or 20020-31999.` (validação em `rathena/src/map/mob.cpp:4983`,
`MIN_MOB_DB`/`MAX_MOB_DB`/`MIN_MOB_DB2`/`MAX_MOB_DB2`). O admin (`MonsterForm.tsx`) não valida essa
faixa em lugar nenhum — o `ID` é um `<input type=number>` livre. Recriado com id 25001 (dentro de
20020-31999, livre no banco). **Não corrigido nesta rodada** (adicionar a faixa exigiria mexer em
`field-limits.ts`/`MonsterForm.tsx`, fora do escopo de "só testar"; registrado para decisão futura).
Adicionado ao `risk-report.md` como nota do A26 (mesma família de "range real do rAthena não
espelhada na UI", como A7/A15).

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| Criar monstro novo (25001) | PASSOU | PASSOU (após corrigir A26 + reescolher ID) | PASSOU (rede confirmada, visual não) | **PASSOU** |
| Monstro existente (Poring 1002) no mesmo mapa | N/A (não editado) | PASSOU | PASSOU | **PASSOU** |
| Coexistência dos dois | — | — | PASSOU (`window.__world()`, 2 leituras) | **PASSOU** |
| Spawns via admin | — | — | — | **NÃO APLICÁVEL** (travado por design, A23 já endereçado) |
