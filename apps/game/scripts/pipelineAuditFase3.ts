/**
 * FASE 3 — investigação dos contextos WebGL extra dos retratos do HUD
 * (achado F2-4/F2-5 da Fase 2). Instrumentação/diagnóstico apenas — não
 * altera nenhum arquivo de produção, não otimiza nada. Script separado da
 * Fase 1/2 de propósito (mesma convenção do projeto).
 *
 * `pnpm --filter @ragnarok/game exec tsx scripts/pipelineAuditFase3.ts`
 *
 * Usa DUAS fontes de evidência:
 *  1. A instrumentação de produção já existente (`window.__voo`,
 *     `core/diagnostics/rendererProbe.ts`'s eventos `contexto-criado`/
 *     `canvas-criado`/`renderer-criado`/`contexto-perdido`, coluna
 *     `contextosVivos`).
 *  2. Um monkey-patch de diagnóstico próprio (`page.addInitScript`, nunca
 *     toca código do jogo) em `HTMLCanvasElement.prototype.getContext` +
 *     `WebGLRenderingContext.prototype.clear` — cada `clear()` é 1 proxy de
 *     "houve um render()" naquele contexto (three.js limpa o framebuffer no
 *     início de `WebGLRenderer.render()` por padrão), o que dá a TAXA REAL
 *     de render por contexto sem tocar em nada do jogo.
 */
import { chromium, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3096;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "pipeline-audit-results");
const HEADLESS = process.env.PIPELINE_AUDIT_HEADED === "0";

const SQUARE_SIZE = 2.0;
function squareToWorld(col: number, row: number) {
  return { x: (col + 0.5) * SQUARE_SIZE, z: (row + 0.5) * SQUARE_SIZE };
}

function buildMap(mobCount: number, size = 40) {
  const W = size;
  const H = size;
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  const collision = new Array(n).fill("walkable");
  const idx = (c: number, r: number) => r * W + c;
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);
  const spawns: unknown[] = [];
  const { x: px, z: pz } = squareToWorld(cx, cy + 8);
  spawns.push({ id: "player_start", kind: "player_start", position: [px, 0, pz] });
  const mobRefs = ["skeleton_warrior", "skeleton_minion"];
  const cols = Math.ceil(Math.sqrt(Math.max(1, mobCount)));
  const spacing = 3;
  for (let i = 0; i < mobCount; i++) {
    const col = cx - Math.floor((cols * spacing) / 2) + (i % cols) * spacing;
    const row = cy - Math.floor((cols * spacing) / 2) + Math.floor(i / cols) * spacing;
    if (col < 2 || col >= W - 2 || row < 2 || row >= H - 2) continue;
    const { x, z } = squareToWorld(col, row);
    spawns.push({ id: `mob_${i}`, kind: "mob", refId: mobRefs[i % mobRefs.length], position: [x, 0, z] });
  }
  return {
    id: "pipeline-audit-f3",
    name: "pipeline-audit-f3",
    size: { width: W, height: H },
    cellSize: SQUARE_SIZE,
    terrainMode: "square",
    heightmap,
    collision,
    surface: [],
    terrainStyle: {},
    waterLevel: null,
    props: [],
    spawns,
    triggers: [],
    ramps: [],
    authoredHexScale: 1,
    lighting: { sunAzimuth: 40, sunElevation: 55, sunIntensity: 1.2, ambient: 0.75 },
    sky: { skyId: "day" },
    ambientParticles: [],
    metadata: { version: 1, generatedAt: new Date(0).toISOString() },
  };
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {
      /* servidor ainda não subiu */
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
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
}
async function freePort(port: number): Promise<void> {
  if (process.platform !== "win32") return;
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: "utf8" });
    const pids = new Set(out.split("\n").map((l) => l.trim().split(/\s+/).pop()).filter(Boolean));
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } catch {
        /* já morto */
      }
    }
  } catch {
    /* porta livre */
  }
}

/** monkey-patch de DIAGNÓSTICO (nunca produção): intercepta toda criação de
 * contexto WebGL do documento + conta `clear()` por contexto como proxy de
 * "um render() aconteceu". Instalado ANTES de qualquer script da página. */
/**
 * String JS pura (não função TS) de propósito: `page.addInitScript(fn)`
 * serializa a função via `.toString()`, e o esbuild do tsx injeta um helper
 * `__name(...)` no módulo compilado que não existe isolado na página —
 * `ReferenceError: __name is not defined`. Passando string crua, o
 * Playwright injeta como `<script>` direto, sem passar pelo `.toString()`
 * de uma função compilada.
 */
const CONTEXT_TRACKER_SRC = `
(function () {
  try {
    var registry = [];
    var nextId = 1;
    var origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type) {
      var ctx = origGetContext.apply(this, arguments);
      if (ctx && (type === "webgl" || type === "webgl2") && !ctx.__f3id) {
        var info = {
          id: nextId++,
          type: type,
          canvasW: this.width,
          canvasH: this.height,
          createdAt: performance.now(),
          clearTimestamps: [],
          lost: false,
          lostAt: null,
        };
        ctx.__f3id = info.id;
        registry.push(info);
        this.addEventListener("webglcontextlost", function () {
          info.lost = true;
          info.lostAt = performance.now();
        });
        var origClear = ctx.clear.bind(ctx);
        ctx.clear = function (mask) {
          info.clearTimestamps.push(performance.now());
          if (info.clearTimestamps.length > 4000) info.clearTimestamps.splice(0, 2000);
          return origClear(mask);
        };
      }
      return ctx;
    };
    window.__f3ctxErr = "patch instalado ok";
    window.__f3ctx = {
      list: function () { return registry; },
      summary: function () {
        var now = performance.now();
        return registry.map(function (r) {
          var recentes = r.clearTimestamps.filter(function (t) { return now - t < 3000; });
          return {
            id: r.id,
            type: r.type,
            canvas: r.canvasW + "x" + r.canvasH,
            idadeMs: Math.round(now - r.createdAt),
            lost: r.lost,
            clearsTotal: r.clearTimestamps.length,
            clearsUltimos3s: recentes.length,
            taxaHz: Math.round((recentes.length / 3) * 10) / 10,
          };
        });
      },
    };
  } catch (e) {
    window.__f3ctxErr = String(e) + (e && e.stack ? " | " + e.stack : "");
  }
})();
`;

