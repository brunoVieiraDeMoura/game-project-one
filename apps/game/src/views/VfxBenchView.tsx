import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { GameMap } from "@ragnarok/map-format";
import type { NetEntity } from "../net/worldStore";
import { useWorldStore } from "../net/worldStore";
import { useSkillCatalog, type SkillInfo } from "../net/skillCatalog";
import { useVfxStore, type VfxKind } from "../vfx/vfxStore";
import { legacyMapping, cellToWorld, type LegacyMapping } from "../net/legacyCells";
import { SkillVfx } from "../vfx/SkillVfx";
import { VfxRoot } from "../vfx/core/VfxRoot";
import { vfxManager } from "../vfx/core/manager";
import { resolveMigratedVfxId } from "../vfx/migratedVfxBridge";
import { useDamageFeed } from "../net/damageFeed";
import { MULTI_HIT_DURATION_MS } from "../vfx/mage/multiHitRegistry";
import { spawnCombatHitVfx, spawnCombatHitImpacts } from "../vfx/combat/combatHitVfx";
import { shardColorForElement } from "../vfx/mage/multiHitShardImpact";
import { spawnFireLanceHits } from "../vfx/mage/fire-lance/fireLanceMultiHit";
import type { FireLanceGpuTier } from "../vfx/mage/fire-lance/fireLanceVfxDefGpu";
import { spawnColdBoltHits } from "../vfx/mage/cold-bolt/coldBoltMultiHit";
import type { ColdBoltGpuTier } from "../vfx/mage/cold-bolt/coldBoltVfxDefGpu";
import { spawnLightBoltHits } from "../vfx/mage/light-bolt/lightBoltMultiHit";
import type { LightBoltGpuTier } from "../vfx/mage/light-bolt/lightBoltVfxDefGpu";
import { spawnSoulStrikeHits } from "../vfx/mage/soul-strike/soulStrikeMultiHit";
import type { SoulStrikeGpuTier } from "../vfx/mage/soul-strike/soulStrikeVfxDefGpu";
import { NetDamageNumbers } from "../net/NetDamageNumbers";
import { gridFor } from "../grid";
import { PerfProbe, PerfOverlay } from "../scene/PerfHud";

/**
 * `/vfx-bench` — auditoria de custo dos VFX de skill, ISOLADA do jogo de
 * verdade (leia1.txt: "quero investigar quanto os VFX das habilidades estão
 * pesando"). Sem login, sem char-select, sem gateway, sem mapa do rAthena —
 * só o suficiente pra `SkillVfx` (o dispatcher real, `vfx/SkillVfx.tsx`)
 * rodar: um `GameMap` plano fabricado aqui, entidades falsas plantadas
 * direto no `worldStore`, e o catálogo de skills semeado direto (sem
 * `fetch` — a API não precisa estar de pé).
 *
 * NÃO reimplementa nenhum VFX — importa e monta o `<SkillVfx>` de produção,
 * a mesma árvore que roda em `/play`. O controle (`window.__vfxBench`) só
 * decide QUANDO chamar `useVfxStore.getState().spawn(...)`, que é a MESMA
 * chamada que `net/useWorldEvents.ts` faz com pacote de verdade.
 */

const BENCH_MAP_SIZE = 80;
const BENCH_CELL_SIZE = 5;

const map: GameMap = {
  id: "vfx-bench",
  name: "vfx-bench",
  size: { width: BENCH_MAP_SIZE, height: BENCH_MAP_SIZE },
  cellSize: BENCH_CELL_SIZE,
  terrainMode: "smooth",
  heightmap: new Array(BENCH_MAP_SIZE * BENCH_MAP_SIZE).fill(0),
  collision: new Array(BENCH_MAP_SIZE * BENCH_MAP_SIZE).fill("walkable"),
  surface: [],
  terrainStyle: {},
  waterLevel: null,
  props: [],
  spawns: [],
  triggers: [],
  ramps: [],
  authoredHexScale: 1,
  lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
  sky: { skyId: "day" },
  ambientParticles: [],
  legacy: { mapName: "vfx-bench", originX: 0, originY: 0 },
  metadata: { version: 1, generatedAt: new Date(0).toISOString() },
};

const mapping = legacyMapping(map) as LegacyMapping;
const terrain = gridFor(map).terrainQuery(map);

/** aegis reconhecidos pelos 4 registros de `vfx/SkillVfx.tsx` — um skillId
 * FALSO por entrada (nunca colide com id real: skill_db do rAthena não
 * passa de ~5 dígitos baixos por classe, aqui começa em 90000). `undefined`
 * marca o caminho GENÉRICO (fallback sem componente próprio) — mesma skill
 * fictícia (`GENERIC_SKILL_ID`) serve pros 4 kinds genéricos. */
const GENERIC_SKILL_ID = 90100;
const BENCH_SKILLS: { id: number; aegisName: string; kind: VfxKind; areaRadius: number; label: string }[] = [
  { id: 90001, aegisName: "MG_COLDBOLT", kind: "impact", areaRadius: 0, label: "Cold Bolt — impact" },
  { id: 90002, aegisName: "MG_COLDBOLT", kind: "cast", areaRadius: 0, label: "Cold Bolt — cast" },
  { id: 90003, aegisName: "MG_FIREBOLT", kind: "impact", areaRadius: 0, label: "Fire Lance — impact" },
  { id: 90004, aegisName: "MG_FIREBOLT", kind: "cast", areaRadius: 0, label: "Fire Lance — cast" },
  { id: 90005, aegisName: "MG_THUNDERSTORM", kind: "impact", areaRadius: 2.6, label: "Thunder Storm — impact" },
  { id: 90006, aegisName: "MG_THUNDERSTORM", kind: "cast", areaRadius: 2.6, label: "Thunder Storm — cast" },
  { id: 90007, aegisName: "MG_LIGHTNINGBOLT", kind: "impact", areaRadius: 0, label: "Light Bolt — impact" },
  { id: 90008, aegisName: "MG_LIGHTNINGBOLT", kind: "cast", areaRadius: 0, label: "Light Bolt — cast (= Thunder Storm)" },
  { id: 90009, aegisName: "MG_SOULSTRIKE", kind: "impact", areaRadius: 0, label: "Soul Strike — impact" },
  { id: 90010, aegisName: "MG_SOULSTRIKE", kind: "cast", areaRadius: 0, label: "Soul Strike — cast" },
  // 2026-08-19-v: `areaRadius:2` bate com o real (`SplashArea: Area:2` do
  // `skill_db.yml` = 5x5, ver docblock de `fireBallVfxDefGpu.tsx`) — era
  // 1.5 (chute do protótipo genérico anterior).
  { id: 90011, aegisName: "MG_FIREBALL", kind: "impact", areaRadius: 2, label: "Fire Ball — impact" },
  { id: 90012, aegisName: "MG_FIREBALL", kind: "cast", areaRadius: 2, label: "Fire Ball — cast" },
  { id: 90013, aegisName: "MG_FROSTDIVER", kind: "impact", areaRadius: 0, label: "Frost Diver — impact" },
  { id: 90014, aegisName: "MG_FROSTDIVER", kind: "cast", areaRadius: 0, label: "Frost Diver — cast (= Cold Bolt)" },
  { id: 90015, aegisName: "MG_STONECURSE", kind: "impact", areaRadius: 0, label: "Stone Curse — impact" },
  { id: 90016, aegisName: "MG_STONECURSE", kind: "cast", areaRadius: 0, label: "Stone Curse — cast" },
  { id: 90017, aegisName: "MG_SAFETYWALL", kind: "area", areaRadius: 0, label: "Safety Wall — area cell" },
  { id: 90018, aegisName: "MG_FIREWALL", kind: "area", areaRadius: 0, label: "Fire Wall — area cell" },
  { id: 90019, aegisName: "MG_SIGHT", kind: "buff", areaRadius: 3, label: "Oracle (Sight) — buff" },
  { id: GENERIC_SKILL_ID, aegisName: "ZZ_GENERIC", kind: "impact", areaRadius: 0, label: "Genérico — impact flash" },
  { id: GENERIC_SKILL_ID + 1, aegisName: "ZZ_GENERIC", kind: "cast", areaRadius: 1, label: "Genérico — cast disc" },
  { id: GENERIC_SKILL_ID + 2, aegisName: "ZZ_GENERIC", kind: "area", areaRadius: 0, label: "Genérico — area cell" },
  { id: GENERIC_SKILL_ID + 3, aegisName: "ZZ_GENERIC", kind: "buff", areaRadius: 1, label: "Genérico — buff ring" },
];

