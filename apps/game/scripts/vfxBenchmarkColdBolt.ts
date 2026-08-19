/**
 * `pnpm --filter @ragnarok/game vfx:benchmark:coldbolt` (ou
 * `VFX_BENCH_HEADED=1 npx tsx scripts/vfxBenchmarkColdBolt.ts` direto de
 * `apps/game`) — benchmark DEDICADO da reconstrução Cold Bolt 2026-08-19-d,
 * MESMO padrão de `vfxBenchmarkFireLance.ts` (ver aquele arquivo pro
 * raciocínio completo — não duplicado aqui): losango de gelo grande +
 * stretch GPU + trail + burst de impacto tier-específico, per-hit driver
 * próprio, cast com crescimento+pulso na ponta do cajado.
 *
 * Porta PRÓPRIA (3097, nunca 3098/3099 — Fire Lance/benchmark principal)
 * pra poder rodar em paralelo ou isolado sem interferir nos outros dois.
 *
 * Exercita o CAMINHO REAL: `__vfxBench.spawnColdBoltHitsAll({hits,tier})`
 * chama `vfx/mage/cold-bolt/coldBoltMultiHit.ts: spawnColdBoltHits` — o
 * MESMO driver que `net/useWorldEvents.ts` chama num pacote `skill:cast`
 * de verdade.
 *
 * `VFX_BENCH_HEADED=1` é OBRIGATÓRIO pra qualquer conclusão de fps/frame
 * time absoluto (mesma regra de sempre).
 */
import { chromium, type CDPSession, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3097;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "vfx-bench-results");
const HEADLESS = process.env.VFX_BENCH_HEADED !== "1";
const RUN_LABEL = process.env.VFX_BENCH_LABEL ?? "run";

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

function killViteTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}

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

async function settle(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

async function collectGarbage(cdp: CDPSession): Promise<void> {
  try {
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
  } catch {
    // best-effort
  }
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
interface CdpMetric {
  name: string;
  value: number;
}
function metricsToMap(metrics: CdpMetric[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of metrics) m[e.name] = e.value;
  return m;
}

async function perfSnapshot(page: Page): Promise<PerfSnapshot> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { perfSnapshot: () => PerfSnapshot } }).__vfxBench.perfSnapshot());
}
async function resetFrameStats(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __vfxBench: { resetFrameStats: () => void } }).__vfxBench.resetFrameStats());
}
async function cullStats(page: Page): Promise<CullStats> {
  return page.evaluate(() => (window as unknown as { __vfxBench: { cullStats: () => CullStats } }).__vfxBench.cullStats());
}

type Tier = "low" | "medium" | "high";
type Scenario = "baseline" | Tier;

/** `VFX_BENCH_PLAYERS=1,10,30,50` roda só esses níveis. */
const PLAYER_LEVELS = process.env.VFX_BENCH_PLAYERS
  ? process.env.VFX_BENCH_PLAYERS.split(",").map((s) => Number(s.trim()))
  : [1, 5, 10, 20, 30, 50];
const SCENARIOS: Scenario[] = ["baseline", "low", "medium", "high"];
/** pior caso real: skill no nível máximo (10 hits, `ICICLE_MAX_HITS`). */
const HITS_PER_CAST = 10;
/** janela de medição: cobre a cascata INTEIRA de 10 hits staggered
 * (`ICICLE_STAGGER_MS=130` × 9 + `ICICLE_FALL_MS=560` do último hit +
 * ~300ms de burst/tail) com folga. */
const MEASURE_WINDOW_MS = 2800;

interface ColdBoltResult {
  scenario: Scenario;
  players: number;
  perf: PerfSnapshot;
  /** instâncias vivas no PICO — ver docblock equivalente em
   * `vfxBenchmarkFireLance.ts` (mesmo achado: ler no fim da janela mede o
   * resto morto, a cascata termina bem antes de `MEASURE_WINDOW_MS`). */
  cullPeak: CullStats;
  domNodesDelta: number;
  heapDeltaMb: number;
}

const PEAK_SAMPLE_DELAY_MS = 900;

