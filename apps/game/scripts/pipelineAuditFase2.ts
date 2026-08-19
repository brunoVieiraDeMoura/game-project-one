/**
 * FASE 2 — decomposição do frame time (instrumentação/diagnóstico apenas).
 *
 * `pnpm --filter @ragnarok/game exec tsx scripts/pipelineAuditFase2.ts`
 *
 * NÃO altera nenhum arquivo de produção, não otimiza nada. Só orquestra
 * instrumentação que JÁ EXISTE no jogo (`window.__voo` — flight recorder,
 * `window.__gl`/`__scene` — PerfHud, `?iso=` — core/diagnostics/isolamento.ts)
 * via Chromium HEADED (GPU real) + CDP `Performance.getMetrics` (categorias
 * de browser: script/recalc-style/layout/task, independentes do instrumento
 * do próprio jogo, como checagem cruzada) + um hook mínimo de
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` (técnica padrão de profiling do React,
 * não um patch no código do jogo) para contar commits do React por segundo.
 *
 * Script separado do `pipelineAudit.ts` da Fase 1 de propósito — mesma
 * convenção do projeto (`vfx:benchmark` vs este), auxiliar de diagnóstico,
 * nunca código de produção.
 */
import { chromium, type Page, type CDPSession } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3097;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "pipeline-audit-results");
const HEADLESS = process.env.PIPELINE_AUDIT_HEADED === "0";

const SQUARE_SIZE = 2.0;
function squareToWorld(col: number, row: number) {
  return { x: (col + 0.5) * SQUARE_SIZE, z: (row + 0.5) * SQUARE_SIZE };
}

interface BuildOpts {
  mobCount: number;
  size?: number; // W=H, default 90
}

function buildMap(opts: BuildOpts) {
  const W = opts.size ?? 90;
  const H = W;
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  const collision = new Array(n).fill("walkable");
  const idx = (c: number, r: number) => r * W + c;
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);

  for (let r = -6; r <= 6; r++)
    for (let c = -6; c <= 6; c++) {
      const cc = cx + c;
      const rr = cy + r;
      if (cc < 0 || cc >= W || rr < 0 || rr >= H) continue;
      const d = Math.abs(c) + Math.abs(r);
      if (d <= 2) heightmap[idx(cc, rr)] = 3;
      else if (d <= 5) heightmap[idx(cc, rr)] = 2;
      else heightmap[idx(cc, rr)] = 1;
    }
  if (W > 20)
    for (let r = 5; r <= 12; r++)
      for (let c = 5; c <= 14; c++) {
        if (c < W && r < H) collision[idx(c, r)] = "water";
      }

  const props: unknown[] = [];
  if (W > 20) {
    const propKinds = ["tree_1_a", "tree_1_b", "tree_2_a", "rock_1_a", "rock_1_c", "bush_1_a", "bush_1_b"];
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 60; i++) {
      const col = Math.floor(rand() * (W - 10)) + 5;
      const row = Math.floor(rand() * (H - 10)) + 5;
      if (collision[idx(col, row)] === "water") continue;
      const { x, z } = squareToWorld(col, row);
      const level = heightmap[idx(col, row)] ?? 0;
      props.push({
        id: `p${i}`,
        assetId: propKinds[i % propKinds.length],
        position: [x, level, z],
        rotation: [0, rand() * Math.PI * 2, 0],
        scale: [1, 1, 1],
        colliderType: "none",
      });
    }
  }

  const spawns: unknown[] = [];
  const { x: px, z: pz } = squareToWorld(cx, cy + 8);
  spawns.push({ id: "player_start", kind: "player_start", position: [px, 0, pz] });

  const mobRefs = ["skeleton_warrior", "skeleton_minion"];
  const cols = Math.ceil(Math.sqrt(Math.max(1, opts.mobCount)));
  const spacing = 5;
  for (let i = 0; i < opts.mobCount; i++) {
    const col = cx - Math.floor((cols * spacing) / 2) + (i % cols) * spacing;
    const row = cy - Math.floor((cols * spacing) / 2) + Math.floor(i / cols) * spacing;
    if (col < 2 || col >= W - 2 || row < 2 || row >= H - 2) continue;
    if (collision[idx(col, row)] === "water") continue;
    const { x, z } = squareToWorld(col, row);
    spawns.push({
      id: `mob_${i}`,
      kind: "mob",
      refId: mobRefs[i % mobRefs.length],
      position: [x, heightmap[idx(col, row)] ?? 0, z],
    });
  }

  return {
    id: "pipeline-audit-f2",
    name: "pipeline-audit-f2",
    size: { width: W, height: H },
    cellSize: SQUARE_SIZE,
    terrainMode: "square",
    heightmap,
    collision,
    surface: [],
    terrainStyle: {},
    waterLevel: W > 20 ? 0.4 : null,
    props,
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

/** todas as chaves de isolamento exceto as de UI/interação (irrelevantes pra
 * custo de render) — usado pra isolar "só entidade", sem mapa/água/props/etc. */
const ISO_ENTIDADE_SOZINHA = [
  "semTerreno",
  "semProps",
  "semAgua",
  "semCeuFoto",
  "semNevoa",
  "semHorizonte",
  "semImpostorArvore",
  "semVento",
  "semSol",
  "semAmbiente",
  "semParticulas",
].join(",");

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

/** instala o hook ANTES de qualquer script da página — mesmo mecanismo que o
 * React DevTools usa (`onCommitFiberRoot`), leitura passiva, não altera
 * nenhum componente. Sobrevive a `page.goto` porque `addInitScript` reinstala
 * a cada navegação da mesma `page`. */
async function installReactCommitCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let commits = 0;
    const hook = {
      supportsFiber: true,
      inject: () => 1,
      onScheduleFiberRoot: () => {},
      onCommitFiberRoot: () => {
        commits++;
      },
      onCommitFiberUnmount: () => {},
      checkDCE: () => {},
    };
    (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
    (window as unknown as { __RCC?: unknown }).__RCC = {
      commits: () => commits,
      reset: () => {
        commits = 0;
      },
    };
  });
}

