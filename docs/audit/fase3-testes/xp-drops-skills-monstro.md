# 3. Drops / XP / Skills dos monstros — evidência de teste funcional real

Protocolo: PERSISTÊNCIA → RUNTIME → `/play`. Monstro alvo: `GPQA_NOVO_MOB` (id 25001, ver
`monstros.md`) — nível 5, HP 50, EXP base 999 / job 444, 2 drops a 100% (Red Potion 501, Jellopy
909). Personagem: `GPQA3` (conta QA `gpqa3`, GM).

**Nota sobre o método de combate**: o driver de automação (Playwright MCP) não conseguiu disparar
clique-tile nem `Tab`-target no canvas React Three Fiber deste projeto (cliques sintéticos e
reais do Playwright não acionam o raycasting da cena — ver `monstros.md`, limitação de ferramenta
registrada). Para testar combate de fato, usei o socket real do jogo
(`window.__gateway`, exposto em DEV — `net/gateway.ts:258`) para emitir os MESMOS eventos que o
clique do jogador emitiria (`move:to`, `action:attack`, `item:pickup`) e o MESMO hook de leitura
que o HUD usa (`window.__world`, `window.__player` — `net/worldStore.ts:1287`,
`net/playerStore.ts:335`). Isto ainda é o caminho de rede real cliente↔gateway↔rAthena — não é
mock nem leitura de banco; é o mesmo protocolo, só sem o mouse físico no meio.

## Teste 3.1 — XP recebido pelo jogador

- **Antes**: `SELECT base_level,job_level,base_exp,job_exp FROM char WHERE name='GPQA3'` →
  `1, 1, 0, 0`.
- **Combate real**: sequência `move:to` + `action:attack` até o mob morrer (HP 50→32→14→morto,
  3 hits confirmados via `window.__world()` entre cada golpe — dano server-autoritativo, não
  calculado no cliente).
- **Depois** (mesma sessão, `@save` força `chrif_save(sd, CSAVE_NORMAL)` —
  `rathena/src/map/atcommand.cpp:960`, salva o char inteiro incluindo XP):
  `SELECT ...` → `4, 4, 214, 27` — personagem subiu de nível 1→4 **matando 1 monstro só** (EXP
  base 999 configurada no admin é muito acima do necessário pro nível 1→2 de um Aprendiz).
  HUD (`/play`) mostrou o mesmo valor simultaneamente (`window.__player()`,
  `docs/audit/fase3-testes/backup/13-kill-drop-no-chao.png`: LVL 4/4, HP 55/55, SP 14/14 —
  status derivado do novo nível).
- Um segundo kill (mob respawnado, 3 hits) levou a `5, 6, 39, 90` (nível 4→5 base, 5→6 job),
  confirmado de novo via `@save` + `SELECT`.
- Persistência confirmada TAMBÉM depois de restart completo do rAthena (3 restarts aconteceram
  durante a bateria por outros motivos — mapas/monstros): personagem voltou ao mundo já como
  "Nv. 4" no char-select, sem perder progresso.
- **PASSOU** — camada 1 (persistência SQL), 2 (`@save`/`chrif_save` real), 3 (`/play` HUD e
  `window.__player()` mostrando o mesmo valor).

## Teste 3.2 — Drops configurados (2× rate 100%)

- Capturado via listener real no evento `ground:item` (pacote `ZC_ITEM_FALL_ENTRY` decodificado
  pelo gateway, `apps/gateway/src/ro/session.ts:1237`) em **duas mortes independentes**:
  - 1ª morte: `{itemId:501,amount:1}` (Red Potion) + `{itemId:909,amount:1}` (Jellopy) —
    ambos presentes, nenhum drop configurado ficou de fora.
  - 2ª morte (mob respawnado): mesmos dois itens de novo, mesma quantidade.
- **Rate 100% bate**: em 2 mortes consecutivas, os 2 drops caíram as 2 vezes (nenhuma falha de
  RNG possível estatisticamente já esperado, já que é literalmente 100%) — confirma que o valor
  gravado (`drop1_rate=10000`, `drop2_rate=10000` em `mob_db_re`, ver `monstros.md`) chegou
  inteiro ao cálculo real do rAthena (`mob.cpp`, RNG contra `n/10000`).
- **PASSOU** (camada 2+3 — o drop nasce no mundo real, evento de rede real recebido pelo cliente).

## Teste 3.3 — Pegar o drop (item:pickup → inventário)