/** mesma classificação real do skill_db (`Hit: Multi_Hit`) que as 5 skills
 * migradas têm — mantém o catálogo do bench fiel ao gate real de
 * `net/useWorldEvents.ts` (auditoria multi-hit 2026-08-17), embora
 * `spawnRealistic` abaixo ainda decida sozinho via `MULTI_HIT_DURATION_MS`. */
const MULTI_HIT_AEGIS = new Set(["MG_COLDBOLT", "MG_FIREBOLT", "MG_THUNDERSTORM", "MG_LIGHTNINGBOLT", "MG_SOULSTRIKE"]);

function seedSkillCatalog(): void {
  const byId: Record<number, SkillInfo> = {};
  for (const s of BENCH_SKILLS) {
    byId[s.id] = {
      id: s.id,
      aegisName: s.aegisName,
      name: s.label,
      hitType: MULTI_HIT_AEGIS.has(s.aegisName) ? "multi_hit" : "normal",
      target: s.kind === "buff" ? "self" : "enemy",
      areaRadius: s.areaRadius,
      maxLevel: 10,
      type: "damage",
      element: "weapon",
      spCost: 0,
      range: 9,
      cooldownMs: 0,
      durationMs: s.kind === "buff" ? 10000 : 0,
      duration2Ms: 0,
    };
  }
  useSkillCatalog.setState({ byId });
}

/** planta N entidades PARADAS (durationMs:0 → `interpolatedCell` nunca
 * precisa do relógio) numa grade, longe o bastante pra não empilhar em cima
 * uma da outra no teste de simultaneidade (50 instâncias). gid negativo pro
 * CASTER de cada slot — nunca colide com o gid do ALVO (positivo), e os dois
 * são lidos por `SkillVfx` (`effect.gid` = alvo/caster conforme o kind,
 * `effect.sourceGid` = caster pros 4 impactos que voam da mão). */
/**
 * `arrangement` — Fase 5, benchmark de escala (item 2/6/7 do pedido:
 * "espalhadas" vs "sobrepostas" vs "fora da câmera" NÃO são a mesma
 * dimensão, mas as três nascem do MESMO parâmetro de posicionamento —
 * nenhuma lógica de spawn muda, só onde as entidades são plantadas
 * (`spawnCombo`/`spawnOne` já derivam posição de `cellOfGid`, então mudar
 * o plantio propaga sozinho):
 *   "spread"  (padrão, sempre foi assim) — grade 6 células de espaçamento;
 *     cresce mais rápido que o frustum da câmera fixa do bench, então em
 *     N alto uma fração real fica FORA da câmera sozinha (câmera nunca
 *     precisa ser movida à mão pro teste de culling).
 *   "tight"   — grade 1 célula de espaçamento, cluster perto da origem,
 *     quase tudo dentro do frustum — é o contraponto "culling desligado"
 *     pra comparar com "spread" no MESMO N.
 *   "overlap" — todo mundo na MESMA célula — estresse de overdraw real
 *     (item 6: "sobrepostos" vs "espalhados").
 *   "offscreen" — todo mundo numa célula ÚNICA e DELIBERADAMENTE além do
 *     `far` da câmera do bench (2000 células × 5 = 10000 unidades de
 *     mundo, câmera tem `far:4000`) — controle experimental (rodada
 *     "update antes do culling"): garante 100% das instâncias fora do
 *     frustum, sempre, não depende de acaso de posição/direção de câmera
 *     como o "spread" em N alto já dependia.
 */
export type BenchArrangement = "spread" | "tight" | "overlap" | "offscreen";

function plantEntities(count: number, arrangement: BenchArrangement = "spread"): { targetGids: number[]; casterGids: number[] } {
  const entities: Record<number, NetEntity> = {};
  const targetGids: number[] = [];
  const casterGids: number[] = [];
  const cols = Math.ceil(Math.sqrt(count));
  const spacing = arrangement === "spread" ? 6 : 1;
  const fixedCol = arrangement === "overlap" ? 4 : arrangement === "offscreen" ? 2000 : null;
  for (let i = 0; i < count; i++) {
    const col = fixedCol ?? 1 + (i % cols) * spacing;
    const row = fixedCol ?? 1 + Math.floor(i / cols) * spacing;
    const targetGid = 1000 + i;
    const casterGid = -(1000 + i);
    const base: Omit<NetEntity, "gid" | "kind" | "job" | "x" | "y" | "toX" | "toY"> = {
      movedAt: 0,
      durationMs: 0,
      dir: 0,
      speed: 0,
    };
    entities[targetGid] = { ...base, gid: targetGid, kind: "mob", job: 1002, x: col, y: row, toX: col, toY: row };
    entities[casterGid] = { ...base, gid: casterGid, kind: "mob", job: 1002, x: col - 1, y: row, toX: col - 1, toY: row };
    targetGids.push(targetGid);
    casterGids.push(casterGid);
  }
  useWorldStore.setState({ entities });
  return { targetGids, casterGids };
}

interface SpawnOpts {
  hits?: number;
  damage?: number;
  crit?: boolean;
}

/** Fase "auditoria DOM residual" (pedido do usuário, 2026-08-17): 1 nó
 * observado no snapshot antes/depois de um spawn — tag+classe (pra
 * classificar por prefixo, ver `vfxBenchmark.ts`) + flags de estilo
 * computado que custam raster caro (mesma lista item-a-item do pedido). */
interface DomAuditNode {
  tag: string;
  className: string;
  filter: boolean;
  boxShadow: boolean;
  textShadow: boolean;
  clipPath: boolean;
  hasCssAnimation: boolean;
  hasTransition: boolean;
  opacityAnimated: boolean;
  transformAnimated: boolean;
}

interface PerfSnapshot {
  drawCalls: number;
  triangles: number;
  /** média das últimas ~120 amostras de `useFrame`, não instantâneo — um
   * quadro isolado é ruidoso demais pra comparar antes/depois (Fase 5,
   * item 15 do pedido: "draw calls + GPU frame time quando disponível"). */
  fps: number;
  frameTimeMs: number;
  /** percentis de frame time (ms) da janela rolante — item 13 do pedido de
   * escala ("não basta média, quero P50/P95/P99"). `sampleCount` diz
   * quantas amostras sustentam o percentil (menos confiável com poucas). */
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
}

interface CullStats {
  active: number;
  culled: number;
}

