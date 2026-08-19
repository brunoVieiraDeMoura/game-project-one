/**
 * `pnpm --filter @ragnarok/game exec tsx scripts/pipelineAudit.ts`
 *
 * Auditoria de performance READ-ONLY do pipeline COMPLETO de renderização
 * (mapa real chunked + props/vegetação + água + entidades + animação +
 * sombra), fora da auditoria de VFX (essa já existe em vfxBenchmark.ts).
 *
 * NÃO cria/edita nenhum arquivo de produção — sobe seu próprio vite dev numa
 * porta dedicada, abre `/play?preview=1` (mesmo canal que o editor usa pra
 * pré-visualizar mapa sem precisar de sessão rAthena — ver PlayView.tsx:
 * `IS_PREVIEW`/`ragnarok:preview-map`), injeta um GameMap sintético com
 * terrainMode:"square" (o terreno REAL de produção, SquareTerrain chunked,
 * não o MapTerrain de fallback) via postMessage, e lê os contadores que já
 * existem em produção (`window.__gl`/`window.__perf`/`window.__scene`/
 * `window.__censo`, expostos por `scene/PerfHud.tsx` em DEV).
 *
 * Chromium HEADED (GPU real) por padrão — `PIPELINE_AUDIT_HEADED=0` força
 * headless só para teste rápido de sintaxe (fps/draw calls aí não valem
 * nada, SwiftShader).
 */
import { chromium, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3098;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "pipeline-audit-results");
const HEADLESS = process.env.PIPELINE_AUDIT_HEADED === "0";

const SQUARE_SIZE = 2.0;
function squareToWorld(col: number, row: number) {
  return { x: (col + 0.5) * SQUARE_SIZE, z: (row + 0.5) * SQUARE_SIZE };
}

interface BuildOpts {
  mobCount: number;
  arrangement: "tight" | "spread";
}

/** Mapa 90x90 (180x180 unidades de mundo) com colina, lagoa, ~40 props
 * (árvore/pedra/arbusto) espalhados — o suficiente pra exercitar
 * terreno+vegetação+água+props de verdade, não só um plano vazio. */
function buildMap(opts: BuildOpts) {
  const W = 90;
  const H = 90;
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  const collision = new Array(n).fill("walkable");
  const idx = (c: number, r: number) => r * W + c;
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);

  // colina em degraus no centro (mesmo padrão de squareDemoMap.ts)
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
  // lagoa num canto
  for (let r = 5; r <= 12; r++)
    for (let c = 5; c <= 14; c++) {
      collision[idx(c, r)] = "water";
    }

  const props: unknown[] = [];
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

  const spawns: unknown[] = [];
  const { x: px, z: pz } = squareToWorld(cx, cy + 8);
  spawns.push({ id: "player_start", kind: "player_start", position: [px, 0, pz] });

  const mobRefs = ["skeleton_warrior", "skeleton_minion"];
  const cols = Math.ceil(Math.sqrt(opts.mobCount));
  const spacing = opts.arrangement === "tight" ? 2 : 5;
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
    id: "pipeline-audit",
    name: "pipeline-audit",
    size: { width: W, height: H },
    cellSize: SQUARE_SIZE,
    terrainMode: "square",
    heightmap,
    collision,
    surface: [],
    terrainStyle: {},
    waterLevel: 0.4,
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

