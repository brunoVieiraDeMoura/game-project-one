# 8. Classes — evidência de teste funcional real

Backend: YAML (`job_stats.yml`/`job_basepoints`/`job_exp`/`job_aspd`/`skill_tree.yml`,
`job-database-writer.ts`).

## Teste 8.1 — Editar classe existente (Swordman, id 1)

- Tentativa de alterar "Nível base máximo" via admin (50→51). Salvo sem erro na UI, mas
  `GET /job-classes/1` releu `maxBaseLevel: 99` (não 51) — **resultado não confirmado como o
  esperado**. Não foi possível, no tempo restante, determinar se (a) o campo editado no formulário
  não corresponde ao `maxBaseLevel` real (rótulo confuso — o snapshot do formulário mostrou dois
  campos com nomes muito parecidos, um provavelmente é derivado/somente leitura), ou (b) há um
  bug de write-path similar aos já encontrados nesta bateria (A26/A28/A29). **Registrado como
  achado aberto, não investigado a fundo** — recomenda-se retestar em rodada futura com mais
  tempo, seguindo o mesmo processo de isolamento usado para A26/A28/A29.
- `job_stats.yml`/reload não verificados nesta tentativa por causa do resultado inconclusivo acima.

## Teste 8.2 — Criar classe nova / 8.3 — Classe antiga / `/play` (XP, HP, SP, ATK)

**Não testados nesta rodada** — tempo da bateria esgotado antes de chegar a esta cobertura.

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| Editar classe existente | **INCONCLUSIVO** (valor não refletiu o esperado) | NÃO TESTADO | NÃO TESTADO | **BLOQUEADO** (tempo — achado aberto, não investigado) |
| Criar classe nova | — | — | — | **NÃO TESTADO** (tempo) |
| Classe antiga | — | — | — | **NÃO TESTADO** (tempo) |
