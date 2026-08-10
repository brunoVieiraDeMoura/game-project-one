# Auditoria de inputs do Admin vs rAthena

Índice. Escopo, regras e fases em `C:\Users\Bruno\.claude\plans\estuda-next-change-editor-txt-linked-kettle.md`
(aprovado — Fase 0 + Fase 1 apenas nesta rodada). Achados que exigem aprovação: `risk-report.md`.

- [items.md](./items.md) — Itens
- [monsters.md](./monsters.md) — Monstros
- [skills.md](./skills.md) — Skills
- [statuses.md](./statuses.md) — Statuses
- [job-classes.md](./job-classes.md) — Classes
- [monster-skills.md](./monster-skills.md) — Monster Skills (sem UI, bloqueado por A4)
- [risk-report.md](./risk-report.md) — Divergências e riscos (A1-A9)

## Como ler as matrizes

Cada linha é um campo do form real. Coluna `Fase` diz onde a mudança proposta entra no plano
(`Fase1` = implementado nesta rodada; `Fase2/3/4` = fora de escopo, registrado pra depois).
Coluna `Divergência` referencia um ID de `risk-report.md` quando aplicável. Todo limite numérico
cita `arquivo:linha` do rAthena real — nenhum inventado.

## O que foi implementado nesta rodada (Fase 0 + Fase 1)

Ver seção final de cada matriz / `risk-report.md` para o detalhamento; resumo consolidado no
relatório de conclusão desta tarefa (fora deste diretório, na resposta ao usuário).
