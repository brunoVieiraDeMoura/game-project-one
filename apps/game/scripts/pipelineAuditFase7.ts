/**
 * FASE 7 — validação do fix de `entities/petrifyMaterial.ts` (compileAsync
 * atrás de rAF, mesma técnica de `assets.ts`/Fase E2). Instrumentação de
 * diagnóstico apenas — o fix em si já foi aplicado em produção (arquivo
 * real), este script só MEDE o resultado.
 *
 * `pnpm --filter @ragnarok/game exec tsx scripts/pipelineAuditFase7.ts`
 *
 * Petrificar só existe em `net/NetEntity.tsx`, que só monta com sessão
 * ONLINE real (`online = session !== null`) — `/play?preview=1` (usado nas
 * fases anteriores) usa `entities/Monster.tsx`, sem Petrificar. Em vez de
 * subir WSL2+rAthena+API de verdade (fora do escopo/tempo desta auditoria),
 * fabrica uma sessão "online" mínima: intercepta a ÚNICA chamada de rede que
 * `useMap` faria (`GET /maps/<id>`, `map/useMap.ts`) e devolve o mapa
 * sintético direto, sem precisar da API rodando. `net/useGatewayEvents`
 * ainda tenta conectar no socket (porta 4100, também não está de pé) — isso
 * é OK, socket.io falha quieto em segundo plano, o app não depende dele pra
 * nada que este script usa.
 */
import { chromium, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3094;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "pipeline-audit-results");
const HEADLESS = process.env.PIPELINE_AUDIT_HEADED === "0";
const MAP_ID = "pipeline-audit-f7";

const SQUARE_SIZE = 2.0;
function squareToWorld(col: number, row: number) {
  return { x: (col + 0.5) * SQUARE_SIZE, z: (row + 0.5) * SQUARE_SIZE };
}