interface Snapshot {
  n: number;
  arrangement: string;
  rendererString: string | null;
  perf: unknown;
  glInfo: unknown;
  sceneStats: unknown;
  domNodeCount: number;
  activeAnimationCount: number;
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

async function measureScenario(page: Page, opts: BuildOpts, label: string, screenshotPath: string): Promise<Snapshot> {
  await page.goto(`${BASE_URL}/play?preview=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof (window as unknown as { __gl?: unknown }).__gl === "function", {
    timeout: 15000,
  });

  const map = buildMap(opts);
  await page.evaluate((m) => {
    window.postMessage({ type: "ragnarok:preview-map", map: m }, "*");
  }, map);

  // assentar: streaming de chunk (cortina de carga) + animações entrando em
  // regime + culling estabilizando
  await page.waitForTimeout(4000);

  // zera a janela de amostragem de fps ANTES de medir "em regime" (perfProbe
  // já é janela rolante de ~5s; damos mais 2s de amostra limpa)
  await page.waitForTimeout(2000);

  const rendererString = await page.evaluate(() => {
    try {
      const w = window as unknown as { __gl: () => { getContext: () => WebGLRenderingContext } };
      const ctx = w.__gl().getContext();
      const ext = ctx.getExtension("WEBGL_debug_renderer_info");
      return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "sem WEBGL_debug_renderer_info";
    } catch (e) {
      return `erro: ${String(e)}`;
    }
  });

  const perf = await page.evaluate(() => (window as unknown as { __perf: () => unknown }).__perf());

  const glInfo = await page.evaluate(() => {
    const w = window as unknown as { __gl: () => { info: unknown } };
    const info = w.__gl().info as {
      render: { calls: number; triangles: number; points: number; lines: number };
      memory: { geometries: number; textures: number };
      programs?: unknown[];
    };
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  });

  const sceneStats = await page.evaluate(() => {
    const w = window as unknown as { __scene: () => THREENode; __camera: () => { position: { x: number; y: number; z: number }; getWorldDirection: (v: unknown) => unknown } };
    type THREENode = {
      traverse: (cb: (o: unknown) => void) => void;
    };
    const scene = w.__scene();
    let totalObjects = 0;
    let meshes = 0;
    let skinnedMeshes = 0;
    let instancedMeshes = 0;
    let instancedTotalInstances = 0;
    let visibleMeshes = 0;
    let invisibleMeshes = 0;
    let castShadowCount = 0;
    let lights = 0;
    const materialSet = new Set<unknown>();
    const geometrySet = new Set<unknown>();
    scene.traverse((o: unknown) => {
      totalObjects++;
      const obj = o as {
        isMesh?: boolean;
        isSkinnedMesh?: boolean;
        isInstancedMesh?: boolean;
        isLight?: boolean;
        visible?: boolean;
        castShadow?: boolean;
        count?: number;
        material?: unknown;
        geometry?: unknown;
      };
      if (obj.isLight) lights++;
      if (obj.isMesh) {
        meshes++;
        if (obj.visible) visibleMeshes++;
        else invisibleMeshes++;
        if (obj.castShadow) castShadowCount++;
        if (obj.material) materialSet.add(obj.material);
        if (obj.geometry) geometrySet.add(obj.geometry);
      }
      if (obj.isSkinnedMesh) skinnedMeshes++;
      if (obj.isInstancedMesh) {
        instancedMeshes++;
        instancedTotalInstances += obj.count ?? 0;
      }
    });
    return {
      totalObjects,
      meshes,
      skinnedMeshes,
      instancedMeshes,
      instancedTotalInstances,
      visibleMeshes,
      invisibleMeshes,
      castShadowCount,
      lights,
      uniqueMaterials: materialSet.size,
      uniqueGeometries: geometrySet.size,
    };
  });

  const domNodeCount = await page.evaluate(() => document.getElementsByTagName("*").length);
  const activeAnimationCount = await page.evaluate(() => document.getAnimations().length);

  await page.screenshot({ path: screenshotPath }).catch(() => {});

  console.log(`  [${label}] fps=${(perf as { fps: number }).fps} calls=${glInfo.calls} tris=${glInfo.triangles} dom=${domNodeCount}`);

  return { n: opts.mobCount, arrangement: opts.arrangement, rendererString, perf, glInfo, sceneStats, domNodeCount, activeAnimationCount };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);

  console.log(`[pipeline-audit] subindo vite dev em :${PORT}...`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  const results: Snapshot[] = [];

  try {
    await waitForServer(BASE_URL, 30000);

    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    console.log(`[pipeline-audit] headless=${HEADLESS}`);

    const levels = [1, 5, 10, 20, 30];
    for (const n of levels) {
      const r = await measureScenario(
        page,
        { mobCount: n, arrangement: "spread" },
        `spread N=${n}`,
        path.join(OUT_DIR, `spread-${n}.png`),
      );
      results.push(r);
    }
    // controle de culling/overdraw: tudo empilhado perto do centro
    const rTight = await measureScenario(
      page,
      { mobCount: 30, arrangement: "tight" },
      "tight N=30",
      path.join(OUT_DIR, `tight-30.png`),
    );
    results.push(rTight);

    // mapa vazio (0 mobs) — baseline de custo do terreno/props sozinho
    const rBaseline = await measureScenario(
      page,
      { mobCount: 0, arrangement: "spread" },
      "baseline (mapa sozinho, 0 mobs)",
      path.join(OUT_DIR, `baseline.png`),
    );
    results.unshift(rBaseline);

    await browser.close();

    const outFile = path.join(OUT_DIR, `result-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`[pipeline-audit] resultado salvo em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
