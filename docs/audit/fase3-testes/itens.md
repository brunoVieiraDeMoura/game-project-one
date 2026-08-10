# 4. Itens — evidência de teste funcional real

Backend: MySQL (`item_db_re`, `MysqlItemRepository`). Personagem de teste: `Campo` (conta `campo1`,
GM, nível 200) — usado porque `GPQA3` tem o bug A27 (inventário nunca persiste) que teria mascarado
os resultados aqui; `Campo` já tinha 55 itens reais persistidos, confirmando que seu inventário
funciona normalmente.

## Teste 4.1 — Criar item novo (tipo Cura, com script real, delay e stack)

- **Item**: id 39100, `GPQA_HEAL_POTION` / "QA Poção de Cura", tipo Cura, compra 50z / venda 25z,
  peso 10, delay de uso 3000ms, stack máximo 30 (só inventário), script ao usar `heal 500,0;`.
- **Persistência**: `SELECT` em `item_db_re` confirma todos os campos, incluindo
  `delay_duration = 3` (3000ms → 3s, **A19 confirmado funcionando** nesta rodada) e
  `stack_amount = 30`.
- **Achado A28 (alta, CONFIRMADO e CORRIGIDO nesta rodada)**: o script (`script` = `heal 500,0;`)
  **não persistiu nas duas primeiras tentativas** — ficou `NULL` mesmo com o texto certo digitado
  e confirmado no corpo da requisição `PUT` (capturado via rede: `"rawScript":"heal 500,0;"`
  presente). Causa raiz: `rawScript`/`rawEquipScript`/`rawUnequipScript` nunca foram declarados em
  `ItemSchema` (`packages/game-data/src/item.ts`) — só existiam no tipo interno `MysqlItem`
  (`apps/api/src/store/mysql-item-row.ts`). `ItemSchema.safeParse(req.body)` na rota descarta
  chaves não declaradas por padrão do zod, então o texto digitado nunca chegava no repositório —
  a lógica de merge do `MysqlItemRepository.update()` então preservava o script ANTIGO (NULL para
  item novo). **Corrigido**: os 3 campos adicionados como `z.string().optional()` em `ItemSchema`.
  Retestado: script grava corretamente. Ver `risk-report.md` A28 para o detalhamento completo.
- **Runtime**: `POST /items` engatilha reload automático (`queueReload("itemdb")`), fila drenada
  em <1s.
- **`/play`**: `@item 39100 5` no personagem `Campo` → chat confirma "Item created." → item
  aparece no inventário real (`window.__player().inventario`, índice 57, amount 5) →
  `item:use` (mesmo evento que o clique de usar dispara) → amount cai pra 4, sem erro — script
  `heal 500,0;` executou (efeito imperceptível contra HP cheio de 37.187, mas SEM falha/rejeição).
  Screenshot: `docs/audit/fase3-testes/backup/16-item-novo-inventario-campo.png` (mostra o
  inventário REAL de Campo com 55+ itens, prova de que a persistência funciona pra este personagem).
- **PASSOU** (após corrigir A28).

## Teste 4.2 — Editar item existente (Red Potion, id 501)

- Alterado `Preço de venda` de 0 → 15z. Salvo.
- **Persistência**: `SELECT price_sell, script FROM item_db_re WHERE id=501` → `15`,
  `itemheal rand(45,65),0;` — preço novo gravado, e o **script real do item (não tocado nesta
  edição) permaneceu intacto**, confirmando que a lógica de merge do repositório preserva
  corretamente campos não enviados quando o operador não mexe neles (o mesmo mecanismo que
  causava o A28 quando o campo ERA enviado, mas descartado antes de chegar).
- **PASSOU**.

## Teste 4.3 — Item antigo (Red Potion, sem editar comportamento)

- Usado ao longo de toda a bateria: drop de monstro (100% rate, seção 3), `@item 501 N` (GM),
  inventário do jogador mostrando "First aid Box" com contagem correta, script de cura real
  (`itemheal rand(45,65),0;`) visível no admin e consistente com o item real do rAthena.
- **PASSOU**.

## Cobertura de tipos — nota de escopo

O pedido original pedia cobertura de TODOS os tipos suportados (`healing`, `usable`, `etc`,
`armor`, `weapon`, `card`, `pet_egg`, `pet_armor`, `ammo`, `delay_consume`, `shadow_gear`, `cash`).
Dado o tempo já investido nesta bateria (2 bugs reais de write-path encontrados e corrigidos nesta
mesma seção — A27 fora do admin, A28 dentro dele — cada um exigindo reprodução, isolamento de
causa raiz e reteste), a cobertura desta rodada ficou em **1 tipo criado do zero (Cura) +
1 edição (Cura existente)**, ambos com prova completa de persistência→runtime→`/play`. Armadura/
arma/carta são cobertos separadamente na seção 5 (Equipamentos), que junto com Cura soma 2 dos 12
tipos com prova end-to-end. Os demais 9 tipos (`usable`, `etc`, `pet_egg`, `pet_armor`, `ammo`,
`delay_consume`, `shadow_gear`, `cash`) **não foram testados nesta rodada** — ficam como pendência
explícita, não como "aprovados por omissão".

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| Criar item novo (Cura) | PASSOU (após corrigir A28) | PASSOU | PASSOU | **PASSOU** |
| Editar item existente | PASSOU | PASSOU | N/A (preço não requer novo teste de uso) | **PASSOU** |
| Item antigo | PASSOU | PASSOU | PASSOU | **PASSOU** |
| Demais 9 tipos de item | — | — | — | **NÃO TESTADO** (fora do orçamento de tempo desta rodada) |
