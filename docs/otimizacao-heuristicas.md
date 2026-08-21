# Otimização: heurísticas de escala do cliente 3D

Plano completo em `C:\Users\Bruno\.claude\plans\twinkling-tickling-marshmallow.md`
(auditoria linha a linha do que já existe, o que é parcial, e por que algumas
heurísticas do relatório externo foram rebaixadas para este projeto — `area_size:
60` já faz interest management no servidor, ~25 entidades na tela, GC medido em
226ms de pico).

Ordem escolhida para nunca voltar num arquivo já fechado: substrato de
importância → LOD (VFX/animação/entidade) → orçamento global (livro-caixa, não
gerente — ver contrato em T5a) → GC → HUD → assets.

## Status

| # | Task | Status | Notas |
|---|---|---|---|
| T0 | Linha de base medida (`test:perf` + cenário headed + `__voo`) | ⬜ pendente | |
| T1 | `core/importancia.ts` — módulo puro de tier/taxa | ⬜ pendente | |
| T2 | Ligar LOD de VFX (thresholds calibrados, 5 renderers restantes) | ⬜ pendente | |
| T3 | Animation LOD (taxa por distância, não binário) | ⬜ pendente | |
| T4 | Buckets de frequência de entidade (plaquinha/barra/GlowChao) | ⬜ pendente | mesmo `useFrame` de T3 |
| T5a | Contrato do `FrameBudget` validado (teste de semântica) | ⬜ pendente | ver `leia1.txt` — livro-caixa, não `GlobalManager` |
| T5b | Terreno/moveTarget/VFX consultam o `FrameBudget` | ⬜ pendente | |
| T6 | Passada de GC (matar `.clone()`/alocação em `useFrame`) | ⬜ pendente | |
| T7 | Consolidar rAF do HUD num tick único | ⬜ pendente | |
| T8 | Assets: descarte por mapa + KTX2/Draco/meshopt | ⬜ pendente | |
| T9 | Entity LOD visual / occlusion / workers — só se T0 provar necessidade | ⬜ não iniciar sem dado | |

Legenda: ⬜ pendente · 🔄 em andamento · ✅ concluído · ⏭️ pulado (com motivo)
