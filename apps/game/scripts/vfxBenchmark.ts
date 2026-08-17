/**
 * `pnpm --filter @ragnarok/game vfx:benchmark`
 *
 * Auditoria de custo dos VFX de skill (leia1.txt "quero investigar quanto os
 * VFX das habilidades estão pesando") — mede a `/vfx-bench` (view isolada,
 * `src/views/VfxBenchView.tsx`) num Chrome de VERDADE via CDP, porque os VFX
 * de skill são DOM/CSS (drei `<Html>`, achado da auditoria estática: 51
 * `<Html>` × 0 `<mesh>` em `vfx/mage/**`) — o custo real é
 * Style→Layout→Paint→Raster→Composite do navegador, não draw call/shader.
 * Vitest (Node puro, sem jsdom neste repo) não alcança nada disso; daí o
 * Playwright.
 *
 * Sobe o próprio `vite dev` numa porta dedicada (não a 3001 de
 * desenvolvimento, pra nunca brigar com uma sessão já aberta), abre
 * `/vfx-bench` headless, e dirige tudo pela API de controle
 * (`window.__vfxBench`, ver a view) — nunca reimplementa nem chama VFX
 * diretamente, só orquestra o dispatcher de produção.
 */
import { chromium, type CDPSession, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "vfx-bench-results");
// AVISO (achado da Fase BG, CPU profile real via CDP `Profiler`): headless
// neste ambiente cai pro SwiftShader (WebGL 100% software — confirmado via
// `UNMASKED_RENDERER_WEBGL`), não a GPU real da máquina. Um combo que mede
// fps=2-3 headless roda 59-60fps headed (`VFX_BENCH_HEADED=1`, GPU real).
// Números ABSOLUTOS de fps/frame time só valem rodados headed — headless
// serve só pra comparação RELATIVA rápida (A×B na MESMA sessão), nunca pra
// concluir "está bom"/"está ruim" em produção.
const HEADLESS = process.env.VFX_BENCH_HEADED !== "1";
const RUN_LABEL = process.env.VFX_BENCH_LABEL ?? "run";

// ---- tipos do lado do browser (window.__vfxBench, ver VfxBenchView.tsx) ----
interface ScenarioDef {
  id: number;
  aegisName: string;
  kind: "impact" | "buff" | "area" | "cast";
  areaRadius: number;
  label: string;
}
interface CdpMetric {
  name: string;
  value: number;
}

function metricsToMap(metrics: CdpMetric[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of metrics) m[e.name] = e.value;
  return m;
}

function delta(before: Record<string, number>, after: Record<string, number>, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (after[k] ?? 0) - (before[k] ?? 0);
  return out;
}

const METRIC_KEYS = [
  "ScriptDuration",
  "TaskDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "JSHeapUsedSize",
  "Nodes",
  "JSEventListeners",
  "LayoutCount",
  "RecalcStyleCount",
];

/** soma `dur` (µs) dos eventos de tracing do Chrome, agrupados por fase que
 * interessa — nomes reais do DevTools timeline (`disabled-by-default-
 * devtools.timeline`), não invenção: `Layout`, `UpdateLayoutTree` (recalc
 * style), `Paint`, `CompositeLayers`, `RasterTask`. */
interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
  cat?: string;
}
function summarizeTrace(events: TraceEvent[]): Record<string, number> {
  const wanted: Record<string, string[]> = {
    layoutMs: ["Layout", "PrePaint"],
    recalcStyleMs: ["UpdateLayoutTree"],
    paintMs: ["Paint", "PaintImage"],
    rasterMs: ["RasterTask", "Rasterize"],
    // Chrome moderno não emite mais `CompositeLayers` — o commit do
    // compositor sai como `Commit`, e `Layerize` é o trabalho de decidir
    // camada por elemento (blur/filter/opacity animada força camada própria,
    // exatamente o que este benchmark quer flagrar).
    compositeMs: ["Commit", "Layerize", "UpdateLayer"],
    scriptMs: ["FunctionCall", "EvaluateScript", "V8.Execute"],
    gpuMs: ["GPUTask"],
    gcMs: ["MinorGC", "MajorGC", "V8.GC_MC_BACKGROUND_MARKING", "V8.GC_MC_BACKGROUND_SWEEPING"],
  };
  const out: Record<string, number> = {};
  for (const key of Object.keys(wanted)) out[key] = 0;
  for (const e of events) {
    if (e.ph !== "X" || typeof e.dur !== "number") continue;
    for (const [key, names] of Object.entries(wanted)) {
      if (names.includes(e.name)) out[key] += e.dur / 1000; // µs → ms
    }
  }
  return out;
}

async function withTrace<T>(cdp: CDPSession, fn: () => Promise<T>): Promise<{ result: T; trace: Record<string, number> }> {
  const events: TraceEvent[] = [];
  const onData = (e: { value: TraceEvent[] }) => events.push(...e.value);
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", {
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "blink.user_timing",
    ].join(","),
    transferMode: "ReportEvents",
  } as never);
  const result = await fn();
  const done = new Promise<void>((resolve) => cdp.once("Tracing.tracingComplete", () => resolve()));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", onData);
  return { result, trace: summarizeTrace(events) };
}

async function collectGarbage(cdp: CDPSession): Promise<void> {
  try {
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
  } catch {
    // best-effort — segue sem GC forçado se o driver não suportar
  }
}

// ---- Fase BG: a Fase BF provou que `vfxManager.update()` é barato
// (0.5-1.6ms/quadro) e descartou `composite` (artefato, aparece igual em
// N=0 saudável) — sobra achar ONDE o tempo vai de verdade. `Profiler`
// (CPU sampling real do V8, categoria DIFERENTE de `Tracing`) responde
// isso diretamente: hitCount por função, agregado por self-time. ----
interface CdpProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number;
  children?: number[];
}
interface CdpProfile {
  nodes: CdpProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}
interface CpuProfileRow {
  name: string;
  url: string;
  selfMs: number;
}

async function captureCpuProfile<T>(cdp: CDPSession, runInWindow: () => Promise<T>): Promise<{ result: T; top: CpuProfileRow[]; totalMs: number }> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 } as never); // µs — 10kHz, granular o bastante pra 800ms de janela
  await cdp.send("Profiler.start");
  const result = await runInWindow();
  const { profile } = (await cdp.send("Profiler.stop")) as { profile: CdpProfile };
  await cdp.send("Profiler.disable");

  const idToNode = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfTimeUs = new Map<number, number>();
  let totalUs = 0;
  if (profile.samples && profile.timeDeltas) {
    for (let i = 0; i < profile.samples.length; i++) {
      const nodeId = profile.samples[i]!;
      const dt = Math.max(0, profile.timeDeltas[i] ?? 0);
      selfTimeUs.set(nodeId, (selfTimeUs.get(nodeId) ?? 0) + dt);
      totalUs += dt;
    }
  }
  const top: CpuProfileRow[] = [...selfTimeUs.entries()]
    .map(([id, us]) => {
      const node = idToNode.get(id);
      const rawName = node?.callFrame.functionName || "(anonymous)";
      const url = node?.callFrame.url ?? "";
      const shortUrl = url ? url.replace(/^.*\/src\//, "src/").replace(/\?.*$/, "") : "";
      return { name: rawName, url: shortUrl, selfMs: us / 1000 };
    })
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 20);
  return { result, top, totalMs: totalUs / 1000 };
}

function fmtCpuProfile(top: CpuProfileRow[], totalMs: number): string {
  const lines = [`total amostrado=${totalMs.toFixed(1)}ms`];
  for (const row of top.slice(0, 15)) {
    const pct = totalMs > 0 ? ((row.selfMs / totalMs) * 100).toFixed(1) : "0.0";
    lines.push(`    ${pct.padStart(5)}%  ${row.selfMs.toFixed(1)}ms  ${row.name || "(anonymous)"}  ${row.url}`);
  }
  return lines.join("\n");
}

async function settle(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * Achado da Fase 4 (relatório, seção J): esta função criava um
 * `PerformanceObserver` NOVO a cada chamada sem nunca desconectar o
 * anterior — depois de ~115 chamadas (Fases A/B rodando antes da C) cada
 * long task real era contada ~100×, produzindo números fisicamente
 * impossíveis (ex.: "201828ms de long task numa janela de 700ms"). Guarda
 * o observer em `window` e desconecta o velho ANTES de criar o novo —
 * nunca mais que 1 observer vivo por vez.
 */
async function installLongTaskCollector(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __benchLongTasks: number[]; __benchLongTaskObserver?: PerformanceObserver };
    w.__benchLongTaskObserver?.disconnect();
    w.__benchLongTasks = [];
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__benchLongTasks.push(e.duration);
      });
      obs.observe({ entryTypes: ["longtask"] });
      w.__benchLongTaskObserver = obs;
    } catch {
      // longtask indisponível — segue sem
    }
  });
}

async function readLongTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __benchLongTasks?: number[] };
    const v = w.__benchLongTasks ?? [];
    w.__benchLongTasks = [];
    return v;
  });
}

async function domNodeCount(page: Page): Promise<number> {
  return page.evaluate(() => document.getElementsByTagName("*").length);
}

interface PerfSnapshot {
  drawCalls: number;
  triangles: number;
  fps: number;
  frameTimeMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
}

interface CullStats {
  active: number;
  culled: number;
}

/** `gl.info.render` + fps/frame-time (média + P50/P95/P99) da janela
 * rolante — Etapa 0 da Fase 5 (item 15: "draw calls + GPU frame time") +
 * benchmark de escala (item 13: "não basta média"). Fonte real, não
 * estimada: `__vfxBench.perfSnapshot()` (`VfxBenchView.tsx`), mesma
 * leitura que `scene/PerfHud.tsx` já faz em produção. */
async function perfSnapshot(page: Page): Promise<PerfSnapshot> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { perfSnapshot: () => PerfSnapshot } }).__vfxBench.perfSnapshot());
}

async function resetFrameStats(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vfxBench: { resetFrameStats: () => void } }).__vfxBench.resetFrameStats());
}

/** quantas instâncias vivas estão dentro/fora do frustum — item 7 do
 * benchmark de escala ("comprovar que o culling descarta trabalho real,
 * não só altera um contador"). */
async function cullStats(page: Page): Promise<CullStats> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { cullStats: () => CullStats } }).__vfxBench.cullStats());
}

interface ScenarioResult {
  scenario: string;
  kind: string;
  instances: number;
  domNodesDelta: number;
  domNodesLeakAfterUnmount: number;
  metricsWindow: Record<string, number>;
  trace?: Record<string, number>;
  longTasks: number[];
  heapDeltaMb: number;
  perf: PerfSnapshot;
}

async function measureOnce(
  page: Page,
  cdp: CDPSession,
  scenarioIndex: number,
  scenario: ScenarioDef,
  instances: number,
  windowMs: number,
  withTracing: boolean,
): Promise<ScenarioResult> {
  await page.evaluate((n) => (window as unknown as { __vfxBench: { reset: (c: number) => void } }).__vfxBench.reset(n), instances);
  await settle(page, 150);
  await collectGarbage(cdp);
  const domBefore = await domNodeCount(page);
  await installLongTaskCollector(page);

  const spawnAndWait = async () => {
    await page.evaluate(
      (idx) => (window as unknown as { __vfxBench: { spawnAll: (i: number) => number[] } }).__vfxBench.spawnAll(idx),
      scenarioIndex,
    );
    await settle(page, 200); // estabilização: primeiro layout/paint do mount
  };

  const metricsBeforeRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsBefore = metricsToMap(metricsBeforeRaw.metrics);

  let trace: Record<string, number> | undefined;
  if (withTracing) {
    const { trace: t } = await withTrace(cdp, async () => {
      await spawnAndWait();
      await settle(page, windowMs);
    });
    trace = t;
  } else {
    await spawnAndWait();
    await settle(page, windowMs);
  }

  const metricsAfterRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsAfter = metricsToMap(metricsAfterRaw.metrics);
  const metricsWindow = delta(metricsBefore, metricsAfter, METRIC_KEYS);
  const heapDeltaMb = metricsWindow.JSHeapUsedSize! / (1024 * 1024);

  const domDuring = await domNodeCount(page);
  const longTasks = await readLongTasks(page);
  const perf = await perfSnapshot(page);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);
  const domAfter = await domNodeCount(page);

  return {
    scenario: scenario.label,
    kind: scenario.kind,
    instances,
    domNodesDelta: domDuring - domBefore,
    domNodesLeakAfterUnmount: domAfter - domBefore,
    metricsWindow,
    trace,
    longTasks,
    heapDeltaMb,
    perf,
  };
}

// ---- Fase C: multiplayer real — players × intensidade (leia1.txt item 7:
// "não testar apenas 1/5/10/20/30 players, testar players × intensidade de
// VFX"). `spawnCombo` (VfxBenchView.tsx) dispara uma COMBINAÇÃO de skills
// por "jogador" (slot), não N cópias do mesmo cenário — é uma dimensão
// diferente da Fase B acima. ----
interface MultiplayerResult {
  players: number;
  combo: string;
  domNodesDelta: number;
  domNodesLeakAfterUnmount: number;
  metricsWindow: Record<string, number>;
  trace?: Record<string, number>;
  longTasks: number[];
  heapDeltaMb: number;
  perf: PerfSnapshot;
}

async function measureMultiplayer(
  page: Page,
  cdp: CDPSession,
  players: number,
  combo: "wallsAndOracle" | "chaotic",
  windowMs: number,
  withTracing: boolean,
): Promise<MultiplayerResult> {
  await page.evaluate((n) => (window as unknown as { __vfxBench: { reset: (c: number) => void } }).__vfxBench.reset(n), players);
  await settle(page, 150);
  await collectGarbage(cdp);
  const domBefore = await domNodeCount(page);
  await installLongTaskCollector(page);

  const spawnAndWait = async () => {
    await page.evaluate(
      ({ n, c }) => {
        const api = (window as unknown as { __vfxBench: { spawnCombo: (slot: number, combo: string) => void } }).__vfxBench;
        for (let i = 0; i < n; i++) api.spawnCombo(i, c);
      },
      { n: players, c: combo },
    );
    // janela de estabilização maior que a Fase A/B — cada slot aqui dispara
    // VÁRIAS skills de uma vez (até 6, ver `spawnCombo`), o primeiro
    // commit de layout/paint tem mais trabalho pra fazer de uma vez.
    await settle(page, 300);
  };

  const metricsBeforeRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsBefore = metricsToMap(metricsBeforeRaw.metrics);

  let trace: Record<string, number> | undefined;
  if (withTracing) {
    const { trace: t } = await withTrace(cdp, async () => {
      await spawnAndWait();
      await settle(page, windowMs);
    });
    trace = t;
  } else {
    await spawnAndWait();
    await settle(page, windowMs);
  }

  const metricsAfterRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsAfter = metricsToMap(metricsAfterRaw.metrics);
  const metricsWindow = delta(metricsBefore, metricsAfter, METRIC_KEYS);
  const heapDeltaMb = metricsWindow.JSHeapUsedSize! / (1024 * 1024);

  const domDuring = await domNodeCount(page);
  const longTasks = await readLongTasks(page);
  const perf = await perfSnapshot(page);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);
  const domAfter = await domNodeCount(page);

  return {
    players,
    combo,
    domNodesDelta: domDuring - domBefore,
    domNodesLeakAfterUnmount: domAfter - domBefore,
    metricsWindow,
    trace,
    longTasks,
    heapDeltaMb,
    perf,
  };
}

// ---- matriz sintética de CSS (blur / text-shadow), fora da árvore de VFX —
// isola a PROPRIEDADE do componente, pra responder "quanto cada camada
// custa" sem o resto do VFX no meio. ----
interface CssMatrixResult {
  name: string;
  trace: Record<string, number>;
}
async function cssMatrix(page: Page, cdp: CDPSession): Promise<CssMatrixResult[]> {
  const N = 40; // elementos simultâneos — mesma ordem de grandeza de um burst de skill
  const cases: { name: string; css: string }[] = [
    { name: "text-shadow × 0", css: "font: 900 168px system-ui; color: #ffe27a;" },
    {
      name: "text-shadow × 1",
      css: "font: 900 168px system-ui; color: #ffe27a; text-shadow: 0 12px 0 rgba(60,45,0,.95);",
    },
    {
      name: "text-shadow × 2",
      css: "font: 900 168px system-ui; color: #ffe27a; text-shadow: 0 12px 0 rgba(60,45,0,.95), 0 -12px 0 rgba(60,45,0,.95);",
    },
    {
      name: "text-shadow × 4",
      css: "font: 900 168px system-ui; color: #ffe27a; text-shadow: 0 12px 0 rgba(60,45,0,.95), 0 -12px 0 rgba(60,45,0,.95), 12px 0 0 rgba(60,45,0,.95), -12px 0 0 rgba(60,45,0,.95);",
    },
    {
      name: "text-shadow × 6 (ts-total real)",
      css: "font: 900 168px system-ui; color: #ffe27a; text-shadow: 0 0 64px rgba(255,220,110,.95), 0 12px 0 rgba(60,45,0,.95), 0 -12px 0 rgba(60,45,0,.95), 12px 0 0 rgba(60,45,0,.95), -12px 0 0 rgba(60,45,0,.95), 0 0 104px rgba(255,210,90,.65);",
    },
    { name: "blur: none", css: "width:160px;height:640px;background:#6ab4ff;" },
    { name: "blur: 4px (pequeno)", css: "width:160px;height:640px;background:#6ab4ff;filter:blur(4px);" },
    { name: "blur: 10px (médio, ts-bolt real)", css: "width:160px;height:640px;background:#6ab4ff;filter:blur(10px);" },
    { name: "blur: 24px (grande)", css: "width:160px;height:640px;background:#6ab4ff;filter:blur(24px);" },
  ];

  const results: CssMatrixResult[] = [];
  for (const c of cases) {
    // a CRIAÇÃO tem que estar DENTRO do tracing — medir depois de um settle
    // já mediria a cena PARADA (a única animação daqui é `opacity`, que o
    // compositor anima sem repintar; blur/text-shadow são ESTÁTICOS depois
    // do primeiro layout, então o custo real acontece no COMMIT inicial).
    const { trace } = await withTrace(cdp, async () => {
      await page.evaluate(
        ({ css, n }) => {
          const root = document.createElement("div");
          root.id = "__cssMatrix";
          root.style.position = "fixed";
          root.style.inset = "0";
          root.style.pointerEvents = "none";
          for (let i = 0; i < n; i++) {
            const el = document.createElement("div");
            el.textContent = "8888";
            el.style.cssText = `position:absolute; left:${(i * 37) % 1600}px; top:${(i * 53) % 900}px; ${css} animation: __cssMatrixSpin 400ms linear infinite;`;
            root.appendChild(el);
          }
          if (!document.getElementById("__cssMatrixKeyframes")) {
            const style = document.createElement("style");
            style.id = "__cssMatrixKeyframes";
            style.textContent = "@keyframes __cssMatrixSpin { from { opacity: .6; } to { opacity: 1; } }";
            document.head.appendChild(style);
          }
          document.body.appendChild(root);
        },
        { css: c.css, n: N },
      );
      await settle(page, 500); // cobre o(s) primeiro(s) commit(s) de layout+paint+raster
    });

    await page.evaluate(() => document.getElementById("__cssMatrix")?.remove());
    await settle(page, 150);
    results.push({ name: c.name, trace });
  }
  return results;
}

// ---- Fase D: A/B de decomposição do Oráculo (Fase 5, Etapa 6 — leia1.txt:
// "antes de migrar o Oracle pra GPU, decompor visualmente a receita atual e
// medir quanto cada elemento custa, não assumir"). Controla
// `window.__oracleBench` (`vfx/mage/oracle/oracleBenchConfig.ts`, mesmo
// padrão do `__fwBench` que Fire Wall já tinha) — nunca reimplementa a
// arte, só liga/desliga pedaços da PRODUÇÃO. ----
interface OracleVariantResult {
  variant: string;
  domNodes: number;
  trace: Record<string, number>;
}

interface OracleBenchConfigPartial {
  echoCountPerSkull?: number;
  glimmerCount?: number;
  showSkullGlow?: boolean;
  skullFilterMode?: "all" | "none";
  echoFilterMode?: "all" | "none";
}

const ORACLE_VARIANTS: { name: string; config: OracleBenchConfigPartial }[] = [
  { name: "oracle-original", config: {} },
  { name: "oracle-sem-skull-filter", config: { skullFilterMode: "none" } },
  { name: "oracle-sem-skull-glow", config: { showSkullGlow: false } },
  { name: "oracle-sem-echo-filter", config: { echoFilterMode: "none" } },
  { name: "oracle-sem-echos", config: { echoCountPerSkull: 0 } },
  { name: "oracle-sem-glimmers", config: { glimmerCount: 0 } },
  {
    name: "oracle-so-estrutura",
    config: { echoCountPerSkull: 0, glimmerCount: 0, showSkullGlow: false, skullFilterMode: "none", echoFilterMode: "none" },
  },
];

async function measureOracleVariant(
  page: Page,
  cdp: CDPSession,
  scenarioIndex: number,
  variantName: string,
  config: OracleBenchConfigPartial,
  windowMs: number,
): Promise<OracleVariantResult> {
  await page.evaluate((n) => (window as unknown as { __vfxBench: { reset: (c: number) => void } }).__vfxBench.reset(n), 1);
  await page.evaluate(
    (cfg) => (window as unknown as { __oracleBench: { set: (c: OracleBenchConfigPartial) => void } }).__oracleBench.set(cfg),
    config,
  );
  await settle(page, 150);
  await collectGarbage(cdp);
  const domBefore = await domNodeCount(page);

  const { trace } = await withTrace(cdp, async () => {
    await page.evaluate(
      (idx) => (window as unknown as { __vfxBench: { spawnAll: (i: number) => number[] } }).__vfxBench.spawnAll(idx),
      scenarioIndex,
    );
    await settle(page, 200);
    await settle(page, windowMs);
  });

  const domDuring = await domNodeCount(page);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await page.evaluate(() => (window as unknown as { __oracleBench: { reset: () => void } }).__oracleBench.reset());
  await settle(page, 250);
  await collectGarbage(cdp);

  return { variant: variantName, domNodes: domDuring - domBefore, trace };
}

// ---- Fase E/F: benchmark de escala (Fase 5, pedido "1/5/10/20/30 players,
// espalhados/sobrepostos/fora da câmera, CPU separado de raster, curva de
// crescimento, culling on/off, legacy vs shared"). Reusa `plantEntities`
// (arrangement) + `spawnCombo`/`spawnAll` já existentes — nenhuma lógica de
// spawn nova, só orquestração + captura de métricas novas
// (perfSnapshot/cullStats). ----
type BenchArrangement = "spread" | "tight" | "overlap";

interface ScaleResult {
  label: string;
  players: number;
  arrangement: BenchArrangement;
  domNodesDelta: number;
  metricsWindow: Record<string, number>;
  trace?: Record<string, number>;
  perf: PerfSnapshot;
  cullBefore: CullStats;
  cullAfter: CullStats;
  /** Fase 5, rodada "reestruturar VFX pra escala" (leia1.txt item 1) —
   * `document.getAnimations().length` capturado no mesmo instante que
   * `domDuring`, antes do `clear()`. Campo novo, não quebra os call
   * sites antigos de `measureScale` (só passa a vir preenchido). */
  activeAnimations: number;
}

async function measureScale(
  page: Page,
  cdp: CDPSession,
  players: number,
  arrangement: BenchArrangement,
  spawnAllPlayers: () => Promise<void>,
  windowMs: number,
  withTracing: boolean,
  label: string,
): Promise<ScaleResult> {
  await page.evaluate(
    ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
    { n: players, arr: arrangement },
  );
  await settle(page, 150);
  await collectGarbage(cdp);
  const domBefore = await domNodeCount(page);
  await resetFrameStats(page);
  const cullBefore = await cullStats(page);

  const metricsBeforeRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsBefore = metricsToMap(metricsBeforeRaw.metrics);

  const run = async () => {
    await spawnAllPlayers();
    await settle(page, 300); // burst maior que Fase A/B: cada player pode disparar várias skills de uma vez
    await settle(page, windowMs);
  };

  let trace: Record<string, number> | undefined;
  if (withTracing) {
    const { trace: t } = await withTrace(cdp, run);
    trace = t;
  } else {
    await run();
  }

  const metricsAfterRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsAfter = metricsToMap(metricsAfterRaw.metrics);
  const metricsWindow = delta(metricsBefore, metricsAfter, METRIC_KEYS);

  const domDuring = await domNodeCount(page);
  const activeAnimations = await activeAnimationCountPage(page);
  const perf = await perfSnapshot(page);
  const cullAfter = await cullStats(page);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);

  return { label, players, arrangement, domNodesDelta: domDuring - domBefore, metricsWindow, trace, perf, cullBefore, cullAfter, activeAnimations };
}

async function spawnComboAllPlayers(page: Page, players: number, combo: "wallsAndOracle" | "chaotic"): Promise<void> {
  await page.evaluate(
    ({ n, c }) => {
      const api = (window as unknown as { __vfxBench: { spawnCombo: (slot: number, combo: string) => void } }).__vfxBench;
      for (let i = 0; i < n; i++) api.spawnCombo(i, c);
    },
    { n: players, c: combo },
  );
}

async function spawnComboSubsetAllPlayers(page: Page, players: number, skills: string[]): Promise<void> {
  await page.evaluate(
    ({ n, sk }) => {
      const api = (window as unknown as { __vfxBench: { spawnComboSubset: (slot: number, skills: string[]) => void } }).__vfxBench;
      for (let i = 0; i < n; i++) api.spawnComboSubset(i, sk);
    },
    { n: players, sk: skills },
  );
}

async function spawnSingleAllPlayers(page: Page, scenarioIndex: number): Promise<void> {
  await page.evaluate(
    (idx) => (window as unknown as { __vfxBench: { spawnAll: (i: number) => number[] } }).__vfxBench.spawnAll(idx),
    scenarioIndex,
  );
}

// Fase S: dispara cada slot com um atraso real (setTimeout) de
// `offsetMsPerSlot * slot` — MESMO cenário/opts/DOM/duração, só o instante
// de nascimento de cada cast é diferente (ver docblock em `VfxBenchView.tsx`).
async function spawnAllStaggeredPage(
  page: Page,
  scenarioIndex: number,
  offsetMsPerSlot: number,
  opts?: { hits?: number; damage?: number },
): Promise<void> {
  await page.evaluate(
    ({ idx, offset, o }) =>
      (
        window as unknown as {
          __vfxBench: { spawnAllStaggered: (i: number, offset: number, opts?: typeof o) => Promise<number[]> };
        }
      ).__vfxBench.spawnAllStaggered(idx, offset, o),
    { idx: scenarioIndex, offset: offsetMsPerSlot, o: opts },
  );
}

interface ImpactWatchResult {
  frames: { frame: number; impacts: number; toggles: number; animStarts: number; live: number }[];
  maxImpactsPerFrame: number;
  maxTogglesPerFrame: number;
  maxAnimStartsPerFrame: number;
}

