/**
 * `pnpm --filter @ragnarok/game vfx:benchmark:lightbolt` (ou
 * `VFX_BENCH_HEADED=1 npx tsx scripts/vfxBenchmarkLightBolt.ts` direto de
 * `apps/game`) — benchmark DEDICADO de Eletrocutar/Light Bolt
 * (reconstrução 2026-08-19-f), MESMO padrão de `vfxBenchmarkFireLance.ts`/
 * `vfxBenchmarkColdBolt.ts` (ver aquele arquivo pro raciocínio completo,
 * não duplicado aqui): raios elétricos caindo na cabeça do alvo, per-hit
 * driver próprio, tracking ao vivo.
 *
 * Porta PRÓPRIA (3096, nunca 3097/3098/3099 — Cold Bolt/Fire Lance/
 * benchmark principal).
 *
 * Exercita o CAMINHO REAL: `__vfxBench.spawnLightBoltHitsAll({hits,tier})`
 * chama `vfx/mage/light-bolt/lightBoltMultiHit.ts: spawnLightBoltHits` —
 * o MESMO driver que `net/useWorldEvents.ts` chama num pacote `skill:cast`
 * de verdade.
 */
import { chromium, type CDPSession, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3096;
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

const PLAYER_LEVELS = process.env.VFX_BENCH_PLAYERS
  ? process.env.VFX_BENCH_PLAYERS.split(",").map((s) => Number(s.trim()))
  : [1, 5, 10, 20, 30, 50];
const SCENARIOS: Scenario[] = ["baseline", "low", "medium", "high"];
/** pior caso real: skill no nível máximo (10 hits, `LIGHT_BOLT_MAX_HITS`). */
const HITS_PER_CAST = 10;
/** janela de medição: cobre a cascata inteira de 10 hits staggered
 * (`LIGHT_BOLT_STAGGER_MS=170` × 9 + `LIGHTNING_FALL_MS=260` do último hit
 * + burst/tail) com folga. */
const MEASURE_WINDOW_MS = 2400;
const PEAK_SAMPLE_DELAY_MS = 900;

interface LightBoltResult {
  scenario: Scenario;
  players: number;
  perf: PerfSnapshot;
  cullPeak: CullStats;
  domNodesDelta: number;
  heapDeltaMb: number;
}

async function measure(page: Page, cdp: CDPSession, players: number, scenario: Scenario, castScenarioIdx: number): Promise<LightBoltResult> {
  await page.evaluate((n) => (window as unknown as { __vfxBench: { reset: (c: number, a?: string) => void } }).__vfxBench.reset(n, "spread"), players);
  await settle(page, 150);
  await collectGarbage(cdp);
  const domBefore = await domNodeCount(page);
  const metricsBeforeRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsBefore = metricsToMap(metricsBeforeRaw.metrics);

  await resetFrameStats(page);
  if (scenario !== "baseline") {
    await page.evaluate(
      (t) => (window as unknown as { __lightBoltRenderBench: { setTier: (t: Tier) => void } }).__lightBoltRenderBench.setTier(t),
      scenario,
    );
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
            __vfxBench: { spawnLightBoltHitsAll: (o: { hits: number; tier: Tier }) => void };
          }
        ).__vfxBench.spawnLightBoltHitsAll({ hits, tier }),
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

function fmt(r: LightBoltResult): string {
  return `fps=${r.perf.fps.toFixed(0)} frame(avg/p50/p95/p99)=${r.perf.frameTimeMs.toFixed(1)}/${r.perf.p50Ms.toFixed(1)}/${r.perf.p95Ms.toFixed(1)}/${r.perf.p99Ms.toFixed(1)}ms(n=${r.perf.sampleCount}) drawCalls=${r.perf.drawCalls} tris=${r.perf.triangles} vfxAtivosPico=${r.cullPeak.active} domNodes=${r.domNodesDelta} heapMb=${r.heapDeltaMb.toFixed(1)}`;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);

  console.log(`[light-bolt-bench] subindo vite dev em :${PORT}... (headless=${HEADLESS})`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");

    console.log("[light-bolt-bench] abrindo /vfx-bench...");
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
    const castScenarioIdx = scenarios.findIndex((s) => s.aegisName === "MG_LIGHTNINGBOLT" && s.kind === "cast");
    if (castScenarioIdx === -1) {
      console.warn("[light-bolt-bench] cenário 'Light Bolt — cast' não encontrado — rodando SEM cast (só projétil/impact).");
    }

    const results: LightBoltResult[] = [];
    for (const players of PLAYER_LEVELS) {
      for (const scenario of SCENARIOS) {
        process.stdout.write(`  [${scenario}] ${players} players... `);
        const r = await measure(page, cdp, players, scenario, castScenarioIdx);
        results.push(r);
        console.log(fmt(r));
      }
    }

    await browser.close();

    const outFile = path.join(OUT_DIR, `light-bolt-${RUN_LABEL}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`[light-bolt-bench] resultados em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
