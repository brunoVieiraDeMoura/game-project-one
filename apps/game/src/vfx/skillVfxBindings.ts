/**
 * Agregador de TODAS as skills migradas pro VFX Core (leia1.txt —
 * padronização Skills/VFX). Importado uma vez por `vfx/vfxStore.ts` (efeito
 * colateral de module-load, mesmo padrão de `registrarPerfilEstruturalVfx`/
 * `registrarColetorDeMeta`) — nada aqui é chamado diretamente por ninguém.
 *
 * Cada módulo de skill migrada (`vfx/mage/<skill>/<skill>VfxDef.ts(x)`)
 * chama `defineVfx()` (registra a(s) `VfxDefinition`), `registerDomArt()`
 * (registra a arte transitória, se `renderer:"dom"`) e `bindSkillVfx()`
 * (liga o `aegisName` do skill_db ao(s) `vfxId`) no PRÓPRIO module-load —
 * este arquivo só garante que esses módulos são importados (e portanto
 * executados) antes do primeiro `vfxStore.spawn()` real.
 *
 * Skill NÃO listada aqui = não migrada ainda = `resolveSkillVfx()` devolve
 * `undefined` = cai no caminho legado (`vfx/SkillVfx.tsx`), automaticamente,
 * sem `if` nenhum a mais em lugar nenhum (é assim que
 * `vfx/vfxStore.ts: spawn()` decide entre os dois caminhos).
 *
 * ## Ordem de migração (plano aprovado, leia1.txt)
 *
 * Fase 3 (prova): Fire Ball → Thunder Storm → Safety Wall → Fire Wall →
 * Sight — cada `import` abaixo é adicionado só DEPOIS da skill anterior
 * medida em `/vfx-bench` e comparada visualmente.
 *
 * Fase 5 (restante): Cold Bolt, Fire Lance, Light Bolt, Soul Strike, Frost
 * Diver, Stone Curse (impact+cast) — mesmo procedimento, sem arquitetura
 * nova.
 *
 * ## GPU é o padrão de produção (Directive B, virada final)
 *
 * As 11 skills abaixo (`<skill>RenderMode.ts`) chamam `set<Skill>
 * RenderMode("gpu")` (ou `"high"` pro Oracle) no PRÓPRIO module-load —
 * cada import é importado DEPOIS do `<skill>VfxDef.ts(x)` correspondente
 * (que registra o DOM primeiro), então a versão GPU vence por último e é
 * o que o jogo usa por padrão. DOM continua 100% intocado e disponível —
 * `window.__<skill>RenderBench.set("dom")` reverte em dev sem rebuild,
 * pra comparação/regressão visual. Confirmado headed em GPU real (NVIDIA
 * GTX 1660 Ti): combo completo das 11 skills roda 57-60fps em todo N até
 * 30 players, tight e spread (`docs/claude-context/09-vfx-gpu-
 * migration.md`, seção W) — DOM equivalente é 0-1fps no mesmo cenário.
 */

import "./mage/ghost-dome/ghostDomeVfxDef";
import "./mage/fire-wall/fireWallVfxDef";
import "./mage/oracle/oracleVfxDef";
import "./mage/fire-ball/fireBallVfxDef";
import "./mage/thunder-storm/thunderStormVfxDef";
import "./mage/fire-ball/fireBallRenderMode";
import "./mage/oracle/oracleRenderMode";
import "./mage/cold-bolt/coldBoltRenderMode";
import "./mage/fire-wall/fireWallRenderMode";
import "./mage/thunder-storm/thunderStormRenderMode";
import "./mage/soul-strike/soulStrikeRenderMode";
// Fire Lance é gêmea estrutural de Cold Bolt, Light Bolt reusa o CAST de
// Thunder Storm e usa `beam` pro raio único, Ghost Dome (Safety Wall) já
// estava no Core (defineVfx-swap) — as 5 skills fora da lista original.
import "./mage/fire-lance/fireLanceRenderMode";
import "./mage/light-bolt/lightBoltRenderMode";
import "./mage/ghost-dome/ghostDomeRenderMode";
// Frost Diver/Stone Curse: hits:1, sem cascata de dano, sem `@keyframes
// infinite` no original (já mais baratas por design) — migradas por
// completude, mesmo mecanismo `caster-to-target` de Soul Strike.
import "./mage/frost-diver/frostDiverRenderMode";
import "./mage/stone-curse/stoneCurseRenderMode";

export {};