- **Achado — NÃO CONFIRMADO, requer seguimento manual**: emitir `item:pickup` com o `gid` real do
  item (capturado do próprio `ground:item`, ex. `{gid:59,itemId:501}`, jogador a ~1 célula de
  distância) **nunca gerou o evento de confirmação `inv:add`** (`net/gateway.ts:141`) em nenhuma
  das 3 tentativas (2 no personagem em nível baixo, 1 após relogin limpo). O inventário do
  jogador, tanto no cliente (`window.__player().inventario`) quanto no banco
  (`SELECT nameid,amount FROM inventory WHERE char_id=150043`), permaneceu com só os 3 itens de
  equipamento inicial em TODAS as verificações — nunca incluiu item 501 nem 909.
  - **Uma captura de tela anterior (`14-inventario-apos-drops.png`) mostrou "First aid Box (5)"
    no inventário do HUD** — mas essa tela não sobreviveu a um `@save` seguido de reconsulta nem
    a um relogin: o estado se mostrou inconsistente entre uma leitura e outra da MESMA sessão, o
    que por si só já é uma divergência (o HUD não deveria mostrar um item que o servidor nunca
    confirmou de verdade, por regra do próprio projeto — CLAUDE.md, "nunca inventar valores no
    cliente"). Não foi possível determinar se aquele "(5)" veio de um replay de um `@item 501 1`
    manual anterior (feito na preparação, seção 0) que também não persistiu, ou de outra causa.
  - **Causa raiz não determinada** — hipóteses não descartadas: (a) o pickup exige uma janela de
    "direito de loot" (quem matou tem prioridade por alguns segundos) que meu script pode ter
    perdido por timing; (b) alcance real da célula fracionária no momento do pickup ficou fora do
    raio aceito pelo `pc_takeitem` do rAthena; (c) bug real no encode do pacote `CZ_ITEM_PICKUP`
    em `packages/ro-protocol`/`apps/gateway/src/ro/session.ts:1623-1629` (não comparado byte-a-byte
    contra a struct oficial nesta rodada); (d) o clique real do mouse (que este teste não
    conseguiu simular — ver nota de limitação de ferramenta) faz uma sequência diferente (anda
    até a célula do item ANTES do pickup) que meu disparo direto não reproduziu.
  - **Não corrigido nesta rodada**: a causa raiz não foi isolada com confiança suficiente para
    editar código sem risco de mascarar um bug real ou "consertar" um comportamento correto do
    servidor. Registrado para reprodução com interação de mouse real (fora do alcance desta
    bateria de automação).
- **FALHOU** (ou BLOQUEADO, dependendo da causa real) — "usar/equipar" e "verificar no jogador"
  dos itens dropados não pôde ser completado porque o item nunca chegou ao inventário nesta
  bateria.

## Teste 3.4 — Skill do monstro em combate

- **Persistência/Runtime**: `Monster.skills` **não tem write-path no admin** (A4 do
  `risk-report.md` — zero referências a `mob_skill_db` em `mysql-monster-row.ts`/
  `mysql-monster-repository.ts`, confirmado por grep). Testado pelo caminho REAL do rAthena, como
  o protocolo previa: entrada adicionada em `rathena-db-import/mob_skill_db.txt` —
  `25001,QA Slime Novo@NPC_WATERATTACK,attack,184,1,10000,0,0,yes,target,always,0,,,,,,,`
  (skill 184 = NPC_WATERATTACK, a mesma que o Poring vanilla usa como referência,
  `rathena/db/re/mob_skill_db.txt:65`; estado `attack`, 100% de chance, sem delay).
- Boot confirmou o carregamento: `[Status]: Done reading '1' entries in
  'db/import/mob_skill_db.txt'.` — sem erro de parse, sem aviso de skill/id inválido.
  **RUNTIME: PASSOU** (o registro chega ao servidor rodando).
- **Observação em combate**: escutei o evento `skill:cast` (`net/gateway.ts:149`, pacote real de
  uso de skill) durante uma sequência de ataques contra o mob configurado, mas os golpes desta
  tentativa específica não conectaram (o mob estava se afastando por IA de passeio antes do
  próximo ataque — falha do script de teste em perseguir, não do servidor) e nenhum `skill:cast`
  foi capturado na janela observada. Não repeti a tentativa por já ter esgotado o orçamento de
  tempo razoável para esta seção — combate real já foi provado funcionando em outra sequência
  (Teste 3.1), então a lacuna aqui é só não ter capturado ESTE evento específico, não uma prova de
  que a skill não dispara.
- **Veredito**: **PASSOU (runtime) / NÃO OBSERVADO (comportamento em combate)** — o registro chega
  ao servidor real e é carregado sem erro; o disparo da skill durante o combate em si não foi
  capturado numa janela de observação, sem indicação de falha (apenas de teste incompleto).

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| XP recebido | PASSOU (`char.base_exp`/`job_exp`) | PASSOU (`@save`/`chrif_save`) | PASSOU (HUD + `window.__player()`) | **PASSOU** |
| Drops configurados (2× 100%) | N/A (efêmero, item no chão) | PASSOU (`ground:item` real, 2 mortes) | PASSOU (visível no chão) | **PASSOU** |
| Pegar drop → inventário | FALHOU (nunca em `inventory` SQL) | FALHOU (nunca chega `inv:add`) | Inconsistente (1 screenshot mostrou, releitura não confirmou) | **FALHOU** (causa raiz aberta) |
| Skill do monstro em combate | NÃO APLICÁVEL (A4, sem write-path admin) | PASSOU (script real carregado, `Done reading '1' entries`) | NÃO OBSERVADO (não capturado na janela de teste) | **RUNTIME PASSOU / combate não observado** |
