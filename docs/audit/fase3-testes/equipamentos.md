# 5. Equipamentos — evidência de teste funcional real

Mesmo backend/personagem de teste da seção 4 (MySQL `item_db_re`, personagem `Campo` — inventário
funcional, ao contrário de `GPQA3`, ver A27).

## Teste 5.1 — Criar arma nova

- **Item**: id 39200, `GPQA_SWORD` / "QA Espada", tipo Arma, subtipo Espada (1M), local
  `right_hand`, ATK 100, nível de arma 1, refinável, script ao equipar `bonus bStr,5;`.
- **Persistência**: `SELECT` confirma `attack=100`, `location_right_hand=1`, `weapon_level=1`,
  `refineable=1`, `equip_script='bonus bStr,5;'` — o `equip_script` também passou a persistir
  corretamente graças ao fix do A28 (mesma causa raiz, mesmos 3 campos).
- **Runtime**: reload automático (`itemdb`) no save.
- **`/play`** (personagem `Campo`): `@item 39200 1` → item no inventário real → `item:equip` →
  `equipped: true`, `atkBonus` 0→100 (bate exatamente com o ATK configurado), `aspd` 210→360
  (penalidade de velocidade por trocar de arma — mecânica real do rAthena, não inventada) →
  `item:unequip` → `equipped: false`, `atkBonus` volta a 0. **PASSOU** (equipar/desequipar e ATK
  confirmados numericamente contra o servidor real).
- Bônus do script de equipar (`bStr,5`) não foi isolado numericamente na janela de teste (o
  resumo `window.__player()` não expõe separadamente "bônus de STR de equipamento" vs. outros
  bônus já presentes no personagem `Campo`, que tem gear própria) — **não confirmado nem refutado**,
  registrado como lacuna, não como falha.

## Teste 5.2 — Editar equipamento existente (Cotton Shirt, id 2301)

- `Defesa` alterada de 10 → 20. `SELECT defense FROM item_db_re WHERE id=2301` → `20`. **PASSOU**
  (persistência + reload; efeito em jogador não testado nesta rodada por tempo — mecanismo de
  equipar já provado no teste 5.1 com a arma).

## Teste 5.3 — Equipamento antigo

Coberto indiretamente: os 3 itens de equipamento inicial de `GPQA3` (Knife 1201, Cotton Shirt
2301, item 23484) e o inventário completo de `Campo` (55 itens reais, incluindo equipamentos)
continuam carregando e equipados normalmente após os 3 restarts do servidor ao longo da bateria —
nenhuma regressão observada em equipamento pré-existente.

## Não testado nesta rodada (nota de escopo)

Cartas/slots (`CardApplyDialog`), restrição de classe bloqueando equipar item incompatível,
requisito de nível, e cobertura de acessórios/armaduras adicionais — não testados por tempo.
`A3` do `risk-report.md` (colunas SQL ausentes pra `both_hands`/`both_accessories`/variantes
`all_upper` etc.) não foi re-verificado nesta rodada — achado já documentado em auditoria anterior,
não contestado, não reconfirmado ao vivo aqui.

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| Criar arma nova | PASSOU (após A28) | PASSOU | PASSOU (ATK/ASPD numéricos) | **PASSOU** |
| Editar equipamento existente | PASSOU | PASSOU | NÃO TESTADO (tempo) | **PASSOU** (parcial) |
| Equipamento antigo | PASSOU (sobrevive a 3 restarts) | PASSOU | PASSOU (indireto) | **PASSOU** |
| Cartas/restrição de classe/nível | — | — | — | **NÃO TESTADO** |