interface BenchApi {
  /** limpa efeitos vivos + repovoa entidades pro `count` pedido — `arrangement`
   * decide COMO elas se espalham (`spread`/`tight`/`overlap`, ver docblock
   * de `plantEntities`); default `"spread"` preserva o comportamento de
   * sempre pra quem não passa o parâmetro. */
  reset: (count: number, arrangement?: BenchArrangement) => void;
  /** dispara UMA instância do cenário `scenarioId` (índice em `BENCH_SKILLS`
   * ou aegisName+kind) na entidade de índice `slot` (0..count-1) plantada
   * pelo último `reset`. Devolve o `id` do efeito no `vfxStore` (pra
   * `removeUnit`/expiração manual, se precisar). */
  spawn: (scenarioIndex: number, slot: number, opts?: SpawnOpts) => number;
  /** dispara o cenário em TODOS os slots plantados de uma vez — o teste de
   * simultaneidade (1/5/10/20/50) pede exatamente isto */
  spawnAll: (scenarioIndex: number, opts?: SpawnOpts) => number[];
  /** Fase 5, rodada "sincronização dos impactos do Cold Bolt": MESMO
   * `spawnAll`, só que o disparo de cada slot é adiado `offsetMsPerSlot *
   * slot` (setTimeout real) em vez de todos no MESMO tick — desincroniza o
   * MOMENTO de nascimento de cada cast (o `bornAt` que `ColdBoltImpact`
   * lê é `performance.now()` no mount, então atrasar o mount desloca TODA
   * a cascata daquele player). Não toca em `ICICLE_STAGGER_MS`/produção —
   * só quando o benchmark PEDE pra nascer, igual um jogador de verdade
   * castando em instante diferente do outro. */
  spawnAllStaggered: (scenarioIndex: number, offsetMsPerSlot: number, opts?: SpawnOpts) => Promise<number[]>;
  /** planta `cellCount` células de área ADJACENTES (uma parede real, não 1
   * célula só) — ver docblock em `makeApi`. */
  spawnAreaLine: (scenarioIndex: number, slot: number, cellCount: number) => number[];
  /** dispara uma COMBINAÇÃO de skills pro mesmo slot — dimensão de
   * "intensidade" do teste multiplayer (item 7 do pedido), independente da
   * dimensão de "quantos players" (`reset(playerCount)` + chamar isto por
   * slot). */
  spawnCombo: (slot: number, combo: "wallsAndOracle" | "chaotic") => void;
  /** Fase 5, rodada "decompor o combo caótico" — mesmo `spawnCombo`
   * "chaotic", mas só as skills em `skills` (chaves: "fireball",
   * "thunderstorm", "firewall", "oracle", "coldbolt", "soulstrike"). */
  spawnComboSubset: (slot: number, skills: string[]) => void;
  /** Combat Hit VFX genérico (auditoria "fechar Normal/Single/Critical",
   * 2026-08-19) — dispara em TODOS os slots plantados, MESMO caminho que
   * `entity:action` usa de verdade (`spawnCombatHitVfx`/
   * `spawnCombatHitImpacts`, fora do `vfxStore`/`BENCH_SKILLS` porque
   * ataque básico não tem `skillId`). `hits<=1` (default) = NORMAL/SINGLE/
   * CRITICAL (1 instância por slot); `hits>1` = MULTI_HIT/MULTI_HIT_
   * CRITICAL (N instâncias staggered por slot, mesmo `spawnHitImpacts`). */
  spawnCombatHitAll: (opts?: { hits?: number; critical?: boolean }) => void;
  /** Fire Lance real, driver dedicado (`fire-lance/fireLanceMultiHit.ts:
   * spawnFireLanceHits`) — EXERCITA o caminho de produção completo
   * (projétil+trail+burst de impacto tier-específicos, agendados por
   * `setTimeout`, mesmo mecanismo que `useWorldEvents.ts` usa num pacote
   * `skill:cast` real), não `useVfxStore.spawn()` (esse só cobria a
   * cascata de números DOM — o burst GPU nunca era medido antes desta
   * auditoria, achado explícito da reconstrução 2026-08-19-b). Dispara em
   * TODOS os slots plantados de uma vez, `hits`/`tier` iguais pra todos —
   * suficiente pro benchmark de escala (1/5/10/20/30/50 players ×
   * LOW/MEDIUM/HIGH). */
  spawnFireLanceHitsAll: (opts: { hits: number; tier: FireLanceGpuTier; critical?: boolean }) => void;
  /** MESMO mecanismo, driver dedicado de Cold Bolt (reconstrução
   * 2026-08-19-d) — ver docblock de `spawnFireLanceHitsAll` acima. */
  spawnColdBoltHitsAll: (opts: { hits: number; tier: ColdBoltGpuTier; critical?: boolean }) => void;
  /** Eletrocutar real, driver dedicado (reconstrução 2026-08-19-f) — ver
   * docblock de `spawnFireLanceHitsAll` acima. */
  spawnLightBoltHitsAll: (opts: { hits: number; tier: LightBoltGpuTier; critical?: boolean }) => void;
  /** Esferas Espirituais real, driver dedicado (reconstrução 2026-08-19-z)
   * — ver docblock de `spawnFireLanceHitsAll` acima. Único driver que
   * também usa `sourceGid` (voo caster→alvo, não cai de cima). */
  spawnSoulStrikeHitsAll: (opts: { hits: number; tier: SoulStrikeGpuTier; critical?: boolean }) => void;
  clear: () => void;
  domNodeCount: () => number;
  /** draw calls/triângulos do quadro mais recente (`gl.info.render`, mesma
   * fonte que `scene/PerfHud.tsx` já usa) + fps/frame time médio da janela
   * rolante — Etapa 0 da Fase 5, item 15 do pedido ("medir draw calls +
   * GPU frame time quando disponível" pro antes/depois de cada skill). */
  perfSnapshot: () => PerfSnapshot;
  /** zera a janela rolante de frame time — chamar no INÍCIO de uma medição
   * pra `perfSnapshot().p50Ms` etc. refletirem só o burst medido, não uma
   * mistura com quadros ociosos de antes (Fase 5, benchmark de escala). */
  resetFrameStats: () => void;
  /** quantas instâncias vivas estão dentro/fora do frustum AGORA (Fase 5,
   * item 7: prova de que o culling da Etapa 4 descarta trabalho de
   * verdade, não só um contador). */
  cullStats: () => CullStats;
  /** decomposição interna de `vfxManager.update()` (Fase 5, rodada
   * "descobrir de onde vêm os ~46.6ms/quadro do piso de 30 instâncias
   * culled") — acumulado desde o último `resetUpdateProfile()`, em ms
   * TOTAIS (dividir por `frames` pra custo médio por quadro). */
  updateProfile: () => ReturnType<typeof vfxManager.getUpdateProfile>;
  resetUpdateProfile: () => void;
  /** inventário de nós DOM por tipo/estado — Fase 5, rodada "React/DOM
   * persistent tree isolation", item 1 (mapear exatamente o que existe). */
  domBreakdown: () => DomBreakdown;
  /** Controle B (React mínimo): monta `count` `<div>` vazios via React,
   * SEM `vfxManager`/animação/`useFrame` nenhum — mede custo de "React
   * mantendo N elementos" isolado de "VFX Core fazendo trabalho". */
  mountStaticDom: (count: number) => void;
  clearStaticDom: () => void;
  /** Controle DOM-detached: desconecta/reconecta a árvore do `DomRenderer`
   * do `document` sem desmontar React (`DomRenderer.setDocumentAttached`).
   * `onInstanceUpdate` continua escrevendo estilo normalmente enquanto
   * desconectado — só o navegador para de fazer layout/paint pra ela. */
  setDomDocumentAttached: (attached: boolean) => void;
  /** Fase 5, rodada "sincronização dos impactos do Cold Bolt": conta
   * eventos de impacto/burst por QUADRO (`animationstart` filtrado pelos
   * `@keyframes` de impacto + mutação de `class` que liga
   * `cb-ice-wrap--impact`/`cb-ice-dmgnum--impact`) — sem instrumentar
   * React, só observando o DOM de fora, mesmo espírito de `domBreakdown`.
   * `liveSelector` opcional (Fase 5, rodada "reprodutibilidade do spike"):
   * conta por quadro quantos elementos daquele seletor estão com
   * `style.display !== "none"` (leitura de PROPRIEDADE inline, nunca
   * `getComputedStyle` — evita forçar reflow que distorceria a própria
   * medição). Lista de elementos é capturada UMA VEZ no início (o cenário
   * já garante zero mount/unmount durante a janela, ver Fase T). */
  startImpactWatch: (liveSelector?: string) => void;
  stopImpactWatch: () => ImpactWatchResult;
  /** Fase 5, rodada "reprodutibilidade do spike do Cold Bolt": cópia CRUA
   * da janela rolante de frame time (ms), pra histograma/correlação por
   * quadro — `perfSnapshot()` só devolve os agregados (avg/p50/p95/p99). */
  frameTimesRaw: () => number[];
  /** Fase 5, rodada "decomposição do custo de apresentação do Cold Bolt" —
   * liga/desliga um override CSS (`!important`, mesma técnica do
   * `oracleBenchConfig`) sobre as classes que `ColdBoltImpact.tsx` já
   * declara, sem tocar o arquivo de produção. Ver `COLD_BOLT_CSS_RULES`
   * pra cada modo (baseline/B..G). */
  setColdBoltCssOverride: (mode: string) => void;
  resetColdBoltCssOverride: () => void;
  /** contagem estática de elementos por classe do Cold Bolt (DOM não muda
   * depois de montado — uma leitura por controle já basta). */
  coldBoltClassCounts: () => Record<string, number>;
  /** Fase 5, rodada "isolamento Soul Strike" — mesmo mecanismo do Cold
   * Bolt (override CSS bench-only), classes próprias de `SoulStrikeImpact`. */
  setSoulStrikeCssOverride: (mode: string) => void;
  resetSoulStrikeCssOverride: () => void;
  soulStrikeClassCounts: () => Record<string, number>;
  /** Fase 5, rodada "reestruturar VFX pra escala" (leia1.txt item 1/16):
   * `document.getAnimations().length` — API nativa do browser, conta
   * TODA animação CSS/Web Animations ativa no documento agora, sem
   * precisar conhecer as classes de cada skill (genérico, ao contrário
   * de `startImpactWatch`, que era escopado ao Cold Bolt). */
  activeAnimationCount: () => number;
  /** Fase 5, rodada "ligar LOD/Budget de verdade" — calibração do
   * `maxActiveInstances` por benchmark real (leia1.txt item 5: "não
   * escolha thresholds arbitrários", "derivado dos dados"). `Infinity`
   * volta ao padrão (no-op). */
  setVfxBudget: (maxActiveInstances: number) => void;
  vfxBudgetExcludedCount: () => number;
  /** Fase "auditoria DOM residual" — MESMA chamada que `spawnOne` faz
   * (`vfxStore.spawn`), MAIS a réplica exata do `useDamageFeed.push()`
   * condicional que `net/useWorldEvents.ts` (linha ~647) faz DEPOIS do
   * spawn pra qualquer skill `kind:"impact"` não-multi-hit (ou miss) —
   * `spawnOne` sozinho NUNCA chamava isso, então todo benchmark anterior
   * desta investigação nunca viu o número de dano GENÉRICO (`dmg-num`,
   * `net/NetDamageNumbers.tsx`) que hits reais de Fire Ball/Frost Diver/
   * etc. mostram em `/play`. Devolve o MESMO id de `spawnOne`. */
  spawnRealistic: (scenarioIndex: number, slot: number, opts?: SpawnOpts) => number;
  /** snapshot de TODOS os elementos do documento agora (tag+classe+flags de
   * estilo computado) — o chamador tira um ANTES e um DEPOIS do spawn e
   * faz o diff por multiset (contagem por tag+classe), sem precisar
   * marcar elemento nenhum com atributo novo. */
  domAuditSnapshot: () => DomAuditNode[];
  scenarios: typeof BENCH_SKILLS;
}

