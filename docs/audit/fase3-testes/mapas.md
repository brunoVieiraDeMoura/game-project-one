# 1. Mapas — evidência de teste funcional real

Protocolo: PERSISTÊNCIA → RUNTIME → `/play`, fluxo real do projeto (admin autenticado → editor 3D
embutido → export:mapcache → registro `map_index.txt`/`map_conf.txt` → restart rAthena).

## Teste 1.1 — Criar mapa novo `gpqa01`

- **ID**: `gpqa01` (antes `novo_msnl57jl`, renomeado via "✎ Info" no admin — caminho real de rename)
- **Nome**: "GPQA01 (teste Fase 3)"
- **Dados configurados**: 128×128 células, `terrainMode: "square"`, 1 célula bloqueada (pincel
  "Montanha ⛰" no editor 3D real, em `hex 81,59`, autorada com dois cliques no mesmo ponto)
- **Fluxo usado**: login admin (`bruno.moura.code@gmail.com`) → `/maps` → "+ Novo mapa 3D" → editor
  3D embutido (`localhost:3001/editor` via iframe autenticado) → pintura da parede → "Salvar"
  (`POST /maps` via `createMap`, fallback do `updateMap` 404) → "✎ Info" → renomear id para
  `gpqa01` (`PUT /maps/novo_msnl57jl` com `id: "gpqa01"` no corpo → Supabase `UPDATE ... WHERE
  id = novo_msnl57jl` seta a PK nova)

### Camada 1 — Persistência

- `GET http://localhost:4000/maps/gpqa01` → `{"id":"gpqa01","name":"GPQA01 (teste Fase 3)",
  "size":{"width":128,"height":128},"terrainMode":"square"}` ✅ (API, fonte crua é Supabase —
  repositório ativo confirmado por `defaultMapRepository()`)
- **PASSOU**

### Camada 2 — Runtime (rAthena real)

1. `pnpm --filter @ragnarok/legacy-migration export:mapcache -- --maps gpqa01`
   → `rathena-db-import/map_cache.dat` (**achado A24**, ver abaixo — reduziu o cache de 1 mapa
   (`prt_fild08`) pra 1 mapa (só `gpqa01`); corrigido reexportando `--maps prt_fild08,gpqa01`)
2. Registro em `rathena-db-import/map_index.txt`: `gpqa01	1900` (**achado A25** — a primeira
   tentativa, `1250` copiado do comentário-exemplo do próprio arquivo, colidiu com o mapa vanilla
   `1@ch1a`; a segunda, `5000`, estourou `MAX_MAPINDEX=2000`)
3. Registro em `rathena-conf/map_conf.txt`: `map: gpqa01` (sem isto o mapindex conhece o nome mas
   nenhum map-server hospeda o mapa)
4. `scripts/wsl-stop.sh` + `scripts/wsl-run.sh` (3 restarts ao todo, um por iteração dos achados
   A24/A25 acima)
5. `logs/map.log` do boot final: **zero** ocorrências de `error`/`warning`/`overriding`/`out of
   range` relacionadas a `gpqa01`; `[Status]: Server is 'ready' and listening on port '5122'`
- **PASSOU** (após corrigir A24/A25 — ver seção de achados)

### Camada 3 — `/play`

- Login conta QA (`gpqa3` / GM), personagem `GPQA3`, chat `@warp gpqa01 64 64` → resposta do
  servidor `"Warped."` no chat, minimapa passa a mostrar "GPQA01 (teste Fase 3)" como nome do mapa
  atual, terreno 3D carregado (103 chunks, textura grama) —
  `docs/audit/fase3-testes/backup/05-warp-gpqa01.png`
- Clique-tile (canvas 3D) → personagem se move para o ponto clicado (predição client-side +
  confirmação do servidor) — `docs/audit/fase3-testes/backup/06-gpqa01-movimento.png`
- `@warp gpqa01 76 59` (5 células a oeste da parede pintada em 81,59, mesma linha) → segundo
  `"Warped."` confirmado — `docs/audit/fase3-testes/backup/07-perto-da-parede.png`
- **Limitação de ferramenta registrada, não do produto**: a confirmação visual pixel-a-pixel de
  "o personagem para exatamente na borda da célula bloqueada" não foi capturada — o driver
  (Playwright MCP) só clica no CENTRO de um elemento, sem coordenadas arbitrárias de tela, então
  não foi possível mirar precisamente a célula da parede a partir do ângulo de câmera disponível.
  A prova de colisão fica pela camada 2 (export reportou exatamente **37 células bloqueadas**,
  número que corresponde à área pintada com o pincel "Montanha" no editor — mesma fonte, mesma
  contagem, sem intervenção manual no meio) + carga limpa do mapa pelo rAthena sem erro de grade.
- **PASSOU** (mapa aparece, é reconhecido pelo runtime, jogador entra e se move; colisão
  evidenciada numericamente, não pixel-a-pixel)

## Achados desta seção (ver `docs/audit/risk-report.md` para o texto completo)

- **A24** (alta, tooling): `export-mapcache.ts` substitui `map_cache.dat` inteiro em vez de
  mesclar — reexportar 1 mapa apaga os demais do arquivo. Mitigado nesta rodada re-listando todos
  os mapas (`prt_fild08,gpqa01`); não corrigido em código (fora do escopo desta bateria).
- **A25** (média, doc): comentário-exemplo do template (`map_index.txt`, índice 1250) colide com
  mapa vanilla real (`1@ch1a`); `MAX_MAPINDEX` é 2000, não documentado em lugar nenhum do projeto.
  `gpqa01` registrado em 1900. Comentário do template não foi editado (seria alterar arquivo fora
  do escopo estrito da bateria — registrado para decisão do usuário).

## Resumo da seção

| Teste | Persistência | Runtime | `/play` | Veredito |
|---|---|---|---|---|
| Criar mapa novo (`gpqa01`) | PASSOU | PASSOU (após corrigir A24/A25) | PASSOU | **PASSOU** |