async function measure(page: Page, cdp: CDPSession, players: number, scenario: Scenario, castScenarioIdx: number): Promise<ColdBoltResult> {
  await page.evaluate((n) => (window as unknown as { __vfxBench: { reset: (c: number, a?: string) => void } }).__vfxBench.reset(n, "spread"), players);
  await settle(page, 150);
  await collectGarbage(cdp);
  const domBefore = await domNodeCount(page);
  const metricsBeforeRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsBefore = metricsToMap(metricsBeforeRaw.metrics);

  await resetFrameStats(page);
  if (scenario !== "baseline") {
    // tier efetivo = override de dev (`window.__coldBoltRenderBench`, NUNCA
    // escreve na store persistida do jogador) — reaplica a receita do CAST
    // pro MESMO tier que o projétil/impact vão usar.
    await page.evaluate(
      (t) => (window as unknown as { __coldBoltRenderBench: { setTier: (t: Tier) => void } }).__coldBoltRenderBench.setTier(t),
      scenario,
    );
    // cast REAL (dispatch de produção), não um caminho especial de bench.
    if (castScenarioIdx >= 0) {
      await page.evaluate(
        (idx) => (window as unknown as { __vfxBench: { spawnAll: (i: number) => number[] } }).__vfxBench.spawnAll(idx),
        castScenarioIdx,
      );
    }
    await page.evaluate(
      ({ hits, tier }) =>
        (
          window as unknown as {
            __vfxBench: { spawnColdBoltHitsAll: (o: { hits: number; tier: Tier }) => void };
          }
        ).__vfxBench.spawnColdBoltHitsAll({ hits, tier }),
      { hits: HITS_PER_CAST, tier: scenario },
    );
  }

  await settle(page, PEAK_SAMPLE_DELAY_MS);
  const cullPeak = await cullStats(page);
  await settle(page, MEASURE_WINDOW_MS - PEAK_SAMPLE_DELAY_MS);

  const metricsAfterRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsAfter = metricsToMap(metricsAfterRaw.metrics);
  const heapDeltaMb = ((metricsAfter.JSHeapUsedSize ?? 0) - (metricsBefore.JSHeapUsedSize ?? 0)) / (1024 * 1024);

  const domDuring = await domNodeCount(page);
  const perf = await perfSnapshot(page);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);

  return { scenario, players, perf, cullPeak, domNodesDelta: domDuring - domBefore, heapDeltaMb };
}

function fmt(r: ColdBoltResult): string {
  return `fps=${r.perf.fps.toFixed(0)} frame(avg/p50/p95/p99)=${r.perf.frameTimeMs.toFixed(1)}/${r.perf.p50Ms.toFixed(1)}/${r.perf.p95Ms.toFixed(1)}/${r.perf.p99Ms.toFixed(1)}ms(n=${r.perf.sampleCount}) drawCalls=${r.perf.drawCalls} tris=${r.perf.triangles} vfxAtivosPico=${r.cullPeak.active} domNodes=${r.domNodesDelta} heapMb=${r.heapDeltaMb.toFixed(1)}`;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);

  console.log(`[cold-bolt-bench] subindo vite dev em :${PORT}... (headless=${HEADLESS})`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");

    console.log("[cold-bolt-bench] abrindo /vfx-bench...");
    await page.goto(`${BASE_URL}/vfx-bench`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as unknown as { __vfxBenchReady?: boolean }).__vfxBenchReady === true, {
      timeout: 15000,
    });
    await settle(page, 500);

    interface ScenarioDef {
      aegisName: string;
      kind: string;
      label: string;
    }
    const scenarios = (await page.evaluate(
      () => (window as unknown as { __vfxBench: { scenarios: ScenarioDef[] } }).__vfxBench.scenarios,
    )) as ScenarioDef[];
    const castScenarioIdx = scenarios.findIndex((s) => s.aegisName === "MG_COLDBOLT" && s.kind === "cast");
    if (castScenarioIdx === -1) {
      console.warn("[cold-bolt-bench] cenário 'Cold Bolt — cast' não encontrado — rodando SEM cast (só projétil/impact).");
    }

    const results: ColdBoltResult[] = [];
    for (const players of PLAYER_LEVELS) {
      for (const scenario of SCENARIOS) {
        process.stdout.write(`  [${scenario}] ${players} players... `);
        const r = await measure(page, cdp, players, scenario, castScenarioIdx);
        results.push(r);
        console.log(fmt(r));
      }
    }

    await browser.close();

    const outFile = path.join(OUT_DIR, `cold-bolt-${RUN_LABEL}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`[cold-bolt-bench] resultados em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