async function installContextTracker(page: Page): Promise<void> {
  await page.addInitScript(CONTEXT_TRACKER_SRC);
}

interface Snapshot {
  label: string;
  mobCount: number;
  voo: { contextosVivos?: { p50: number }; drawCalls?: { p50: number } };
  ctxSummary: unknown[];
  eventosRenderer: unknown[];
}

async function gotoScenario(page: Page, mobCount: number, size = 40): Promise<void> {
  const map = buildMap(mobCount, size);
  await page.goto(`${BASE_URL}/play?preview=1&iso=`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof (window as unknown as { __gl?: unknown }).__gl === "function", { timeout: 15000 });
  await page.evaluate((m) => window.postMessage({ type: "ragnarok:preview-map", map: m }, "*"), map);
}

async function measure(page: Page, label: string, mobCount: number): Promise<Snapshot> {
  await page.bringToFront();
  await page.waitForTimeout(6000); // curtain + warmup completos
  const voo = (await page.evaluate(() => (window as unknown as { __voo: { json: () => { resumo: Record<string, { p50: number }> } } }).__voo.json())) as {
    resumo: { contextosVivos?: { p50: number }; drawCalls?: { p50: number } };
    eventos: { cat: string; tipo: string }[];
  };
  const errCheck = await page.evaluate(() => (window as unknown as { __f3ctxErr?: unknown }).__f3ctxErr);
  console.log(`  __f3ctxErr=${errCheck}`);
  const ctxSummary = await page.evaluate(() => (window as unknown as { __f3ctx: { summary: () => unknown[] } }).__f3ctx.summary());
  const eventosRenderer = voo.eventos.filter((e) => e.cat === "renderer" || (e.cat === "cena" && e.tipo.startsWith("montou")));
  console.log(`  [${label}] contextosVivos=${voo.resumo.contextosVivos?.p50} contexts=${JSON.stringify(ctxSummary)}`);
  return { label, mobCount, voo: voo.resumo, ctxSummary, eventosRenderer };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);
  console.log(`[fase3] subindo vite dev em :${PORT}...`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  const out: Record<string, unknown> = {};

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await installContextTracker(page);
    console.log(`[fase3] headless=${HEADLESS}`);

    // ---- A. curva de contextos por N (mapa NÃO isolado — comportamento real) ----
    console.log("[fase3] Parte A — curva de contextos por N");
    const curva: Snapshot[] = [];
    for (const n of [0, 1, 5, 10, 20, 30, 50, 100]) {
      await gotoScenario(page, n);
      curva.push(await measure(page, `N=${n}`, n));
    }
    out.curvaContextos = curva;

    // ---- B. taxa de render por contexto (24Hz esperado nos retratos) ----
    console.log("[fase3] Parte B — taxa de render por contexto, sessão parada (N=5)");
    await gotoScenario(page, 5);
    await page.waitForTimeout(8000);
    await page.bringToFront();
    await page.waitForTimeout(4000);
    const taxas = await page.evaluate(() => (window as unknown as { __f3ctx: { summary: () => unknown[] } }).__f3ctx.summary());
    console.log("  taxas:", JSON.stringify(taxas));
    out.taxaPorContexto = taxas;

    // ---- C. timing exato: retrato nasce atrás da cortina? ----
    console.log("[fase3] Parte C — timing de criação vs cortina (caso completo)");
    await gotoScenario(page, 5);
    await page.waitForTimeout(200);
    // dispara captura manual bem cedo pra pegar toda a sequência de warmup na janela
    await page.evaluate(() => (window as unknown as { __voo: { capturar: (m: string) => void } }).__voo.capturar("manual"));
    await page.waitForTimeout(6000);
    const dump = (await page.evaluate(() => (window as unknown as { __voo: { json: () => unknown } }).__voo.json())) as {
      casos: { eventos: { cat: string; tipo: string; quadro: number; t: number; dados?: unknown }[]; quadros: Record<string, number[]> }[];
    };
    const caso = dump.casos[dump.casos.length - 1];
    const relevantes = (caso?.eventos ?? []).filter(
      (e) => (e.cat === "renderer" && ["contexto-criado", "canvas-criado", "renderer-criado"].includes(e.tipo)) || (e.cat === "cena" && (e.tipo.startsWith("montou") || e.tipo === "shader:compile-entidade")),
    );
    const linhas = relevantes.map((e) => {
      const idx = caso?.quadros.quadro?.indexOf(e.quadro) ?? -1;
      const sceneVisivel = idx >= 0 ? caso?.quadros.sceneVisivel?.[idx] : undefined;
      const quadroMs = idx >= 0 ? caso?.quadros.quadroMs?.[idx] : undefined;
      const programas = idx >= 0 ? caso?.quadros.programas?.[idx] : undefined;
      return { t: e.t, cat: e.cat, tipo: e.tipo, quadro: e.quadro, dados: e.dados, sceneVisivel, quadroMs, programas };
    });
    console.log("  timeline curtain-vs-contexto:", JSON.stringify(linhas, null, 1));
    out.timingCortina = linhas;

    await browser.close();
    const outFile = path.join(OUT_DIR, `fase3-result-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`[fase3] resultado salvo em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