interface ImpactWatchResult {
  frames: { frame: number; impacts: number; toggles: number; animStarts: number; live: number }[];
  maxImpactsPerFrame: number;
  maxTogglesPerFrame: number;
  maxAnimStartsPerFrame: number;
}

interface DomBreakdown {
  total: number;
  div: number;
  svg: number;
  path: number;
  displayNone: number;
  visibilityHidden: number;
  connected: number;
}

let benchGlInfo: { calls: number; triangles: number } | null = null;
// janela generosa (10s a 60fps) — `resetFrameStats()` zera no início de
// cada medição, então o teto aqui só evita crescimento sem limite se
// ninguém chamar reset (não é o tamanho real de uma janela de medição).
const FRAME_WINDOW = 600;
const frameTimesMs: number[] = [];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

/** dentro do `<Canvas>` — único jeito de alcançar `gl.info`/frame delta sem
 * duplicar a cena. Não desenha nada, só amostra. */
function BenchPerfCapture() {
  const { gl } = useThree();
  useFrame((_, delta) => {
    benchGlInfo = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    frameTimesMs.push(delta * 1000);
    if (frameTimesMs.length > FRAME_WINDOW) frameTimesMs.shift();
  });
  return null;
}

function perfSnapshot(): PerfSnapshot {
  const avgMs = frameTimesMs.length > 0 ? frameTimesMs.reduce((a, b) => a + b, 0) / frameTimesMs.length : 0;
  const sorted = [...frameTimesMs].sort((a, b) => a - b);
  return {
    drawCalls: benchGlInfo?.calls ?? 0,
    triangles: benchGlInfo?.triangles ?? 0,
    frameTimeMs: avgMs,
    fps: avgMs > 0 ? 1000 / avgMs : 0,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    sampleCount: sorted.length,
  };
}

function resetFrameStats(): void {
  frameTimesMs.length = 0;
}

function domBreakdown(): DomBreakdown {
  const all = document.getElementsByTagName("*");
  let div = 0;
  let svg = 0;
  let path = 0;
  let displayNone = 0;
  let visibilityHidden = 0;
  let connected = 0;
  for (const el of Array.from(all)) {
    const tag = el.tagName.toLowerCase();
    if (tag === "div") div++;
    else if (tag === "svg") svg++;
    else if (tag === "path") path++;
    const style = (el as HTMLElement).style;
    if (style?.display === "none") displayNone++;
    if (style?.visibility === "hidden") visibilityHidden++;
    if (el.isConnected) connected++;
  }
  return { total: all.length, div, svg, path, displayNone, visibilityHidden, connected };
}

/** Controle C (DOM estático) — nós criados direto via `document.
 * createElement`, FORA da árvore React/VFX Core inteira: nenhum `useFrame`,
 * nenhum `vfxManager`, nenhuma animação toca estes nós depois de montados.
 * Isola "custo de ter N nós no document" de "custo de React/VFX
 * mantendo N instâncias". */
let staticDomContainer: HTMLDivElement | null = null;

function mountStaticDom(count: number): void {
  clearStaticDom();
  const container = document.createElement("div");
  container.id = "__staticDomBench";
  container.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;overflow:hidden;";
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "__static-node";
    el.textContent = "";
    container.appendChild(el);
  }
  document.body.appendChild(container);
  staticDomContainer = container;
}

function clearStaticDom(): void {
  staticDomContainer?.remove();
  staticDomContainer = null;
}

function cullStats(): CullStats {
  const active = vfxManager.activeCount;
  return { active, culled: vfxManager.culledCount };
}