function buildMap() {
  const W = 20;
  const H = 20;
  const n = W * H;
  return {
    id: MAP_ID,
    name: MAP_ID,
    size: { width: W, height: H },
    cellSize: SQUARE_SIZE,
    terrainMode: "square",
    heightmap: new Array(n).fill(0),
    collision: new Array(n).fill("walkable"),
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

interface ActionResult {
  label: string;
  programsBefore: number;
  programsAfter: number;
  novoPrograma: boolean;
  quadroMsMax: number;
  renderMsMax: number;
  gpuMsMax: number;
  errosConsole: string[];
}

async function measureAction(page: Page, label: string, errosConsole: string[], action: () => Promise<void>): Promise<ActionResult> {
  const programsBefore = await page.evaluate(() => (window as unknown as { __gl: () => { info: { programs?: unknown[] } } }).__gl().info.programs?.length ?? 0);
  await page.evaluate(() => (window as unknown as { __voo: { limpar: () => void } }).__voo.limpar());
  const antesDoErro = errosConsole.length;
  await action();
  await page.waitForTimeout(900);
  const programsAfter = await page.evaluate(() => (window as unknown as { __gl: () => { info: { programs?: unknown[] } } }).__gl().info.programs?.length ?? 0);
  const voo = (await page.evaluate(() => (window as unknown as { __voo: { json: () => unknown } }).__voo.json())) as {
    resumo: Record<string, { max: number }>;
    eventos: { cat: string; tipo: string; dados?: unknown }[];
  };
  console.log(`    eventos nesta janela: ${voo.eventos.map((e) => `${e.cat}/${e.tipo}${e.dados ? "=" + JSON.stringify(e.dados) : ""}`).join(", ") || "(nenhum)"}`);
  const result: ActionResult = {
    label,
    programsBefore,
    programsAfter,
    novoPrograma: programsAfter > programsBefore,
    quadroMsMax: voo.resumo.quadroMs?.max ?? -1,
    renderMsMax: voo.resumo.renderMs?.max ?? -1,
    gpuMsMax: voo.resumo.gpuMs?.max ?? -1,
    errosConsole: errosConsole.slice(antesDoErro),
  };
  console.log(
    `  [${label}] programas ${programsBefore}→${programsAfter} (novo=${result.novoPrograma}) quadroMs_max=${result.quadroMsMax} renderMs_max=${result.renderMsMax} gpuMs_max=${result.gpuMsMax} erros=${result.errosConsole.length}`,
  );
  return result;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);
  console.log(`[fase7] subindo vite dev em :${PORT}...`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  const out: Record<string, unknown> = {};

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const errosConsole: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errosConsole.push(msg.text());
    });
    page.on("pageerror", (err) => errosConsole.push(`pageerror: ${err.message}`));

    // intercepta a chamada de mapa que `map/useMap.ts` faria — sem API rodando
    const map = buildMap();
    await page.route(`**/maps/${MAP_ID}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(map) }));

    console.log(`[fase7] headless=${HEADLESS}`);
    /**
     * Descoberta desta rodada (2 tentativas anteriores): `IS_PREVIEW` é uma
     * CONST de módulo travada pela URL na primeira carga — trocar
     * `sessionStore.world` DEPOIS não faz `online` virar `true` enquanto
     * `?preview=1` esteve na URL de navegação (o app renderizou o mundo
     * local/preview o tempo todo; os 2 "Group" na cena eram só estrutura,
     * `net/NetEntity.tsx`/Petrificar nunca rodaram — daí zero eventos SEMPRE,
     * mesmo com `worldStore.entities` populado). Correção: `sessionStore`
     * precisa estar pronto ANTES do primeiro render, então a sessão é
     * fabricada via `page.addInitScript` (roda antes de QUALQUER script da
     * página) e a navegação vai DIRETO pro `/play` puro, sem `?preview=1`.
     */
    // pré-aquece o módulo no cache HTTP do browser antes da navegação real,
    // pra tentar vencer a corrida contra o redirect de /login (tentativa
    // anterior, sem isto, perdeu a corrida)
    await page.goto(`${BASE_URL}/play?preview=1`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      await import(/* @vite-ignore */ "/src/net/sessionStore.ts");
    });
    await page.addInitScript(
      ({ mapId }) => {
        void (async () => {
          const sessMod = await import(/* @vite-ignore */ "/src/net/sessionStore.ts");
          (sessMod as { useSessionStore: { setState: (p: unknown) => void } }).useSessionStore.setState({
            world: { mapName: mapId, x: 10, y: 10, dir: 0, gid: 777, char: null },
          });
        })();
      },
      { mapId: MAP_ID },
    );
    await page.goto(`${BASE_URL}/play`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof (window as unknown as { __gl?: unknown }).__gl === "function", { timeout: 15000 });
    await page.waitForTimeout(3000);

    const rendererString = await page.evaluate(() => {
      const w = window as unknown as { __gl: () => { getContext: () => WebGLRenderingContext } };
      const ctx = w.__gl().getContext();
      const e = ctx.getExtension("WEBGL_debug_renderer_info");
      return e ? String(ctx.getParameter(e.UNMASKED_RENDERER_WEBGL)) : "sem WEBGL_debug_renderer_info";
    });
    console.log("[fase7] renderer:", rendererString);
    out.rendererString = rendererString;

    // fabrica sessão "online" mínima — bypassa login/char-select/gateway
    // por completo, só o suficiente pra `online` virar true no PlayView.
    await page.evaluate(async (mapId) => {
      const sessMod = (await import(/* @vite-ignore */ "/src/net/sessionStore.ts")) as { useSessionStore: { setState: (p: unknown) => void } };
      sessMod.useSessionStore.setState({ world: { mapName: mapId, x: 10, y: 10, dir: 0, gid: 777, char: null } });
      const playerMod = (await import(/* @vite-ignore */ "/src/net/playerStore.ts")) as { usePlayerStore: { getState: () => { stats: Record<string, unknown> }; setState: (p: unknown) => void } };
      const stats = playerMod.usePlayerStore.getState().stats;
      playerMod.usePlayerStore.setState({ stats: { ...stats, class: 1, atkRange: 9 } });
      const worldMod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { setState: (p: unknown) => void } };
      worldMod.useWorldStore.setState({
        entities: {
          2001: { gid: 2001, kind: "mob", job: 1002, name: "Teste F7", x: 11, y: 10, toX: 11, toY: 10, movedAt: 0, durationMs: 0, dir: 0, speed: 0, hp: 100, maxHp: 100, opt1: 0 },
          2002: { gid: 2002, kind: "mob", job: 1002, name: "Teste F7 B", x: 12, y: 10, toX: 12, toY: 10, movedAt: 0, durationMs: 0, dir: 0, speed: 0, hp: 100, maxHp: 100, opt1: 0 },
        },
      });
    }, MAP_ID);

    console.log("[fase7] esperando cortina/aquecimento (sessão fabricada, mapa via rota interceptada)...");
    await page.waitForTimeout(8000);
    await page.bringToFront();

    const errosAteAqui = errosConsole.length;
    console.log(`[fase7] erros de console até aqui: ${errosAteAqui}`, errosAteAqui > 0 ? errosConsole.slice(0, 5) : "");
    out.errosAteSettle = errosConsole.slice(0, errosAteAqui);

    // diagnóstico: a cena realmente tem algo? sessão realmente virou online?
    const diag = await page.evaluate(async () => {
      const sessMod = (await import(/* @vite-ignore */ "/src/net/sessionStore.ts")) as { useSessionStore: { getState: () => { world: unknown } } };
      const w = window as unknown as { __scene: () => { children: unknown[] }; __gl: () => { info: unknown } };
      let sceneChildren = -1;
      let childNames: string[] = [];
      try {
        const scene = w.__scene();
        sceneChildren = scene.children.length;
        childNames = scene.children.map((c) => (c as { name?: string; type?: string }).name || (c as { type?: string }).type || "?");
      } catch (e) {
        childNames = [`erro: ${String(e)}`];
      }
      return { world: sessMod.useSessionStore.getState().world, sceneChildren, childNames, bodyText: document.body.innerText.slice(0, 300) };
    });
    console.log("[fase7] diagnóstico:", JSON.stringify(diag, null, 1));
    out.diag = diag;
    await page.screenshot({ path: path.join(OUT_DIR, "fase7-diag.png") }).catch(() => {});

    const results: ActionResult[] = [];

    // ---- COLD: 1ª petrificação da sessão (entidade 2001, fase "wait") ----
    console.log("[fase7] COLD — 1º Petrificar da sessão (OPT1_STONEWAIT)");
    results.push(
      await measureAction(page, "petrify COLD (wait, entidade 2001)", errosConsole, async () => {
        await page.evaluate(async () => {
          const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { getState: () => { entities: Record<number, { opt1?: number }> }; setState: (p: unknown) => void } };
          const entities = mod.useWorldStore.getState().entities;
          mod.useWorldStore.setState({ entities: { ...entities, 2001: { ...entities[2001], opt1: 6 } } });
        });
      }),
    );

    // ---- WARM: mesma entidade, fase "stone" (mesmo programa, uniform diferente) ----
    console.log("[fase7] WARM #1 — mesma entidade, fase 'stone' (mesmo programa)");
    results.push(
      await measureAction(page, "petrify WARM (stone, entidade 2001)", errosConsole, async () => {
        await page.evaluate(async () => {
          const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { getState: () => { entities: Record<number, { opt1?: number }> }; setState: (p: unknown) => void } };
          const entities = mod.useWorldStore.getState().entities;
          mod.useWorldStore.setState({ entities: { ...entities, 2001: { ...entities[2001], opt1: 1 } } });
        });
      }),
    );

    // ---- WARM #2: entidade DIFERENTE, primeira vez QUE ELA petrifica (programa já existe) ----
    console.log("[fase7] WARM #2 — entidade nova (2002) petrifica pela 1ª vez, programa já compilado");
    results.push(
      await measureAction(page, "petrify WARM (wait, entidade 2002 nova)", errosConsole, async () => {
        await page.evaluate(async () => {
          const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { getState: () => { entities: Record<number, { opt1?: number }> }; setState: (p: unknown) => void } };
          const entities = mod.useWorldStore.getState().entities;
          mod.useWorldStore.setState({ entities: { ...entities, 2002: { ...entities[2002], opt1: 6 } } });
        });
      }),
    );

    // ---- estabilidade de recursos: 1/5/10/20 toggles ----
    console.log("[fase7] estabilidade de recursos — 20 toggles wait/none na mesma entidade");
    const geoTexProgAntes = await page.evaluate(() => {
      const w = window as unknown as { __gl: () => { info: { memory: { geometries: number; textures: number }; programs?: unknown[] } } };
      const i = w.__gl().info;
      return { geometrias: i.memory.geometries, texturas: i.memory.textures, programas: i.programs?.length ?? 0 };
    });
    for (let i = 0; i < 20; i++) {
      const opt1 = i % 2 === 0 ? 6 : 0;
      await page.evaluate(async (opt1) => {
        const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { getState: () => { entities: Record<number, { opt1?: number }> }; setState: (p: unknown) => void } };
        const entities = mod.useWorldStore.getState().entities;
        mod.useWorldStore.setState({ entities: { ...entities, 2001: { ...entities[2001], opt1 } } });
      }, opt1);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(500);
    const geoTexProgDepois = await page.evaluate(() => {
      const w = window as unknown as { __gl: () => { info: { memory: { geometries: number; textures: number }; programs?: unknown[] } } };
      const i = w.__gl().info;
      return { geometrias: i.memory.geometries, texturas: i.memory.textures, programas: i.programs?.length ?? 0 };
    });
    console.log("  antes:", JSON.stringify(geoTexProgAntes), "depois:", JSON.stringify(geoTexProgDepois));
    out.estabilidadeRecursos = { antes: geoTexProgAntes, depois: geoTexProgDepois };

    out.results = results;
    out.totalErrosConsole = errosConsole.length;
    out.errosConsoleTodos = errosConsole;

    await browser.close();
    const outFile = path.join(OUT_DIR, `fase7-result-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`[fase7] resultado salvo em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