async function startImpactWatchPage(page: Page, liveSelector?: string): Promise<void> {
  await page.evaluate(
    (sel) => (window as unknown as { __vfxBench: { startImpactWatch: (s?: string) => void } }).__vfxBench.startImpactWatch(sel),
    liveSelector,
  );
}

async function stopImpactWatchPage(page: Page): Promise<ImpactWatchResult> {
  return page.evaluate(() =>
    (window as unknown as { __vfxBench: { stopImpactWatch: () => ImpactWatchResult } }).__vfxBench.stopImpactWatch(),
  );
}

async function readFrameTimesRawPage(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { frameTimesRaw: () => number[] } }).__vfxBench.frameTimesRaw());
}

async function setColdBoltCssOverridePage(page: Page, mode: string): Promise<void> {
  await page.evaluate(
    (m) => (window as unknown as { __vfxBench: { setColdBoltCssOverride: (mode: string) => void } }).__vfxBench.setColdBoltCssOverride(m),
    mode,
  );
}

async function resetColdBoltCssOverridePage(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vfxBench: { resetColdBoltCssOverride: () => void } }).__vfxBench.resetColdBoltCssOverride());
}

async function setVfxBudgetPage(page: Page, maxActiveInstances: number): Promise<void> {
  await page.evaluate(
    (n) => (window as unknown as { __vfxBench: { setVfxBudget: (n: number) => void } }).__vfxBench.setVfxBudget(n),
    maxActiveInstances,
  );
}

async function vfxBudgetExcludedCountPage(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { vfxBudgetExcludedCount: () => number } }).__vfxBench.vfxBudgetExcludedCount());
}

async function activeAnimationCountPage(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { activeAnimationCount: () => number } }).__vfxBench.activeAnimationCount());
}

async function coldBoltClassCountsPage(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() =>
    (window as unknown as { __vfxBench: { coldBoltClassCounts: () => Record<string, number> } }).__vfxBench.coldBoltClassCounts(),
  );
}

async function setSoulStrikeCssOverridePage(page: Page, mode: string): Promise<void> {
  await page.evaluate(
    (m) => (window as unknown as { __vfxBench: { setSoulStrikeCssOverride: (mode: string) => void } }).__vfxBench.setSoulStrikeCssOverride(m),
    mode,
  );
}

async function resetSoulStrikeCssOverridePage(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __vfxBench: { resetSoulStrikeCssOverride: () => void } }).__vfxBench.resetSoulStrikeCssOverride(),
  );
}

async function soulStrikeClassCountsPage(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() =>
    (window as unknown as { __vfxBench: { soulStrikeClassCounts: () => Record<string, number> } }).__vfxBench.soulStrikeClassCounts(),
  );
}

function fmtScale(r: ScaleResult): string {
  const p = r.perf;
  return `script=${r.metricsWindow.ScriptDuration?.toFixed(1)}ms recalc=${r.metricsWindow.RecalcStyleDuration?.toFixed(1)}ms layout=${r.metricsWindow.LayoutDuration?.toFixed(1)}ms ${r.trace ? `paint=${r.trace.paintMs?.toFixed(1)}ms raster=${r.trace.rasterMs?.toFixed(1)}ms composite=${r.trace.compositeMs?.toFixed(1)}ms gpu=${r.trace.gpuMs?.toFixed(1)}ms ` : ""}domNodes=${r.domNodesDelta} activeAnims=${r.activeAnimations} fps=${p.fps.toFixed(0)} frame(avg/p50/p95/p99)=${p.frameTimeMs.toFixed(1)}/${p.p50Ms.toFixed(1)}/${p.p95Ms.toFixed(1)}/${p.p99Ms.toFixed(1)}ms(n=${p.sampleCount}) drawCalls=${p.drawCalls} cull(before/after)=${r.cullBefore.culled}/${r.cullAfter.culled} de ${r.cullBefore.active}/${r.cullAfter.active} ativas`;
}

// ---- Fase G: MOUNT vs STEADY-STATE — a Fase E/F misturava rajada de spawn
// com estado estável na mesma janela de 800ms, então não dava pra saber ONDE
// o custo de escala realmente mora. Duas janelas SEPARADAS e não sobrepostas
// por medição: MOUNT (logo após o spawn, ~300ms — captura criação de DOM/
// componentes/instâncias) e STEADY (depois de ~3.5s estabilizado, janela
// própria) — cada uma com seu próprio `resetFrameStats()`, então os frames
// de uma nunca vazam pra estatística da outra. ----
interface WindowMeasurement {
  domNodes: number;
  metricsWindow: Record<string, number>;
  trace?: Record<string, number>;
  perf: PerfSnapshot;
  cull: CullStats;
}

interface MountVsSteadyResult {
  label: string;
  players: number;
  arrangement: BenchArrangement;
  mount: WindowMeasurement;
  steady: WindowMeasurement;
}

async function captureWindow(
  page: Page,
  cdp: CDPSession,
  runInWindow: () => Promise<void>,
  withTracing: boolean,
): Promise<WindowMeasurement> {
  await resetFrameStats(page);
  const metricsBeforeRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsBefore = metricsToMap(metricsBeforeRaw.metrics);

  let trace: Record<string, number> | undefined;
  if (withTracing) {
    const { trace: t } = await withTrace(cdp, runInWindow);
    trace = t;
  } else {
    await runInWindow();
  }

  const metricsAfterRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsAfter = metricsToMap(metricsAfterRaw.metrics);
  const metricsWindow = delta(metricsBefore, metricsAfter, METRIC_KEYS);

  const domNodes = await domNodeCount(page);
  const perf = await perfSnapshot(page);
  const cull = await cullStats(page);

  return { domNodes, metricsWindow, trace, perf, cull };
}

async function measureMountVsSteady(
  page: Page,
  cdp: CDPSession,
  players: number,
  arrangement: BenchArrangement,
  spawnAllPlayers: () => Promise<void>,
  withTracing: boolean,
  label: string,
): Promise<MountVsSteadyResult> {
  await page.evaluate(
    ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
    { n: players, arr: arrangement },
  );
  await settle(page, 150);
  await collectGarbage(cdp);

  // JANELA MOUNT — spawn + ~300ms, exatamente o burst de criação (React
  // commit, DOM, primitives, instâncias no manager). `resetFrameStats()` já
  // roda dentro de `captureWindow`, então só conta frames DESTA janela.
  const mount = await captureWindow(
    page,
    cdp,
    async () => {
      await spawnAllPlayers();
      await settle(page, 300);
    },
    withTracing,
  );

  // estabiliza ~3.5s SEM medir (nem trace nem frame-stats destinados à
  // comparação) — é só o tempo que separa "acabou de nascer" de "já vive
  // renderizando há um tempo".
  await settle(page, 3200);

  // JANELA STEADY — tudo já vivo, nada novo sendo criado; mede só o custo
  // de MANTER renderizando.
  const steady = await captureWindow(page, cdp, () => settle(page, 800), withTracing);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);

  return { label, players, arrangement, mount, steady };
}

function fmtWindow(w: WindowMeasurement): string {
  return `script=${w.metricsWindow.ScriptDuration?.toFixed(1)}ms recalc=${w.metricsWindow.RecalcStyleDuration?.toFixed(1)}ms ${w.trace ? `paint=${w.trace.paintMs?.toFixed(1)}ms raster=${w.trace.rasterMs?.toFixed(1)}ms composite=${w.trace.compositeMs?.toFixed(1)}ms ` : ""}dom=${w.domNodes} fps=${w.perf.fps.toFixed(0)} frame(avg/p50/p95/p99)=${w.perf.frameTimeMs.toFixed(1)}/${w.perf.p50Ms.toFixed(1)}/${w.perf.p95Ms.toFixed(1)}/${w.perf.p99Ms.toFixed(1)}(n=${w.perf.sampleCount}) cull=${w.cull.culled}/${w.cull.active}`;
}

// ---- Fase J: decomposição interna de `vfxManager.update()` — a Fase I
// achou um piso de custo com 30 instâncias 100% culled (raster=0, paint=0,
// mas fps ainda cai 73%). Esta fase lê `vfxManager.getUpdateProfile()`
// (instrumentação real dentro do `update()`, ver `manager.ts`) pra separar
// anchor/trajectory de culling de DOM/style de flush, nos 4 controles que
// isolam "existir" de "estar visível". ----
interface UpdateProfileSnapshot {
  iterationMs: number;
  anchorMs: number;
  cullingMs: number;
  domUpdateMs: number;
  flushMs: number;
  frames: number;
}

async function resetUpdateProfile(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vfxBench: { resetUpdateProfile: () => void } }).__vfxBench.resetUpdateProfile());
}

async function readUpdateProfile(page: Page): Promise<UpdateProfileSnapshot> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { updateProfile: () => UpdateProfileSnapshot } }).__vfxBench.updateProfile());
}

interface ControlResult {
  label: string;
  players: number;
  arrangement: BenchArrangement;
  steady: WindowMeasurement;
  profile: UpdateProfileSnapshot;
}

async function measureControl(
  page: Page,
  cdp: CDPSession,
  players: number,
  arrangement: BenchArrangement,
  oracleIdx: number,
  withTracing: boolean,
  label: string,
): Promise<ControlResult> {
  await page.evaluate(
    ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
    { n: players, arr: arrangement },
  );
  await settle(page, 150);
  await collectGarbage(cdp);

  await spawnSingleAllPlayers(page, oracleIdx);
  await settle(page, 300); // mount — não medido nesta fase, só passar pro steady

  await settle(page, 3200); // estabiliza — MESMA janela de 3.5s da Fase G/H

  // reseta OS DOIS relógios no mesmo instante — só o que acontece na
  // janela steady conta, nem um frame da rajada/estabilização vaza aqui.
  await resetFrameStats(page);
  await resetUpdateProfile(page);
  const steady = await captureWindow(page, cdp, () => settle(page, 800), withTracing);
  const profile = await readUpdateProfile(page);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);

  return { label, players, arrangement, steady, profile };
}

function fmtProfile(p: UpdateProfileSnapshot): string {
  if (p.frames === 0) return "frames=0 (sem amostra)";
  const per = (ms: number) => (ms / p.frames).toFixed(3);
  const total = p.iterationMs + p.anchorMs + p.cullingMs + p.domUpdateMs + p.flushMs;
  return `frames=${p.frames} total/quadro=${(total / p.frames).toFixed(2)}ms — iteration=${per(p.iterationMs)} anchor=${per(p.anchorMs)} culling=${per(p.cullingMs)} domUpdate=${per(p.domUpdateMs)} flush=${per(p.flushMs)} (ms/quadro)`;
}

// ---- Fase K: React/DOM persistent tree isolation — a Fase J refutou
// "update() é caro"; sobra descobrir se os ~49ms (1→30 culled) vêm de
// manter uma árvore DOM grande CONECTADA ao document (Caso A), de React/
// VFX lifecycle em si (Caso B), ou de outra coisa (Caso C). ----
interface DomBreakdown {
  total: number;
  div: number;
  svg: number;
  path: number;
  displayNone: number;
  visibilityHidden: number;
  connected: number;
}

async function readDomBreakdown(page: Page): Promise<DomBreakdown> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { domBreakdown: () => DomBreakdown } }).__vfxBench.domBreakdown());
}

async function mountStaticDomPage(page: Page, count: number): Promise<void> {
  await page.evaluate((n) => (window as unknown as { __vfxBench: { mountStaticDom: (c: number) => void } }).__vfxBench.mountStaticDom(n), count);
}

async function clearStaticDomPage(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vfxBench: { clearStaticDom: () => void } }).__vfxBench.clearStaticDom());
}

async function setDomAttachedPage(page: Page, attached: boolean): Promise<void> {
  await page.evaluate(
    (a) => (window as unknown as { __vfxBench: { setDomDocumentAttached: (v: boolean) => void } }).__vfxBench.setDomDocumentAttached(a),
    attached,
  );
}

interface OracleConfigPartial extends OracleFilterConfigPartial {
  echoCountPerSkull?: number;
  glimmerCount?: number;
  showSkullGlow?: boolean;
  freezeUpdates?: boolean;
  glimmerAnimationMode?: "on" | "off";
  glimmerPlayState?: "running" | "paused";
  glimmerVisibilityHidden?: boolean;
}

async function setOracleConfig(page: Page, cfg: OracleConfigPartial): Promise<void> {
  await page.evaluate(
    (c) => (window as unknown as { __oracleBench: { set: (cfg: typeof c) => void } }).__oracleBench.set(c),
    cfg,
  );
}

// item 1: inventário de DOM por escala (offscreen — não importa
// visibilidade aqui, só contagem).
async function measureDomInventory(page: Page, cdp: CDPSession, players: number, oracleIdx: number): Promise<DomBreakdown> {
  await page.evaluate(
    ({ n }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, "offscreen"),
    { n: players },
  );
  await settle(page, 150);
  await collectGarbage(cdp);
  await spawnSingleAllPlayers(page, oracleIdx);
  await settle(page, 500);
  const breakdown = await readDomBreakdown(page);
  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  return breakdown;
}

// Controle C: 30 instâncias Oracle, offscreen, mas com a configuração
// "so-estrutura" da Fase D (0 ecos, 0 glimmers, sem glow, sem filtro) —
// reusa `oracleBenchConfig.ts`, NÃO cria componente novo. DOM por
// instância cai de ~284 pra ~23 nós — testa "React/VFX com pouco DOM".
async function measureMinimalControl(page: Page, cdp: CDPSession, oracleIdx: number, withTracing: boolean): Promise<ControlResult> {
  await setOracleConfig(page, { echoCountPerSkull: 0, glimmerCount: 0, showSkullGlow: false, skullFilterMode: "none", echoFilterMode: "none" });
  const r = await measureControl(page, cdp, 30, "offscreen", oracleIdx, withTracing, "C: 30 minimal (so-estrutura)/offscreen");
  await resetOracleFilter(page); // reset() da Fase D já restaura TODOS os campos, não só filtro
  return r;
}

// Controle D: ~mesmo número de nós DOM que 30 Oracles (8539), criados
// DIRETO (`document.createElement`, fora de React/VFX Core inteiramente)
// — zero JS toca eles depois de montados. Isola "ter N nós no document"
// de "React/VFX mantendo N instâncias".
async function measureStaticDomControl(page: Page, cdp: CDPSession, count: number, withTracing: boolean): Promise<WindowMeasurement & { label: string }> {
  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await mountStaticDomPage(page, count);
  await settle(page, 150);
  await collectGarbage(cdp);
  await settle(page, 3200); // MESMA janela de estabilização das outras fases, mesmo não tendo nada pra "estabilizar"
  const w = await captureWindow(page, cdp, () => settle(page, 800), withTracing);
  await clearStaticDomPage(page);
  await settle(page, 250);
  await collectGarbage(cdp);
  return { ...w, label: "D: DOM estático (sem VFX)" };
}

// Controle E: DOM-detached — 30/tight (6 visíveis, MESMA config que a
// Fase H mediu com a árvore CONECTADA) mas com `hostEl` do `DomRenderer`
// fora do `document` durante a janela steady. React continua rodando
// (`onInstanceUpdate` continua escrevendo `style.transform`), só o
// navegador para de fazer layout/paint pra essa árvore.
async function measureDetachedControl(page: Page, cdp: CDPSession, oracleIdx: number, withTracing: boolean): Promise<ControlResult> {
  await page.evaluate(
    ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
    { n: 30, arr: "tight" as BenchArrangement },
  );
  await settle(page, 150);
  await collectGarbage(cdp);
  await spawnSingleAllPlayers(page, oracleIdx);
  await settle(page, 300);
  await setDomAttachedPage(page, false);
  await settle(page, 3200);
  await resetFrameStats(page);
  await resetUpdateProfile(page);
  const steady = await captureWindow(page, cdp, () => settle(page, 800), withTracing);
  const profile = await readUpdateProfile(page);
  await setDomAttachedPage(page, true); // religa ANTES de clear() — clear() desmonta via React, precisa estar conectado
  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);
  return { label: "E: 30/tight, DOM DESCONECTADO", players: 30, arrangement: "tight", steady, profile };
}

function fmtDom(b: DomBreakdown): string {
  return `total=${b.total} div=${b.div} svg=${b.svg} path=${b.path} displayNone=${b.displayNone} visibilityHidden=${b.visibilityHidden} connected=${b.connected}`;
}

// ---- Fase L: qual característica da árvore VFX conectada explica o
// custo — 30 instâncias, SEMPRE 0 visíveis (offscreen), controles mínimos
// reusando `oracleBenchConfig.ts`. NÃO reabre update()/culling/renderer —
// Fase J já provou que isso é ~0.10ms. ----
interface TreeControlResult {
  label: string;
  domNodes: number;
  steady: WindowMeasurement;
}

async function measureTreeControl(
  page: Page,
  cdp: CDPSession,
  oracleIdx: number,
  cfg: OracleConfigPartial,
  detached: boolean,
  label: string,
): Promise<TreeControlResult> {
  await page.evaluate(
    ({ n }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, "offscreen"),
    { n: 30 },
  );
  if (Object.keys(cfg).length > 0) await setOracleConfig(page, cfg);
  await settle(page, 150);
  await collectGarbage(cdp);
  await spawnSingleAllPlayers(page, oracleIdx);
  await settle(page, 300);
  if (detached) await setDomAttachedPage(page, false);
  await settle(page, 3200);
  const steady = await captureWindow(page, cdp, () => settle(page, 800), true);
  const domNodes = steady.domNodes;
  if (detached) await setDomAttachedPage(page, true);
  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await resetOracleFilter(page);
  await settle(page, 250);
  await collectGarbage(cdp);
  return { label, domNodes, steady };
}

// ---- Fase H: filtro CSS em escala — mesma arquitetura (Skill → Core →
// SharedTrailPrimitive → DomRenderer → culling), a ÚNICA variável é o filtro
// `drop-shadow` do Oráculo (`.or-skull`/`.or-echo`). Reusa
// `oracleBenchConfig.ts` (já existia da Fase D, Etapa 6 — `skullFilterMode`/
// `echoFilterMode`), NÃO cria `FilterPrimitive` nenhuma. ----
interface OracleFilterConfigPartial {
  skullFilterMode?: "all" | "none";
  echoFilterMode?: "all" | "none";
}

async function setOracleFilter(page: Page, mode: "all" | "none"): Promise<void> {
  await page.evaluate(
    (m) =>
      (window as unknown as { __oracleBench: { set: (c: OracleFilterConfigPartial) => void } }).__oracleBench.set({
        skullFilterMode: m,
        echoFilterMode: m,
      }),
    mode,
  );
}

async function resetOracleFilter(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __oracleBench: { reset: () => void } }).__oracleBench.reset());
}