/** Fase 5, rodada "sincronização dos impactos do Cold Bolt" (item 4 do
 * pedido) — nomes dos `@keyframes` disparados no MOMENTO do impacto
 * (`cold-bolt/ColdBoltImpact.tsx: ICE_SPIKE_CSS`), nunca os `infinite`
 * de glow contínuo (esses não marcam "um impacto aconteceu"). */
const COLD_BOLT_IMPACT_ANIM_NAMES = new Set(["cbSpikeImpact", "cbHitFlash", "cbHitRing", "cbHitFrag", "cbDmgNum"]);
const COLD_BOLT_IMPACT_CLASSES = ["cb-ice-wrap--impact", "cb-ice-dmgnum--impact"];

interface ImpactWatchState {
  frames: ImpactWatchResult["frames"];
  counters: { impacts: number; toggles: number; animStarts: number };
  liveEls: HTMLElement[];
  frame: number;
  raf: number;
  mo: MutationObserver;
  onAnimStart: (e: AnimationEvent) => void;
}

let impactWatch: ImpactWatchState | null = null;

function startImpactWatch(liveSelector?: string): void {
  stopImpactWatch();
  const counters = { impacts: 0, toggles: 0, animStarts: 0 };
  const frames: ImpactWatchState["frames"] = [];
  const liveEls: HTMLElement[] = liveSelector ? Array.from(document.querySelectorAll<HTMLElement>(liveSelector)) : [];
  const onAnimStart = (e: AnimationEvent) => {
    counters.animStarts++;
    if (COLD_BOLT_IMPACT_ANIM_NAMES.has(e.animationName)) counters.impacts++;
  };
  document.addEventListener("animationstart", onAnimStart, true);
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type !== "attributes" || r.attributeName !== "class") continue;
      const el = r.target as Element;
      if (COLD_BOLT_IMPACT_CLASSES.some((c) => el.classList.contains(c))) counters.toggles++;
    }
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
  const state: ImpactWatchState = { frames, counters, liveEls, frame: 0, raf: 0, mo, onAnimStart };
  const tick = () => {
    let live = 0;
    for (const el of liveEls) if (el.style.display !== "none") live++;
    state.frames.push({ frame: state.frame++, impacts: counters.impacts, toggles: counters.toggles, animStarts: counters.animStarts, live });
    counters.impacts = 0;
    counters.toggles = 0;
    counters.animStarts = 0;
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
  impactWatch = state;
}

function stopImpactWatch(): ImpactWatchResult {
  if (!impactWatch) return { frames: [], maxImpactsPerFrame: 0, maxTogglesPerFrame: 0, maxAnimStartsPerFrame: 0 };
  cancelAnimationFrame(impactWatch.raf);
  impactWatch.mo.disconnect();
  document.removeEventListener("animationstart", impactWatch.onAnimStart, true);
  const { frames } = impactWatch;
  const maxImpactsPerFrame = frames.reduce((m, f) => Math.max(m, f.impacts), 0);
  const maxTogglesPerFrame = frames.reduce((m, f) => Math.max(m, f.toggles), 0);
  const maxAnimStartsPerFrame = frames.reduce((m, f) => Math.max(m, f.animStarts), 0);
  impactWatch = null;
  return { frames, maxImpactsPerFrame, maxTogglesPerFrame, maxAnimStartsPerFrame };
}

function frameTimesRaw(): number[] {
  return [...frameTimesMs];
}

function activeAnimationCount(): number {
  return document.getAnimations().length;
}

/**
 * Fase 5, rodada "decomposição do custo de apresentação do Cold Bolt" —
 * MESMA técnica de `oracleBenchConfig.ts` (uma tag `<style>` de override
 * com `!important`, criada/removida só pelo benchmark): nunca toca
 * `cold-bolt/ColdBoltImpact.tsx`, só sobrepõe regras nas classes que a
 * PRÓPRIA skill já declara. `!important` numa folha de estilo externa
 * vence `style.transform`/`style.opacity` escritos inline pelo `useFrame`
 * (sem `!important`) — é assim que o controle D consegue "congelar"
 * transform/opacity que são escritos em JS, sem editar o componente.
 */
const COLD_BOLT_CSS_RULES: Record<string, string> = {
  baseline: "",
  B_no_animation: `
    .cb-ice-spike, .cb-ice-spike__glow, .cb-ice-hit__flash, .cb-ice-hit__ring, .cb-ice-hit__frag, .cb-ice-dmgnum, .cb-ice-total {
      animation: none !important;
    }
  `,
  C_no_filters_shadows: `
    .cb-ice-spike, .cb-ice-hit__frag { filter: none !important; }
    .cb-ice-spike__body, .cb-ice-hit__ring { box-shadow: none !important; }
    .cb-ice-dmgnum, .cb-ice-total { text-shadow: none !important; }
  `,
  D_frozen_transform_opacity: `
    .cb-ice-spike, .cb-ice-hit, .cb-ice-hit__flash, .cb-ice-hit__ring, .cb-ice-hit__frag, .cb-ice-dmgnum, .cb-ice-total, .cb-ice-spike__body {
      transform: none !important;
      opacity: 1 !important;
    }
  `,
  E_simplified_content: `
    .cb-ice-spike__body, .cb-ice-spike__body::before, .cb-ice-spike__body::after {
      background: #4aa8e0 !important;
      clip-path: none !important;
    }
    .cb-ice-spike__body::before { mix-blend-mode: normal !important; }
    .cb-ice-hit__ring::before { background: none !important; -webkit-mask: none !important; mask: none !important; }
    .cb-ice-hit__flash, .cb-ice-hit__frag { background: #ffffff !important; clip-path: none !important; }
  `,
  F_icicle_only: `
    .cb-ice-spike__glow, .cb-ice-hit { display: none !important; }
  `,
  G_decorations_only: `
    .cb-ice-spike { filter: none !important; }
    .cb-ice-spike__body { background: #666666 !important; box-shadow: none !important; }
    .cb-ice-spike__body::before, .cb-ice-spike__body::after { opacity: 0 !important; }
  `,
  // Fase 5, rodada "isolamento do burst de impacto" (decompor `.cb-ice-hit`,
  // achado da rodada anterior: escondê-lo inteiro já derruba 77-86% do p99).
  H_hide_frags_only: `
    .cb-ice-hit__frag { display: none !important; }
  `,
  I_hide_flash_ring_only: `
    .cb-ice-hit__flash, .cb-ice-hit__ring { display: none !important; }
  `,
  J_frags_no_filter: `
    .cb-ice-hit__frag { filter: none !important; }
  `,
  K_frags_no_animation: `
    .cb-ice-hit__frag { animation: none !important; }
  `,
  // combinação J+K (o pedido descreveu L com o MESMO texto de J — "sem
  // drop-shadow + animation normal" — o que duplicaria J; a leitura que
  // faz L útil ao lado de J/K é a combinatória: nem filtro nem animação,
  // pra fechar a decomposição). Documentado explicitamente no relatório.
  L_frags_no_filter_no_animation: `
    .cb-ice-hit__frag { filter: none !important; animation: none !important; }
  `,
  // Fase 5, rodada "validar fix mínimo": mesma técnica JÁ EM PRODUÇÃO pra
  // `vfx-dom-culled` (`legacyVfxArt.ts: CORE_CSS`) — `animation-play-state:
  // paused`, não `animation:none` — pra confirmar que o resultado de K/L
  // (Fase W) se sustenta com o MESMO mecanismo que o fix real vai usar.
  M_frags_paused: `
    .cb-ice-hit__frag { animation-play-state: paused !important; }
  `,
  // Fase 5, rodada "validar animation:none + inspeção visual" — C reforça B
  // com `opacity:0` explícito, como seguro contra qualquer resíduo de
  // fill-mode (mesmo a leitura do CSS já apontando que não deveria haver
  // nenhum: base `.cb-ice-hit__frag` já é `opacity:0` sem `animation`).
  C_frags_none_opacity0: `
    .cb-ice-hit__frag { animation: none !important; opacity: 0 !important; }
  `,
  // controles de contagem — mesma estrutura/keyframe/filter/duração,
  // só reduzindo QUANTOS dos 8 fragmentos por icicle ficam visíveis
  // (nth-child conta a partir de 1 na ordem de `buildFragments`/`.map`).
  N_frags_count_4: `
    .cb-ice-hit__frag:nth-child(n+7) { display: none !important; }
  `,
  O_frags_count_2: `
    .cb-ice-hit__frag:nth-child(n+5) { display: none !important; }
  `,
};
const COLD_BOLT_OVERRIDE_STYLE_ID = "cold-bolt-bench-override";

