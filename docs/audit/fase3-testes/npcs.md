# 9. NPCs — evidência de teste funcional real

Backend: NPCs migrados via Supabase/JSON, com ponte real para o `.txt` (`npc-script-sync.ts`),
que escreve **diretamente em `rathena/npc/...`** — a única exceção deliberada e testada à regra
"`rathena/` é somente leitura" (feature aprovada em sessão anterior, `leia1.txt` 2026-08-08,
com suíte própria `npc-script-sync.test.ts`/`npc-script-sync.functional.test.ts`, ambas passando).
Toda tentativa de escrita nesta seção foi feita com backup prévio do arquivo real tocado
(`docs/audit/fase3-testes/backup/{quests_dicastes,poring_war}.txt.bak-fase3`) e conferida
byte-a-byte (`diff`) depois — nenhuma mudança líquida ficou em `rathena/`.

## Teste 9.1 — NPC antigo (`Mestre do Teste`, `npc-idle/devmenu.txt`)

Interagido AO VIVO em `/play` via os mesmos eventos de rede que um clique real dispara
(`npc:talk`/`npc:next`/`npc:menu`/`npc:close`, `net/gateway.ts`):
1. `npc:talk` → 3 linhas de diálogo reais + `next` (texto do `.txt` real, batendo com
   `npc-idle/devmenu.txt`).
2. `npc:next` → menu de 5 opções (`Classe de 3a`, `Classe de 4a`, `So maximizar`, `Resetar`,
   `Cancelar`) — o MESMO switch/select do script real.
3. `npc:menu` (escolha "Cancelar") → `close` — encerramento correto.
- **PASSOU** — fala, next, choice e close confirmados contra o script real rodando no rAthena.

## Teste 9.2 — Editar NPC existente

Duas tentativas, ambas com backup prévio do `.txt` real e `diff` posterior confirmando ZERO
mudança líquida (o writer recusou nos dois casos, sem escrever nada):

- **`jellopy`** (nó `action`/legacyScript): `PUT` recusado com HTTP 422
  `"nó \"n0\" (kind \"action\") não tem escrita suportada ainda"`. Confirma que o writer só sabe
  reimprimir `say`/`end`/`action:warp` — a maioria dos NPCs migrados (que usam scripts legados
  complexos) não é editável pelo admin ainda. **NÃO APLICÁVEL** (por design, writer recusa por
  segurança em vez de corromper).
- **`poring_war_recruiter-wop`** (nó `say`, texto multi-linha): adicionar um sufixo à última
  linha do texto foi recusado com HTTP 500 `"round-trip falhou: o corpo novo não reparseia pro
  grafo pedido"` — a guarda de segurança do writer (reparsear o resultado e comparar contra o
  grafo pedido) pegou uma divergência e abortou ANTES de escrever. **FALHOU** o teste específico
  desta edição, mas o COMPORTAMENTO do writer (recusar em vez de gravar algo errado) é o correto
  e intencional — registrado como A30 no `risk-report.md`, não como bug a corrigir nesta rodada.
- Nenhuma edição de NPC foi persistida com sucesso nesta bateria — a cobertura real de nós
  editáveis é mais estreita do que os testes tentados aqui cobriram.

## Teste 9.3 — Criar NPC novo

**Não testado nesta rodada** (tempo). Pela leitura do código (`apps/api/src/routes/npcs.ts`), o
`POST /npcs` NÃO chama `applyNpcScriptEdit` (só o `PUT` faz) — um NPC criado pelo admin ficaria
só no banco (Supabase/JSON), sem nunca virar um `.txt` real carregável pelo rAthena. Isso bateria
com o padrão já documentado (A23, `Monster.spawns[]`): funcionalidade exposta na UI sem
write-path real por trás. **Não confirmado ao vivo** — inferência de leitura de código, registrada
como suspeita para validação futura, não como achado fechado.

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| NPC antigo | N/A (não editado) | PASSOU | PASSOU (fala/next/choice/close reais) | **PASSOU** |
| Editar NPC existente | FALHOU (2/2 recusados pelo writer, corretamente) | N/A | N/A | **FALHOU** (cobertura de nós estreita, comportamento seguro — ver A30) |
| Criar NPC novo | — | — | — | **NÃO TESTADO** (tempo; suspeita de gap por leitura de código, não confirmada) |
