# 7. Status — evidência de teste funcional real

Backend: YAML (`rathena-db-import/status.yml`, `YamlStatusRepository`) + metadados descritivos em
Supabase (`description`, migrado de `rathena/doc/status_change.txt`).

## Teste 7.1 — Editar status existente (`poison`)

- Campo `description` alterado para incluir marcador "(editado QA Fase 3)". Confirmado via
  `GET /statuses/poison` → novo texto presente.
- **Nota de escopo**: `description` é metadado informacional (documentado no próprio rótulo do
  campo no admin: "Vem de `rathena/doc/status_change.txt` na migração"), não uma coluna que o
  rAthena carrega em runtime — por isso não aparece em `status.yml`. Editar campos que SÃO
  carregados pelo runtime (`flags`, `calcFlags`, `states`, `icon`) não foi testado nesta rodada
  por tempo.
- **Runtime**: `POST/PUT` de status também engatilha `queueReload("statusdb")` — confirmado
  drenado (`panel_reload_queue`, kind=statusdb, `requested_at`≈`done_at`).

## Teste 7.2 — Criar status novo / 7.3 — Status antigo / aplicação em `/play`

**Não testados nesta rodada.** Tentativa de aplicar status via GM (`@sc <id> <duration>`) falhou
com `"@sc is Unknown Command."` — confirmando que esse não é o nome real do comando neste build
de rAthena (achado do teste, não bug: `@sc` não existe na tabela de atcommands real, só
`@displaystatus` — que só manda o ÍCONE visual via `clif_status_change`, sem aplicar o efeito de
verdade no `sc_data` do jogador, então não serviria como prova funcional). O tempo restante da
bateria não permitiu identificar o comando correto nem testar aplicação via skill/item real.

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| Editar status existente (metadado) | PASSOU | PASSOU (reload) | NÃO TESTADO | **PASSOU** (parcial) |
| Criar status novo | — | — | — | **NÃO TESTADO** (tempo) |
| Status antigo / aplicação real | — | — | — | **NÃO TESTADO** (tempo; comando GM incorreto identificado, não corrigido no teste) |