function setColdBoltCssOverride(mode: string): void {
  let tag = document.getElementById(COLD_BOLT_OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = COLD_BOLT_OVERRIDE_STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = COLD_BOLT_CSS_RULES[mode] ?? "";
}

function resetColdBoltCssOverride(): void {
  document.getElementById(COLD_BOLT_OVERRIDE_STYLE_ID)?.remove();
}

const COLD_BOLT_CLASSES = [
  "cb-ice-wrap",
  "cb-ice-spike",
  "cb-ice-spike__glow",
  "cb-ice-spike__body",
  "cb-ice-hit",
  "cb-ice-hit__flash",
  "cb-ice-hit__ring",
  "cb-ice-hit__frag",
  "cb-ice-dmgnum",
  "cb-ice-total",
] as const;

/** contagem ESTÁTICA por classe — a estrutura DOM do Cold Bolt não muda
 * depois de montada (só `display`/classe `--impact` mudam), então uma
 * leitura por controle basta, não precisa ser por-quadro. */
function coldBoltClassCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of COLD_BOLT_CLASSES) out[c] = document.getElementsByClassName(c).length;
  return out;
}

/**
 * Fase 5, rodada "isolamento Soul Strike" — mesmo padrão do Cold Bolt
 * (override CSS `!important`, nunca toca `SoulStrikeImpact.tsx`) e mesma
 * contagem estática por classe (`soul-strike/SoulStrikeImpact.tsx: SOUL_CSS`).
 */
const SOUL_STRIKE_CSS_RULES: Record<string, string> = {
  baseline: "",
  P_ghost_no_animation: `
    .ss-ghost { animation: none !important; }
  `,
  Q_hit_burst_hidden: `
    .ss-hit { display: none !important; }
  `,
  R_filters_shadows_off: `
    .ss-ghost { filter: none !important; }
    .ss-ghost__glow, .ss-echo, .ss-hit__wisp { filter: none !important; }
    .ss-hit__ripple { box-shadow: none !important; }
    .ss-dmgnum, .ss-total { text-shadow: none !important; }
  `,
  // Fase 5, rodada "combinar R+Q" — mesmas duas regras de cima, uma tag só.
  S_filters_shadows_off_plus_hit_hidden: `
    .ss-ghost { filter: none !important; }
    .ss-ghost__glow, .ss-echo, .ss-hit__wisp { filter: none !important; }
    .ss-hit__ripple { box-shadow: none !important; }
    .ss-dmgnum, .ss-total { text-shadow: none !important; }
    .ss-hit { display: none !important; }
  `,
};
const SOUL_STRIKE_OVERRIDE_STYLE_ID = "soul-strike-bench-override";

function setSoulStrikeCssOverride(mode: string): void {
  let tag = document.getElementById(SOUL_STRIKE_OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = SOUL_STRIKE_OVERRIDE_STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = SOUL_STRIKE_CSS_RULES[mode] ?? "";
}

function resetSoulStrikeCssOverride(): void {
  document.getElementById(SOUL_STRIKE_OVERRIDE_STYLE_ID)?.remove();
}

const SOUL_STRIKE_CLASSES = [
  "ss-wrap",
  "ss-ghost",
  "ss-ghost__glow",
  "ss-ghost__body",
  "ss-ghost__eye",
  "ss-echo",
  "ss-hit",
  "ss-hit__flash",
  "ss-hit__ripple",
  "ss-hit__wisp",
  "ss-hit__frag",
  "ss-dmgnum",
  "ss-total",
] as const;

function soulStrikeClassCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of SOUL_STRIKE_CLASSES) out[c] = document.getElementsByClassName(c).length;
  return out;
}

