# 6. Skills — evidência de teste funcional real

Backend: YAML (`rathena-db-import/skill_db.yml`, `YamlSkillRepository`).

## Teste 6.1 — Criar skill nova

- **Skill**: id 10020, `GPQA_BOLT` / "QA Raio", nível máx 5, alvo Inimigo, alcance 9, 1 hit,
  custo SP 20, cast fixo 500ms, cooldown 1000ms.
- **Persistência**: `grep "Id: 10020"` em `skill_db.yml` confirma todos os campos.
- **Achado A29 (alta, CONFIRMADO e CORRIGIDO nesta rodada)**: a skill **não carregava no
  rAthena** — boot reportava `[Error]: An ammo type is required before specifying ammo amount.`
  e `Loading '1' entries` / `Done reading '0' entries` (skill inteira descartada). Causa raiz:
  `AmmoAmount` emitido incondicionalmente no writer YAML, violando a regra real do loader
  (`skill.cpp:15432-15434`: `AmmoAmount` presente exige `Ammo` com algum tipo marcado). Duas
  iterações de correção: a primeira (gate por `Object.keys(ammo).length`) não bastou porque o
  mapa de munição sempre tem as 10 chaves presentes (todas `false`); a correção real usa
  `Object.values(ammo).some(Boolean)`. **Isso bloqueava a criação de QUALQUER skill nova sem
  requisito de munição pelo admin** — achado de alto impacto, ver `risk-report.md` A29 para o
  detalhamento completo (inclui teste isolado da função pura, fora do HTTP, provando a causa raiz).
- **Runtime**: após o fix, boot confirma `Loading '1' entries` / `Done reading '1' entries` —
  carregamento limpo.
- **`/play`**: `@allskill` (GM) + tentativa de `skill:use` contra monstros reais em `prt_fild08`
  não gerou resposta observável na janela de teste (nem cast, nem rejeição por alcance) — os
  monstros disponíveis estavam fora do alcance configurado (9 células) e o tempo restante da
  bateria não permitiu aproximar e reconfirmar. **NÃO OBSERVADO** (nem confirmado nem refutado);
  runtime (carregamento pelo servidor) está provado, o disparo em combate real não.

## Teste 6.2 — Editar skill existente / 6.3 — Skill antiga

**Não testados nesta rodada** — o tempo da bateria foi consumido isolando e corrigindo o A29
(bug que bloqueava toda skill nova, prioritário sobre os testes de edição/skill antiga).

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| Criar skill nova | PASSOU | PASSOU (após corrigir A29) | NÃO OBSERVADO | **PASSOU** (persistência+runtime) |
| Editar skill existente | — | — | — | **NÃO TESTADO** (tempo) |
| Skill antiga | — | — | — | **NÃO TESTADO** (tempo) |
