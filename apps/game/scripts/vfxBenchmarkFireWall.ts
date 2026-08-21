/**
 * `pnpm --filter @ragnarok/game vfx:benchmark:firewall` (ou
 * `VFX_BENCH_HEADED=1 npx tsx scripts/vfxBenchmarkFireWall.ts` direto de
 * `apps/game`) — benchmark DEDICADO da reconstrução visual de Fire Wall
 * (tiers + brasas + brilho de chão + `idleFlicker`), MESMO padrão de
 * `vfxBenchmarkFireBall.ts` (ver aquele arquivo pro raciocínio completo do
 * harness, não duplicado aqui).
 *
 * Porta PRÓPRIA (3093, nunca 3094-3099 — Soul Strike/Fire Ball/Light Bolt/
 * Cold Bolt/Fire Lance/benchmark principal).
 *
 * Diferente de Fire Ball: Fire Wall é ÁREA PERSISTENTE de N CÉLULAS (3 ou 5,
 * decididas pelo servidor — linha reta ou diagonal), não um projétil de 1
 * instância. O cenário real a medir não é "1 spawn por player" e sim
 * "W paredes simultâneas × C células cada" — usa `__vfxBench.spawnAreaLine`
 * (já existente, usado hoje pelos combos `wallsAndOracle`/`chaotic`), uma
 * chamada por parede, cada uma na posição do SEU próprio "jogador" (slot),
 * pra nunca empilhar todas as paredes numa célula só — o pedido original
 * (item 19) quer "N players cada um conjurando uma Fire Wall", não N cópias
 * na mesma posição.
 */
import { chromium, type CDPSession, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3093;
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

const WALL_COUNTS = process.env.VFX_BENCH_WALLS
  ? process.env.VFX_BENCH_WALLS.split(",").map((s) => Number(s.trim()))
  : [1, 5, 10, 20, 30];
/** 3 = layout diagonal, 5 = layout reto — os dois tamanhos REAIS de Fire
 * Wall (`unit.layout:-1` do rAthena), nunca um número arbitrário. */
const CELL_COUNTS = [3, 5];
const TIERS: Tier[] = ["low", "medium", "high"];
/** janela de estado ESTÁVEL — Fire Wall é área persistente, o custo que
 * importa é "manter N paredes queimando", não um pico de spawn. */
const STEADY_WINDOW_MS = 1500;
/** tempo pra deixar o burst de spawn (mount de N×C instâncias) assentar
 * antes de medir estado estável. */
const SETTLE_AFTER_SPAWN_MS = 400;

interface FireWallResult {
  tier: Tier;
  walls: number;
  cellsPerWall: number;
  totalCells: number;
  perf: PerfSnapshot;
  cullSteady: CullStats;
  domNodesDelta: number;
  heapDeltaMb: number;
}

async function measure(
  page: Page,
  cdp: CDPSession,
  fireWallAreaIdx: number,
  walls: number,
  cellsPerWall: number,
  tier: Tier,
): Promise<FireWallResult> {
  await page.evaluate((n) => (window as unknown as { __vfxBench: { reset: (c: number, a?: string) => void } }).__vfxBench.reset(n, "spread"), walls);
  await settle(page, 150);
  await collectGarbage(cdp);
  const domBefore = await domNodeCount(page);
  const metricsBeforeRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsBefore = metricsToMap(metricsBeforeRaw.metrics);

  await page.evaluate(
    (t) => (window as unknown as { __fireWallRenderBench: { setTier: (t: Tier) => void } }).__fireWallRenderBench.setTier(t),
    tier,
  );

  // uma parede por "jogador" (slot) — nunca empilhadas na mesma posição
  // (item 19 do pedido: "N players, cada um criando Fire Wall").
  await page.evaluate(
    ({ idx, w, c }) => {
      const api = (window as unknown as { __vfxBench: { spawnAreaLine: (i: number, slot: number, cellCount: number) => number[] } }).__vfxBench;
      for (let slot = 0; slot < w; slot++) api.spawnAreaLine(idx, slot, c);
    },
    { idx: fireWallAreaIdx, w: walls, c: cellsPerWall },
  );
  await settle(page, SETTLE_AFTER_SPAWN_MS);

  await resetFrameStats(page);
  await settle(page, STEADY_WINDOW_MS);
  const cullSteady = await cullStats(page);
  const perf = await perfSnapshot(page);

  const metricsAfterRaw = (await cdp.send("Performance.getMetrics")) as { metrics: CdpMetric[] };
  const metricsAfter = metricsToMap(metricsAfterRaw.metrics);
  const heapDeltaMb = ((metricsAfter.JSHeapUsedSize ?? 0) - (metricsBefore.JSHeapUsedSize ?? 0)) / (1024 * 1024);

  const domDuring = await domNodeCount(page);

  await page.evaluate(() => (window as unknown as { __vfxBench: { clear: () => void } }).__vfxBench.clear());
  await settle(page, 250);
  await collectGarbage(cdp);

  return {
    tier,
    walls,
    cellsPerWall,
    totalCells: walls * cellsPerWall,
    perf,
    cullSteady,
    domNodesDelta: domDuring - domBefore,
    heapDeltaMb,
  };
}

function fmt(r: FireWallResult): string {
  return `fps=${r.perf.fps.toFixed(0)} frame(avg/p50/p95/p99)=${r.perf.frameTimeMs.toFixed(1)}/${r.perf.p50Ms.toFixed(1)}/${r.perf.p95Ms.toFixed(1)}/${r.perf.p99Ms.toFixed(1)}ms(n=${r.perf.sampleCount}) drawCalls=${r.perf.drawCalls} tris=${r.perf.triangles} vfxAtivas=${r.cullSteady.active} culled=${r.cullSteady.culled} domNodes=${r.domNodesDelta} heapMb=${r.heapDeltaMb.toFixed(1)}`;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);

  console.log(`[fire-wall-bench] subindo vite dev em :${PORT}... (headless=${HEADLESS})`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");

    console.log("[fire-wall-bench] abrindo /vfx-bench...");
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
    const fireWallAreaIdx = scenarios.findIndex((s) => s.aegisName === "MG_FIREWALL" && s.kind === "area");
    if (fireWallAreaIdx === -1) throw new Error("cenário 'Fire Wall — area cell' não encontrado em BENCH_SKILLS");

    const results: FireWallResult[] = [];
    for (const cellsPerWall of CELL_COUNTS) {
      for (const walls of WALL_COUNTS) {
        for (const tier of TIERS) {
          process.stdout.write(`  [${tier}] ${walls} paredes × ${cellsPerWall} células (${walls * cellsPerWall} total)... `);
          const r = await measure(page, cdp, fireWallAreaIdx, walls, cellsPerWall, tier);
          results.push(r);
          console.log(fmt(r));
        }
      }
    }

    await browser.close();

    const outFile = path.join(OUT_DIR, `fire-wall-${RUN_LABEL}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`[fire-wall-bench] resultados em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