function makeApi(): BenchApi {
  let lastTargetGids: number[] = [];
  let lastCasterGids: number[] = [];

  function reset(count: number, arrangement: BenchArrangement = "spread"): void {
    useVfxStore.getState().reset();
    const { targetGids, casterGids } = plantEntities(count, arrangement);
    lastTargetGids = targetGids;
    lastCasterGids = casterGids;
  }

  function cellOfGid(gid: number): { x: number; y: number } {
    const e = useWorldStore.getState().entities[gid];
    if (!e) return { x: 0, y: 0 };
    return { x: e.x, y: e.y };
  }

  function spawnOne(scenarioIndex: number, slot: number, opts?: SpawnOpts): number {
    const scenario = BENCH_SKILLS[scenarioIndex];
    if (!scenario) throw new Error(`cenário ${scenarioIndex} não existe`);
    const targetGid = lastTargetGids[slot % Math.max(1, lastTargetGids.length)];
    const casterGid = lastCasterGids[slot % Math.max(1, lastCasterGids.length)];
    const before = useVfxStore.getState().effects.length;
    // skill migrada pro VFX Core (`vfx/skillVfxBindings.ts`) nunca entra em
    // `effects` — o `id` de retorno tem que vir de `vfxManager`, não do
    // array legado (ver `vfx/migratedVfxBridge.ts`).
    const migratedVfxId = resolveMigratedVfxId(scenario.aegisName, scenario.kind);
    if (scenario.kind === "area") {
      const cell = targetGid !== undefined ? cellOfGid(targetGid) : { x: 4, y: 4 };
      useVfxStore.getState().spawn({
        kind: "area",
        skillId: scenario.id,
        cell,
        expiresAt: Infinity,
        unitGid: 500000 + slot,
      });
    } else if (scenario.kind === "cast") {
      useVfxStore.getState().spawn({
        kind: "cast",
        skillId: scenario.id,
        gid: casterGid,
        expiresAt: performance.now() + 3000,
      });
    } else if (scenario.kind === "buff") {
      useVfxStore.getState().spawn({
        kind: "buff",
        skillId: scenario.id,
        gid: casterGid,
        expiresAt: performance.now() + 60000,
      });
    } else {
      useVfxStore.getState().spawn({
        kind: "impact",
        skillId: scenario.id,
        gid: targetGid,
        sourceGid: casterGid,
        expiresAt: performance.now() + 4000,
        damage: opts?.damage ?? 1234,
        crit: opts?.crit ?? false,
        hits: opts?.hits ?? 5,
      });
    }
    if (migratedVfxId) {
      // maior `instanceId` cujo `vfxId` bate — o que acabou de nascer OU o
      // que acabou de receber `pulse()` (coalescência); nos dois casos é a
      // instância que representa o `spawn()` que acabou de acontecer.
      const ids = vfxManager
        .listInstances()
        .filter((i) => i.vfxId === migratedVfxId)
        .map((i) => i.instanceId);
      return ids.length > 0 ? Math.max(...ids) : before;
    }
    const after = useVfxStore.getState().effects;
    return after[after.length - 1]?.id ?? before;
  }

  // contador PRÓPRIO de unitGid pra área com várias células — nunca colide
  // com o `500000 + slot` que `spawnOne` já usa (um só por slot, célula
  // única); aqui cada CÉLULA de uma parede precisa do próprio unitGid real
  // (é assim que o servidor manda `skill:ground-gone` célula a célula).
  let nextAreaUnitGid = 900000;

  /**
   * Planta uma parede de `cellCount` células ADJACENTES (linha reta a
   * partir da célula do alvo) pro cenário `scenarioIndex` (precisa ser
   * `kind:"area"`, ex. Fire Wall) — o `spawnOne` de cima só planta 1
   * célula, insuficiente pra simular uma Fire Wall REAL (até ~19 células
   * num pacote do servidor, ver `docs/claude-context/05-diagnostics-
   * flight-recorder.md`). Devolve os `id`/`unitGid` de cada célula, pra
   * limpeza manual se precisar (`removeUnit` por célula).
   */
  function spawnAreaLine(scenarioIndex: number, slot: number, cellCount: number): number[] {
    const scenario = BENCH_SKILLS[scenarioIndex];
    if (!scenario || scenario.kind !== "area") throw new Error(`cenário ${scenarioIndex} não é kind:"area"`);
    const targetGid = lastTargetGids[slot % Math.max(1, lastTargetGids.length)];
    const base = targetGid !== undefined ? cellOfGid(targetGid) : { x: 4, y: 4 };
    const unitGids: number[] = [];
    for (let i = 0; i < cellCount; i++) {
      const unitGid = nextAreaUnitGid++;
      useVfxStore.getState().spawn({
        kind: "area",
        skillId: scenario.id,
        cell: { x: base.x + i, y: base.y },
        expiresAt: Infinity,
        unitGid,
      });
      unitGids.push(unitGid);
    }
    return unitGids;
  }

  /**
   * Combinação de skills disparadas de UMA VEZ pro mesmo "jogador" (slot) —
   * item 7 do pedido: o teste multiplayer precisa de DUAS dimensões
   * (nº de players × intensidade de VFX por player), não só N cópias do
   * MESMO cenário (`spawnAll` já cobria isso, é a Fase B do benchmark).
   *
   *  - `wallsAndOracle`: o cenário citado explicitamente no pedido —
   *    3 Fire Wall (8 células cada, "representativo", não o máximo real de
   *    19 — documentado no relatório) + 1 Oráculo.
   *  - `chaotic`: combate realista — todas as skills migradas pro Core
   *    (Fire Ball, Thunder Storm, Fire Wall, Oráculo) MAIS duas ainda no
   *    dispatcher legado (Cold Bolt, Soul Strike) — mistura de verdade,
   *    igual ao jogo hoje (5 skills no Core, 13 no `SkillVfx.tsx` antigo
   *    convivendo).
   */
  function spawnCombo(slot: number, combo: "wallsAndOracle" | "chaotic"): void {
    const idxOf = (aegisName: string, kind: (typeof BENCH_SKILLS)[number]["kind"]) =>
      BENCH_SKILLS.findIndex((s) => s.aegisName === aegisName && s.kind === kind);

    if (combo === "wallsAndOracle") {
      const fireWallIdx = idxOf("MG_FIREWALL", "area");
      const oracleIdx = idxOf("MG_SIGHT", "buff");
      for (let w = 0; w < 3; w++) spawnAreaLine(fireWallIdx, slot, 8);
      spawnOne(oracleIdx, slot);
      return;
    }

    // chaotic
    spawnOne(idxOf("MG_FIREBALL", "impact"), slot);
    spawnOne(idxOf("MG_THUNDERSTORM", "impact"), slot, { hits: 5, damage: 4000 });
    spawnAreaLine(idxOf("MG_FIREWALL", "area"), slot, 8);
    spawnOne(idxOf("MG_SIGHT", "buff"), slot);
    spawnOne(idxOf("MG_COLDBOLT", "impact"), slot, { hits: 5, damage: 2000 });
    spawnOne(idxOf("MG_SOULSTRIKE", "impact"), slot, { hits: 5, damage: 2000 });
    // as 5 skills fora da lista original de 5 (Directive B, "migra as skills
    // fora da lista") — somadas ao chaotic pra ele cobrir as 11 skills com
    // protótipo GPU, não só as 6 originais.
    spawnOne(idxOf("MG_FIREBOLT", "impact"), slot, { hits: 5, damage: 2000 });
    spawnOne(idxOf("MG_LIGHTNINGBOLT", "impact"), slot, { hits: 5, damage: 2000 });
    spawnOne(idxOf("MG_FROSTDIVER", "impact"), slot);
    spawnOne(idxOf("MG_STONECURSE", "impact"), slot);
    spawnOne(idxOf("MG_SAFETYWALL", "area"), slot);
  }

  /** Fase 5, rodada "decompor o combo caótico" — MESMOS 6 disparos de
   * `spawnCombo("chaotic")` acima, byte a byte, só que agora escolhendo
   * QUAIS entram (`skills`) — nenhuma skill individual (Fire Ball/Fire
   * Wall/Thunder Storm/Oracle/Cold Bolt/Soul Strike) explicou o colapso
   * do combo sozinha; isso permite achar em qual COMBINAÇÃO ele aparece,
   * sem duplicar a lógica de spawn de cada skill. */
  function spawnComboSubset(slot: number, skills: string[]): void {
    const idxOf = (aegisName: string, kind: (typeof BENCH_SKILLS)[number]["kind"]) =>
      BENCH_SKILLS.findIndex((s) => s.aegisName === aegisName && s.kind === kind);
    const set = new Set(skills);
    if (set.has("fireball")) spawnOne(idxOf("MG_FIREBALL", "impact"), slot);
    if (set.has("thunderstorm")) spawnOne(idxOf("MG_THUNDERSTORM", "impact"), slot, { hits: 5, damage: 4000 });
    if (set.has("firewall")) spawnAreaLine(idxOf("MG_FIREWALL", "area"), slot, 8);
    if (set.has("oracle")) spawnOne(idxOf("MG_SIGHT", "buff"), slot);
    if (set.has("coldbolt")) spawnOne(idxOf("MG_COLDBOLT", "impact"), slot, { hits: 5, damage: 2000 });
    if (set.has("soulstrike")) spawnOne(idxOf("MG_SOULSTRIKE", "impact"), slot, { hits: 5, damage: 2000 });
  }

  /** MESMA réplica exata da condição em `net/useWorldEvents.ts` (linha
   * ~647): "kind:'target' (não-buff/área) e (não é multi-hit OU errou)"
   * → também mostra o número GENÉRICO (`net/damageFeed`/`NetDamageNumbers.
   * tsx`), ALÉM do que a própria `VfxDefinition` já desenha. `spawnOne`
   * sozinho NUNCA fazia este segundo push — nenhum benchmark anterior
   * desta investigação viu esse DOM. */
  function spawnRealistic(scenarioIndex: number, slot: number, opts?: SpawnOpts): number {
    const scenario = BENCH_SKILLS[scenarioIndex];
    if (!scenario) throw new Error(`cenário ${scenarioIndex} não existe`);
    const id = spawnOne(scenarioIndex, slot, opts);
    if (scenario.kind === "impact") {
      const isMultiHit = MULTI_HIT_DURATION_MS[scenario.aegisName] !== undefined;
      const damage = opts?.damage ?? 1234;
      if (!isMultiHit || damage === 0) {
        const targetGid = lastTargetGids[slot % Math.max(1, lastTargetGids.length)];
        if (targetGid !== undefined) {
          useDamageFeed.getState().push({
            gid: targetGid,
            value: damage,
            crit: opts?.crit ?? false,
            miss: damage === 0,
            onSelf: false,
            skill: true,
          });
        }
      }
    }
    return id;
  }

  /** snapshot de tag+classe+flags de estilo computado caro, pra TODO
   * elemento do documento agora — o chamador (Node) tira 1 antes e 1
   * depois de um spawn e faz o diff por multiset (Fase "auditoria DOM
   * residual"). `getComputedStyle` só nos elementos que existem NO
   * MOMENTO da chamada — chamar em vários instantes (cast/travel/impact/
   * after-effect) cobre o ciclo de vida inteiro, nenhuma amostra única
   * precisa bastar sozinha. */
  function domAuditSnapshot(): DomAuditNode[] {
    const out: DomAuditNode[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const cs = getComputedStyle(el);
      out.push({
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === "string" ? el.className : "",
        filter: cs.filter !== "none",
        boxShadow: cs.boxShadow !== "none",
        textShadow: cs.textShadow !== "none",
        clipPath: cs.clipPath !== "none",
        hasCssAnimation: cs.animationName !== "none",
        hasTransition: cs.transitionProperty !== "none" && cs.transitionDuration !== "0s",
        opacityAnimated: cs.animationName !== "none" && cs.opacity !== "1" && cs.opacity !== "0",
        transformAnimated: cs.animationName !== "none" && cs.transform !== "none",
      });
    }
    return out;
  }

  async function spawnAllStaggered(scenarioIndex: number, offsetMsPerSlot: number, opts?: SpawnOpts): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 0; i < lastTargetGids.length; i++) {
      if (offsetMsPerSlot > 0 && i > 0) await new Promise((r) => setTimeout(r, offsetMsPerSlot));
      ids.push(spawnOne(scenarioIndex, i, opts));
    }
    return ids;
  }

  function spawnCombatHitAll(opts?: { hits?: number; critical?: boolean }): void {
    const hits = Math.max(1, Math.floor(opts?.hits ?? 1));
    const critical = opts?.critical === true;
    const color = shardColorForElement(undefined); // ataque básico não tem elemento
    for (const targetGid of lastTargetGids) {
      if (hits <= 1) spawnCombatHitVfx({ targetGid, color, critical });
      else spawnCombatHitImpacts({ targetGid, hits, color, critical });
    }
  }

  function spawnFireLanceHitsAll(opts: { hits: number; tier: FireLanceGpuTier; critical?: boolean }): void {
    for (const targetGid of lastTargetGids) {
      spawnFireLanceHits({ targetGid, hits: opts.hits, tier: opts.tier, critical: opts.critical === true });
    }
  }

  function spawnColdBoltHitsAll(opts: { hits: number; tier: ColdBoltGpuTier; critical?: boolean }): void {
    for (const targetGid of lastTargetGids) {
      spawnColdBoltHits({ targetGid, hits: opts.hits, tier: opts.tier, critical: opts.critical === true });
    }
  }

  function spawnLightBoltHitsAll(opts: { hits: number; tier: LightBoltGpuTier; critical?: boolean }): void {
    for (const targetGid of lastTargetGids) {
      spawnLightBoltHits({ targetGid, hits: opts.hits, tier: opts.tier, critical: opts.critical === true });
    }
  }

  function spawnSoulStrikeHitsAll(opts: { hits: number; tier: SoulStrikeGpuTier; critical?: boolean }): void {
    for (let i = 0; i < lastTargetGids.length; i++) {
      spawnSoulStrikeHits({
        sourceGid: lastCasterGids[i],
        targetGid: lastTargetGids[i]!,
        hits: opts.hits,
        tier: opts.tier,
        critical: opts.critical === true,
      });
    }
  }

  return {
    reset,
    spawn: spawnOne,
    spawnAll: (scenarioIndex, opts) => lastTargetGids.map((_, i) => spawnOne(scenarioIndex, i, opts)),
    spawnAllStaggered,
    spawnAreaLine,
    spawnCombo,
    spawnComboSubset,
    spawnCombatHitAll,
    spawnFireLanceHitsAll,
    spawnColdBoltHitsAll,
    spawnLightBoltHitsAll,
    spawnSoulStrikeHitsAll,
    clear: () => useVfxStore.getState().reset(),
    domNodeCount: () => document.getElementsByTagName("*").length,
    perfSnapshot,
    resetFrameStats,
    cullStats,
    updateProfile: () => vfxManager.getUpdateProfile(),
    resetUpdateProfile: () => vfxManager.resetUpdateProfile(),
    domBreakdown,
    mountStaticDom,
    clearStaticDom,
    setDomDocumentAttached: (attached) => vfxManager.setDomDocumentAttached(attached),
    startImpactWatch,
    stopImpactWatch,
    frameTimesRaw,
    setColdBoltCssOverride,
    resetColdBoltCssOverride,
    coldBoltClassCounts,
    setSoulStrikeCssOverride,
    resetSoulStrikeCssOverride,
    soulStrikeClassCounts,
    activeAnimationCount,
    setVfxBudget: (maxActiveInstances) => vfxManager.setBudgetLimits({ maxActiveInstances }),
    vfxBudgetExcludedCount: () => vfxManager.budgetExcludedCount,
    spawnRealistic,
    domAuditSnapshot,
    scenarios: BENCH_SKILLS,
  };
}