interface VooRow {
  p50: number;
  p95: number;
  max: number;
  n: number;
}
type VooResumo = Record<string, VooRow>;

async function gotoScenario(page: Page, opts: { mobCount: number; iso?: string; size?: number }): Promise<void> {
  const map = buildMap({ mobCount: opts.mobCount, size: opts.size });
  const iso = opts.iso ?? "";
  await page.goto(`${BASE_URL}/play?preview=1&iso=${encodeURIComponent(iso)}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof (window as unknown as { __gl?: unknown }).__gl === "function", {
    timeout: 15000,
  });
  await page.evaluate((m) => {
    window.postMessage({ type: "ragnarok:preview-map", map: m }, "*");
  }, map);
}

interface Snapshot {
  label: string;
  mobCount: number;
  iso: string;
  voo: VooResumo;
  cdpDeltaMs: Record<string, number>;
  reactCommitsPerSec: number;
  glInfo: { calls: number; triangles: number; geometries: number; textures: number; programs: number };
  sceneStats: Record<string, number>;
  domNodeCount: number;
  focusState?: { hidden: boolean; hasFocus: boolean };
  suspeito?: boolean;
}

async function cdpMetricsMap(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const out: Record<string, number> = {};
  for (const m of metrics) out[m.name] = m.value;
  return out;
}

async function readSceneStats(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const w = window as unknown as { __scene: () => { traverse: (cb: (o: unknown) => void) => void } };
    const scene = w.__scene();
    let meshes = 0,
      skinnedMeshes = 0,
      instancedMeshes = 0,
      castShadowCount = 0,
      lights = 0;
    scene.traverse((o: unknown) => {
      const obj = o as { isMesh?: boolean; isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isLight?: boolean; castShadow?: boolean };
      if (obj.isLight) lights++;
      if (obj.isMesh) {
        meshes++;
        if (obj.castShadow) castShadowCount++;
      }
      if (obj.isSkinnedMesh) skinnedMeshes++;
      if (obj.isInstancedMesh) instancedMeshes++;
    });
    return { meshes, skinnedMeshes, instancedMeshes, castShadowCount, lights };
  });
}

/** limpa __voo, espera `windowMs` de amostra "limpa" e devolve o resumo
 * (p50/p95/max por coluna) + delta de métricas CDP no MESMO intervalo +
 * taxa de commits do React nesse intervalo. */
async function measureWindow(page: Page, cdp: CDPSession, label: string, mobCount: number, iso: string, windowMs = 3000): Promise<Snapshot> {
  // Chrome throttla rAF de janela sem FOCO DE SO mesmo com a aba "visível"
  // (document.hidden só cobre troca de ABA, não perda de foco da janela) —
  // sem isto, alguns cenários gravam quadroMs≈1000ms (1 rAF/s) que é
  // artefato de automação, não custo do jogo. `bringToFront` + checagem de
  // hidden/focus abaixo torna essa contaminação DETECTÁVEL em vez de muda.
  await page.bringToFront();
  await page.evaluate(() => {
    const w = window as unknown as { __voo: { limpar: () => void }; __RCC?: { reset: () => void } };
    w.__voo.limpar();
    w.__RCC?.reset();
  });
  const before = await cdpMetricsMap(cdp);
  await page.waitForTimeout(windowMs);
  const after = await cdpMetricsMap(cdp);
  const focusState = await page.evaluate(() => ({ hidden: document.hidden, hasFocus: document.hasFocus() }));

  const voo = await page.evaluate(() => (window as unknown as { __voo: { json: () => { resumo: VooResumo } } }).__voo.json().resumo);
  const reactCommits = await page.evaluate(() => (window as unknown as { __RCC?: { commits: () => number } }).__RCC?.commits() ?? -1);
  const glInfo = await page.evaluate(() => {
    const w = window as unknown as { __gl: () => { info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number }; programs?: unknown[] } } };
    const info = w.__gl().info;
    return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 };
  });
  const sceneStats = await readSceneStats(page);
  const domNodeCount = await page.evaluate(() => document.getElementsByTagName("*").length);

  const cdpDeltaMs: Record<string, number> = {};
  for (const k of ["ScriptDuration", "RecalcStyleDuration", "LayoutDuration", "TaskDuration", "JSHeapUsedSize"]) {
    if (before[k] !== undefined && after[k] !== undefined) cdpDeltaMs[k] = Math.round((after[k]! - before[k]!) * 1000) / 1000;
  }

  const q = voo.quadroMs;
  const suspeito = (q?.p50 ?? 0) > 100 || focusState.hidden || !focusState.hasFocus;
  console.log(
    `  [${label}] quadroMs p50=${q?.p50} render=${voo.renderMs?.p50} gpu=${voo.gpuMs?.p50} anim=${voo.animacaoMs?.p50} matriz=${voo.matrizMs?.p50} sobra=${voo.sobraMs?.p50} | script=${cdpDeltaMs.ScriptDuration}s layout=${cdpDeltaMs.LayoutDuration}s | reactCommits=${reactCommits} (${(reactCommits / (windowMs / 1000)).toFixed(1)}/s) | calls=${glInfo.calls} tris=${glInfo.triangles}${suspeito ? "  ⚠ SUSPEITO (throttle de foco/aba — descartar)" : ""}`,
  );

  return { label, mobCount, iso, voo, cdpDeltaMs, reactCommitsPerSec: reactCommits / (windowMs / 1000), glInfo, sceneStats, domNodeCount, focusState, suspeito } as Snapshot;
}

interface ShaderHitchResult {
  extKHRParallelShaderCompile: boolean;
  primeiroSpawn: { eventos: unknown[]; quadroDoEvento: Record<string, number> | null; programasAntes: number; programasDepois: number };
  segundoSpawn: { eventos: unknown[]; quadroDoEvento: Record<string, number> | null; programasAntes: number; programasDepois: number };
}

async function testeShaderHitch(page: Page): Promise<ShaderHitchResult> {
  // ambiente isolado (só entidade) pra não confundir com rebuild de terreno
  await gotoScenario(page, { mobCount: 0, iso: ISO_ENTIDADE_SOZINHA, size: 10 });
  await page.waitForTimeout(2000);

  const ext = await page.evaluate(() => {
    const w = window as unknown as { __gl: () => { getContext: () => WebGLRenderingContext } };
    return w.__gl().getContext().getExtension("KHR_parallel_shader_compile") !== null;
  });

  async function spawnAndCapture(mobCount: number): Promise<{ eventos: unknown[]; quadroDoEvento: Record<string, number> | null; programasAntes: number; programasDepois: number }> {
    const programasAntes = await page.evaluate(() => (window as unknown as { __gl: () => { info: { programs?: unknown[] } } }).__gl().info.programs?.length ?? 0);
    await page.evaluate(() => (window as unknown as { __voo: { limpar: () => void } }).__voo.limpar());
    const map = buildMap({ mobCount, size: 10 });
    await page.evaluate((m) => window.postMessage({ type: "ragnarok:preview-map", map: m }, "*"), map);
    await page.waitForTimeout(1500);
    const programasDepois = await page.evaluate(() => (window as unknown as { __gl: () => { info: { programs?: unknown[] } } }).__gl().info.programs?.length ?? 0);
    await page.evaluate(() => (window as unknown as { __voo: { capturar: (m: string) => void } }).__voo.capturar("manual"));
    await page.waitForTimeout(300);
    const dump = (await page.evaluate(
      () => (window as unknown as { __voo: { json: () => unknown } }).__voo.json(),
    )) as { casos: { eventos: unknown[]; quadros: Record<string, number[]> }[] };
    const caso = dump.casos[dump.casos.length - 1];
    const eventos = (caso?.eventos ?? []).filter((e) => {
      const ev = e as { cat?: string; tipo?: string };
      return ev.cat === "cena" || ev.cat === "renderer";
    });
    let quadroDoEvento: Record<string, number> | null = null;
    const compileEvt = eventos.find((e) => (e as { tipo?: string }).tipo === "shader:compile-entidade") as { quadro?: number } | undefined;
    if (compileEvt?.quadro !== undefined && caso) {
      const idx = caso.quadros.quadro?.indexOf(compileEvt.quadro);
      if (idx !== undefined && idx >= 0) {
        quadroDoEvento = {};
        for (const [campo, arr] of Object.entries(caso.quadros)) quadroDoEvento[campo] = arr[idx]!;
      }
    }
    return { eventos, quadroDoEvento, programasAntes, programasDepois };
  }

  const primeiroSpawn = await spawnAndCapture(5); // primeira vez: espécies NUNCA compiladas
  const segundoSpawn = await spawnAndCapture(10); // mais 10 das MESMAS espécies, mesma sessão/contexto

  return { extKHRParallelShaderCompile: ext, primeiroSpawn, segundoSpawn };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);

  console.log(`[fase2] subindo vite dev em :${PORT}...`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  const out: Record<string, unknown> = {};

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await installReactCommitCounter(page);

    console.log(`[fase2] headless=${HEADLESS}`);

    // ---- 0. reproduzir Fase 1 (sanity check) ----
    console.log("[fase2] Parte 0 — reproduzir resultado da Fase 1");
    await gotoScenario(page, { mobCount: 30 });
    await page.waitForTimeout(6000);
    const rendererString = await page.evaluate(() => {
      const w = window as unknown as { __gl: () => { getContext: () => WebGLRenderingContext } };
      const ctx = w.__gl().getContext();
      const e = ctx.getExtension("WEBGL_debug_renderer_info");
      return e ? String(ctx.getParameter(e.UNMASKED_RENDERER_WEBGL)) : "sem WEBGL_debug_renderer_info";
    });
    const repro = await measureWindow(page, cdp, "reprodução N=30", 30, "", 3000);
    out.reproducao = { rendererString, ...repro };

    // ---- 1. curva de decomposição completa: mapa + N monstros ----
    console.log("[fase2] Parte 1 — decomposição completa por N (mapa + monstros)");
    const curvaCompleta: Snapshot[] = [];
    for (const n of [0, 1, 5, 10, 20, 30, 50, 100]) {
      await gotoScenario(page, { mobCount: n });
      await page.waitForTimeout(5000);
      curvaCompleta.push(await measureWindow(page, cdp, `completo N=${n}`, n, "", 3000));
    }
    out.curvaCompleta = curvaCompleta;

    // ---- 2. entidade isolada (sem mapa/props/água/etc) ----
    console.log("[fase2] Parte 2 — entidade isolada (?iso=" + ISO_ENTIDADE_SOZINHA + ")");
    const curvaEntidade: Snapshot[] = [];
    for (const n of [0, 1, 5, 10, 20, 30]) {
      await gotoScenario(page, { mobCount: n, iso: ISO_ENTIDADE_SOZINHA, size: 20 });
      await page.waitForTimeout(4000);
      curvaEntidade.push(await measureWindow(page, cdp, `entidade N=${n}`, n, ISO_ENTIDADE_SOZINHA, 3000));
    }
    out.curvaEntidade = curvaEntidade;

    // ---- 3. shadow A/B, N=30 ----
    console.log("[fase2] Parte 3 — shadow A/B (N=30)");
    await gotoScenario(page, { mobCount: 30 });
    await page.waitForTimeout(5000);
    const shadowOn = await measureWindow(page, cdp, "shadow ON N=30", 30, "", 3000);
    await gotoScenario(page, { mobCount: 30, iso: "semSombra" });
    await page.waitForTimeout(5000);
    const shadowOff = await measureWindow(page, cdp, "shadow OFF N=30", 30, "semSombra", 3000);
    out.shadowAB = { shadowOn, shadowOff };

    // ---- 4. vegetação/props A/B, N=0 (mapa sozinho) ----
    console.log("[fase2] Parte 4 — props/vegetação A/B (N=0, mapa sozinho)");
    await gotoScenario(page, { mobCount: 0 });
    await page.waitForTimeout(5000);
    const propsOn = await measureWindow(page, cdp, "props ON N=0", 0, "", 3000);
    await gotoScenario(page, { mobCount: 0, iso: "semProps" });
    await page.waitForTimeout(5000);
    const propsOff = await measureWindow(page, cdp, "props OFF N=0", 0, "semProps", 3000);
    out.propsAB = { propsOn, propsOff };

    // ---- 5. shader compile hitch ----
    console.log("[fase2] Parte 5 — shader compilation hitch (1º spawn vs 2º spawn, mesma sessão)");
    out.shaderHitch = await testeShaderHitch(page);

    // ---- 6. React commit rate em ocioso (N=0, mapa completo, câmera parada) ----
    console.log("[fase2] Parte 6 — taxa de commit do React em regime (idle, N=0)");
    await gotoScenario(page, { mobCount: 0 });
    await page.waitForTimeout(5000);
    out.reactIdle = await measureWindow(page, cdp, "react idle N=0", 0, "", 5000);

    await browser.close();

    const outFile = path.join(OUT_DIR, `fase2-result-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`[fase2] resultado salvo em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