async function measureOracleFilterVariant(
  page: Page,
  cdp: CDPSession,
  players: number,
  arrangement: BenchArrangement,
  filterMode: "all" | "none",
  oracleIdx: number,
  withTracing: boolean,
): Promise<MountVsSteadyResult> {
  await page.evaluate(
    ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
    { n: players, arr: arrangement },
  );
  await setOracleFilter(page, filterMode);
  await settle(page, 150);
  await collectGarbage(cdp);

  const mount = await captureWindow(
    page,
    cdp,
    async () => {
      await spawnSingleAllPlayers(page, oracleIdx);
      await settle(page, 300);
    },
    withTracing,
  );

  await settle(page, 3200);

  const steady = await captureWindow(page, cdp, () => settle(page, 800), withTracing);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await resetOracleFilter(page);
  await settle(page, 250);
  await collectGarbage(cdp);

  return { label: `oracle/filter=${filterMode}`, players, arrangement, mount, steady };
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {
      // servidor ainda não subiu
    }
    if (Date.now() - start > timeoutMs) throw new Error(`vite dev não respondeu em ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function startVite(): ChildProcess {
  return spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: APP_DIR,
    stdio: "pipe",
    env: { ...process.env },
    shell: true,
  });
}

/** `shell:true` no Windows spawna um cmd.exe que por sua vez spawna o
 * `node`/`vite` de verdade — `child.kill()` mata só o cmd.exe INTERMEDIÁRIO
 * e o processo real fica órfão, segurando a porta pra sempre (era o que
 * fazia a PRÓXIMA rodada falhar com "port already in use"). `taskkill /T`
 * mata a árvore inteira pelo PID do processo raiz. */
function killViteTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}

/** mata qualquer processo já escutando na porta do benchmark ANTES de subir
 * o próprio vite — sem isto, uma sobra órfã de rodada anterior (ver
 * `killViteTree`) faz `--strictPort` falhar e o script seguir conversando
 * com código VELHO, silenciosamente. Só Windows (`netstat`/`taskkill`);
 * best-effort, nunca derruba o benchmark se a porta já estiver livre. */
async function freePort(port: number): Promise<void> {
  if (process.platform !== "win32") return;
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: "utf8" });
    const pids = new Set(
      out
        .split("\n")
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((p): p is string => !!p && /^\d+$/.test(p)),
    );
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      } catch {
        // já morto — segue
      }
    }
  } catch {
    // findstr sem match sai com código != 0 (porta livre) — nada a fazer
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);

  console.log(`[vfx-bench] subindo vite dev em :${PORT}...`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  try {
    await waitForServer(BASE_URL, 30000);

    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");

    console.log("[vfx-bench] abrindo /vfx-bench...");
    await page.goto(`${BASE_URL}/vfx-bench`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as unknown as { __vfxBenchReady?: boolean }).__vfxBenchReady === true, {
      timeout: 15000,
    });
    await settle(page, 500);

    const scenarios = (await page.evaluate(
      () => (window as unknown as { __vfxBench: { scenarios: ScenarioDef[] } }).__vfxBench.scenarios,
    )) as ScenarioDef[];

    // `VFX_BENCH_ONLY=D` pula A/B/C — usado pra repetir SÓ a Fase D várias
    // vezes rápido (validação de variabilidade, sem pagar o custo das
    // outras fases a cada amostra).
    const onlyPhase = process.env.VFX_BENCH_ONLY;
    const runA = !onlyPhase || onlyPhase === "A";
    const runB = !onlyPhase || onlyPhase === "B";
    const runC = !onlyPhase || onlyPhase === "C";

    console.log(`[vfx-bench] ${scenarios.length} cenários encontrados. Fase A: 1 instância + tracing completo.`);
    const phaseA: ScenarioResult[] = [];
    for (let i = 0; runA && i < scenarios.length; i++) {
      const s = scenarios[i]!;
      process.stdout.write(`  [A] ${s.label}... `);
      const r = await measureOnce(page, cdp, i, s, 1, 1500, true);
      phaseA.push(r);
      console.log(
        `script=${r.metricsWindow.ScriptDuration?.toFixed(1)}ms recalc=${r.metricsWindow.RecalcStyleDuration?.toFixed(1)}ms layout=${r.metricsWindow.LayoutDuration?.toFixed(1)}ms paint=${r.trace?.paintMs?.toFixed(1)}ms raster=${r.trace?.rasterMs?.toFixed(1)}ms domLeak=${r.domNodesLeakAfterUnmount} drawCalls=${r.perf.drawCalls} tris=${r.perf.triangles} fps=${r.perf.fps.toFixed(0)}`,
      );
    }

    console.log(`[vfx-bench] Fase B: escala 1/5/10/20/50 instâncias (sem tracing completo, mais rápido).`);
    const stressLevels = [1, 5, 10, 20, 50];
    const phaseB: ScenarioResult[] = [];
    for (let i = 0; runB && i < scenarios.length; i++) {
      const s = scenarios[i]!;
      for (const n of stressLevels) {
        process.stdout.write(`  [B] ${s.label} × ${n}... `);
        const r = await measureOnce(page, cdp, i, s, n, 700, false);
        phaseB.push(r);
        console.log(`script=${r.metricsWindow.ScriptDuration?.toFixed(1)}ms recalc=${r.metricsWindow.RecalcStyleDuration?.toFixed(1)}ms domNodes=${r.domNodesDelta} drawCalls=${r.perf.drawCalls} tris=${r.perf.triangles}`);
      }
    }

    console.log("[vfx-bench] Fase C: multiplayer real — players × intensidade (1/5/10/20/30 × 2 combos).");
    const playerLevels = [1, 5, 10, 20, 30];
    const combos: ("wallsAndOracle" | "chaotic")[] = ["wallsAndOracle", "chaotic"];
    const phaseC: MultiplayerResult[] = [];
    for (const combo of runC ? combos : []) {
      for (const n of playerLevels) {
        process.stdout.write(`  [C] ${combo} × ${n} players... `);
        // tracing completo só até 10 (custo de coletar o trace cresce com o
        // volume de eventos — acima disso mediríamos o CUSTO DO TRACING
        // junto com o do VFX); 20/30 usam só CDP metrics, mais leve.
        const withTracing = n <= 10;
        const r = await measureMultiplayer(page, cdp, n, combo, 1000, withTracing);
        phaseC.push(r);
        const longTaskMs = r.longTasks.reduce((a, b) => a + b, 0);
        console.log(
          `script=${r.metricsWindow.ScriptDuration?.toFixed(1)}ms recalc=${r.metricsWindow.RecalcStyleDuration?.toFixed(1)}ms layout=${r.metricsWindow.LayoutDuration?.toFixed(1)}ms domNodes=${r.domNodesDelta} longTasks=${r.longTasks.length}(${longTaskMs.toFixed(0)}ms) heapMb=${r.heapDeltaMb.toFixed(1)} drawCalls=${r.perf.drawCalls} fps=${r.perf.fps.toFixed(0)}`,
        );
      }
    }

    console.log("[vfx-bench] Fase D: Oracle A/B — decomposição visual (Etapa 6, leia1.txt).");
    const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
    const phaseD: OracleVariantResult[] = [];
    if (oracleIdx === -1) {
      console.warn("[vfx-bench] cenário Oracle não encontrado em __vfxBench.scenarios — Fase D pulada.");
    } else {
      for (const v of ORACLE_VARIANTS) {
        process.stdout.write(`  [D] ${v.name}... `);
        const r = await measureOracleVariant(page, cdp, oracleIdx, v.name, v.config, 1500);
        phaseD.push(r);
        console.log(
          `domNodes=${r.domNodes} paint=${r.trace.paintMs?.toFixed(1)}ms raster=${r.trace.rasterMs?.toFixed(1)}ms recalc=${r.trace.recalcStyleMs?.toFixed(1)}ms composite=${r.trace.compositeMs?.toFixed(1)}ms`,
        );
      }
    }

    const runE = !onlyPhase || onlyPhase === "E";
    const runF = !onlyPhase || onlyPhase === "F";
    const runG = !onlyPhase || onlyPhase === "G";
    const runH = !onlyPhase || onlyPhase === "H";
    const runI = !onlyPhase || onlyPhase === "I";
    const runJ = !onlyPhase || onlyPhase === "J";
    const runK = !onlyPhase || onlyPhase === "K";
    const runL = !onlyPhase || onlyPhase === "L";
    const runM = !onlyPhase || onlyPhase === "M";
    const runN = !onlyPhase || onlyPhase === "N";
    const runO = !onlyPhase || onlyPhase === "O";
    const runP = !onlyPhase || onlyPhase === "P";
    const runQ = !onlyPhase || onlyPhase === "Q";
    const runR = !onlyPhase || onlyPhase === "R";
    const runS = !onlyPhase || onlyPhase === "S";
    const runT = !onlyPhase || onlyPhase === "T";
    const runU = !onlyPhase || onlyPhase === "U";
    const runV = !onlyPhase || onlyPhase === "V";
    const runW = !onlyPhase || onlyPhase === "W";
    const runX = !onlyPhase || onlyPhase === "X";
    const runY = !onlyPhase || onlyPhase === "Y";
    const runAA = !onlyPhase || onlyPhase === "AA";
    const runAB = !onlyPhase || onlyPhase === "AB";
    const runAC = !onlyPhase || onlyPhase === "AC";
    const runAD = !onlyPhase || onlyPhase === "AD";
    const runAE = !onlyPhase || onlyPhase === "AE";
    const runAF = !onlyPhase || onlyPhase === "AF";
    const runAG = !onlyPhase || onlyPhase === "AG";
    const runAH = !onlyPhase || onlyPhase === "AH";
    const runAI = !onlyPhase || onlyPhase === "AI";
    const runAJ = !onlyPhase || onlyPhase === "AJ";
    const runAK = !onlyPhase || onlyPhase === "AK";
    const runAL = !onlyPhase || onlyPhase === "AL";
    const runAM = !onlyPhase || onlyPhase === "AM";
    const runAN = !onlyPhase || onlyPhase === "AN";
    const runAO = !onlyPhase || onlyPhase === "AO";
    const runAP = !onlyPhase || onlyPhase === "AP";
    const runAQ = !onlyPhase || onlyPhase === "AQ";
    const runAR = !onlyPhase || onlyPhase === "AR";
    const runAS = !onlyPhase || onlyPhase === "AS";
    const runAT = !onlyPhase || onlyPhase === "AT";
    const runAU = !onlyPhase || onlyPhase === "AU";
    const runAV = !onlyPhase || onlyPhase === "AV";
    const runAW = !onlyPhase || onlyPhase === "AW";
    const runAX = !onlyPhase || onlyPhase === "AX";
    const runAY = !onlyPhase || onlyPhase === "AY";
    const runAZ = !onlyPhase || onlyPhase === "AZ";
    const runBA = !onlyPhase || onlyPhase === "BA";
    const runBB = !onlyPhase || onlyPhase === "BB";
    const runBC = !onlyPhase || onlyPhase === "BC";
    const runBD = !onlyPhase || onlyPhase === "BD";
    const runBE = !onlyPhase || onlyPhase === "BE";
    const runBF = !onlyPhase || onlyPhase === "BF";
    const runBG = !onlyPhase || onlyPhase === "BG";
    const runBH = !onlyPhase || onlyPhase === "BH";
    const runBI = !onlyPhase || onlyPhase === "BI";
    const runBJ = !onlyPhase || onlyPhase === "BJ";
    const runBK = !onlyPhase || onlyPhase === "BK";
    const runBM = !onlyPhase || onlyPhase === "BM";
    const runBN = !onlyPhase || onlyPhase === "BN";
    const scalePlayerLevels = [1, 5, 10, 20, 30];
    const scaleArrangements: BenchArrangement[] = ["spread", "tight", "overlap"];

    const phaseE: ScaleResult[] = [];
    if (runE) {
      console.log("[vfx-bench] Fase E: escala multiplayer × arranjo — combo caótico, players×espalhado/cluster/sobreposto.");
      for (const arrangement of scaleArrangements) {
        for (const n of scalePlayerLevels) {
          process.stdout.write(`  [E] chaotic/${arrangement} × ${n}... `);
          const withTracing = n <= 10;
          const r = await measureScale(page, cdp, n, arrangement, () => spawnComboAllPlayers(page, n, "chaotic"), 800, withTracing, `chaotic/${arrangement}`);
          phaseE.push(r);
          console.log(fmtScale(r));
        }
      }
    }

    const phaseF: ScaleResult[] = [];
    if (runF) {
      console.log("[vfx-bench] Fase F: legacy DOM vs SharedTrailPrimitive — mesma skill repetida, players 1..30 (arranjo spread).");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      const coldBoltImpactIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      const singleTargets: { name: string; idx: number }[] = [
        { name: "oracle(shared-trail)", idx: oracleIdx },
        { name: "coldbolt-impact(legacy)", idx: coldBoltImpactIdx },
      ];
      for (const target of singleTargets) {
        if (target.idx === -1) {
          console.warn(`[vfx-bench] cenário "${target.name}" não encontrado — pulado.`);
          continue;
        }
        for (const n of scalePlayerLevels) {
          process.stdout.write(`  [F] ${target.name} × ${n}... `);
          const r = await measureScale(page, cdp, n, "spread", () => spawnSingleAllPlayers(page, target.idx), 800, true, target.name);
          phaseF.push(r);
          console.log(fmtScale(r));
        }
      }
    }

    const phaseG: MountVsSteadyResult[] = [];
    if (runG) {
      console.log("[vfx-bench] Fase G: MOUNT vs STEADY-STATE — separa rajada de spawn de custo em regime.");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      const coldBoltImpactIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      const singleTargets: { name: string; idx: number }[] = [
        { name: "oracle(shared-trail)", idx: oracleIdx },
        { name: "coldbolt-impact(legacy)", idx: coldBoltImpactIdx },
      ];
      for (const target of singleTargets) {
        if (target.idx === -1) {
          console.warn(`[vfx-bench] cenário "${target.name}" não encontrado — pulado.`);
          continue;
        }
        for (const n of scalePlayerLevels) {
          process.stdout.write(`  [G] ${target.name}/spread × ${n}...\n`);
          const r = await measureMountVsSteady(page, cdp, n, "spread", () => spawnSingleAllPlayers(page, target.idx), true, target.name);
          phaseG.push(r);
          console.log(`    mount:  ${fmtWindow(r.mount)}`);
          console.log(`    steady: ${fmtWindow(r.steady)}`);
        }
      }
      // item 4: culling on/off no MESMO N (30) — "tight" mantém quase tudo
      // dentro do frustum, contraponto do "spread" (naturalmente parcial
      // fora da câmera em N alto) já medido acima.
      if (oracleIdx !== -1) {
        process.stdout.write(`  [G] oracle(shared-trail)/tight × 30...\n`);
        const r = await measureMountVsSteady(page, cdp, 30, "tight", () => spawnSingleAllPlayers(page, oracleIdx), true, "oracle(shared-trail)");
        phaseG.push(r);
        console.log(`    mount:  ${fmtWindow(r.mount)}`);
        console.log(`    steady: ${fmtWindow(r.steady)}`);
      }
    }

    const phaseH: MountVsSteadyResult[] = [];
    if (runH) {
      console.log("[vfx-bench] Fase H: filtro CSS em escala — mesma SharedTrailPrimitive, com/sem drop-shadow.");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase H pulada.");
      } else {
        for (const filterMode of ["all", "none"] as const) {
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [H] filter=${filterMode}/spread × ${n}...\n`);
            const r = await measureOracleFilterVariant(page, cdp, n, "spread", filterMode, oracleIdx, true);
            phaseH.push(r);
            console.log(`    mount:  ${fmtWindow(r.mount)}`);
            console.log(`    steady: ${fmtWindow(r.steady)}`);
          }
          // item 4: dentro vs fora da câmera, só em 30 players (spread já
          // rodou acima nesse loop) — completa o par com "tight".
          process.stdout.write(`  [H] filter=${filterMode}/tight × 30...\n`);
          const rTight = await measureOracleFilterVariant(page, cdp, 30, "tight", filterMode, oracleIdx, true);
          phaseH.push(rTight);
          console.log(`    mount:  ${fmtWindow(rTight.mount)}`);
          console.log(`    steady: ${fmtWindow(rTight.steady)}`);
        }
      }
    }

    const phaseI: MountVsSteadyResult[] = [];
    if (runI) {
      console.log("[vfx-bench] Fase I: controle 'update antes do culling' — 30 players 100% fora do frustum (offscreen).");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase I pulada.");
      } else {
        process.stdout.write(`  [I] oracle(shared-trail)/offscreen × 30...\n`);
        const r = await measureMountVsSteady(page, cdp, 30, "offscreen", () => spawnSingleAllPlayers(page, oracleIdx), true, "oracle(shared-trail)");
        phaseI.push(r);
        console.log(`    mount:  ${fmtWindow(r.mount)}`);
        console.log(`    steady: ${fmtWindow(r.steady)}`);
      }
    }

    const phaseJ: ControlResult[] = [];
    if (runJ) {
      console.log("[vfx-bench] Fase J: decomposição interna do update() — 4 controles (A/B/C/D).");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase J pulada.");
      } else {
        const controls: { players: number; arrangement: BenchArrangement; name: string }[] = [
          { players: 1, arrangement: "spread", name: "A: 1/1 visível" },
          { players: 30, arrangement: "offscreen", name: "B: 30/0 visível" },
          { players: 30, arrangement: "spread", name: "C: 30/1 visível" },
          { players: 30, arrangement: "tight", name: "D: 30/6 visíveis" },
        ];
        for (const c of controls) {
          process.stdout.write(`  [J] ${c.name}...\n`);
          const r = await measureControl(page, cdp, c.players, c.arrangement, oracleIdx, true, c.name);
          phaseJ.push(r);
          console.log(`    ${fmtWindow(r.steady)}`);
          console.log(`    profile: ${fmtProfile(r.profile)}`);
        }
      }
    }

    const phaseKDom: DomBreakdown[] = [];
    const phaseKControls: (ControlResult | (WindowMeasurement & { label: string }))[] = [];
    const phaseKCurve: { players: number; frameMs: number; fps: number }[] = [];
    if (runK) {
      console.log("[vfx-bench] Fase K: React/DOM persistent tree isolation.");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase K pulada.");
      } else {
        console.log("  -- item 1: inventário DOM por escala --");
        for (const n of scalePlayerLevels) {
          const b = await measureDomInventory(page, cdp, n, oracleIdx);
          phaseKDom.push(b);
          console.log(`  [K-dom] × ${n}: ${fmtDom(b)}`);
        }

        console.log("  -- item 2/3/4: controles A-E --");
        process.stdout.write("  [K] C: 30 minimal/offscreen...\n");
        const cResult = await measureMinimalControl(page, cdp, oracleIdx, true);
        phaseKControls.push(cResult);
        console.log(`    ${fmtWindow(cResult.steady)}`);
        console.log(`    profile: ${fmtProfile(cResult.profile)}`);

        process.stdout.write("  [K] D: DOM estático (8539 nós, sem VFX)...\n");
        const dResult = await measureStaticDomControl(page, cdp, 8539, true);
        phaseKControls.push(dResult);
        console.log(`    ${fmtWindow(dResult)}`);

        process.stdout.write("  [K] E: 30/tight DOM desconectado...\n");
        const eResult = await measureDetachedControl(page, cdp, oracleIdx, true);
        phaseKControls.push(eResult);
        console.log(`    ${fmtWindow(eResult.steady)}`);
        console.log(`    profile: ${fmtProfile(eResult.profile)}`);

        console.log("  -- item 7 (curva, spawn fresco por N, não remoção progressiva) --");
        const curveLevels = [1, 5, 10, 15, 20, 25, 30];
        for (const n of curveLevels) {
          const r = await measureControl(page, cdp, n, "offscreen", oracleIdx, n <= 10, `curve/${n}`);
          phaseKCurve.push({ players: n, frameMs: r.steady.perf.frameTimeMs, fps: r.steady.perf.fps });
          console.log(`  [K-curve] × ${n}: frame=${r.steady.perf.frameTimeMs.toFixed(1)}ms fps=${r.steady.perf.fps.toFixed(0)}`);
        }
      }
    }

    const phaseL: TreeControlResult[] = [];
    if (runL) {
      console.log("[vfx-bench] Fase L: qual característica da árvore VFX conectada explica o custo (30/0 visível sempre).");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase L pulada.");
      } else {
        const runs: { label: string; cfg: OracleFilterConfigPartial & { echoCountPerSkull?: number }; detached: boolean }[] = [
          { label: "A: baseline (30/0 visível, conectado)", cfg: {}, detached: false },
          { label: "Detached: mesma árvore, DOM desconectado", cfg: {}, detached: true },
          { label: "B: sem ecos/SVG (echoCountPerSkull=0), conectado", cfg: { echoCountPerSkull: 0 }, detached: false },
        ];
        for (const r of runs) {
          process.stdout.write(`  [L] ${r.label}...\n`);
          const result = await measureTreeControl(page, cdp, oracleIdx, r.cfg, r.detached, r.label);
          phaseL.push(result);
          console.log(`    dom=${result.domNodes} ${fmtWindow(result.steady)}`);
        }
      }
      console.log(
        "  [L] Controle C/D (style/transform dinâmico vs estático): NÃO re-executado — Fase J já mediu domUpdateMs=0.000ms/quadro pra 30/0-visível (onInstanceUpdate nunca chamado pra instância culled), então 'congelar updates' é um no-op nesse cenário; a resposta já está nos dados existentes.",
      );
      console.log(
        "  [L] Controle E (sem portal) e F (SVG simples isolado): N/A — controle não isolável sem alterar a arquitetura de posicionamento real da skill (portal) ou sem código novo de primitive (SVG simples), fora do escopo desta rodada (só diagnóstico via toggles existentes).",
      );
    }

    const phaseM: TreeControlResult[] = [];
    if (runM) {
      console.log("[vfx-bench] Fase M: isolar CSS animation dos glimmers (mesmo DOM, só liga/desliga `animation`).");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase M pulada.");
      } else {
        const runs: { label: string; cfg: { glimmerAnimationMode?: "on" | "off" }; detached: boolean }[] = [
          { label: "Baseline (glimmer animation ON, conectado)", cfg: { glimmerAnimationMode: "on" }, detached: false },
          { label: "Animation OFF (mesmo DOM, conectado)", cfg: { glimmerAnimationMode: "off" }, detached: false },
          { label: "Animation ON restaurada (confirma reversibilidade)", cfg: { glimmerAnimationMode: "on" }, detached: false },
        ];
        for (const r of runs) {
          process.stdout.write(`  [M] ${r.label}...\n`);
          const result = await measureTreeControl(page, cdp, oracleIdx, r.cfg, r.detached, r.label);
          phaseM.push(result);
          console.log(`    dom=${result.domNodes} ${fmtWindow(result.steady)}`);
        }
      }
      console.log("  [M] Detached reference: reaproveitado da Fase L (~16.6ms/60fps) — não re-executado, número já validado.");
    }

    const phaseN: TreeControlResult[] = [];
    if (runN) {
      console.log("[vfx-bench] Fase N: running vs paused vs display:none (já implícito) vs visibility:hidden.");
      console.log(
        "  [N] NOTA: o ancestral de CADA instância (`DomRenderer.wrapEl`) já fica `display:none` assim que culled — confirmado pelo código de `setActive()` (Etapa 4), não é um controle novo. TODAS as medições offscreen desta investigação (Fases K/L/M) já rodaram com o ancestral em display:none, e o custo persistiu — então 'ancestral display:none' NÃO é uma hipótese nova a testar, já está refutada pelos próprios números anteriores.",
      );
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase N pulada.");
      } else {
        const runs: { label: string; cfg: OracleConfigPartial; detached: boolean }[] = [
          { label: "Baseline (running)", cfg: { glimmerPlayState: "running" }, detached: false },
          { label: "A: animation-play-state paused (mesmo DOM/animation-name/duration)", cfg: { glimmerPlayState: "paused" }, detached: false },
          { label: "D: visibility:hidden NO GLIMMER (animation continua running)", cfg: { glimmerPlayState: "running", glimmerVisibilityHidden: true }, detached: false },
        ];
        for (const r of runs) {
          process.stdout.write(`  [N] ${r.label}...\n`);
          const result = await measureTreeControl(page, cdp, oracleIdx, r.cfg, r.detached, r.label);
          phaseN.push(result);
          console.log(`    dom=${result.domNodes} ${fmtWindow(result.steady)}`);
        }
      }
      console.log("  [N] Controle B (animation:none): reaproveitado da Fase M (~16.7ms/60fps) — não re-executado.");
    }

    const phaseO: { label: string; players: number; arrangement: BenchArrangement; steady: WindowMeasurement }[] = [];
    const phaseOCurve: { players: number; frameMs: number; fps: number }[] = [];
    if (runO) {
      console.log("[vfx-bench] Fase O: verificação da correção (vfx-dom-culled) — comportamento PADRÃO, sem toggle de bench.");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase O pulada.");
      } else {
        process.stdout.write("  [O] 30/0 visível (offscreen), MESMA receita da Fase K/L/M/N...\n");
        const baseline = await measureControl(page, cdp, 30, "offscreen", oracleIdx, true, "pós-correção: 30/0 visível");
        phaseO.push({ label: "pós-correção: 30/0 visível", players: 30, arrangement: "offscreen", steady: baseline.steady });
        console.log(`    ${fmtWindow(baseline.steady)}`);

        process.stdout.write("  [O] 30/6 visíveis (tight) — visíveis devem continuar animando normal...\n");
        const tight = await measureControl(page, cdp, 30, "tight", oracleIdx, true, "pós-correção: 30/6 visíveis");
        phaseO.push({ label: "pós-correção: 30/6 visíveis", players: 30, arrangement: "tight", steady: tight.steady });
        console.log(`    ${fmtWindow(tight.steady)}`);

        console.log("  -- curva 1..30, offscreen, pós-correção --");
        for (const n of [1, 5, 10, 15, 20, 25, 30]) {
          const r = await measureControl(page, cdp, n, "offscreen", oracleIdx, n <= 10, `curve-pós/${n}`);
          phaseOCurve.push({ players: n, frameMs: r.steady.perf.frameTimeMs, fps: r.steady.perf.fps });
          console.log(`  [O-curve] × ${n}: frame=${r.steady.perf.frameTimeMs.toFixed(1)}ms fps=${r.steady.perf.fps.toFixed(0)}`);
        }
      }
    }

    // item Thunder Storm da Fase Q: o bench dá `expiresAt = now+4000` pro
    // impact (`VfxBenchView.tsx: spawnOne`, kind "impact") — mount(300) +
    // estabilização(3200) + janela(800) da Fase P somava ~4300ms, ESTOURANDO
    // os 4000ms e medindo a cena já vazia (`dom=19`). Aqui a estabilização
    // encolhe pra caber dentro do lifetime real, sem mudar nada do bench.
    async function measureShortLived(
      players: number,
      arrangement: BenchArrangement,
      scenarioIdx: number,
      stabilizeMs: number,
      windowMs: number,
      label: string,
    ): Promise<ControlResult> {
      await page.evaluate(
        ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
        { n: players, arr: arrangement },
      );
      await settle(page, 150);
      await collectGarbage(cdp);
      await spawnSingleAllPlayers(page, scenarioIdx);
      await settle(page, 300);
      await settle(page, stabilizeMs);
      await resetFrameStats(page);
      await resetUpdateProfile(page);
      const steady = await captureWindow(page, cdp, () => settle(page, windowMs), true);
      const profile = await readUpdateProfile(page);
      await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
      await settle(page, 250);
      await collectGarbage(cdp);
      return { label, players, arrangement, steady, profile };
    }

    const phaseQ: (ControlResult & { skill: string })[] = [];
    if (runQ) {
      console.log("[vfx-bench] Fase Q: Thunder Storm com janela compatível com o lifetime real (~4s no bench).");
      const thunderIdx = scenarios.findIndex((s) => s.aegisName === "MG_THUNDERSTORM" && s.kind === "impact");
      if (thunderIdx === -1) {
        console.warn("[vfx-bench] cenário Thunder Storm não encontrado — Fase Q pulada.");
      } else {
        for (const arr of ["offscreen", "tight"] as BenchArrangement[]) {
          process.stdout.write(`  [Q] Thunder Storm/${arr} × 30 (janela curta)...\n`);
          // 300 (mount, já gasto acima) + 1500 (estabiliza) + 800 (mede) = 2600ms << 4000ms de lifetime
          const r = await measureShortLived(30, arr, thunderIdx, 1500, 800, `Thunder Storm/${arr} (curto)`);
          phaseQ.push({ ...r, skill: "Thunder Storm" });
          console.log(`    dom=${r.steady.domNodes} ${fmtWindow(r.steady)}`);
          console.log(`    profile: ${fmtProfile(r.profile)}`);
        }
      }
    }

    // Fase R: Cold Bolt / Soul Strike NÃO passam pelo vfxManager — cada
    // instância (`Icicle`/`Soul`) é um `<group>` R3F com `useFrame` PRÓPRIO e
    // um `<Html>` (drei) portado direto pro DOM do canvas, sem culling
    // nenhum (nem do `DomRenderer`, nem frustum do drei — `occlude={false}`).
    // Lifetime de cada instância é CURTO e interno (`ICICLE_VISIBLE_MS`/
    // `SOUL_VISIBLE_MS`, ~1.5–2.7s), bem dentro do `expiresAt=+4000` que o
    // bench atribui a todo cenário "impact" — janela curta só por precisar
    // medir enquanto a animação (glow infinite, queda/voo) ainda está viva,
    // mesmo cuidado da Fase Q.
    const phaseR: (ControlResult & { skill: string })[] = [];
    if (runR) {
      console.log("[vfx-bench] Fase R: isolamento Cold Bolt / Soul Strike (sem vfxManager, sem culling) — mede custo dentro/fora de câmera.");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      const soulStrikeIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      const targets: { name: string; idx: number }[] = [
        { name: "Cold Bolt", idx: coldBoltIdx },
        { name: "Soul Strike", idx: soulStrikeIdx },
      ];
      for (const t of targets) {
        if (t.idx === -1) {
          console.warn(`[vfx-bench] cenário "${t.name}" não encontrado — pulado.`);
          continue;
        }
        for (const arr of ["offscreen", "tight"] as BenchArrangement[]) {
          process.stdout.write(`  [R] ${t.name}/${arr} × 30 (janela curta)...\n`);
          // 300 (mount) + 800 (estabiliza, cai no meio da sobreposição dos 5
          // hits — ver conta no comentário do relatório) + 500 (mede) = 1600ms
          const r = await measureShortLived(30, arr, t.idx, 800, 500, `${t.name}/${arr} (curto)`);
          phaseR.push({ ...r, skill: t.name });
          console.log(`    dom=${r.steady.domNodes} ${fmtWindow(r.steady)}`);
          console.log(`    profile: ${fmtProfile(r.profile)}`);
        }
      }
    }

    // Fase S: a Fase R achou spike sincronizado em Cold Bolt/tight (p99=378ms
    // vs offscreen p99=33.9ms). Pergunta única: é a SINCRONIZAÇÃO dos 30
    // impactos (todos os casts nascem no mesmo tick, então os 5 hits de cada
    // um caem no MESMO instante pros 30 players) ou existe custo estrutural
    // independente disso? Controle A reproduz o original (offset=0); Controle
    // B desloca o nascimento de cada slot num `setTimeout` real
    // (`spawnAllStaggered`, só no benchmark — `ICICLE_STAGGER_MS` de produção
    // intocado) pra espalhar os mesmos 150 hits (30×5) no tempo em vez de
    // deixá-los coincidir.
    interface SyncResult {
      label: string;
      offsetMsPerSlot: number;
      steady: WindowMeasurement;
      impact: ImpactWatchResult;
    }
    const phaseS: SyncResult[] = [];
    const phaseSBaseline: (ControlResult & { skill: string })[] = [];
    if (runS) {
      console.log("[vfx-bench] Fase S: Cold Bolt — sincronização dos 30 impactos (sem tocar stagger de produção).");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase S pulada.");
      } else {
        process.stdout.write("  [S.1] reproduzindo baseline da Fase R (30 Cold Bolt/tight, janela 800+500)...\n");
        const baseline = await measureShortLived(30, "tight", coldBoltIdx, 800, 500, "Cold Bolt/tight (Fase R reproduzida)");
        phaseSBaseline.push({ ...baseline, skill: "Cold Bolt" });
        console.log(`    dom=${baseline.steady.domNodes} ${fmtWindow(baseline.steady)}`);

        async function measureColdBoltSync(offsetMsPerSlot: number, windowMs: number, label: string): Promise<SyncResult> {
          await page.evaluate(
            ({ n }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, "tight"),
            { n: 30 },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          await resetFrameStats(page);
          await startImpactWatchPage(page);
          const steady = await captureWindow(
            page,
            cdp,
            async () => {
              // sequencial (mesmo padrão de `measureShortLived`/todo o resto do
              // arquivo) — o próprio ato de espalhar os spawns no tempo já
              // avança o relógio real do browser, então não precisa (nem deve)
              // rodar em paralelo com `settle`; concorrência aqui já causou uma
              // leitura de DOM inválida (dom=20) numa rodada anterior.
              const t0 = Date.now();
              await spawnAllStaggeredPage(page, coldBoltIdx, offsetMsPerSlot, { hits: 5, damage: 2000 });
              console.log(`      [S diag] spawnAllStaggered(offset=${offsetMsPerSlot}) levou ${Date.now() - t0}ms de parede (esperado ~${offsetMsPerSlot * 29}ms)`);
              await settle(page, windowMs);
            },
            true,
          );
          const impact = await stopImpactWatchPage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);
          return { label, offsetMsPerSlot, steady, impact };
        }

        // janela igual pras duas condições (1800ms): cobre o burst
        // sincronizado (offset=0, tudo cai em ~0-1000ms) E o espalhado
        // (offset=25ms × 29 = 725ms só pra terminar de nascer, + cauda).
        const WINDOW_MS = 1800;
        process.stdout.write("  [S.2] Controle A — 30 casts no mesmo tick (offset=0)...\n");
        const controlA = await measureColdBoltSync(0, WINDOW_MS, "A — sincronizado (offset=0)");
        phaseS.push(controlA);
        console.log(`    ${fmtWindow(controlA.steady)}`);
        console.log(
          `    impactos/quadro(max)=${controlA.impact.maxImpactsPerFrame} toggles/quadro(max)=${controlA.impact.maxTogglesPerFrame} animStarts/quadro(max)=${controlA.impact.maxAnimStartsPerFrame}`,
        );

        process.stdout.write("  [S.2] Controle B — 30 casts com offset=25ms/slot (distribuído)...\n");
        const controlB = await measureColdBoltSync(25, WINDOW_MS, "B — distribuído (offset=25ms)");
        phaseS.push(controlB);
        console.log(`    ${fmtWindow(controlB.steady)}`);
        console.log(
          `    impactos/quadro(max)=${controlB.impact.maxImpactsPerFrame} toggles/quadro(max)=${controlB.impact.maxTogglesPerFrame} animStarts/quadro(max)=${controlB.impact.maxAnimStartsPerFrame}`,
        );

        console.log(
          "  [S.3] Controle C (sem disparar o trigger de impacto/burst, DOM/useFrame/lifetime intactos): N/A — " +
            "o trigger é interno ao `useFrame` de `ColdBoltImpact.tsx` (`hit.current`/`fallLife >= ICICLE_IMPACT_FRACTION`), " +
            "sem gancho de benchmark exposto (diferente do `freezeUpdates` do Oracle, que já existia). Adicionar um " +
            "exigiria editar o arquivo de produção da skill — fora do escopo desta rodada. Não inventado.",
        );
      }
    }

    // Fase T: a Fase S invalidou o Controle B porque `spawnAllStaggered`
    // monta cada cast em commit React SEPARADO (~180ms/cast fora de lote,
    // achado registrado à parte, NÃO reaberto aqui). Esta fase corrige o
    // desenho: monta os 30 Cold Bolt num ÚNICO `spawnAll` (commit único,
    // ~2ms, mesma árvore/DOM/useFrame/CSS de sempre) e só DEPOIS mede —
    // nenhum mount/unmount acontece durante a janela medida, então "DOM
    // igual" é garantido por CONSTRUÇÃO (efeito só expira aos 4000ms do
    // `vfxStore`, a janela medida fica bem dentro disso).
    interface SteadyImpactResult {
      label: string;
      domInitial: number;
      domDuring: number;
      steady: WindowMeasurement;
      impact: ImpactWatchResult;
    }
    const phaseTSync: SteadyImpactResult[] = [];
    if (runT) {
      console.log("[vfx-bench] Fase T: Cold Bolt — impacto sincronizado vs distribuído, SEM re-montar nada durante a medição.");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase T pulada.");
      } else {
        async function measureColdBoltSteadyImpact(runLabel: string): Promise<SteadyImpactResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);

          // ÚNICO mount desta medição inteira: um `spawnAll` (commit React
          // único, ~2ms medido na Fase S) — nada mais nasce/morre depois disto.
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 50);
          const domInitial = await domNodeCount(page);

          await resetFrameStats(page);
          await startImpactWatchPage(page);
          // janela curta cobrindo os 5 hits (último impacto natural cai perto
          // de 1019ms depois do cast; a cauda do 5º número vai até ~1459ms) —
          // 1400ms cobre a cascata inteira sem chegar perto dos 4000ms de vida.
          const steady = await captureWindow(page, cdp, () => settle(page, 1400), true);
          const impact = await stopImpactWatchPage(page);
          const domDuring = steady.domNodes;

          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);
          return { label: runLabel, domInitial, domDuring, steady, impact };
        }

        for (let run = 1; run <= 3; run++) {
          process.stdout.write(`  [T] Controle A (sincronizado, natural) — run ${run}/3...\n`);
          const r = await measureColdBoltSteadyImpact(`A — sincronizado, run ${run}`);
          phaseTSync.push(r);
          const valid = r.domInitial === r.domDuring;
          console.log(
            `    domInicial=${r.domInitial} domDurante=${r.domDuring} válido=${valid} ${fmtWindow(r.steady)}`,
          );
          console.log(
            `    impactos/quadro(max)=${r.impact.maxImpactsPerFrame} toggles/quadro(max)=${r.impact.maxTogglesPerFrame} animStarts/quadro(max)=${r.impact.maxAnimStartsPerFrame}`,
          );
        }

        console.log(
          "  [T] Controle B (impacto distribuído, DOM/mount/useFrame idênticos): NÃO IMPLEMENTÁVEL sem tocar produção. " +
            "`bornAt` (o relógio que cada `Icicle` usa pra decidir quando cai/impacta) é `useRef(performance.now())` " +
            "lido no PRÓPRIO mount de `cold-bolt/ColdBoltImpact.tsx` — não existe prop, config, nem clock injetável " +
            "(ao contrário do `oracleBenchConfig`, que já existia pro Oracle) pra deslocar esse relógio por instância " +
            "DEPOIS que as 30 já estão montadas juntas num commit só. Qualquer forma de variar SÓ o timing do impacto " +
            "sem editar o arquivo de produção exigiria: (a) um monkey-patch global de `performance.now` durante o " +
            "render — afeta o scheduler do React inteiro, não é isolado à Cold Bolt, é hack invasivo; ou (b) assumir " +
            "a ORDEM de render de `specs.map` como sinal pra aplicar offsets diferentes — depende de um detalhe de " +
            "implementação do React não garantido pela API pública. Nenhuma das duas é um mecanismo existente nem " +
            "uma injeção limpa — parando aqui, sem forçar, conforme pedido (item 5/item 10, Caso D).",
        );
      }
    }

    // Fase U: a Fase T achou variância enorme de p99 (118–680ms) no MESMO
    // cenário válido (30 Cold Bolt/tight, mount único, DOM estável). Antes de
    // seguir investigando sincronização, checa se o spike é reprodutível/
    // correlacionado com eventos da própria skill, ou ruído de runtime/browser.
    interface FrameHistogram {
      under20: number;
      b20_33: number;
      b33_100: number;
      b100_250: number;
      over250: number;
    }
    function histogram(times: number[]): FrameHistogram {
      const h: FrameHistogram = { under20: 0, b20_33: 0, b33_100: 0, b100_250: 0, over250: 0 };
      for (const t of times) {
        if (t < 20) h.under20++;
        else if (t < 33) h.b20_33++;
        else if (t < 100) h.b33_100++;
        else if (t < 250) h.b100_250++;
        else h.over250++;
      }
      return h;
    }
    interface ColdBoltRunResult {
      run: number;
      arrangement: BenchArrangement;
      domInitial: number;
      domDuring: number;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      fps: number;
      sampleCount: number;
      hist: FrameHistogram;
      worstFrameIdx: number;
      worstFrameImpacts: number;
      worstFrameAnimStarts: number;
      worstFrameLive: number;
      trace?: Record<string, number>;
    }
    const phaseU: ColdBoltRunResult[] = [];
    const phaseUOffscreen: ColdBoltRunResult[] = [];
    if (runU) {
      console.log("[vfx-bench] Fase U: Cold Bolt — reprodutibilidade do spike (10 runs, histograma, correlação, tight vs offscreen).");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase U pulada.");
      } else {
        async function measureColdBoltRun(arrangement: BenchArrangement, runIndex: number, withTracing: boolean): Promise<ColdBoltRunResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: arrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 50);
          const domInitial = await domNodeCount(page);
          await resetFrameStats(page);
          await startImpactWatchPage(page, ".cb-ice-wrap");
          const steady = await captureWindow(page, cdp, () => settle(page, 1400), withTracing);
          const frames = await readFrameTimesRawPage(page);
          const impact = await stopImpactWatchPage(page);
          const domDuring = steady.domNodes;
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);

          let worstFrameIdx = -1;
          let max = 0;
          frames.forEach((t, i) => {
            if (t > max) {
              max = t;
              worstFrameIdx = i;
            }
          });
          // vizinhança ±2 quadros: `frameTimesMs` (r3f `useFrame`) e
          // `impactWatch` (rAF próprio) nascem em `resetFrameStats`/
          // `startImpactWatch` chamados em SEQUÊNCIA (~1-2ms de diferença),
          // não no mesmo tick exato — ±2 absorve o desalinhamento sem
          // inventar uma correlação mais precisa do que a instrumentação
          // permite.
          let worstFrameImpacts = 0;
          let worstFrameAnimStarts = 0;
          let worstFrameLive = 0;
          for (let d = -2; d <= 2; d++) {
            const f = impact.frames[worstFrameIdx + d];
            if (f) {
              worstFrameImpacts = Math.max(worstFrameImpacts, f.impacts);
              worstFrameAnimStarts = Math.max(worstFrameAnimStarts, f.animStarts);
              worstFrameLive = Math.max(worstFrameLive, f.live);
            }
          }

          return {
            run: runIndex,
            arrangement,
            domInitial,
            domDuring,
            avg: steady.perf.frameTimeMs,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max,
            fps: steady.perf.fps,
            sampleCount: steady.perf.sampleCount,
            hist: histogram(frames),
            worstFrameIdx,
            worstFrameImpacts,
            worstFrameAnimStarts,
            worstFrameLive,
            trace: steady.trace,
          };
        }

        const RUNS = 10;
        for (let i = 1; i <= RUNS; i++) {
          process.stdout.write(`  [U] tight run ${i}/${RUNS}...\n`);
          const r = await measureColdBoltRun("tight", i, false);
          phaseU.push(r);
          console.log(
            `    dom(ini/durante)=${r.domInitial}/${r.domDuring} avg=${r.avg.toFixed(1)} p50=${r.p50.toFixed(1)} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} max=${r.max.toFixed(1)} fps=${r.fps.toFixed(0)} n=${r.sampleCount}`,
          );
          console.log(
            `    hist: <20=${r.hist.under20} 20-33=${r.hist.b20_33} 33-100=${r.hist.b33_100} 100-250=${r.hist.b100_250} >250=${r.hist.over250}`,
          );
          console.log(
            `    piorQuadro(idx=${r.worstFrameIdx}, ${r.max.toFixed(1)}ms): impactos(viz.±2)=${r.worstFrameImpacts} animStarts(viz.±2)=${r.worstFrameAnimStarts} vivos(viz.±2)=${r.worstFrameLive}`,
          );
        }

        // item 6: tracing só nos extremos — AMOSTRAS NOVAS (não dá pra
        // re-traçar retroativamente um run que já terminou), mesma
        // condição/escala dos runs mais caro/barato observados acima.
        const sortedByP99 = [...phaseU].sort((a, b) => b.p99 - a.p99);
        const worstLike = sortedByP99[0]!;
        const bestLike = sortedByP99[sortedByP99.length - 1]!;
        process.stdout.write(`  [U] tracing — amostra nova (referência: pior run observado, p99=${worstLike.p99.toFixed(1)})...\n`);
        const tracedWorst = await measureColdBoltRun("tight", 900, true);
        console.log(`    p99 desta amostra=${tracedWorst.p99.toFixed(1)} trace=${JSON.stringify(tracedWorst.trace)}`);
        process.stdout.write(`  [U] tracing — amostra nova (referência: melhor run observado, p99=${bestLike.p99.toFixed(1)})...\n`);
        const tracedBest = await measureColdBoltRun("tight", 901, true);
        console.log(`    p99 desta amostra=${tracedBest.p99.toFixed(1)} trace=${JSON.stringify(tracedBest.trace)}`);
        phaseU.push(tracedWorst, tracedBest);

        // item 7: controle negativo offscreen — mesmo controle espacial da
        // Fase R, sem alterar skill nem adicionar culling.
        for (let i = 1; i <= 3; i++) {
          process.stdout.write(`  [U] offscreen run ${i}/3...\n`);
          const r = await measureColdBoltRun("offscreen", i, false);
          phaseUOffscreen.push(r);
          console.log(
            `    dom(ini/durante)=${r.domInitial}/${r.domDuring} avg=${r.avg.toFixed(1)} p50=${r.p50.toFixed(1)} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} max=${r.max.toFixed(1)} fps=${r.fps.toFixed(0)}`,
          );
        }
      }
    }

    // Fase V (o pedido do usuário chama de "Fase U" de novo — renomeada aqui
    // só pra não colidir com a letra já usada na rodada de reprodutibilidade
    // acima): decompor QUAL parte visual do Cold Bolt custa caro quando 150
    // elementos ficam simultaneamente vivos. Cada controle é um override CSS
    // `!important` (mesma técnica do `oracleBenchConfig`) sobre as classes
    // que `ColdBoltImpact.tsx` já declara — arquivo de produção intocado.
    interface ColdBoltControlRunResult {
      mode: string;
      run: number;
      domInitial: number;
      domDuring: number;
      classCounts: Record<string, number>;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      fps: number;
      sampleCount: number;
      worstFrameIdx: number;
      worstFrameLive: number;
      spikeCoincidesWithFullLive: boolean;
      trace?: Record<string, number>;
    }
    const phaseV: ColdBoltControlRunResult[] = [];
    const phaseVConfirm: ColdBoltControlRunResult[] = [];
    if (runV) {
      console.log("[vfx-bench] Fase V: Cold Bolt — decomposição do custo de apresentação (controles B–G, override CSS, sem tocar produção).");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase V pulada.");
      } else {
        async function measureColdBoltControl(mode: string, runIndex: number, withTracing: boolean): Promise<ColdBoltControlRunResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          await setColdBoltCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 50);
          const domInitial = await domNodeCount(page);
          const classCounts = await coldBoltClassCountsPage(page);
          await resetFrameStats(page);
          await startImpactWatchPage(page, ".cb-ice-wrap");
          const steady = await captureWindow(page, cdp, () => settle(page, 1400), withTracing);
          const frames = await readFrameTimesRawPage(page);
          const impact = await stopImpactWatchPage(page);
          const domDuring = steady.domNodes;
          await resetColdBoltCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);

          let worstFrameIdx = -1;
          let max = 0;
          frames.forEach((t, i) => {
            if (t > max) {
              max = t;
              worstFrameIdx = i;
            }
          });
          let worstFrameLive = 0;
          for (let d = -2; d <= 2; d++) {
            const f = impact.frames[worstFrameIdx + d];
            if (f) worstFrameLive = Math.max(worstFrameLive, f.live);
          }

          return {
            mode,
            run: runIndex,
            domInitial,
            domDuring,
            classCounts,
            avg: steady.perf.frameTimeMs,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max,
            fps: steady.perf.fps,
            sampleCount: steady.perf.sampleCount,
            worstFrameIdx,
            worstFrameLive,
            spikeCoincidesWithFullLive: worstFrameLive >= 145,
            trace: steady.trace,
          };
        }

        const CONTROLS = [
          "baseline",
          "B_no_animation",
          "C_no_filters_shadows",
          "D_frozen_transform_opacity",
          "E_simplified_content",
          "F_icicle_only",
          "G_decorations_only",
        ];
        const RUNS_PER_CONTROL = 3;
        for (const mode of CONTROLS) {
          for (let run = 1; run <= RUNS_PER_CONTROL; run++) {
            process.stdout.write(`  [V] ${mode} run ${run}/${RUNS_PER_CONTROL}...\n`);
            const r = await measureColdBoltControl(mode, run, run === RUNS_PER_CONTROL);
            phaseV.push(r);
            console.log(
              `    dom(ini/durante)=${r.domInitial}/${r.domDuring} avg=${r.avg.toFixed(1)} p50=${r.p50.toFixed(1)} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} max=${r.max.toFixed(1)} fps=${r.fps.toFixed(0)} vivos(pior±2)=${r.worstFrameLive}`,
            );
            if (r.trace) console.log(`    trace: ${JSON.stringify(r.trace)}`);
          }
          const counts = phaseV[phaseV.length - 1]!.classCounts;
          console.log(`    classCounts(${mode}): ${JSON.stringify(counts)}`);
        }

        function median(nums: number[]): number {
          const s = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length === 0 ? 0 : s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }
        const byMode = new Map<string, number[]>();
        for (const r of phaseV) {
          if (!byMode.has(r.mode)) byMode.set(r.mode, []);
          byMode.get(r.mode)!.push(r.p99);
        }
        const baselineMedian = median(byMode.get("baseline") ?? []);
        console.log(`  [V] medianas p99: ${CONTROLS.map((m) => `${m}=${median(byMode.get(m) ?? []).toFixed(1)}`).join(" ")}`);

        let bestMode: string | null = null;
        let bestMedian = baselineMedian;
        for (const m of CONTROLS) {
          if (m === "baseline") continue;
          const med = median(byMode.get(m) ?? []);
          if (med < bestMedian) {
            bestMedian = med;
            bestMode = m;
          }
        }

        // item "se reduzir drasticamente, faça UMA segunda rodada
        // confirmatória: baseline → controle → baseline" — limiar: mediana
        // do controle <= metade da mediana do baseline.
        if (bestMode && baselineMedian > 0 && bestMedian <= baselineMedian * 0.5) {
          console.log(
            `  [V] "${bestMode}" reduziu drasticamente (mediana p99 ${bestMedian.toFixed(1)}ms vs baseline ${baselineMedian.toFixed(1)}ms) — confirmação baseline→controle→baseline...`,
          );
          const sequence: [string, string][] = [
            ["baseline", "confirm-baseline-1"],
            [bestMode, "confirm-control"],
            ["baseline", "confirm-baseline-2"],
          ];
          for (const [mode, label] of sequence) {
            const r = await measureColdBoltControl(mode, 99, false);
            phaseVConfirm.push(r);
            console.log(`    [confirm ${label}] mode=${mode} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)}`);
          }
        } else {
          console.log(
            `  [V] nenhum controle reduziu drasticamente (melhor: ${bestMode ?? "nenhum"} mediana=${bestMedian.toFixed(1)}ms vs baseline=${baselineMedian.toFixed(1)}ms) — sem rodada confirmatória.`,
          );
        }
      }
    }

    // Fase W (o pedido chama de "Fase U" de novo — renomeada só pra não
    // colidir com as letras U/V já usadas nas duas rodadas anteriores):
    // decompor `.cb-ice-hit` (flash ×150, ring ×150, frag ×1200) — a Fase
    // anterior (V) já provou que esconder o burst inteiro derruba 77-86% do
    // p99; esta fase isola QUAL peça dentro dele é responsável.
    interface BurstControlRunResult {
      mode: string;
      run: number;
      domInitial: number;
      domDuring: number;
      classCounts: Record<string, number>;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      fps: number;
      sampleCount: number;
      worstFrameLive: number;
      fragsVisibleAtPeak: number;
      flashVisibleAtPeak: number;
      ringVisibleAtPeak: number;
      trace?: Record<string, number>;
    }
    const phaseW: BurstControlRunResult[] = [];
    const phaseWConfirm: BurstControlRunResult[] = [];
    if (runW) {
      console.log("[vfx-bench] Fase W: Cold Bolt — isolamento do burst de impacto (.cb-ice-hit: frag/flash/ring).");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase W pulada.");
      } else {
        // controles H/I removem via `display:none` a peça inteira do DOM
        // renderizado (nós continuam existindo — `domNodesDelta`/contagem de
        // classe não muda — só param de pintar); com isso, "visíveis no
        // pico" da peça removida é 0 por CONSTRUÇÃO, e das outras é
        // `worstFrameLive × contagem-por-icicle` (produção só liga/desliga
        // TUDO junto via `.cb-ice-wrap`, nunca frag/flash/ring
        // individualmente — hidden/visible sempre anda junto por icicle).
        const FRAGS_PER_ICICLE = 8;
        function derivedVisibleCounts(mode: string, worstFrameLive: number): { frags: number; flash: number; ring: number } {
          if (mode === "H_hide_frags_only") return { frags: 0, flash: worstFrameLive, ring: worstFrameLive };
          if (mode === "I_hide_flash_ring_only") return { frags: worstFrameLive * FRAGS_PER_ICICLE, flash: 0, ring: 0 };
          return { frags: worstFrameLive * FRAGS_PER_ICICLE, flash: worstFrameLive, ring: worstFrameLive };
        }

        async function measureColdBoltBurstControl(mode: string, runIndex: number, withTracing: boolean): Promise<BurstControlRunResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          await setColdBoltCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 50);
          const domInitial = await domNodeCount(page);
          const classCounts = await coldBoltClassCountsPage(page);
          await resetFrameStats(page);
          await startImpactWatchPage(page, ".cb-ice-wrap");
          const steady = await captureWindow(page, cdp, () => settle(page, 1400), withTracing);
          const frames = await readFrameTimesRawPage(page);
          const impact = await stopImpactWatchPage(page);
          const domDuring = steady.domNodes;
          await resetColdBoltCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);

          let worstFrameIdx = -1;
          let max = 0;
          frames.forEach((t, i) => {
            if (t > max) {
              max = t;
              worstFrameIdx = i;
            }
          });
          let worstFrameLive = 0;
          for (let d = -2; d <= 2; d++) {
            const f = impact.frames[worstFrameIdx + d];
            if (f) worstFrameLive = Math.max(worstFrameLive, f.live);
          }
          const derived = derivedVisibleCounts(mode, worstFrameLive);

          return {
            mode,
            run: runIndex,
            domInitial,
            domDuring,
            classCounts,
            avg: steady.perf.frameTimeMs,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max,
            fps: steady.perf.fps,
            sampleCount: steady.perf.sampleCount,
            worstFrameLive,
            fragsVisibleAtPeak: derived.frags,
            flashVisibleAtPeak: derived.flash,
            ringVisibleAtPeak: derived.ring,
            trace: steady.trace,
          };
        }

        const CONTROLS_PRE = ["baseline"];
        const CONTROLS_MAIN = ["H_hide_frags_only", "I_hide_flash_ring_only", "J_frags_no_filter", "K_frags_no_animation", "L_frags_no_filter_no_animation"];
        const CONTROLS_POST = ["baseline"];
        const RUNS_PER_CONTROL = 3;

        async function runControlBlock(mode: string, label: string): Promise<void> {
          for (let run = 1; run <= RUNS_PER_CONTROL; run++) {
            process.stdout.write(`  [W] ${label} run ${run}/${RUNS_PER_CONTROL}...\n`);
            const r = await measureColdBoltBurstControl(mode, run, run === RUNS_PER_CONTROL);
            phaseW.push(r);
            console.log(
              `    dom(ini/durante)=${r.domInitial}/${r.domDuring} avg=${r.avg.toFixed(1)} p50=${r.p50.toFixed(1)} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} max=${r.max.toFixed(1)} fps=${r.fps.toFixed(0)} vivos=${r.worstFrameLive} frags=${r.fragsVisibleAtPeak} flash=${r.flashVisibleAtPeak} ring=${r.ringVisibleAtPeak}`,
            );
            if (r.trace) console.log(`    trace: ${JSON.stringify(r.trace)}`);
          }
        }

        process.stdout.write("  [W] baseline (ANTES)...\n");
        await runControlBlock("baseline", "baseline-antes");
        for (const mode of CONTROLS_MAIN) {
          await runControlBlock(mode, mode);
        }
        process.stdout.write("  [W] baseline (DEPOIS)...\n");
        await runControlBlock("baseline", "baseline-depois");

        function median(nums: number[]): number {
          const s = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length === 0 ? 0 : s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }
        const byLabelMode = new Map<string, number[]>();
        for (const r of phaseW) {
          if (!byLabelMode.has(r.mode)) byLabelMode.set(r.mode, []);
          byLabelMode.get(r.mode)!.push(r.p99);
        }
        // mediana do baseline combina as DUAS blocagens (antes+depois) —
        // 6 amostras no total, checando estabilidade ao longo da fase.
        const baselineMedian = median(byLabelMode.get("baseline") ?? []);
        console.log(
          `  [W] medianas p99: baseline=${baselineMedian.toFixed(1)} ${[...CONTROLS_MAIN].map((m) => `${m}=${median(byLabelMode.get(m) ?? []).toFixed(1)}`).join(" ")}`,
        );

        const jMedian = median(byLabelMode.get("J_frags_no_filter") ?? []);
        if (baselineMedian > 0 && jMedian <= baselineMedian * 0.5) {
          console.log(`  [W] J reduziu drasticamente (mediana ${jMedian.toFixed(1)}ms vs baseline ${baselineMedian.toFixed(1)}ms) — confirmação baseline→J→baseline...`);
          const sequence: [string, string][] = [
            ["baseline", "confirm-baseline-1"],
            ["J_frags_no_filter", "confirm-J"],
            ["baseline", "confirm-baseline-2"],
          ];
          for (const [mode, label] of sequence) {
            const r = await measureColdBoltBurstControl(mode, 99, false);
            phaseWConfirm.push(r);
            console.log(`    [confirm ${label}] mode=${mode} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)}`);
          }
        } else {
          console.log(`  [W] J não reduziu drasticamente (mediana ${jMedian.toFixed(1)}ms vs baseline ${baselineMedian.toFixed(1)}ms) — sem confirmação dedicada de J.`);
        }
      }
    }

    // Fase X (pedido do usuário: "validar o fix mínimo dos 1200
    // .cb-ice-hit__frag" — usando `animation-play-state:paused`, a MESMA
    // técnica já em produção pra `.vfx-dom-culled`, não `animation:none`
    // como K/L testaram). Alternado baseline/paused pra cancelar deriva
    // temporal (mesmo cuidado da Fase U).
    interface PausedFragRunResult {
      mode: string;
      run: number;
      domInitial: number;
      domDuring: number;
      worstFrameLive: number;
      fragsAtPeak: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      fps: number;
      avg: number;
      trace?: Record<string, number>;
    }
    const phaseX: PausedFragRunResult[] = [];
    if (runX) {
      console.log("[vfx-bench] Fase X: validação do fix mínimo — .cb-ice-hit__frag { animation-play-state: paused }, alternado com baseline.");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase X pulada.");
      } else {
        async function measurePausedFrag(mode: string, runIndex: number, withTracing: boolean): Promise<PausedFragRunResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          await setColdBoltCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 50);
          const domInitial = await domNodeCount(page);
          await resetFrameStats(page);
          await startImpactWatchPage(page, ".cb-ice-wrap");
          const steady = await captureWindow(page, cdp, () => settle(page, 1400), withTracing);
          const frames = await readFrameTimesRawPage(page);
          const impact = await stopImpactWatchPage(page);
          const domDuring = steady.domNodes;
          await resetColdBoltCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);

          let worstFrameIdx = -1;
          let max = 0;
          frames.forEach((t, i) => {
            if (t > max) {
              max = t;
              worstFrameIdx = i;
            }
          });
          let worstFrameLive = 0;
          for (let d = -2; d <= 2; d++) {
            const f = impact.frames[worstFrameIdx + d];
            if (f) worstFrameLive = Math.max(worstFrameLive, f.live);
          }

          return {
            mode,
            run: runIndex,
            domInitial,
            domDuring,
            worstFrameLive,
            fragsAtPeak: worstFrameLive * 8,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max,
            fps: steady.perf.fps,
            avg: steady.perf.frameTimeMs,
            trace: steady.trace,
          };
        }

        const ALTERNATIONS = 4; // 4× baseline + 4× paused = 8 runs
        for (let i = 1; i <= ALTERNATIONS; i++) {
          process.stdout.write(`  [X] baseline run ${i}/${ALTERNATIONS}...\n`);
          const rb = await measurePausedFrag("baseline", i, i === ALTERNATIONS);
          phaseX.push(rb);
          console.log(
            `    dom=${rb.domInitial}/${rb.domDuring} p50=${rb.p50.toFixed(1)} p95=${rb.p95.toFixed(1)} p99=${rb.p99.toFixed(1)} max=${rb.max.toFixed(1)} fps=${rb.fps.toFixed(0)} frags=${rb.fragsAtPeak}`,
          );
          if (rb.trace) console.log(`    trace: ${JSON.stringify(rb.trace)}`);

          process.stdout.write(`  [X] M_frags_paused run ${i}/${ALTERNATIONS}...\n`);
          const rp = await measurePausedFrag("M_frags_paused", i, i === ALTERNATIONS);
          phaseX.push(rp);
          console.log(
            `    dom=${rp.domInitial}/${rp.domDuring} p50=${rp.p50.toFixed(1)} p95=${rp.p95.toFixed(1)} p99=${rp.p99.toFixed(1)} max=${rp.max.toFixed(1)} fps=${rp.fps.toFixed(0)} frags=${rp.fragsAtPeak}`,
          );
          if (rp.trace) console.log(`    trace: ${JSON.stringify(rp.trace)}`);
        }

        function median(nums: number[]): number {
          const s = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length === 0 ? 0 : s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }
        const baseP99 = median(phaseX.filter((r) => r.mode === "baseline").map((r) => r.p99));
        const pausedP99 = median(phaseX.filter((r) => r.mode === "M_frags_paused").map((r) => r.p99));
        console.log(`  [X] mediana p99: baseline=${baseP99.toFixed(1)}ms paused=${pausedP99.toFixed(1)}ms Δ=${(((pausedP99 - baseP99) / baseP99) * 100).toFixed(0)}%`);
      }
    }

    // Fase Y: validar `animation:none` nos 1200 `.cb-ice-hit__frag` — leitura
    // de código (base `.cb-ice-hit__frag { opacity: 0; }`, animação só
    // aplicada por `.cb-ice-wrap--impact .cb-ice-hit__frag { animation:
    // cbHitFrag 420ms ease-out forwards; }`, keyframe 0%→100% opacity 1→0)
    // sugere que `animation:none` deixa o fragmento no estado BASE
    // (opacity:0, invisível) — mas a Fase X já mostrou que raciocinar sobre
    // CSS sem MEDIR levou a um resultado errado (`paused` não fez o que a
    // intuição sugeria) — aqui a instrução é explícita: inspecionar de
    // verdade (screenshot + computed style), não inferir.
    interface VisualInspectionResult {
      mode: string;
      screenshotPath: string;
      computedOpacity: string;
      computedTransform: string;
      computedDisplay: string;
    }
    const phaseYVisual: VisualInspectionResult[] = [];
    const phaseY: PausedFragRunResult[] = [];
    const phaseYFragCount: PausedFragRunResult[] = [];
    if (runY) {
      console.log("[vfx-bench] Fase Y: validação visual + performance de animation:none nos fragments.");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase Y pulada.");
      } else {
        // --- inspeção visual: 1 player, screenshot no instante do impacto
        // do PRIMEIRO icicle (~470ms depois do spawn: IMPACT_AT_MS=459.2 +
        // folga) — baseline (deve mostrar 8 fragmentos voando) vs B (deve
        // mostrar nada visível, se a leitura do CSS estiver certa). ---
        async function inspectVisual(mode: string, label: string): Promise<VisualInspectionResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await setColdBoltCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 500); // cai dentro da janela de burst (420ms) do 1º hit
          const screenshotPath = path.join(OUT_DIR, `fase-y-visual-${label}.png`);
          await page.screenshot({ path: screenshotPath });
          const computed = await page.evaluate(() => {
            const el = document.getElementsByClassName("cb-ice-hit__frag")[0] as HTMLElement | undefined;
            if (!el) return { opacity: "n/a (elemento não encontrado)", transform: "n/a", display: "n/a" };
            const cs = getComputedStyle(el);
            return { opacity: cs.opacity, transform: cs.transform, display: cs.display };
          });
          await resetColdBoltCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return { mode, screenshotPath, computedOpacity: computed.opacity, computedTransform: computed.transform, computedDisplay: computed.display };
        }

        process.stdout.write("  [Y] inspeção visual: baseline (impacto, 1 player)...\n");
        const visBaseline = await inspectVisual("baseline", "A-baseline");
        phaseYVisual.push(visBaseline);
        console.log(`    screenshot=${visBaseline.screenshotPath} opacity=${visBaseline.computedOpacity} transform=${visBaseline.computedTransform} display=${visBaseline.computedDisplay}`);

        process.stdout.write("  [Y] inspeção visual: B (animation:none, impacto, 1 player)...\n");
        const visB = await inspectVisual("K_frags_no_animation", "B-animation-none");
        phaseYVisual.push(visB);
        console.log(`    screenshot=${visB.screenshotPath} opacity=${visB.computedOpacity} transform=${visB.computedTransform} display=${visB.computedDisplay}`);

        process.stdout.write("  [Y] inspeção visual: C (animation:none + opacity:0, impacto, 1 player)...\n");
        const visC = await inspectVisual("C_frags_none_opacity0", "C-none-opacity0");
        phaseYVisual.push(visC);
        console.log(`    screenshot=${visC.screenshotPath} opacity=${visC.computedOpacity} transform=${visC.computedTransform} display=${visC.computedDisplay}`);

        // --- benchmark A/B/C, 30 players tight, alternado ---
        async function measureFragMode(mode: string, runIndex: number, withTracing: boolean): Promise<PausedFragRunResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          await setColdBoltCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 50);
          const domInitial = await domNodeCount(page);
          await resetFrameStats(page);
          await startImpactWatchPage(page, ".cb-ice-wrap");
          const steady = await captureWindow(page, cdp, () => settle(page, 1400), withTracing);
          const frames = await readFrameTimesRawPage(page);
          const impact = await stopImpactWatchPage(page);
          const domDuring = steady.domNodes;
          await resetColdBoltCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);

          let worstFrameIdx = -1;
          let max = 0;
          frames.forEach((t, i) => {
            if (t > max) {
              max = t;
              worstFrameIdx = i;
            }
          });
          let worstFrameLive = 0;
          for (let d = -2; d <= 2; d++) {
            const f = impact.frames[worstFrameIdx + d];
            if (f) worstFrameLive = Math.max(worstFrameLive, f.live);
          }

          return {
            mode,
            run: runIndex,
            domInitial,
            domDuring,
            worstFrameLive,
            fragsAtPeak: worstFrameLive * 8,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max,
            fps: steady.perf.fps,
            avg: steady.perf.frameTimeMs,
            trace: steady.trace,
          };
        }

        function median(nums: number[]): number {
          const s = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length === 0 ? 0 : s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }

        const MODES_ABC = [
          { key: "baseline", label: "A-baseline" },
          { key: "K_frags_no_animation", label: "B-animation-none" },
          { key: "C_frags_none_opacity0", label: "C-none-opacity0" },
        ];
        const ROUNDS = 3; // 3 rodadas × 3 modos alternados = 9 runs (dentro de 6-8+ pedido)
        for (let round = 1; round <= ROUNDS; round++) {
          for (const { key, label } of MODES_ABC) {
            process.stdout.write(`  [Y] ${label} rodada ${round}/${ROUNDS}...\n`);
            const r = await measureFragMode(key, round, round === ROUNDS);
            phaseY.push(r);
            console.log(
              `    dom=${r.domInitial}/${r.domDuring} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} max=${r.max.toFixed(1)} fps=${r.fps.toFixed(0)} frags=${r.fragsAtPeak}`,
            );
            if (r.trace) console.log(`    trace: ${JSON.stringify(r.trace)}`);
          }
        }
        const medBaseline = median(phaseY.filter((r) => r.mode === "baseline").map((r) => r.p99));
        const medB = median(phaseY.filter((r) => r.mode === "K_frags_no_animation").map((r) => r.p99));
        const medC = median(phaseY.filter((r) => r.mode === "C_frags_none_opacity0").map((r) => r.p99));
        console.log(
          `  [Y] mediana p99: A=${medBaseline.toFixed(1)}ms B=${medB.toFixed(1)}ms (Δ${(((medB - medBaseline) / medBaseline) * 100).toFixed(0)}%) C=${medC.toFixed(1)}ms (Δ${(((medC - medBaseline) / medBaseline) * 100).toFixed(0)}%)`,
        );

        const visuallyClean = visB.computedOpacity === "0" && visC.computedOpacity === "0";
        const bReproducesK = medBaseline > 0 && medB <= medBaseline * 0.6; // ~-40% ou mais, na vizinhança do -56% de K
        console.log(
          `  [Y] B reproduz K (<=60% do baseline)? ${bReproducesK} | visualmente limpo (opacity computada = 0)? ${visuallyClean}`,
        );

        if (!bReproducesK || !visuallyClean) {
          console.log("  [Y] B não passou nos dois critérios — testando redução de contagem de fragmentos (8→4→2)...");
          for (const { key, label } of [
            { key: "N_frags_count_4", label: "N-frags-4" },
            { key: "O_frags_count_2", label: "O-frags-2" },
          ]) {
            for (let run = 1; run <= 3; run++) {
              process.stdout.write(`  [Y] ${label} run ${run}/3...\n`);
              const r = await measureFragMode(key, run, run === 3);
              phaseYFragCount.push(r);
              console.log(`    p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)}`);
            }
            const vis = await inspectVisual(key, label);
            phaseYVisual.push(vis);
            console.log(`    screenshot=${vis.screenshotPath}`);
          }
        } else {
          console.log("  [Y] B passou nos dois critérios — sem necessidade do controle de contagem de fragmentos.");
        }
      }
    }

    // Fase AA: Soul Strike — mesmo mapa da Fase R (sem vfxManager/culling),
    // mas com repetição/decomposição de verdade (a Fase R só tinha 1 run
    // cada e já sugeria "sem gargalo" — aqui confirma com rigor).
    interface SoulStrikeRunResult {
      label: string;
      arrangement: BenchArrangement;
      domNodes: number;
      classCounts: Record<string, number>;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      fps: number;
      avg: number;
      sampleCount: number;
      worstFrameLive: number;
      trace?: Record<string, number>;
    }
    const phaseAA: SoulStrikeRunResult[] = [];
    const phaseAADecomp: SoulStrikeRunResult[] = [];
    if (runAA) {
      console.log("[vfx-bench] Fase AA: Soul Strike — mapa + offscreen×tight com repetição + decomposição condicional.");
      const soulIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      if (soulIdx === -1) {
        console.warn("[vfx-bench] cenário Soul Strike não encontrado — Fase AA pulada.");
      } else {
        async function measureSoulStrike(
          arrangement: BenchArrangement,
          cssMode: string | null,
          label: string,
          withTracing: boolean,
        ): Promise<SoulStrikeRunResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: arrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          if (cssMode) await setSoulStrikeCssOverridePage(page, cssMode);
          // mesma janela validada na Fase R/Q pra "impact" de curta vida:
          // mount(300) + estabiliza(800) + mede(500) = 1600ms << 4000ms de
          // expiresAt do bench, e cai dentro da cascata real (~2.2-2.7s).
          await spawnSingleAllPlayers(page, soulIdx);
          await settle(page, 300);
          await settle(page, 800);
          const domNodes = await domNodeCount(page);
          const classCounts = await soulStrikeClassCountsPage(page);
          await resetFrameStats(page);
          await startImpactWatchPage(page, ".ss-wrap");
          const steady = await captureWindow(page, cdp, () => settle(page, 500), withTracing);
          const frames = await readFrameTimesRawPage(page);
          const impact = await stopImpactWatchPage(page);
          if (cssMode) await resetSoulStrikeCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);

          const worstFrameLive = impact.frames.reduce((m, f) => Math.max(m, f.live), 0);

          return {
            label,
            arrangement,
            domNodes: steady.domNodes,
            classCounts,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max: Math.max(...frames, 0),
            fps: steady.perf.fps,
            avg: steady.perf.frameTimeMs,
            sampleCount: steady.perf.sampleCount,
            worstFrameLive,
            trace: steady.trace,
          };
        }

        function median(nums: number[]): number {
          const s = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length === 0 ? 0 : s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }

        console.log("  [AA] offscreen × tight, 3 runs cada...");
        for (const arr of ["offscreen", "tight"] as BenchArrangement[]) {
          for (let run = 1; run <= 3; run++) {
            process.stdout.write(`  [AA] ${arr} run ${run}/3...\n`);
            const r = await measureSoulStrike(arr, null, `${arr}-${run}`, run === 3);
            phaseAA.push(r);
            console.log(
              `    dom=${r.domNodes} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} max=${r.max.toFixed(1)} fps=${r.fps.toFixed(0)} n=${r.sampleCount} vivos=${r.worstFrameLive}`,
            );
            if (r.trace) console.log(`    trace: ${JSON.stringify(r.trace)}`);
          }
        }
        const classCountsSample = phaseAA[phaseAA.length - 1]!.classCounts;
        console.log(`  [AA] classCounts (30 tight, pico): ${JSON.stringify(classCountsSample)}`);

        const medOffscreen = median(phaseAA.filter((r) => r.arrangement === "offscreen").map((r) => r.p99));
        const medTight = median(phaseAA.filter((r) => r.arrangement === "tight").map((r) => r.p99));
        const gapPct = medOffscreen > 0 ? ((medTight - medOffscreen) / medOffscreen) * 100 : 0;
        console.log(`  [AA] mediana p99: offscreen=${medOffscreen.toFixed(1)}ms tight=${medTight.toFixed(1)}ms Δ=${gapPct.toFixed(0)}%`);

        // decomposição SÓ se houver diferença relevante (limiar: tight pelo
        // menos 50% mais caro que offscreen EM ABSOLUTO, não só percentual —
        // evita disparar decomposição por ruído quando os dois já são baixos,
        // ex. 17ms vs 25ms seria +47% mas irrelevante em termos absolutos).
        const gapAbsoluteMs = medTight - medOffscreen;
        if (gapAbsoluteMs > 20 && medTight > medOffscreen * 1.5) {
          console.log(`  [AA] diferença relevante (Δ=${gapAbsoluteMs.toFixed(1)}ms) — decompondo (P: ghost sem animation, Q: burst escondido, R: filtro/shadow off)...`);
          const DECOMP_MODES = [
            { key: "P_ghost_no_animation", label: "P-ghost-no-anim" },
            { key: "Q_hit_burst_hidden", label: "Q-hit-hidden" },
            { key: "R_filters_shadows_off", label: "R-no-filter-shadow" },
          ];
          for (const { key, label } of DECOMP_MODES) {
            for (let run = 1; run <= 3; run++) {
              process.stdout.write(`  [AA] ${label} run ${run}/3...\n`);
              const r = await measureSoulStrike("tight", key, `${label}-${run}`, run === 3);
              phaseAADecomp.push(r);
              console.log(`    p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)}`);
              if (r.trace) console.log(`    trace: ${JSON.stringify(r.trace)}`);
            }
          }
        } else {
          console.log(`  [AA] sem diferença relevante entre offscreen/tight (Δ=${gapAbsoluteMs.toFixed(1)}ms) — decomposição pulada, nada a isolar.`);
        }
      }
    }

    // Fase AB: Fase AA achou sinal parcial (~-45%) em R (filtros/shadows off)
    // mas com só 3 runs — repetir com 6-8, alternado baseline/R pra cancelar
    // deriva temporal (mesmo cuidado da Fase U/X).
    interface SoulStrikeAltRunResult {
      mode: string;
      run: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      fps: number;
      trace?: Record<string, number>;
    }
    const phaseAB: SoulStrikeAltRunResult[] = [];
    if (runAB) {
      console.log("[vfx-bench] Fase AB: Soul Strike — repetição alternada baseline vs R (filtros/shadows off), 6-8 runs.");
      const soulIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      if (soulIdx === -1) {
        console.warn("[vfx-bench] cenário Soul Strike não encontrado — Fase AB pulada.");
      } else {
        async function measureSoulStrikeAlt(mode: string, runIndex: number, withTracing: boolean): Promise<SoulStrikeAltRunResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          if (mode !== "baseline") await setSoulStrikeCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, soulIdx);
          await settle(page, 300);
          await settle(page, 800);
          await resetFrameStats(page);
          const steady = await captureWindow(page, cdp, () => settle(page, 500), withTracing);
          const frames = await readFrameTimesRawPage(page);
          if (mode !== "baseline") await resetSoulStrikeCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);
          return {
            mode,
            run: runIndex,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max: Math.max(...frames, 0),
            fps: steady.perf.fps,
            trace: steady.trace,
          };
        }

        const ROUNDS = 6; // 6× baseline + 6× R = 12 runs (dentro de 6-8 alternações pedidas)
        for (let round = 1; round <= ROUNDS; round++) {
          process.stdout.write(`  [AB] baseline rodada ${round}/${ROUNDS}...\n`);
          const rb = await measureSoulStrikeAlt("baseline", round, round === ROUNDS);
          phaseAB.push(rb);
          console.log(`    p95=${rb.p95.toFixed(1)} p99=${rb.p99.toFixed(1)} fps=${rb.fps.toFixed(0)}`);
          if (rb.trace) console.log(`    trace: ${JSON.stringify(rb.trace)}`);

          process.stdout.write(`  [AB] R-no-filter-shadow rodada ${round}/${ROUNDS}...\n`);
          const rr = await measureSoulStrikeAlt("R_filters_shadows_off", round, round === ROUNDS);
          phaseAB.push(rr);
          console.log(`    p95=${rr.p95.toFixed(1)} p99=${rr.p99.toFixed(1)} fps=${rr.fps.toFixed(0)}`);
          if (rr.trace) console.log(`    trace: ${JSON.stringify(rr.trace)}`);
        }

        function median(nums: number[]): number {
          const s = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length === 0 ? 0 : s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }
        const medBaseline = median(phaseAB.filter((r) => r.mode === "baseline").map((r) => r.p99));
        const medR = median(phaseAB.filter((r) => r.mode === "R_filters_shadows_off").map((r) => r.p99));
        console.log(
          `  [AB] mediana p99 (n=${ROUNDS} cada): baseline=${medBaseline.toFixed(1)}ms R=${medR.toFixed(1)}ms Δ=${(((medR - medBaseline) / medBaseline) * 100).toFixed(0)}%`,
        );
      }
    }

    // Fase AC: R (filtros/shadows off) confirmado (~-49%, Fase AB) mas não
    // fecha o gap sozinho (89.5ms ainda >> 17.4ms offscreen); Q (burst
    // escondido) sozinho não deu sinal (Fase AA). Testa os dois JUNTOS.
    interface SoulStrikeAltRunResult2 {
      mode: string;
      run: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      fps: number;
      trace?: Record<string, number>;
    }
    const phaseAC: SoulStrikeAltRunResult2[] = [];
    if (runAC) {
      console.log("[vfx-bench] Fase AC: Soul Strike — controle combinado R+Q (filtros/shadows off + burst escondido), alternado, 6 runs.");
      const soulIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      if (soulIdx === -1) {
        console.warn("[vfx-bench] cenário Soul Strike não encontrado — Fase AC pulada.");
      } else {
        async function measureSoulStrikeAlt2(mode: string, runIndex: number, withTracing: boolean): Promise<SoulStrikeAltRunResult2> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          if (mode !== "baseline") await setSoulStrikeCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, soulIdx);
          await settle(page, 300);
          await settle(page, 800);
          await resetFrameStats(page);
          const steady = await captureWindow(page, cdp, () => settle(page, 500), withTracing);
          const frames = await readFrameTimesRawPage(page);
          if (mode !== "baseline") await resetSoulStrikeCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);
          return {
            mode,
            run: runIndex,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            max: Math.max(...frames, 0),
            fps: steady.perf.fps,
            trace: steady.trace,
          };
        }

        const ROUNDS = 6;
        for (let round = 1; round <= ROUNDS; round++) {
          process.stdout.write(`  [AC] baseline rodada ${round}/${ROUNDS}...\n`);
          const rb = await measureSoulStrikeAlt2("baseline", round, round === ROUNDS);
          phaseAC.push(rb);
          console.log(`    p95=${rb.p95.toFixed(1)} p99=${rb.p99.toFixed(1)} fps=${rb.fps.toFixed(0)}`);
          if (rb.trace) console.log(`    trace: ${JSON.stringify(rb.trace)}`);

          process.stdout.write(`  [AC] S-R+Q rodada ${round}/${ROUNDS}...\n`);
          const rs = await measureSoulStrikeAlt2("S_filters_shadows_off_plus_hit_hidden", round, round === ROUNDS);
          phaseAC.push(rs);
          console.log(`    p95=${rs.p95.toFixed(1)} p99=${rs.p99.toFixed(1)} fps=${rs.fps.toFixed(0)}`);
          if (rs.trace) console.log(`    trace: ${JSON.stringify(rs.trace)}`);
        }

        function median(nums: number[]): number {
          const s = [...nums].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length === 0 ? 0 : s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
        }
        const medBaseline = median(phaseAC.filter((r) => r.mode === "baseline").map((r) => r.p99));
        const medS = median(phaseAC.filter((r) => r.mode === "S_filters_shadows_off_plus_hit_hidden").map((r) => r.p99));
        console.log(
          `  [AC] mediana p99 (n=${ROUNDS} cada): baseline=${medBaseline.toFixed(1)}ms R+Q=${medS.toFixed(1)}ms Δ=${(((medS - medBaseline) / medBaseline) * 100).toFixed(0)}% (referência: R sozinho na Fase AB = 89.5ms)`,
        );
      }
    }

    // Fase AD: inspeção visual do R+Q combinado (Fase AC, -93%), mesmo
    // padrão da Fase Y pro Cold Bolt — screenshot + computed style, não
    // inferir do CSS.
    interface SoulVisualInspectionResult {
      mode: string;
      screenshotPath: string;
      ghostFilter: string;
      ghostOpacity: string;
      ghostDisplay: string;
      hitDisplay: string;
      fragOpacity: string;
    }
    const phaseAD: SoulVisualInspectionResult[] = [];
    if (runAD) {
      console.log("[vfx-bench] Fase AD: inspeção visual Soul Strike — baseline vs R+Q (Fase AC).");
      const soulIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      if (soulIdx === -1) {
        console.warn("[vfx-bench] cenário Soul Strike não encontrado — Fase AD pulada.");
      } else {
        async function inspectSoulVisual(mode: string, label: string): Promise<SoulVisualInspectionResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          if (mode !== "baseline") await setSoulStrikeCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, soulIdx);
          // IMPACT_AT_MS = SOUL_FLIGHT_MS(520) * SOUL_IMPACT_FRACTION(0.95)
          // = 494ms — 600ms cai dentro do burst (flash/ripple/wisp/frag
          // ainda tocando, ssHitWisp/ssHitFrag duram 620/380ms).
          await settle(page, 600);
          const screenshotPath = path.join(OUT_DIR, `fase-ad-visual-${label}.png`);
          await page.screenshot({ path: screenshotPath });
          const computed = await page.evaluate(() => {
            const ghost = document.getElementsByClassName("ss-ghost")[0] as HTMLElement | undefined;
            const hit = document.getElementsByClassName("ss-hit")[0] as HTMLElement | undefined;
            const frag = document.getElementsByClassName("ss-hit__frag")[0] as HTMLElement | undefined;
            const gcs = ghost ? getComputedStyle(ghost) : null;
            const hcs = hit ? getComputedStyle(hit) : null;
            const fcs = frag ? getComputedStyle(frag) : null;
            return {
              ghostFilter: gcs?.filter ?? "n/a",
              ghostOpacity: gcs?.opacity ?? "n/a",
              ghostDisplay: gcs?.display ?? "n/a",
              hitDisplay: hcs?.display ?? "n/a",
              fragOpacity: fcs?.opacity ?? "n/a",
            };
          });
          if (mode !== "baseline") await resetSoulStrikeCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return { mode, screenshotPath, ...computed };
        }

        process.stdout.write("  [AD] inspeção visual: baseline (impacto, 1 player)...\n");
        const visBaseline = await inspectSoulVisual("baseline", "A-baseline");
        phaseAD.push(visBaseline);
        console.log(`    screenshot=${visBaseline.screenshotPath} ghostFilter=${visBaseline.ghostFilter} ghostOpacity=${visBaseline.ghostOpacity} hitDisplay=${visBaseline.hitDisplay} fragOpacity=${visBaseline.fragOpacity}`);

        process.stdout.write("  [AD] inspeção visual: R+Q (impacto, 1 player)...\n");
        const visS = await inspectSoulVisual("S_filters_shadows_off_plus_hit_hidden", "S-RplusQ");
        phaseAD.push(visS);
        console.log(`    screenshot=${visS.screenshotPath} ghostFilter=${visS.ghostFilter} ghostOpacity=${visS.ghostOpacity} ghostDisplay=${visS.ghostDisplay} hitDisplay=${visS.hitDisplay} fragOpacity=${visS.fragOpacity}`);
      }
    }

    // Fase AE: a Fase AD capturou só 1 instante (600ms) — o ripple/wisp/frag
    // têm picos em momentos DIFERENTES (IMPACT_AT_MS=494ms; flash pico
    // ~549ms; ripple grande e visível ~644-724ms; wisp pico opacidade
    // ~618ms, decai até 1114ms; frag opacidade máxima logo no início,
    // ~494-550ms, decai até 874ms) — 3 capturas cobrindo esse leque.
    interface SoulBurstFrame {
      label: string;
      settleMs: number;
      screenshotBaseline: string;
      screenshotRQ: string;
    }
    const phaseAE: SoulBurstFrame[] = [];
    if (runAE) {
      console.log("[vfx-bench] Fase AE: Soul Strike — 3 instantes do burst (flash/ripple/wisp/frag no auge), baseline vs R+Q.");
      const soulIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      if (soulIdx === -1) {
        console.warn("[vfx-bench] cenário Soul Strike não encontrado — Fase AE pulada.");
      } else {
        async function captureAt(mode: string, settleMs: number, label: string): Promise<string> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          if (mode !== "baseline") await setSoulStrikeCssOverridePage(page, mode);
          await spawnSingleAllPlayers(page, soulIdx);
          await settle(page, settleMs);
          const screenshotPath = path.join(OUT_DIR, `fase-ae-visual-${label}.png`);
          await page.screenshot({ path: screenshotPath });
          if (mode !== "baseline") await resetSoulStrikeCssOverridePage(page);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return screenshotPath;
        }

        const INSTANTS = [
          { ms: 555, tag: "flash-pico" }, // ~494+61ms: flash em opacity=1, ripple começando, frag ainda quase full
          { ms: 675, tag: "ripple-grande" }, // ~494+181ms: ripple grande ainda visível, wisp perto do pico
          { ms: 845, tag: "frag-wisp-fim" }, // ~494+351ms: frag terminando, wisp declinando
        ];
        for (const inst of INSTANTS) {
          process.stdout.write(`  [AE] instante ${inst.tag} (${inst.ms}ms) — baseline...\n`);
          const pb = await captureAt("baseline", inst.ms, `${inst.tag}-A-baseline`);
          process.stdout.write(`  [AE] instante ${inst.tag} (${inst.ms}ms) — R+Q...\n`);
          const ps = await captureAt("S_filters_shadows_off_plus_hit_hidden", inst.ms, `${inst.tag}-S-RplusQ`);
          phaseAE.push({ label: inst.tag, settleMs: inst.ms, screenshotBaseline: pb, screenshotRQ: ps });
          console.log(`    baseline=${pb}`);
          console.log(`    R+Q=${ps}`);
        }
      }
    }

    // Fase AF (leia1.txt, Passo 0a): Fire Ball nunca foi perfilada nesta
    // investigação inteira. Reusa `measureScale` sem plumbing nova (o
    // agente de auditoria confirmou: MG_FIREBALL já está em BENCH_SKILLS
    // cast/impact). "tight" (todos visíveis, pior caso já visto em toda
    // skill investigada até aqui) + tracing SEMPRE ligado (não só n<=10,
    // leia1.txt pede decomposição completa em TODOS os níveis, não só
    // FPS).
    const phaseAF: ScaleResult[] = [];
    if (runAF) {
      console.log("[vfx-bench] Fase AF: Fire Ball — escala isolada 1/5/10/20/30 (tight), decomposição completa por nível.");
      const fireBallImpactIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREBALL" && s.kind === "impact");
      const fireBallCastIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREBALL" && s.kind === "cast");
      const targets: { name: string; idx: number }[] = [
        { name: "fireball-impact", idx: fireBallImpactIdx },
        { name: "fireball-cast", idx: fireBallCastIdx },
      ];
      for (const target of targets) {
        if (target.idx === -1) {
          console.warn(`[vfx-bench] cenário "${target.name}" não encontrado — pulado.`);
          continue;
        }
        for (const n of scalePlayerLevels) {
          process.stdout.write(`  [AF] ${target.name} × ${n}...\n`);
          const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, target.idx), 800, true, target.name);
          phaseAF.push(r);
          console.log(`    ${fmtScale(r)}`);
        }
      }
    }

    // Fase AG (leia1.txt, Passo 0b): matriz de ablação do Fire Wall — usa
    // o harness `fireWallBenchConfig`/`window.__fwBench` que JÁ EXISTE
    // (não cria infra paralela). 30 células (1 parede só), não 30
    // players — como pedido explicitamente. Não assume "é filter" — a
    // matriz testa filter/glow/licks/smoke/embers isolados E combinados.
    interface FireWallAblationResult {
      label: string;
      p50: number;
      p95: number;
      p99: number;
      fps: number;
      avg: number;
      domNodes: number;
      activeAnimations: number;
      trace?: Record<string, number>;
    }
    const phaseAG: FireWallAblationResult[] = [];
    if (runAG) {
      console.log("[vfx-bench] Fase AG: Fire Wall — matriz de ablação (30 células, 1 parede), harness fireWallBenchConfig existente.");
      const fireWallIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREWALL" && s.kind === "area");
      if (fireWallIdx === -1) {
        console.warn("[vfx-bench] cenário Fire Wall não encontrado — Fase AG pulada.");
      } else {
        async function setFwConfig(cfg: Record<string, unknown>): Promise<void> {
          await page.evaluate(
            (c) => (window as unknown as { __fwBench: { set: (p: Record<string, unknown>) => void } }).__fwBench.set(c),
            cfg,
          );
        }
        async function resetFwConfig(): Promise<void> {
          await page.evaluate(() => (window as unknown as { __fwBench: { reset: () => void } }).__fwBench.reset());
        }
        async function measureFireWallAblation(label: string, cfg: Record<string, unknown> | null, withTracing: boolean): Promise<FireWallAblationResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          if (cfg) await setFwConfig(cfg);
          await page.evaluate(
            (idx) =>
              (window as unknown as { __vfxBench: { spawnAreaLine: (i: number, slot: number, cellCount: number) => number[] } }).__vfxBench.spawnAreaLine(
                idx,
                0,
                30,
              ),
            fireWallIdx,
          );
          await settle(page, 300);
          await settle(page, 800);
          await resetFrameStats(page);
          const steady = await captureWindow(page, cdp, () => settle(page, 800), withTracing);
          const activeAnimations = await activeAnimationCountPage(page);
          if (cfg) await resetFwConfig();
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);
          return {
            label,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            fps: steady.perf.fps,
            avg: steady.perf.frameTimeMs,
            domNodes: steady.domNodes,
            activeAnimations,
            trace: steady.trace,
          };
        }

        const MATRIX: { label: string; cfg: Record<string, unknown> | null }[] = [
          { label: "baseline", cfg: null },
          { label: "-embers", cfg: { emberCount: 0 } },
          { label: "-glow", cfg: { showGlow: false } },
          { label: "-licks", cfg: { showLicks: false } },
          { label: "-smoke", cfg: { showSmoke: false } },
          { label: "glow-only", cfg: { emberCount: 0, showLicks: false, showSmoke: false } },
          { label: "smoke-only", cfg: { emberCount: 0, showGlow: false, showLicks: false } },
          { label: "embers-only", cfg: { showGlow: false, showLicks: false, showSmoke: false } },
          { label: "licks-only", cfg: { emberCount: 0, showGlow: false, showSmoke: false } },
          { label: "filter-none", cfg: { filterMode: "none" } },
          { label: "no-secondary-anim", cfg: { animateSecondary: false } },
          { label: "no-core-anim", cfg: { animateCore: false } },
          { label: "no-ember-anim", cfg: { animateEmbers: false } },
          { label: "tudo-off", cfg: { emberCount: 0, showGlow: false, showLicks: false, showSmoke: false, filterMode: "none", animateSecondary: false, animateCore: false } },
        ];
        for (const { label, cfg } of MATRIX) {
          process.stdout.write(`  [AG] ${label}...\n`);
          const r = await measureFireWallAblation(label, cfg, true);
          phaseAG.push(r);
          console.log(
            `    p50=${r.p50.toFixed(1)} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)} dom=${r.domNodes} anims=${r.activeAnimations}${r.trace ? ` paint=${r.trace.paintMs?.toFixed(1)} raster=${r.trace.rasterMs?.toFixed(1)} composite=${r.trace.compositeMs?.toFixed(1)} gpu=${r.trace.gpuMs?.toFixed(1)}` : ""}`,
          );
        }

        // combinações, só se nenhum controle isolado tiver explicado a
        // maior parte do custo (limiar: nenhum chegou perto do "tudo-off")
        const baseline = phaseAG.find((r) => r.label === "baseline")!;
        const tudoOff = phaseAG.find((r) => r.label === "tudo-off")!;
        const totalGap = baseline.p99 - tudoOff.p99;
        const bestSingle = phaseAG
          .filter((r) => !["baseline", "tudo-off"].includes(r.label))
          .reduce((best, r) => (baseline.p99 - r.p99 > baseline.p99 - best.p99 ? r : best));
        const bestSingleExplains = totalGap > 0 ? (baseline.p99 - bestSingle.p99) / totalGap : 0;
        console.log(
          `  [AG] gap total baseline→tudo-off = ${totalGap.toFixed(1)}ms; melhor controle isolado ("${bestSingle.label}") explica ${(bestSingleExplains * 100).toFixed(0)}% dele.`,
        );
        if (bestSingleExplains < 0.6) {
          console.log("  [AG] nenhum controle isolado explica a maioria do gap — testando combinações de pares...");
          const PAIRS: { label: string; cfg: Record<string, unknown> }[] = [
            { label: "glow+smoke-off", cfg: { showGlow: false, showSmoke: false } },
            { label: "glow+embers-off", cfg: { showGlow: false, emberCount: 0 } },
            { label: "smoke+embers-off", cfg: { showSmoke: false, emberCount: 0 } },
          ];
          for (const { label, cfg } of PAIRS) {
            process.stdout.write(`  [AG] ${label}...\n`);
            const r = await measureFireWallAblation(label, cfg, true);
            phaseAG.push(r);
            console.log(`    p50=${r.p50.toFixed(1)} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)}`);
          }
        }
      }
    }

    // Fase AH: repete a ablação do Fire Wall (Fase AG) com a metodologia
    // ORIGINAL que achou os ~39ms (Fase P) — 30 PLAYERS, cada um com a
    // PRÓPRIA célula (`spawnSingleAllPlayers`/`measureControl`), não uma
    // parede única de 30 células. Decisão confirmada com o usuário depois
    // que a Fase AG não reproduziu o resíduo com a metodologia errada.
    const phaseAH: FireWallAblationResult[] = [];
    if (runAH) {
      console.log("[vfx-bench] Fase AH: Fire Wall — ablação com metodologia original (30 players, 1 célula cada).");
      const fireWallIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREWALL" && s.kind === "area");
      if (fireWallIdx === -1) {
        console.warn("[vfx-bench] cenário Fire Wall não encontrado — Fase AH pulada.");
      } else {
        async function setFwConfig2(cfg: Record<string, unknown>): Promise<void> {
          await page.evaluate(
            (c) => (window as unknown as { __fwBench: { set: (p: Record<string, unknown>) => void } }).__fwBench.set(c),
            cfg,
          );
        }
        async function resetFwConfig2(): Promise<void> {
          await page.evaluate(() => (window as unknown as { __fwBench: { reset: () => void } }).__fwBench.reset());
        }
        async function measureFireWall30Players(label: string, cfg: Record<string, unknown> | null, withTracing: boolean): Promise<FireWallAblationResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 30, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          if (cfg) await setFwConfig2(cfg);
          await spawnSingleAllPlayers(page, fireWallIdx);
          await settle(page, 300);
          await settle(page, 800);
          await resetFrameStats(page);
          const steady = await captureWindow(page, cdp, () => settle(page, 800), withTracing);
          const activeAnimations = await activeAnimationCountPage(page);
          if (cfg) await resetFwConfig2();
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);
          return {
            label,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            fps: steady.perf.fps,
            avg: steady.perf.frameTimeMs,
            domNodes: steady.domNodes,
            activeAnimations,
            trace: steady.trace,
          };
        }

        const MATRIX2: { label: string; cfg: Record<string, unknown> | null }[] = [
          { label: "baseline", cfg: null },
          { label: "-embers", cfg: { emberCount: 0 } },
          { label: "-glow", cfg: { showGlow: false } },
          { label: "-licks", cfg: { showLicks: false } },
          { label: "-smoke", cfg: { showSmoke: false } },
          { label: "glow-only", cfg: { emberCount: 0, showLicks: false, showSmoke: false } },
          { label: "smoke-only", cfg: { emberCount: 0, showGlow: false, showLicks: false } },
          { label: "embers-only", cfg: { showGlow: false, showLicks: false, showSmoke: false } },
          { label: "licks-only", cfg: { emberCount: 0, showGlow: false, showSmoke: false } },
          { label: "filter-none", cfg: { filterMode: "none" } },
          { label: "no-secondary-anim", cfg: { animateSecondary: false } },
          { label: "no-core-anim", cfg: { animateCore: false } },
          { label: "no-ember-anim", cfg: { animateEmbers: false } },
          { label: "tudo-off", cfg: { emberCount: 0, showGlow: false, showLicks: false, showSmoke: false, filterMode: "none", animateSecondary: false, animateCore: false } },
        ];
        for (const { label, cfg } of MATRIX2) {
          process.stdout.write(`  [AH] ${label}...\n`);
          const r = await measureFireWall30Players(label, cfg, true);
          phaseAH.push(r);
          console.log(
            `    p50=${r.p50.toFixed(1)} p95=${r.p95.toFixed(1)} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)} dom=${r.domNodes} anims=${r.activeAnimations}${r.trace ? ` paint=${r.trace.paintMs?.toFixed(1)} raster=${r.trace.rasterMs?.toFixed(1)} composite=${r.trace.compositeMs?.toFixed(1)} gpu=${r.trace.gpuMs?.toFixed(1)}` : ""}`,
          );
        }

        const baseline2 = phaseAH.find((r) => r.label === "baseline")!;
        const tudoOff2 = phaseAH.find((r) => r.label === "tudo-off")!;
        const totalGap2 = baseline2.p99 - tudoOff2.p99;
        const bestSingle2 = phaseAH
          .filter((r) => !["baseline", "tudo-off"].includes(r.label))
          .reduce((best, r) => (baseline2.p99 - r.p99 > baseline2.p99 - best.p99 ? r : best));
        const bestSingleExplains2 = totalGap2 > 0 ? (baseline2.p99 - bestSingle2.p99) / totalGap2 : 0;
        console.log(
          `  [AH] gap total baseline→tudo-off = ${totalGap2.toFixed(1)}ms; melhor controle isolado ("${bestSingle2.label}") explica ${(bestSingleExplains2 * 100).toFixed(0)}% dele.`,
        );
      }
    }

    // Fase AI: decompor o combo caótico — nenhuma das 6 skills explicou o
    // colapso isolada (Fase AF-AH: Fire Ball/Fire Wall limpas; Cold Bolt/
    // Soul Strike/Oracle já corrigidas; Thunder Storm limpa desde a Fase
    // Q). Acumula uma skill de cada vez (mesma ordem do código de
    // produção `spawnCombo("chaotic")`), medindo depois de cada adição —
    // acha ONDE (se em algum ponto) o colapso aparece, em vez de
    // continuar procurando "a skill culpada" que não existe sozinha.
    const phaseAI: ScaleResult[] = [];
    if (runAI) {
      console.log("[vfx-bench] Fase AI: combo caótico — acumulação incremental de skills, achar onde o colapso aparece.");
      const ORDER = ["fireball", "thunderstorm", "firewall", "oracle", "coldbolt", "soulstrike"];
      for (const n of [10, 20]) {
        console.log(`  -- acumulação incremental × ${n} players (tight) --`);
        for (let i = 1; i <= ORDER.length; i++) {
          const subset = ORDER.slice(0, i);
          const label = `+${ORDER[i - 1]} (${subset.join("+")})`;
          process.stdout.write(`  [AI] ${n}p ${label}...\n`);
          const withTracing = n <= 10;
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboSubsetAllPlayers(page, n, subset), 800, withTracing, `${n}p/${label}`);
          phaseAI.push(r);
          console.log(`    ${fmtScale(r)}`);
        }
      }
    }

    // Fase AJ: a Fase AI achou os dois penhascos do combo em Oracle e
    // Cold Bolt, mas com os OUTROS 4 já presentes (herdando custo deles).
    // Isola Oracle sozinho, Cold Bolt sozinho, e os dois juntos — SEM os
    // outros 4 — pra separar aditivo (custo(O)+custo(CB) ≈ custo(O+CB))
    // de interação real (custo(O+CB) >> soma das partes).
    const phaseAJ: ScaleResult[] = [];
    if (runAJ) {
      console.log("[vfx-bench] Fase AJ: Oracle+Cold Bolt isolados dos outros 4 — aditivo ou interação?");
      const COMBOS: { label: string; skills: string[] }[] = [
        { label: "oracle-only", skills: ["oracle"] },
        { label: "coldbolt-only", skills: ["coldbolt"] },
        { label: "oracle+coldbolt", skills: ["oracle", "coldbolt"] },
      ];
      for (const n of [10, 20]) {
        console.log(`  -- × ${n} players (tight) --`);
        for (const { label, skills } of COMBOS) {
          process.stdout.write(`  [AJ] ${n}p ${label}...\n`);
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboSubsetAllPlayers(page, n, skills), 800, true, `${n}p/${label}`);
          phaseAJ.push(r);
          console.log(`    ${fmtScale(r)}`);
        }
      }
    }

    // Fase AK: calibrar `maxActiveInstances` por benchmark real (leia1.txt
    // item 5 — "não escolha threshold no chute", "derivado dos dados").
    // Cenário de referência: Oracle sozinho × 10 tight, que a Fase AJ já
    // mediu em ~76.5ms/quadro (fps=13) SEM budget. Testa alguns limites
    // candidatos e mede se recupera FPS de verdade, sem inventar o número.
    interface BudgetCalibrationResult {
      label: string;
      limit: number;
      excludedCount: number;
      p50: number;
      p95: number;
      p99: number;
      fps: number;
      avg: number;
      domNodes: number;
    }
    const phaseAK: BudgetCalibrationResult[] = [];
    if (runAK) {
      console.log("[vfx-bench] Fase AK: calibração do budget (maxActiveInstances) — Oracle × 10 tight, janela longa (recompute a cada 15 quadros).");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase AK pulada.");
      } else {
        async function measureBudgetCalibration(limit: number, label: string): Promise<BudgetCalibrationResult> {
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 10, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await collectGarbage(cdp);
          await setVfxBudgetPage(page, limit);
          await spawnComboSubsetAllPlayers(page, 10, ["oracle"]);
          await settle(page, 300);
          await resetFrameStats(page);
          // janela longa de propósito: a 13fps (~76ms/quadro), 15 quadros
          // de recompute do budget levam ~1.1s só pra disparar 1x — 3s dá
          // margem pra estabilizar depois da exclusão entrar em vigor.
          const steady = await captureWindow(page, cdp, () => settle(page, 3000), false);
          const excludedCount = await vfxBudgetExcludedCountPage(page);
          await setVfxBudgetPage(page, Infinity);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          await collectGarbage(cdp);
          return {
            label,
            limit,
            excludedCount,
            p50: steady.perf.p50Ms,
            p95: steady.perf.p95Ms,
            p99: steady.perf.p99Ms,
            fps: steady.perf.fps,
            avg: steady.perf.frameTimeMs,
            domNodes: steady.domNodes,
          };
        }

        for (const limit of [Infinity, 6, 4, 2]) {
          const label = Number.isFinite(limit) ? `limit=${limit}` : "sem-limite(baseline)";
          process.stdout.write(`  [AK] ${label}...\n`);
          const r = await measureBudgetCalibration(limit, label);
          phaseAK.push(r);
          console.log(`    excluded=${r.excludedCount} dom=${r.domNodes} avg=${r.avg.toFixed(1)} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)}`);
        }
      }
    }

    // Fase AL: a Fase AK calibrou o budget só com Oracle isolado — pedido
    // do usuário agora é calibrar com o COMBO COMPLETO (6 skills), único
    // jeito de saber se o limite ajuda o cenário real que colapsa. n=10
    // (a Fase AI mediu fps=2/avg=495ms nesse ponto do combo completo,
    // baseline pra comparar). Janela longa: a fps baixo o recompute de 15
    // quadros do budget demora — cada condição precisa de tempo real pra
    // estabilizar DEPOIS da exclusão entrar em vigor.
    interface BudgetCalibrationResult2 {
      label: string;
      limit: number;
      excludedCount: number;
      p50: number;
      p95: number;
      p99: number;
      fps: number;
      avg: number;
      domNodes: number;
    }
    const phaseAL: BudgetCalibrationResult2[] = [];
    if (runAL) {
      console.log("[vfx-bench] Fase AL: calibração do budget no COMBO COMPLETO (6 skills) × 10 players tight.");
      async function measureBudgetComboCalibration(limit: number, label: string): Promise<BudgetCalibrationResult2> {
        await page.evaluate(
          ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
          { n: 10, arr: "tight" as BenchArrangement },
        );
        await settle(page, 150);
        await collectGarbage(cdp);
        await setVfxBudgetPage(page, limit);
        await spawnComboAllPlayers(page, 10, "chaotic");
        await settle(page, 300);
        await resetFrameStats(page);
        // janela bem mais longa que a Fase AK: o combo completo a ~2fps
        // (avg~500ms) precisa de ~7.5s só pros 15 quadros do 1º recompute;
        // 15s dá margem pra estabilizar de verdade depois disso.
        const steady = await captureWindow(page, cdp, () => settle(page, 15000), false);
        const excludedCount = await vfxBudgetExcludedCountPage(page);
        await setVfxBudgetPage(page, Infinity);
        await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
        await settle(page, 250);
        await collectGarbage(cdp);
        return {
          label,
          limit,
          excludedCount,
          p50: steady.perf.p50Ms,
          p95: steady.perf.p95Ms,
          p99: steady.perf.p99Ms,
          fps: steady.perf.fps,
          avg: steady.perf.frameTimeMs,
          domNodes: steady.domNodes,
        };
      }

      for (const limit of [Infinity, 40, 25, 15, 8]) {
        const label = Number.isFinite(limit) ? `limit=${limit}` : "sem-limite(baseline)";
        process.stdout.write(`  [AL] ${label}...\n`);
        const r = await measureBudgetComboCalibration(limit, label);
        phaseAL.push(r);
        console.log(`    excluded=${r.excludedCount} dom=${r.domNodes} avg=${r.avg.toFixed(1)} p99=${r.p99.toFixed(1)} fps=${r.fps.toFixed(0)}`);
      }
    }

    // Fase AM: a Fase AL achou domNodes=7021 CONSTANTE mesmo excluindo 91%
    // das instâncias por budget — hipótese: o custo residual (p99 ~1.1s
    // mesmo com só 8 ativas) vem de simplesmente TER os nós montados, não
    // de trabalho por-quadro. Decompõe com os controles que já existiam da
    // rodada "React/DOM isolation" (Fase K/L, antiga): DOM estático puro
    // (zero React/VFX) vs combo real detached do document (zero
    // paint/layout, React continua vivo) vs o cenário completo attached.
    // CAVEAT real: `setDomDocumentAttached` só desconecta o host do
    // `DomRenderer` (Oracle/Fire Wall/Thunder Storm/Fire Ball) — Cold Bolt
    // e Soul Strike usam `<Html>` do drei, fora do DomRenderer, e não são
    // afetados por este controle. Isso é reportado, não escondido.
    interface DomResidualResult {
      label: string;
      domNodes: number;
      p50: number;
      p95: number;
      p99: number;
      fps: number;
      avg: number;
    }
    const phaseAM: DomResidualResult[] = [];
    if (runAM) {
      console.log("[vfx-bench] Fase AM: decompor o custo residual de 7021 nós DOM — estático puro vs combo detached vs combo attached.");

      async function measureDomResidual(label: string, run: () => Promise<{ domNodes: number }>): Promise<DomResidualResult> {
        await page.evaluate(
          ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
          { n: 10, arr: "tight" as BenchArrangement },
        );
        await settle(page, 150);
        await collectGarbage(cdp);
        const { domNodes } = await run();
        await resetFrameStats(page);
        const steady = await captureWindow(page, cdp, () => settle(page, 3000), false);
        return {
          label,
          domNodes,
          p50: steady.perf.p50Ms,
          p95: steady.perf.p95Ms,
          p99: steady.perf.p99Ms,
          fps: steady.perf.fps,
          avg: steady.perf.frameTimeMs,
        };
      }

      process.stdout.write("  [AM] cena vazia (0 VFX, 0 DOM extra)...\n");
      const rEmpty = await measureDomResidual("cena-vazia", async () => ({ domNodes: await domNodeCount(page) }));
      phaseAM.push(rEmpty);
      console.log(`    dom=${rEmpty.domNodes} avg=${rEmpty.avg.toFixed(1)} p99=${rEmpty.p99.toFixed(1)} fps=${rEmpty.fps.toFixed(0)}`);
      await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
      await settle(page, 250);
      await collectGarbage(cdp);

      process.stdout.write("  [AM] DOM estático puro (7021 divs, zero React/VFX)...\n");
      const rStatic = await measureDomResidual("dom-estatico-7021", async () => {
        await mountStaticDomPage(page, 7021);
        await settle(page, 300);
        return { domNodes: await domNodeCount(page) };
      });
      phaseAM.push(rStatic);
      console.log(`    dom=${rStatic.domNodes} avg=${rStatic.avg.toFixed(1)} p99=${rStatic.p99.toFixed(1)} fps=${rStatic.fps.toFixed(0)}`);
      await clearStaticDomPage(page);
      await settle(page, 250);
      await collectGarbage(cdp);

      process.stdout.write("  [AM] combo real attached, sem budget (baseline)...\n");
      const rAttached = await measureDomResidual("combo-attached-sem-budget", async () => {
        await spawnComboAllPlayers(page, 10, "chaotic");
        await settle(page, 300);
        return { domNodes: await domNodeCount(page) };
      });
      phaseAM.push(rAttached);
      console.log(`    dom=${rAttached.domNodes} avg=${rAttached.avg.toFixed(1)} p99=${rAttached.p99.toFixed(1)} fps=${rAttached.fps.toFixed(0)}`);
      await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
      await settle(page, 250);
      await collectGarbage(cdp);

      process.stdout.write("  [AM] combo real DETACHED (DomRenderer fora do document; Cold Bolt/Soul Strike continuam conectados)...\n");
      const rDetached = await measureDomResidual("combo-detached-parcial", async () => {
        await spawnComboAllPlayers(page, 10, "chaotic");
        await settle(page, 300);
        await setDomAttachedPage(page, false);
        return { domNodes: await domNodeCount(page) };
      });
      phaseAM.push(rDetached);
      console.log(`    dom=${rDetached.domNodes} avg=${rDetached.avg.toFixed(1)} p99=${rDetached.p99.toFixed(1)} fps=${rDetached.fps.toFixed(0)}`);
      await setDomAttachedPage(page, true);
      await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
      await settle(page, 250);
      await collectGarbage(cdp);
    }

    // Fase AN: checagem visual rápida DOM×GPU da Fire Ball ANTES da
    // varredura de escala completa — pega bug óbvio (tela preta, VFX
    // ausente) cedo, barato (1 player, 2 screenshots por modo).
    interface FireBallVisualCheck {
      mode: string;
      screenshotImpact: string;
      screenshotCast: string;
    }
    const phaseAN: FireBallVisualCheck[] = [];
    if (runAN) {
      console.log("[vfx-bench] Fase AN: checagem visual Fire Ball DOM vs GPU (1 player).");
      const fireBallImpactIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREBALL" && s.kind === "impact");
      const fireBallCastIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREBALL" && s.kind === "cast");
      async function setFireBallMode(mode: "dom" | "gpu"): Promise<void> {
        await page.evaluate((m) => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set(m), mode);
      }
      async function captureFireBall(mode: "dom" | "gpu"): Promise<FireBallVisualCheck> {
        await setFireBallMode(mode);
        await page.evaluate(
          ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
          { n: 1, arr: "tight" as BenchArrangement },
        );
        await settle(page, 150);
        await spawnSingleAllPlayers(page, fireBallImpactIdx);
        await settle(page, 250); // ~metade do voo (FIREBALL_FLIGHT_MS=480ms) — bola ainda em trânsito
        const screenshotImpact = path.join(OUT_DIR, `fase-an-visual-impact-${mode}.png`);
        await page.screenshot({ path: screenshotImpact });
        await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
        await settle(page, 250);

        await page.evaluate(
          ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
          { n: 1, arr: "tight" as BenchArrangement },
        );
        await settle(page, 150);
        await spawnSingleAllPlayers(page, fireBallCastIdx);
        await settle(page, 200);
        const screenshotCast = path.join(OUT_DIR, `fase-an-visual-cast-${mode}.png`);
        await page.screenshot({ path: screenshotCast });
        await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
        await settle(page, 250);
        return { mode, screenshotImpact, screenshotCast };
      }

      if (fireBallImpactIdx === -1 || fireBallCastIdx === -1) {
        console.warn("[vfx-bench] cenário Fire Ball não encontrado — Fase AN pulada.");
      } else {
        process.stdout.write("  [AN] DOM...\n");
        const rDom = await captureFireBall("dom");
        phaseAN.push(rDom);
        console.log(`    impact=${rDom.screenshotImpact}`);
        console.log(`    cast=${rDom.screenshotCast}`);

        process.stdout.write("  [AN] GPU...\n");
        const rGpu = await captureFireBall("gpu");
        phaseAN.push(rGpu);
        console.log(`    impact=${rGpu.screenshotImpact}`);
        console.log(`    cast=${rGpu.screenshotCast}`);

        await setFireBallMode("dom"); // sempre volta pro padrão ao final
      }
    }

    // Fase AO (leia1.txt item 6): comparação controlada DOM×GPU, 1/5/10/
    // 20/30, tight — reusa `measureScale` (mesma infra da Fase AF, que já
    // mediu a Fire Ball DOM isolada) só alternando `__fireballBench.set`.
    // O que importa é a CURVA de crescimento, não só o FPS de uma rodada.
    const phaseAO: (ScaleResult & { mode: string })[] = [];
    if (runAO) {
      console.log("[vfx-bench] Fase AO: Fire Ball DOM vs GPU — curva de escala 1/5/10/20/30 (tight).");
      const fireBallImpactIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREBALL" && s.kind === "impact");
      if (fireBallImpactIdx === -1) {
        console.warn("[vfx-bench] cenário Fire Ball não encontrado — Fase AO pulada.");
      } else {
        for (const mode of ["dom", "gpu"] as const) {
          await page.evaluate(
            (m) => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set(m),
            mode,
          );
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [AO] ${mode} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, fireBallImpactIdx), 800, true, `fireball-${mode}`);
            phaseAO.push({ ...r, mode });
            console.log(`    ${fmtScale(r)}`);
          }
        }
        await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
      }
    }

    // Fase AP (leia1.txt item 7): combo completo de novo, agora com Fire
    // Ball em GPU vs DOM — reportar Fire Ball isolada (já feito, Fase AO)
    // separado do efeito no COMBO (não misturar as duas conclusões).
    const phaseAP: (ScaleResult & { mode: string })[] = [];
    if (runAP) {
      console.log("[vfx-bench] Fase AP: combo caótico completo, Fire Ball DOM vs GPU dentro dele — 10/20 players tight.");
      for (const mode of ["dom", "gpu"] as const) {
        await page.evaluate(
          (m) => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set(m),
          mode,
        );
        for (const n of [10, 20]) {
          process.stdout.write(`  [AP] combo/fireball-${mode} × ${n}...\n`);
          const withTracing = true;
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboAllPlayers(page, n, "chaotic"), 800, withTracing, `combo-fireball-${mode}`);
          phaseAP.push({ ...r, mode });
          console.log(`    ${fmtScale(r)}`);
        }
      }
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
    }

    // Fase AQ: checagem visual Oracle DOM vs GPU (low/medium/high/ultra) —
    // 1 player, screenshot de cada modo, antes da varredura de escala.
    interface OracleVisualCheck {
      mode: string;
      screenshot: string;
    }
    const phaseAQ: OracleVisualCheck[] = [];
    if (runAQ) {
      console.log("[vfx-bench] Fase AQ: checagem visual Oracle DOM vs GPU (low/medium/high/ultra), 1 player.");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase AQ pulada.");
      } else {
        async function setOracleMode(mode: string): Promise<void> {
          await page.evaluate(
            (m) => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set(m),
            mode,
          );
        }
        async function captureOracle(mode: string): Promise<OracleVisualCheck> {
          await setOracleMode(mode);
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await spawnSingleAllPlayers(page, oracleIdx);
          await settle(page, 600); // deixa a órbita/animação assentar
          const screenshot = path.join(OUT_DIR, `fase-aq-visual-oracle-${mode}.png`);
          await page.screenshot({ path: screenshot });
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return { mode, screenshot };
        }

        for (const mode of ["dom", "low", "medium", "high", "ultra"]) {
          process.stdout.write(`  [AQ] ${mode}...\n`);
          const r = await captureOracle(mode);
          phaseAQ.push(r);
          console.log(`    ${r.screenshot}`);
        }
        await setOracleMode("dom");
      }
    }

    // Fase AR: Oracle DOM vs GPU (low/medium/high) — curva de escala
    // 1/5/10/20/30 (tight), mesma infra de `measureScale` da Fase AO.
    // Oracle é o candidato #1 de migração (primeiro penhasco do combo).
    const phaseAR: (ScaleResult & { mode: string })[] = [];
    if (runAR) {
      console.log("[vfx-bench] Fase AR: Oracle DOM vs GPU (low/medium/high) — curva de escala 1/5/10/20/30 (tight).");
      const oracleIdx = scenarios.findIndex((s) => s.label.startsWith("Oracle"));
      if (oracleIdx === -1) {
        console.warn("[vfx-bench] cenário Oracle não encontrado — Fase AR pulada.");
      } else {
        for (const mode of ["dom", "low", "medium", "high"] as const) {
          await page.evaluate(
            (m) => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set(m),
            mode,
          );
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [AR] ${mode} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, oracleIdx), 800, true, `oracle-${mode}`);
            phaseAR.push({ ...r, mode });
            console.log(`    ${fmtScale(r)}`);
          }
        }
        await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("dom"));
      }
    }

    // Fase AS: combo completo com Oracle DOM vs GPU(high) — o teste que
    // decide se migrar Oracle sozinho já resolve o primeiro penhasco
    // (44→8fps ao entrar Oracle, decomposição incremental de rodada
    // anterior). Fire Ball fica em GPU também (já migrada e validada).
    const phaseAS: (ScaleResult & { mode: string })[] = [];
    if (runAS) {
      console.log("[vfx-bench] Fase AS: combo caótico completo, Oracle DOM vs GPU(high) dentro dele — 10/20 players tight.");
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("gpu"));
      for (const mode of ["dom", "high"] as const) {
        await page.evaluate(
          (m) => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set(m),
          mode,
        );
        for (const n of [10, 20]) {
          process.stdout.write(`  [AS] combo/oracle-${mode} × ${n}...\n`);
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboAllPlayers(page, n, "chaotic"), 800, true, `combo-oracle-${mode}`);
          phaseAS.push({ ...r, mode });
          console.log(`    ${fmtScale(r)}`);
        }
      }
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
    }

    // Fase AT: checagem visual Cold Bolt DOM vs GPU — 1 player, screenshot
    // de cada modo, mesmo protocolo da Fase AQ (Oracle).
    interface ColdBoltVisualCheck {
      mode: string;
      screenshot: string;
    }
    const phaseAT: ColdBoltVisualCheck[] = [];
    if (runAT) {
      console.log("[vfx-bench] Fase AT: checagem visual Cold Bolt DOM vs GPU, 1 player.");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase AT pulada.");
      } else {
        async function setColdBoltMode(mode: string): Promise<void> {
          await page.evaluate(
            (m) => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set(m),
            mode,
          );
        }
        async function captureColdBolt(mode: string): Promise<ColdBoltVisualCheck> {
          await setColdBoltMode(mode);
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await spawnSingleAllPlayers(page, coldBoltIdx);
          await settle(page, 500); // ~impacto (IMPACT_AT_MS≈459ms) + burst
          const screenshot = path.join(OUT_DIR, `fase-at-visual-coldbolt-${mode}.png`);
          await page.screenshot({ path: screenshot });
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return { mode, screenshot };
        }

        for (const mode of ["dom", "gpu"]) {
          process.stdout.write(`  [AT] ${mode}...\n`);
          const r = await captureColdBolt(mode);
          phaseAT.push(r);
          console.log(`    ${r.screenshot}`);
        }
        await setColdBoltMode("dom");
      }
    }

    // Fase AU: Cold Bolt DOM vs GPU — curva de escala 1/5/10/20/30 (tight),
    // mesma infra de `measureScale` das Fases AO/AR. Cold Bolt é o MAIOR
    // penhasco medido na decomposição incremental (8→2fps).
    const phaseAU: (ScaleResult & { mode: string })[] = [];
    if (runAU) {
      console.log("[vfx-bench] Fase AU: Cold Bolt DOM vs GPU — curva de escala 1/5/10/20/30 (tight).");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase AU pulada.");
      } else {
        for (const mode of ["dom", "gpu"] as const) {
          await page.evaluate(
            (m) => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set(m),
            mode,
          );
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [AU] ${mode} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, coldBoltIdx), 800, true, `coldbolt-${mode}`);
            phaseAU.push({ ...r, mode });
            console.log(`    ${fmtScale(r)}`);
          }
        }
        await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("dom"));
      }
    }

    // Fase AV: combo completo com Cold Bolt DOM vs GPU — Fire Ball e Oracle
    // já em GPU dos dois lados (validadas nas rodadas anteriores). Decide
    // se o MAIOR penhasco medido some do combo.
    const phaseAV: (ScaleResult & { mode: string })[] = [];
    if (runAV) {
      console.log("[vfx-bench] Fase AV: combo caótico completo, Cold Bolt DOM vs GPU dentro dele — 10/20 players tight.");
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("high"));
      for (const mode of ["dom", "gpu"] as const) {
        await page.evaluate(
          (m) => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set(m),
          mode,
        );
        for (const n of [10, 20]) {
          process.stdout.write(`  [AV] combo/coldbolt-${mode} × ${n}...\n`);
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboAllPlayers(page, n, "chaotic"), 800, true, `combo-coldbolt-${mode}`);
          phaseAV.push({ ...r, mode });
          console.log(`    ${fmtScale(r)}`);
        }
      }
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
    }

    // Fase AW: checagem visual Fire Wall DOM vs GPU — 1 player/célula,
    // screenshot de cada modo, mesmo protocolo AQ/AT.
    interface FireWallVisualCheck {
      mode: string;
      screenshot: string;
    }
    const phaseAW: FireWallVisualCheck[] = [];
    if (runAW) {
      console.log("[vfx-bench] Fase AW: checagem visual Fire Wall DOM vs GPU, 1 célula.");
      const fireWallIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREWALL" && s.kind === "area");
      if (fireWallIdx === -1) {
        console.warn("[vfx-bench] cenário Fire Wall não encontrado — Fase AW pulada.");
      } else {
        async function setFireWallMode(mode: string): Promise<void> {
          await page.evaluate(
            (m) => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set(m),
            mode,
          );
        }
        async function captureFireWall(mode: string): Promise<FireWallVisualCheck> {
          await setFireWallMode(mode);
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await spawnSingleAllPlayers(page, fireWallIdx);
          await settle(page, 500);
          const screenshot = path.join(OUT_DIR, `fase-aw-visual-firewall-${mode}.png`);
          await page.screenshot({ path: screenshot });
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return { mode, screenshot };
        }

        for (const mode of ["dom", "gpu"]) {
          process.stdout.write(`  [AW] ${mode}...\n`);
          const r = await captureFireWall(mode);
          phaseAW.push(r);
          console.log(`    ${r.screenshot}`);
        }
        await setFireWallMode("dom");
      }
    }

    // Fase AX: Fire Wall DOM vs GPU — curva de escala 1/5/10/20/30 (tight),
    // metodologia validada na Fase AH (1 player = 1 célula).
    const phaseAX: (ScaleResult & { mode: string })[] = [];
    if (runAX) {
      console.log("[vfx-bench] Fase AX: Fire Wall DOM vs GPU — curva de escala 1/5/10/20/30 (tight).");
      const fireWallIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREWALL" && s.kind === "area");
      if (fireWallIdx === -1) {
        console.warn("[vfx-bench] cenário Fire Wall não encontrado — Fase AX pulada.");
      } else {
        for (const mode of ["dom", "gpu"] as const) {
          await page.evaluate(
            (m) => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set(m),
            mode,
          );
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [AX] ${mode} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, fireWallIdx), 800, true, `firewall-${mode}`);
            phaseAX.push({ ...r, mode });
            console.log(`    ${fmtScale(r)}`);
          }
        }
        await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("dom"));
      }
    }

    // Fase AY: combo completo com Fire Wall DOM vs GPU — Fire Ball/Oracle/
    // Cold Bolt já em GPU dos dois lados (validados nas rodadas anteriores).
    const phaseAY: (ScaleResult & { mode: string })[] = [];
    if (runAY) {
      console.log("[vfx-bench] Fase AY: combo caótico completo, Fire Wall DOM vs GPU dentro dele — 10/20 players tight.");
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("high"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("gpu"));
      for (const mode of ["dom", "gpu"] as const) {
        await page.evaluate(
          (m) => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set(m),
          mode,
        );
        for (const n of [10, 20]) {
          process.stdout.write(`  [AY] combo/firewall-${mode} × ${n}...\n`);
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboAllPlayers(page, n, "chaotic"), 800, true, `combo-firewall-${mode}`);
          phaseAY.push({ ...r, mode });
          console.log(`    ${fmtScale(r)}`);
        }
      }
      await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
    }

    // Fase AZ: checagem visual Thunder Storm DOM vs GPU — 1 player,
    // screenshot de cada modo, mesmo protocolo AQ/AT/AW.
    interface ThunderStormVisualCheck {
      mode: string;
      screenshot: string;
    }
    const phaseAZ: ThunderStormVisualCheck[] = [];
    if (runAZ) {
      console.log("[vfx-bench] Fase AZ: checagem visual Thunder Storm DOM vs GPU, 1 player.");
      const thunderIdx = scenarios.findIndex((s) => s.aegisName === "MG_THUNDERSTORM" && s.kind === "impact");
      if (thunderIdx === -1) {
        console.warn("[vfx-bench] cenário Thunder Storm não encontrado — Fase AZ pulada.");
      } else {
        async function setThunderMode(mode: string): Promise<void> {
          await page.evaluate(
            (m) => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set(m),
            mode,
          );
        }
        async function captureThunder(mode: string): Promise<ThunderStormVisualCheck> {
          await setThunderMode(mode);
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await spawnSingleAllPlayers(page, thunderIdx);
          await settle(page, 500);
          const screenshot = path.join(OUT_DIR, `fase-az-visual-thunderstorm-${mode}.png`);
          await page.screenshot({ path: screenshot });
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return { mode, screenshot };
        }

        for (const mode of ["dom", "gpu"]) {
          process.stdout.write(`  [AZ] ${mode}...\n`);
          const r = await captureThunder(mode);
          phaseAZ.push(r);
          console.log(`    ${r.screenshot}`);
        }
        await setThunderMode("dom");
      }
    }

    // Fase BA: Thunder Storm DOM vs GPU — curva de escala 1/5/10/20/30
    // (tight).
    const phaseBA: (ScaleResult & { mode: string })[] = [];
    if (runBA) {
      console.log("[vfx-bench] Fase BA: Thunder Storm DOM vs GPU — curva de escala 1/5/10/20/30 (tight).");
      const thunderIdx = scenarios.findIndex((s) => s.aegisName === "MG_THUNDERSTORM" && s.kind === "impact");
      if (thunderIdx === -1) {
        console.warn("[vfx-bench] cenário Thunder Storm não encontrado — Fase BA pulada.");
      } else {
        for (const mode of ["dom", "gpu"] as const) {
          await page.evaluate(
            (m) => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set(m),
            mode,
          );
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [BA] ${mode} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, thunderIdx), 800, true, `thunderstorm-${mode}`);
            phaseBA.push({ ...r, mode });
            console.log(`    ${fmtScale(r)}`);
          }
        }
        await page.evaluate(() => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set("dom"));
      }
    }

    // Fase BB: combo completo com Thunder Storm DOM vs GPU — Fire Ball/
    // Oracle/Cold Bolt/Fire Wall já em GPU dos dois lados.
    const phaseBB: (ScaleResult & { mode: string })[] = [];
    if (runBB) {
      console.log("[vfx-bench] Fase BB: combo caótico completo, Thunder Storm DOM vs GPU dentro dele — 10/20 players tight.");
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("high"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("gpu"));
      for (const mode of ["dom", "gpu"] as const) {
        await page.evaluate(
          (m) => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set(m),
          mode,
        );
        for (const n of [10, 20]) {
          process.stdout.write(`  [BB] combo/thunderstorm-${mode} × ${n}...\n`);
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboAllPlayers(page, n, "chaotic"), 800, true, `combo-thunderstorm-${mode}`);
          phaseBB.push({ ...r, mode });
          console.log(`    ${fmtScale(r)}`);
        }
      }
      await page.evaluate(() => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
    }

    // Fase BC: checagem visual Soul Strike DOM vs GPU — 1 player.
    interface SoulStrikeVisualCheck {
      mode: string;
      screenshot: string;
    }
    const phaseBC: SoulStrikeVisualCheck[] = [];
    if (runBC) {
      console.log("[vfx-bench] Fase BC: checagem visual Soul Strike DOM vs GPU, 1 player.");
      const soulIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      if (soulIdx === -1) {
        console.warn("[vfx-bench] cenário Soul Strike não encontrado — Fase BC pulada.");
      } else {
        async function setSoulMode(mode: string): Promise<void> {
          await page.evaluate(
            (m) => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set(m),
            mode,
          );
        }
        async function captureSoul(mode: string): Promise<SoulStrikeVisualCheck> {
          await setSoulMode(mode);
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await spawnSingleAllPlayers(page, soulIdx);
          await settle(page, 500);
          const screenshot = path.join(OUT_DIR, `fase-bc-visual-soulstrike-${mode}.png`);
          await page.screenshot({ path: screenshot });
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
          return { mode, screenshot };
        }

        for (const mode of ["dom", "gpu"]) {
          process.stdout.write(`  [BC] ${mode}...\n`);
          const r = await captureSoul(mode);
          phaseBC.push(r);
          console.log(`    ${r.screenshot}`);
        }
        await setSoulMode("dom");
      }
    }

    // Fase BD: Soul Strike DOM vs GPU — curva de escala 1/5/10/20/30 (tight).
    const phaseBD: (ScaleResult & { mode: string })[] = [];
    if (runBD) {
      console.log("[vfx-bench] Fase BD: Soul Strike DOM vs GPU — curva de escala 1/5/10/20/30 (tight).");
      const soulIdx = scenarios.findIndex((s) => s.aegisName === "MG_SOULSTRIKE" && s.kind === "impact");
      if (soulIdx === -1) {
        console.warn("[vfx-bench] cenário Soul Strike não encontrado — Fase BD pulada.");
      } else {
        for (const mode of ["dom", "gpu"] as const) {
          await page.evaluate(
            (m) => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set(m),
            mode,
          );
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [BD] ${mode} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, soulIdx), 800, true, `soulstrike-${mode}`);
            phaseBD.push({ ...r, mode });
            console.log(`    ${fmtScale(r)}`);
          }
        }
        await page.evaluate(() => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set("dom"));
      }
    }

    // Fase BE: combo completo com Soul Strike DOM vs GPU — as outras 4
    // skills já em GPU dos dois lados.
    const phaseBE: (ScaleResult & { mode: string })[] = [];
    if (runBE) {
      console.log("[vfx-bench] Fase BE: combo caótico completo, Soul Strike DOM vs GPU dentro dele — 10/20 players tight.");
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("high"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set("gpu"));
      for (const mode of ["dom", "gpu"] as const) {
        await page.evaluate(
          (m) => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set(m),
          mode,
        );
        for (const n of [10, 20]) {
          process.stdout.write(`  [BE] combo/soulstrike-${mode} × ${n}...\n`);
          const r = await measureScale(page, cdp, n, "tight", () => spawnComboAllPlayers(page, n, "chaotic"), 800, true, `combo-soulstrike-${mode}`);
          phaseBE.push({ ...r, mode });
          console.log(`    ${fmtScale(r)}`);
        }
      }
      await page.evaluate(() => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
    }

    // Fase BF: perfilar o combo 100%-GPU (6 skills — Fire Ball, Oracle,
    // Cold Bolt, Fire Wall, Thunder Storm, Soul Strike) diretamente, pra
    // achar o PRÓXIMO gargalo — a Fase BE mostrou que migrar mais skill não
    // ajuda mais (fps travado em 6 mesmo com domNodes caindo pra ~420).
    // Decompõe via `vfxManager.getUpdateProfile()` (iteration/anchor/
    // culling/domUpdate/flush, ms/quadro) — se o total daí for pequeno
    // frente ao frame time observado, o gargalo está FORA do VFX Core.
    // Roda tight (cluster, mesma célula — estresse de overdraw) E spread
    // (afastado, dentro do campo de visão) pra testar a hipótese de
    // overdraw/fill-rate (muitos sprites/partículas aditivos sobrepostos).
    interface AllGpuProfileRow {
      mode: "dom" | "gpu";
      arrangement: BenchArrangement;
      players: number;
      steady: WindowMeasurement;
      profile: UpdateProfileSnapshot;
    }
    const phaseBF: AllGpuProfileRow[] = [];
    if (runBF) {
      console.log("[vfx-bench] Fase BF: perfil do combo 100%-DOM vs 100%-GPU (6 skills) — confirmar números reais headed.");

      async function setAllSkills(mode: "dom" | "gpu"): Promise<void> {
        const oracleMode = mode === "gpu" ? "high" : "dom";
        await page.evaluate((m) => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set(m), mode);
        await page.evaluate((m) => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set(m), oracleMode);
        await page.evaluate((m) => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set(m), mode);
        await page.evaluate((m) => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set(m), mode);
        await page.evaluate((m) => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set(m), mode);
        await page.evaluate((m) => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set(m), mode);
      }

      for (const mode of ["dom", "gpu"] as const) {
        await setAllSkills(mode);
        for (const arrangement of ["tight", "spread"] as BenchArrangement[]) {
          for (const n of [0, 10, 20, 30]) {
            process.stdout.write(`  [BF] ${mode}/${arrangement} × ${n}...\n`);
            await page.evaluate(
              ({ nn, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(nn, arr),
              { nn: n, arr: arrangement },
            );
            await settle(page, 150);
            await collectGarbage(cdp);
            await spawnComboAllPlayers(page, n, "chaotic");
            await settle(page, 800); // mount, não medido

            await resetFrameStats(page);
            await resetUpdateProfile(page);
            const steady = await captureWindow(page, cdp, () => settle(page, 800), true);
            const profile = await readUpdateProfile(page);
            phaseBF.push({ mode, arrangement, players: n, steady, profile });
            console.log(`    ${fmtWindow(steady)}`);
            console.log(`    ${fmtProfile(profile)}`);

            await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
            await settle(page, 250);
            await collectGarbage(cdp);
          }
        }
      }

      await setAllSkills("dom");
    }

    // Fase BG: perfil de CPU real (V8 sampling, `Profiler` do CDP —
    // domínio DIFERENTE de `Tracing`, que a Fase BF já provou não
    // confiável pro bucket `composite`) no combo 100%-GPU, N=10 e N=30
    // tight — acha a FUNÇÃO exata que consome o tempo que
    // `vfxManager.update()` (0.5-1.6ms/quadro, Fase BF) não explica.
    interface CpuProfileResult {
      players: number;
      top: CpuProfileRow[];
      totalMs: number;
    }
    const phaseBG: CpuProfileResult[] = [];
    if (runBG) {
      console.log("[vfx-bench] Fase BG: perfil de CPU (V8 sampling) do combo 100%-GPU — achar a função quente.");
      const gpuInfo = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
        if (!gl) return { error: "sem contexto webgl" };
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        };
      });
      console.log(`  [BG] WebGL: ${JSON.stringify(gpuInfo)}`);
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("high"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set("gpu"));
      await page.evaluate(() => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set("gpu"));

      for (const n of [10, 30]) {
        process.stdout.write(`  [BG] tight × ${n}...\n`);
        await page.evaluate(
          ({ nn }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(nn, "tight"),
          { nn: n },
        );
        await settle(page, 150);
        await collectGarbage(cdp);
        await spawnComboAllPlayers(page, n, "chaotic");
        await settle(page, 800); // mount, não medido

        const { top, totalMs } = await captureCpuProfile(cdp, () => settle(page, 1500));
        phaseBG.push({ players: n, top, totalMs });
        console.log(fmtCpuProfile(top, totalMs));

        await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
        await settle(page, 250);
        await collectGarbage(cdp);
      }

      await page.evaluate(() => (window as unknown as { __soulStrikeRenderBench: { set: (mode: string) => void } }).__soulStrikeRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __thunderStormRenderBench: { set: (mode: string) => void } }).__thunderStormRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireWallRenderBench: { set: (mode: string) => void } }).__fireWallRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set("dom"));
      await page.evaluate(() => (window as unknown as { __fireballBench: { set: (mode: string) => void } }).__fireballBench.set("dom"));
    }

    // Fase BH: checagem visual das 5 skills FORA da lista original de 5
    // (Fire Lance, Light Bolt, Ghost Dome/Safety Wall, Frost Diver, Stone
    // Curse) — 1 screenshot DOM + 1 GPU por skill, mesmo protocolo AQ/AT.
    interface OutOfListVisualCheck {
      skill: string;
      mode: string;
      screenshot: string;
    }
    const phaseBH: OutOfListVisualCheck[] = [];
    if (runBH) {
      console.log("[vfx-bench] Fase BH: checagem visual das 5 skills fora da lista original, 1 player.");
      const targets: { skill: string; aegisName: string; bench: string; slug: string }[] = [
        { skill: "Fire Lance", aegisName: "MG_FIREBOLT", bench: "__fireLanceRenderBench", slug: "firelance" },
        { skill: "Light Bolt", aegisName: "MG_LIGHTNINGBOLT", bench: "__lightBoltRenderBench", slug: "lightbolt" },
        { skill: "Frost Diver", aegisName: "MG_FROSTDIVER", bench: "__frostDiverRenderBench", slug: "frostdiver" },
        { skill: "Stone Curse", aegisName: "MG_STONECURSE", bench: "__stoneCurseRenderBench", slug: "stonecurse" },
      ];
      for (const target of targets) {
        const idx = scenarios.findIndex((s) => s.aegisName === target.aegisName && s.kind === "impact");
        if (idx === -1) {
          console.warn(`[vfx-bench] cenário ${target.skill} não encontrado — pulado.`);
          continue;
        }
        for (const mode of ["dom", "gpu"]) {
          await page.evaluate(
            ({ b, m }) => (window as unknown as Record<string, { set: (mode: string) => void }>)[b]!.set(m),
            { b: target.bench, m: mode },
          );
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await spawnSingleAllPlayers(page, idx);
          await settle(page, 500);
          const screenshot = path.join(OUT_DIR, `fase-bh-visual-${target.slug}-${mode}.png`);
          await page.screenshot({ path: screenshot });
          phaseBH.push({ skill: target.skill, mode, screenshot });
          console.log(`  [BH] ${target.skill}/${mode}: ${screenshot}`);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
        }
        await page.evaluate(
          (b) => (window as unknown as Record<string, { set: (mode: string) => void }>)[b]!.set("dom"),
          target.bench,
        );
      }

      // Ghost Dome (Safety Wall) — cenário `kind:"area"`, mesmo protocolo AW.
      const gdIdx = scenarios.findIndex((s) => s.aegisName === "MG_SAFETYWALL" && s.kind === "area");
      if (gdIdx === -1) {
        console.warn("[vfx-bench] cenário Ghost Dome não encontrado — pulado.");
      } else {
        for (const mode of ["dom", "gpu"]) {
          await page.evaluate(
            (m) => (window as unknown as { __ghostDomeRenderBench: { set: (mode: string) => void } }).__ghostDomeRenderBench.set(m),
            mode,
          );
          await page.evaluate(
            ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
            { n: 1, arr: "tight" as BenchArrangement },
          );
          await settle(page, 150);
          await spawnSingleAllPlayers(page, gdIdx);
          await settle(page, 500);
          const screenshot = path.join(OUT_DIR, `fase-bh-visual-ghostdome-${mode}.png`);
          await page.screenshot({ path: screenshot });
          phaseBH.push({ skill: "Ghost Dome", mode, screenshot });
          console.log(`  [BH] Ghost Dome/${mode}: ${screenshot}`);
          await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
          await settle(page, 250);
        }
        await page.evaluate(() => (window as unknown as { __ghostDomeRenderBench: { set: (mode: string) => void } }).__ghostDomeRenderBench.set("dom"));
      }
    }

    // Fase BI: curva de escala 1/5/10/20/30 (tight, isolado) das mesmas 5
    // skills — DOM vs GPU, confirma escala sem depender do combo (essas 5
    // não entraram na cadeia de combo já construída pras 6 da Directive B).
    const phaseBI: (ScaleResult & { mode: string; skill: string })[] = [];
    if (runBI) {
      console.log("[vfx-bench] Fase BI: curva de escala das 5 skills fora da lista, DOM vs GPU, 1/5/10/20/30 tight.");
      const scaleTargets: { skill: string; aegisName: string; kind: "impact" | "area"; bench: string }[] = [
        { skill: "Fire Lance", aegisName: "MG_FIREBOLT", kind: "impact", bench: "__fireLanceRenderBench" },
        { skill: "Light Bolt", aegisName: "MG_LIGHTNINGBOLT", kind: "impact", bench: "__lightBoltRenderBench" },
        { skill: "Frost Diver", aegisName: "MG_FROSTDIVER", kind: "impact", bench: "__frostDiverRenderBench" },
        { skill: "Stone Curse", aegisName: "MG_STONECURSE", kind: "impact", bench: "__stoneCurseRenderBench" },
        { skill: "Ghost Dome", aegisName: "MG_SAFETYWALL", kind: "area", bench: "__ghostDomeRenderBench" },
      ];
      for (const target of scaleTargets) {
        const idx = scenarios.findIndex((s) => s.aegisName === target.aegisName && s.kind === target.kind);
        if (idx === -1) {
          console.warn(`[vfx-bench] cenário ${target.skill} não encontrado — pulado.`);
          continue;
        }
        for (const mode of ["dom", "gpu"] as const) {
          await page.evaluate(
            ({ b, m }) => (window as unknown as Record<string, { set: (mode: string) => void }>)[b]!.set(m),
            { b: target.bench, m: mode },
          );
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [BI] ${target.skill}/${mode} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, idx), 800, true, `${target.skill}-${mode}`);
            phaseBI.push({ ...r, mode, skill: target.skill });
            console.log(`    ${fmtScale(r)}`);
          }
        }
        await page.evaluate(
          (b) => (window as unknown as Record<string, { set: (mode: string) => void }>)[b]!.set("dom"),
          target.bench,
        );
      }
    }

    // Fase BJ: combo caótico completo com as 11 skills (Fire Ball, Oracle,
    // Cold Bolt, Fire Wall, Thunder Storm, Soul Strike, Fire Lance, Light
    // Bolt, Frost Diver, Stone Curse, Ghost Dome) — DOM-100% vs GPU-100%,
    // pedido explícito após a rodada de "migra as skills fora da lista".
    // MESMA estrutura da Fase BF, só com os 11 toggles em vez de 6 — o
    // `spawnCombo("chaotic")` do bench foi estendido pra disparar as 11.
    interface Combo11Row {
      mode: "dom" | "gpu";
      arrangement: BenchArrangement;
      players: number;
      steady: WindowMeasurement;
      profile: UpdateProfileSnapshot;
    }
    const phaseBJ: Combo11Row[] = [];
    if (runBJ) {
      console.log("[vfx-bench] Fase BJ: combo caótico completo, 11 skills, DOM-100% vs GPU-100%.");

      async function setAll11(mode: "dom" | "gpu"): Promise<void> {
        const oracleMode = mode === "gpu" ? "high" : "dom";
        const benches = [
          "__fireballBench",
          "__coldBoltRenderBench",
          "__fireWallRenderBench",
          "__thunderStormRenderBench",
          "__soulStrikeRenderBench",
          "__fireLanceRenderBench",
          "__lightBoltRenderBench",
          "__frostDiverRenderBench",
          "__stoneCurseRenderBench",
          "__ghostDomeRenderBench",
        ];
        for (const b of benches) {
          await page.evaluate(
            ({ bb, m }) => (window as unknown as Record<string, { set: (mode: string) => void }>)[bb]!.set(m),
            { bb: b, m: mode },
          );
        }
        await page.evaluate((m) => (window as unknown as { __oracleRenderBench: { set: (mode: string) => void } }).__oracleRenderBench.set(m), oracleMode);
      }

      for (const mode of ["dom", "gpu"] as const) {
        await setAll11(mode);
        for (const arrangement of ["tight", "spread"] as BenchArrangement[]) {
          for (const n of [10, 20, 30]) {
            process.stdout.write(`  [BJ] ${mode}/${arrangement} × ${n}...\n`);
            await page.evaluate(
              ({ nn, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(nn, arr),
              { nn: n, arr: arrangement },
            );
            await settle(page, 150);
            await collectGarbage(cdp);
            await spawnComboAllPlayers(page, n, "chaotic");
            await settle(page, 800);

            await resetFrameStats(page);
            await resetUpdateProfile(page);
            const steady = await captureWindow(page, cdp, () => settle(page, 800), true);
            const profile = await readUpdateProfile(page);
            phaseBJ.push({ mode, arrangement, players: n, steady, profile });
            console.log(`    ${fmtWindow(steady)}`);
            console.log(`    ${fmtProfile(profile)}`);

            await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
            await settle(page, 250);
            await collectGarbage(cdp);
          }
        }
      }

      await setAll11("dom");
    }

    // Fase BK: sanidade do padrão de PRODUÇÃO — NENHUM toggle é chamado
    // (nem `.set("dom")` nem `.set("gpu")`), só spawna direto e tira
    // screenshot, provando que o default real (module-load de
    // `skillVfxBindings.ts`, sem nenhum bench mexendo) já é GPU.
    interface ProductionDefaultCheck {
      skill: string;
      screenshot: string;
    }
    const phaseBK: ProductionDefaultCheck[] = [];
    if (runBK) {
      console.log("[vfx-bench] Fase BK: sanidade do padrão de produção (sem NENHUM toggle chamado).");
      const targets = [
        { skill: "Cold Bolt", aegisName: "MG_COLDBOLT", kind: "impact" as const },
        { skill: "Fire Wall", aegisName: "MG_FIREWALL", kind: "area" as const },
        { skill: "Light Bolt", aegisName: "MG_LIGHTNINGBOLT", kind: "impact" as const },
      ];
      for (const target of targets) {
        const idx = scenarios.findIndex((s) => s.aegisName === target.aegisName && s.kind === target.kind);
        if (idx === -1) {
          console.warn(`[vfx-bench] cenário ${target.skill} não encontrado — pulado.`);
          continue;
        }
        await page.evaluate(
          ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
          { n: 1, arr: "tight" as BenchArrangement },
        );
        await settle(page, 150);
        await spawnSingleAllPlayers(page, idx);
        await settle(page, 500);
        const screenshot = path.join(OUT_DIR, `fase-bk-producao-padrao-${target.skill.toLowerCase().replace(/\s/g, "")}.png`);
        await page.screenshot({ path: screenshot });
        phaseBK.push({ skill: target.skill, screenshot });
        console.log(`  [BK] ${target.skill} (default, sem toggle): ${screenshot}`);
        await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
        await settle(page, 250);
      }
    }

    // Fase BM: auditoria DOM residual, pedido explícito do usuário
    // (2026-08-17) — "não quero suposição". Pra CADA uma das 11 skills
    // marcadas GPU: spawna pelo dispatcher REAL (`spawnRealistic`, que
    // replica TAMBÉM o push condicional de `net/damageFeed` que
    // `net/useWorldEvents.ts` faz — `spawnOne`/todo benchmark anterior
    // desta investigação NUNCA fazia isso), tira snapshot de TODO o
    // documento em vários instantes do ciclo de vida (cast/travel/impacto/
    // after-effect), faz o DIFF por multiset (tag+classe) contra um
    // baseline, e classifica cada classe nova por prefixo conhecido.
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
    interface AuditSample {
      label: string;
      atMs: number;
      added: { key: string; count: number; node: DomAuditNode }[];
    }
    interface SkillAuditResult {
      skill: string;
      aegisName: string;
      samples: AuditSample[];
      maxAnimations: number;
    }

    // classificação por PREFIXO de classe — tabela fechada, contra o
    // catálogo real de CSS que esta investigação inteira escreveu
    // (legacyVfxArt.ts pros layers `dom` das 5 skills com cascata de
    // número + damageNumberStyle.ts pro genérico). Prefixo fora desta
    // lista = "desconhecido", reportado cru pra inspeção manual — nunca
    // presumido como inofensivo.
    const CLASS_ORIGIN: { prefix: string; origin: string; category: "damage-ui" | "vfx-dom-layer" | "vfx-dom-legacy" }[] = [
      { prefix: "dmg-num", origin: "net/damageFeed + net/NetDamageNumbers.tsx (genérico, TODO hit do jogo)", category: "damage-ui" },
      { prefix: "cb-ice-dmgnum", origin: "coldBoltDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "cb-ice-total", origin: "coldBoltDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "cb-ice-spike", origin: "ColdBoltImpact.tsx LEGADO (lança/burst DOM antiga) — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "cb-ice-hit", origin: "ColdBoltImpact.tsx LEGADO (burst DOM antigo) — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "ts-dmgnum", origin: "thunderStormDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "ts-total", origin: "thunderStormDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "ts-bolt", origin: "ThunderStormImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "ts-ground", origin: "ThunderStormImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "ts-shock", origin: "ThunderStormImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "ts-cast-elec", origin: "ThunderStormCastElectric.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "ss-dmgnum", origin: "soulStrikeDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "ss-total", origin: "soulStrikeDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "ss-ghost", origin: "SoulStrikeImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "ss-echo", origin: "SoulStrikeImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "ss-hit", origin: "SoulStrikeImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "fl-fire-dmgnum", origin: "fireLanceDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "fl-fire-total", origin: "fireLanceDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "fl-fire-spike", origin: "FireLanceImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "fl-fire-hit", origin: "FireLanceImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "lb-dmgnum", origin: "lightBoltDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "lb-total", origin: "lightBoltDamageDomArt.tsx (camada `dom` da VfxDefinition GPU)", category: "vfx-dom-layer" },
      { prefix: "lb-bolt", origin: "LightBoltImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "lb-strike", origin: "LightBoltImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "fbi-", origin: "FireBallImpact (CSS legado, fireBallVfxDef.tsx) — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "fb-cast", origin: "FireBallCastFire (CSS legado) — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "fd-", origin: "FrostDiverImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "sc-", origin: "StoneCurseImpact.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "or-", origin: "oracleVfxDef.tsx LEGADO (dom art registrado, mas id deveria estar em GPU) — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "fw-", origin: "fireWallVfxDef.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
      { prefix: "gd-", origin: "ghostDomeVfxDef.tsx LEGADO — NÃO deveria aparecer em modo GPU", category: "vfx-dom-legacy" },
    ];
    function classify(className: string): { origin: string; category: string } {
      for (const c of CLASS_ORIGIN) {
        if (className.split(/\s+/).some((tok) => tok.startsWith(c.prefix))) return { origin: c.origin, category: c.category };
      }
      if (!className) return { origin: "(sem classe — provável chrome/estrutura, não VFX)", category: "no-class" };
      return { origin: `DESCONHECIDO — investigar manualmente (classe: "${className}")`, category: "unknown" };
    }

    async function snapshotDom(page: Page): Promise<DomAuditNode[]> {
      return page.evaluate(() => (window as unknown as { __vfxBench: { domAuditSnapshot: () => DomAuditNode[] } }).__vfxBench.domAuditSnapshot());
    }
    function diffByMultiset(before: DomAuditNode[], after: DomAuditNode[]): { key: string; count: number; node: DomAuditNode }[] {
      const keyOf = (n: DomAuditNode) => `${n.tag}|${n.className}`;
      const beforeCounts = new Map<string, number>();
      for (const n of before) beforeCounts.set(keyOf(n), (beforeCounts.get(keyOf(n)) ?? 0) + 1);
      const afterGroups = new Map<string, { count: number; node: DomAuditNode }>();
      for (const n of after) {
        const k = keyOf(n);
        const g = afterGroups.get(k);
        if (g) g.count++;
        else afterGroups.set(k, { count: 1, node: n });
      }
      const added: { key: string; count: number; node: DomAuditNode }[] = [];
      for (const [k, g] of afterGroups) {
        const net = g.count - (beforeCounts.get(k) ?? 0);
        if (net > 0) added.push({ key: k, count: net, node: g.node });
      }
      return added;
    }

    const phaseBM: SkillAuditResult[] = [];
    if (runBM) {
      console.log("[vfx-bench] Fase BM: auditoria DOM residual — dispatcher REAL, sem RenderBench.set() nenhum.");
      interface AuditTarget {
        skill: string;
        aegisName: string;
        kind: "impact" | "area" | "buff";
        opts?: { hits?: number; damage?: number };
        samples: { label: string; atMs: number }[];
        castNote?: string;
      }
      const targets: AuditTarget[] = [
        {
          skill: "Fire Ball",
          aegisName: "MG_FIREBALL",
          kind: "impact",
          samples: [
            { label: "travel", atMs: 200 },
            { label: "impact", atMs: 500 },
            { label: "after-effect", atMs: 1050 },
          ],
        },
        {
          skill: "Oracle",
          aegisName: "MG_SIGHT",
          kind: "buff",
          samples: [
            { label: "cast", atMs: 150 },
            { label: "after-effect", atMs: 2000 },
          ],
        },
        {
          skill: "Cold Bolt",
          aegisName: "MG_COLDBOLT",
          kind: "impact",
          opts: { hits: 5, damage: 2000 },
          castNote: "cast migrado pra GPU 2026-08-19 (cold_bolt_cast_gpu) — não medido nesta fase (só kind:impact), mas não é mais DOM",
          samples: [
            { label: "travel", atMs: 150 },
            { label: "impact", atMs: 600 },
            { label: "after-effect", atMs: 1800 },
          ],
        },
        {
          skill: "Fire Wall",
          aegisName: "MG_FIREWALL",
          kind: "area",
          samples: [
            { label: "cast", atMs: 150 },
            { label: "after-effect", atMs: 1000 },
          ],
        },
        {
          skill: "Thunder Storm",
          aegisName: "MG_THUNDERSTORM",
          kind: "impact",
          opts: { hits: 5, damage: 4000 },
          samples: [
            { label: "travel", atMs: 150 },
            { label: "impact", atMs: 700 },
            { label: "after-effect", atMs: 2200 },
          ],
        },
        {
          skill: "Soul Strike",
          aegisName: "MG_SOULSTRIKE",
          kind: "impact",
          opts: { hits: 5, damage: 2000 },
          samples: [
            { label: "travel", atMs: 150 },
            { label: "impact", atMs: 700 },
            { label: "after-effect", atMs: 2200 },
          ],
        },
        {
          skill: "Fire Lance",
          aegisName: "MG_FIREBOLT",
          kind: "impact",
          opts: { hits: 5, damage: 2000 },
          castNote: "cast migrado pra GPU 2026-08-19 (fire_lance_cast_gpu) — não medido nesta fase (só kind:impact), mas não é mais DOM",
          samples: [
            { label: "travel", atMs: 150 },
            { label: "impact", atMs: 600 },
            { label: "after-effect", atMs: 1800 },
          ],
        },
        {
          skill: "Light Bolt",
          aegisName: "MG_LIGHTNINGBOLT",
          kind: "impact",
          opts: { hits: 5, damage: 2000 },
          samples: [
            { label: "travel", atMs: 150 },
            { label: "impact", atMs: 700 },
            { label: "after-effect", atMs: 2200 },
          ],
        },
        {
          skill: "Frost Diver",
          aegisName: "MG_FROSTDIVER",
          kind: "impact",
          opts: { damage: 2000 },
          samples: [
            { label: "travel", atMs: 150 },
            { label: "impact", atMs: 650 },
            { label: "after-effect", atMs: 1300 },
          ],
        },
        {
          skill: "Stone Curse",
          aegisName: "MG_STONECURSE",
          kind: "impact",
          opts: { damage: 0 },
          samples: [
            { label: "travel", atMs: 120 },
            { label: "impact", atMs: 450 },
            { label: "after-effect", atMs: 900 },
          ],
        },
        {
          skill: "Ghost Dome",
          aegisName: "MG_SAFETYWALL",
          kind: "area",
          samples: [
            { label: "cast", atMs: 150 },
            { label: "after-effect", atMs: 1000 },
          ],
        },
      ];

      for (const target of targets) {
        const idx = scenarios.findIndex((s) => s.aegisName === target.aegisName && s.kind === target.kind);
        if (idx === -1) {
          console.warn(`[vfx-bench] cenário ${target.skill} não encontrado — pulado.`);
          continue;
        }
        process.stdout.write(`  [BM] ${target.skill}${target.castNote ? " (nota: " + target.castNote + ")" : ""}...\n`);
        await page.evaluate(
          ({ n, arr }) => (window as unknown as { __vfxBench: { reset: (c: number, a: BenchArrangement) => void } }).__vfxBench.reset(n, arr),
          { n: 1, arr: "tight" as BenchArrangement },
        );
        await settle(page, 150);
        const before = await snapshotDom(page);

        await page.evaluate(
          ({ i, s, opts }) =>
            (window as unknown as { __vfxBench: { spawnRealistic: (idx: number, slot: number, opts?: unknown) => number } }).__vfxBench.spawnRealistic(
              i,
              s,
              opts,
            ),
          { i: idx, s: 0, opts: target.opts },
        );

        const samples: AuditSample[] = [];
        let maxAnimations = 0;
        let elapsed = 0;
        for (const s of target.samples) {
          const waitMs = Math.max(0, s.atMs - elapsed);
          if (waitMs > 0) await settle(page, waitMs);
          elapsed = s.atMs;
          const after = await snapshotDom(page);
          const animCount = await activeAnimationCountPage(page);
          maxAnimations = Math.max(maxAnimations, animCount);
          samples.push({ label: s.label, atMs: s.atMs, added: diffByMultiset(before, after) });
        }
        phaseBM.push({ skill: target.skill, aegisName: target.aegisName, samples, maxAnimations });

        // relatório por skill, na hora — tabela fica gigante pra imprimir
        // tudo no fim, melhor ver skill a skill enquanto roda.
        let totalDom = 0;
        let domVfx = 0;
        let domUi = 0;
        const originsSeen = new Set<string>();
        for (const s of samples) {
          for (const a of s.added) {
            totalDom += a.count;
            const { origin, category } = classify(a.node.className);
            if (category === "damage-ui") domUi += a.count;
            else if (category === "vfx-dom-layer" || category === "vfx-dom-legacy" || category === "unknown") domVfx += a.count;
            originsSeen.add(`${category === "unknown" ? "❓" : category === "vfx-dom-legacy" ? "⚠️ " : ""}${origin}`);
          }
        }
        console.log(`    DOM total=${totalDom} | DOM VFX=${domVfx} | DOM UI=${domUi} | animações(pico)=${maxAnimations}`);
        for (const o of originsSeen) console.log(`      origem: ${o}`);
        for (const s of samples) {
          if (s.added.length === 0) continue;
          console.log(`      [${s.label}@${s.atMs}ms]`);
          for (const a of s.added) {
            const flags = [
              a.node.filter && "filter",
              a.node.boxShadow && "box-shadow",
              a.node.textShadow && "text-shadow",
              a.node.clipPath && "clip-path",
              a.node.hasCssAnimation && "animation",
              a.node.hasTransition && "transition",
              a.node.opacityAnimated && "opacity-anim",
              a.node.transformAnimated && "transform-anim",
            ]
              .filter(Boolean)
              .join(",");
            console.log(`        ${a.count}× <${a.node.tag} class="${a.node.className}"> [${flags || "sem custo de raster"}]`);
          }
        }

        await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
        await settle(page, 300);
      }
    }

    // Fase BN: teste 2 do pedido — "GPU + DOM atual" vs "GPU + DOM VFX
    // desabilitado", pra determinar se o resíduo DOM (a camada `dom` dos
    // números por hit, ver Fase BM) é REALMENTE responsável por alguma
    // diferença de performance, ou só está lá porque números de dano têm
    // que ficar em algum lugar. Cold Bolt como REPRESENTANTE das 5 skills
    // com essa camada (Cold Bolt/Thunder Storm/Soul Strike/Fire Lance/
    // Light Bolt) — mesma arquitetura idêntica nas 5 (mesmo padrão
    // `<skill>DamageDomArt.tsx`), generalizar sem repetir 5× é razoável
    // aqui (não é "otimização nova", é ISOLAR a mesma variável já medida).
    // Registro da variante "sem números" é só NESTE processo do bench via
    // `defineVfx` direto (nunca toca o arquivo de produção).
    const phaseBN: (ScaleResult & { mode: string })[] = [];
    if (runBN) {
      console.log("[vfx-bench] Fase BN: Cold Bolt GPU+DOM-atual vs GPU+DOM-VFX-desabilitado, 1/5/10/20/30 tight.");
      const coldBoltIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "impact");
      if (coldBoltIdx === -1) {
        console.warn("[vfx-bench] cenário Cold Bolt não encontrado — Fase BN pulada.");
      } else {
        await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("gpu"));

        for (const variant of ["com-numeros", "sem-numeros"] as const) {
          if (variant === "sem-numeros") {
            // registra a MESMA VfxDefinition, só sem a última camada (`dom`)
            // — direto no registro do processo do bench, nunca no arquivo
            // de produção. Confirma se REMOVER a camada muda o fps.
            await page.evaluate(() => {
              const w = window as unknown as {
                __coldBoltDiag?: { defineVfx: (def: unknown) => void; def: { layers: unknown[] } & Record<string, unknown> };
              };
              if (!w.__coldBoltDiag) return;
              const { defineVfx, def } = w.__coldBoltDiag;
              defineVfx({ ...def, layers: def.layers.slice(0, -1) });
            });
          }
          for (const n of scalePlayerLevels) {
            process.stdout.write(`  [BN] ${variant} × ${n}...\n`);
            const r = await measureScale(page, cdp, n, "tight", () => spawnSingleAllPlayers(page, coldBoltIdx), 800, true, `coldbolt-${variant}`);
            phaseBN.push({ ...r, mode: variant });
            console.log(`    ${fmtScale(r)}`);
          }
        }

        await page.evaluate(() => (window as unknown as { __coldBoltRenderBench: { set: (mode: string) => void } }).__coldBoltRenderBench.set("dom"));
      }
    }

    const phaseP: (ControlResult & { skill: string })[] = [];
    if (runP) {
      console.log("[vfx-bench] Fase P: isolamento Fire Wall / Thunder Storm (mesma matriz da Fase O, sem alterar fix/culling/renderer).");
      const fireWallIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREWALL" && s.kind === "area");
      const thunderIdx = scenarios.findIndex((s) => s.aegisName === "MG_THUNDERSTORM" && s.kind === "impact");
      const targets: { name: string; idx: number }[] = [
        { name: "Fire Wall", idx: fireWallIdx },
        { name: "Thunder Storm", idx: thunderIdx },
      ];
      for (const t of targets) {
        if (t.idx === -1) {
          console.warn(`[vfx-bench] cenário "${t.name}" não encontrado — pulado.`);
          continue;
        }
        for (const arr of ["offscreen", "tight"] as BenchArrangement[]) {
          process.stdout.write(`  [P] ${t.name}/${arr} × 30...\n`);
          const r = await measureControl(page, cdp, 30, arr, t.idx, true, `${t.name}/${arr}`);
          phaseP.push({ ...r, skill: t.name });
          console.log(`    ${fmtWindow(r.steady)}`);
        }
      }
    }

    const runCss = !onlyPhase || onlyPhase === "CSS";
    const css: CssMatrixResult[] = [];
    if (runCss) {
      console.log("[vfx-bench] matriz CSS sintética (text-shadow × N camadas, blur × intensidade)...");
      css.push(...(await cssMatrix(page, cdp)));
      for (const c of css) {
        console.log(`  [CSS] ${c.name}: paint=${c.trace.paintMs?.toFixed(1)}ms raster=${c.trace.rasterMs?.toFixed(1)}ms recalc=${c.trace.recalcStyleMs?.toFixed(1)}ms`);
      }
    }

    await browser.close();

    const out = {
      label: RUN_LABEL,
      generatedAt: new Date().toISOString(),
      chrome: "chromium (playwright, headless=" + HEADLESS + ")",
      phaseA,
      phaseB,
      phaseC,
      phaseD,
      phaseE,
      phaseF,
      phaseG,
      phaseH,
      phaseI,
      phaseJ,
      phaseKDom,
      phaseKControls,
      phaseKCurve,
      phaseL,
      phaseM,
      phaseN,
      phaseO,
      phaseOCurve,
      phaseP,
      phaseQ,
      phaseR,
      phaseS,
      phaseSBaseline,
      phaseTSync,
      phaseU,
      phaseUOffscreen,
      phaseV,
      phaseVConfirm,
      phaseW,
      phaseWConfirm,
      phaseX,
      phaseYVisual,
      phaseY,
      phaseYFragCount,
      phaseAA,
      phaseAADecomp,
      phaseAB,
      phaseAC,
      phaseAD,
      phaseAE,
      phaseAF,
      phaseAG,
      phaseAH,
      phaseAI,
      phaseAJ,
      phaseAK,
      phaseAL,
      phaseAM,
      phaseAN,
      phaseAO,
      phaseAP,
      phaseAQ,
      phaseAR,
      phaseAS,
      phaseAT,
      phaseAU,
      phaseAV,
      phaseAW,
      phaseAX,
      phaseAY,
      phaseAZ,
      phaseBA,
      phaseBB,
      phaseBC,
      phaseBD,
      phaseBE,
      phaseBF,
      phaseBG,
      phaseBH,
      phaseBI,
      phaseBJ,
      phaseBK,
      phaseBM,
      phaseBN,
      cssMatrix: css,
    };
    const file = path.join(OUT_DIR, `${RUN_LABEL}.json`);
    writeFileSync(file, JSON.stringify(out, null, 2));
    writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify(out, null, 2));
    console.log(`[vfx-bench] resultado salvo em ${file}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