function BenchGround() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(BENCH_MAP_SIZE * BENCH_CELL_SIZE) / 2, 0, (BENCH_MAP_SIZE * BENCH_CELL_SIZE) / 2]}>
      <planeGeometry args={[BENCH_MAP_SIZE * BENCH_CELL_SIZE, BENCH_MAP_SIZE * BENCH_CELL_SIZE]} />
      <meshStandardMaterial color="#2a3138" />
    </mesh>
  );
}

export function VfxBenchView() {
  const readyRef = useRef(false);
  const cellSize = useMemo(() => gridFor(map).cellWidth(), []);

  useEffect(() => {
    seedSkillCatalog();
    (window as unknown as { __vfxBench?: BenchApi }).__vfxBench = makeApi();
    readyRef.current = true;
    (window as unknown as { __vfxBenchReady?: boolean }).__vfxBenchReady = true;
    return () => {
      useVfxStore.getState().reset();
      useWorldStore.setState({ entities: {} });
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0d12" }}>
      <div style={{ position: "absolute", top: 8, left: 8, zIndex: 1, color: "#8f9bb3", font: "12px system-ui" }}>
        /vfx-bench — controlado por window.__vfxBench (ver scripts/vfxBenchmark.ts)
      </div>
      <Canvas
        camera={{ position: [16, 14, 16], fov: 50, near: 0.5, far: 4000 }}
        shadows={false}
        dpr={[1, 1]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, 80, 30]} intensity={1.1} />
        <BenchGround />
        <SkillVfx map={map} mapping={mapping} cellSize={cellSize} terrain={terrain} />
        <VfxRoot map={map} mapping={mapping} cellSize={cellSize} terrain={terrain} />
        {/* Fase "auditoria DOM residual" (2026-08-17): faltava aqui — `/play`
            monta isto pra QUALQUER hit/skill do jogo (`net/damageFeed`), o
            bench nunca montou. Sem isto, `spawnRealistic()`'s damageFeed.
            push() acontecia na store mas não tinha NADA renderizando —
            zero DOM medido não provava zero DOM em produção, só provava que
            o bench não conseguia ver essa camada. */}
        <NetDamageNumbers map={map} mapping={mapping} />
        <BenchPerfCapture />
        {import.meta.env.DEV && <PerfProbe />}
      </Canvas>
      {import.meta.env.DEV && <PerfOverlay />}
    </div>
  );
}

export { BENCH_SKILLS, cellToWorld };
