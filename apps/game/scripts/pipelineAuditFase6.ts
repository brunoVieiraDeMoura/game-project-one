/**
 * FASE 6 — validação A/B cold/warm dos candidatos first-use da Fase 5
 * (AimPreview, AttackRangeCircle, GlowChao). Instrumentação/diagnóstico
 * apenas — não altera nenhum arquivo de produção, não adiciona prewarm.
 *
 * `pnpm --filter @ragnarok/game exec tsx scripts/pipelineAuditFase6.ts`
 *
 * Técnica: em vez de simular clique/hover real (projeção de tela complexa
 * pra pouco ganho), aciona os MESMOS stores Zustand que a UI real aciona —
 * via `import()` dinâmico do módulo já servido pelo Vite dev em
 * `/src/...ts` (é o MESMO singleton de módulo que a árvore React já usa,
 * não uma cópia). Isso não é diferente, do ponto de vista do componente, de
 * um clique real: `useWorldStore.setState({target: gid})` é exatamente o
 * que `net/acoes.ts` faz num clique de verdade.
 */
import { chromium, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3095;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "pipeline-audit-results");
const HEADLESS = process.env.PIPELINE_AUDIT_HEADED === "0";

const SQUARE_SIZE = 2.0;
function squareToWorld(col: number, row: number) {
  return { x: (col + 0.5) * SQUARE_SIZE, z: (row + 0.5) * SQUARE_SIZE };
}

function buildMap(mobCount: number, size = 30) {
  const W = size;
  const H = size;
  const n = W * H;
  const heightmap = new Array(n).fill(0);
  const collision = new Array(n).fill("walkable");
  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);
  const spawns: unknown[] = [];
  const { x: px, z: pz } = squareToWorld(cx, cy);
  spawns.push({ id: "player_start", kind: "player_start", position: [px, 0, pz] });
  const mobRefs = ["skeleton_warrior", "skeleton_minion"];
  for (let i = 0; i < mobCount; i++) {
    const col = cx + 3 + i * 2;
    const row = cy;
    const { x, z } = squareToWorld(col, row);
    spawns.push({ id: `mob_${i}`, kind: "mob", refId: mobRefs[i % mobRefs.length], position: [x, 0, z] });
  }
  return {
    id: "pipeline-audit-f6",
    name: "pipeline-audit-f6",
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

async function gotoScenario(page: Page, mobCount: number): Promise<number[]> {
  const map = buildMap(mobCount) as { spawns: { id: string; kind: string }[] };
  await page.goto(`${BASE_URL}/play?preview=1&iso=`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof (window as unknown as { __gl?: unknown }).__gl === "function", { timeout: 15000 });
  await page.evaluate((m) => window.postMessage({ type: "ragnarok:preview-map", map: m }, "*"), map);
  await page.waitForTimeout(6000); // curtain + warmup + entidades montadas
  // devolve os gids das entidades mob (worldStore usa gid como chave — meu
  // buildMap não define gid explícito, então preciso ler de volta o que o
  // client atribuiu; mais simples: ler diretamente do worldStore depois)
  return [];
}

interface ActionResult {
  label: string;
  programsBefore: number;
  programsAfter: number;
  novoPrograma: boolean;
  quadroMsMax: number;
  renderMsMax: number;
  gpuMsMax: number;
}

async function measureAction(page: Page, label: string, action: () => Promise<void>): Promise<ActionResult> {
  const programsBefore = await page.evaluate(() => (window as unknown as { __gl: () => { info: { programs?: unknown[] } } }).__gl().info.programs?.length ?? 0);
  await page.evaluate(() => (window as unknown as { __voo: { limpar: () => void } }).__voo.limpar());
  await action();
  await page.waitForTimeout(900); // ~54 quadros a 60fps — cobre o quadro de compile + alguns depois
  const programsAfter = await page.evaluate(() => (window as unknown as { __gl: () => { info: { programs?: unknown[] } } }).__gl().info.programs?.length ?? 0);
  const voo = (await page.evaluate(() => (window as unknown as { __voo: { json: () => unknown } }).__voo.json())) as {
    resumo: Record<string, { max: number }>;
  };
  const result: ActionResult = {
    label,
    programsBefore,
    programsAfter,
    novoPrograma: programsAfter > programsBefore,
    quadroMsMax: voo.resumo.quadroMs?.max ?? -1,
    renderMsMax: voo.resumo.renderMs?.max ?? -1,
    gpuMsMax: voo.resumo.gpuMs?.max ?? -1,
  };
  console.log(`  [${label}] programas ${programsBefore}→${programsAfter} (novo=${result.novoPrograma}) quadroMs_max=${result.quadroMsMax} renderMs_max=${result.renderMsMax} gpuMs_max=${result.gpuMsMax}`);
  return result;
}

/** helper de página: importa o módulo real do Vite dev (mesmo singleton que
 * a árvore React já usa) e devolve o export nomeado pedido. */
async function importStore<T>(page: Page, modulePath: string, exportName: string): Promise<T> {
  return page.evaluate(
    async ({ modulePath, exportName }) => {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<string, unknown>;
      return mod[exportName] as unknown;
    },
    { modulePath, exportName },
  ) as Promise<T>;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);
  console.log(`[fase6] subindo vite dev em :${PORT}...`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  const out: Record<string, unknown> = {};

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    console.log(`[fase6] headless=${HEADLESS}`);

    await gotoScenario(page, 4);
    await page.bringToFront();

    // renderer real, confirmado (não SwiftShader)
    const rendererString = await page.evaluate(() => {
      const w = window as unknown as { __gl: () => { getContext: () => WebGLRenderingContext } };
      const ctx = w.__gl().getContext();
      const e = ctx.getExtension("WEBGL_debug_renderer_info");
      return e ? String(ctx.getParameter(e.UNMASKED_RENDERER_WEBGL)) : "sem WEBGL_debug_renderer_info";
    });
    console.log("[fase6] renderer:", rendererString);
    out.rendererString = rendererString;

    /**
     * IMPORTANTE (achado desta fase, não um bug do script): `/play?preview=1`
     * é OFFLINE — os monstros vêm de `entities/previewSpawns(map)` e são
     * desenhados por `entities/Monster.tsx`, NUNCA por `net/NetEntity.tsx`
     * (isso só roda com sessão online de verdade). `AttackRangeCircle` lê
     * `useWorldStore(s => s.target !== null)` — só precisa de um ID
     * verdadeiro, não de uma entidade real renderizada — então dá pra testar
     * mesmo offline. `GlowChao` ("alvo"), por morar DENTRO de
     * `net/NetEntity.tsx`, NÃO É TESTÁVEL neste bench offline sem fingir uma
     * sessão online inteira (risco alto de quebrar o resto do PlayView,
     * fora de escopo) — fica declarado NÃO MEDIDO, não pulado em silêncio.
     */
    const gids = [1001, 1002];
    console.log("[fase6] usando gids sintéticos (worldStore.target não exige entidade real montada):", gids);
    out.gids = gids;
    out.glowChaoAlvoNota = "NÃO TESTADO — GlowChao(alvo) só monta dentro de net/NetEntity.tsx, que só roda com sessão online real; bench offline não alcança esse componente sem fingir sessão inteira (fora de escopo desta fase).";

    // garante atkRange>1 pro ataque básico mostrar círculo (senão raioAtual<=1
    // esconde o mesh e o teste não dispara nada) — só leitura/escrita de STORE,
    // não é edição de arquivo de produção.
    await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ "/src/net/playerStore.ts")) as { usePlayerStore: { setState: (p: unknown) => void; getState: () => { stats: Record<string, unknown> } } };
      const stats = mod.usePlayerStore.getState().stats;
      mod.usePlayerStore.setState({ stats: { ...stats, atkRange: 9 } });
    });

    const results: ActionResult[] = [];

    // ---- CANDIDATO: AttackRangeCircle + GlowChao("alvo"), via worldStore.target ----
    console.log("[fase6] Teste A/B — seleção de alvo (AttackRangeCircle + GlowChao 'alvo')");
    results.push(
      await measureAction(page, "alvo COLD (1º select, entidade A)", async () => {
        await page.evaluate(async (gid) => {
          const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { setState: (p: unknown) => void } };
          mod.useWorldStore.setState({ target: gid });
        }, gids[0]);
      }),
    );
    results.push(
      await measureAction(page, "alvo WARM (2º select, entidade B, mesma cor/material)", async () => {
        await page.evaluate(async (gid) => {
          const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { setState: (p: unknown) => void } };
          mod.useWorldStore.setState({ target: null });
        }, gids[1]);
        await page.waitForTimeout(50);
        await page.evaluate(async (gid) => {
          const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { setState: (p: unknown) => void } };
          mod.useWorldStore.setState({ target: gid });
        }, gids[1]);
      }),
    );

    // ---- CANDIDATO: AimPreview, via aimStore.aim() + skillCatalog seedado ----
    console.log("[fase6] Teste A/B — abrir mira de skill de área (AimPreview)");
    await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ "/src/net/skillCatalog.ts")) as { useSkillCatalog: { setState: (p: unknown) => void } };
      mod.useSkillCatalog.setState({
        byId: {
          90501: { id: 90501, aegisName: "F6_TESTE_A", name: "Teste F6 A", hitType: "normal", target: "enemy", areaRadius: 2, maxLevel: 1, type: "damage", element: "weapon", spCost: 0, range: 9, cooldownMs: 0, durationMs: 0, duration2Ms: 0 },
          90502: { id: 90502, aegisName: "F6_TESTE_B", name: "Teste F6 B", hitType: "normal", target: "enemy", areaRadius: 2, maxLevel: 1, type: "damage", element: "weapon", spCost: 0, range: 9, cooldownMs: 0, durationMs: 0, duration2Ms: 0 },
        },
      });
    });
    results.push(
      await measureAction(page, "mira COLD (1ª vez abrindo mira de área)", async () => {
        await page.evaluate(async () => {
          const mod = (await import(/* @vite-ignore */ "/src/net/aimStore.ts")) as { useAimStore: { getState: () => { aim: (s: unknown) => void } } };
          mod.useAimStore.getState().aim({ id: 90501, level: 1, name: "Teste F6 A", mode: "ground" });
        });
        // hover precisa de uma célula válida pra malha de área desenhar — a
        // malha do ANEL (raio de alcance) já desenha só com `mirando`, então
        // isto cobre o caso principal sem precisar simular movimento de mouse.
      }),
    );
    const diag = await page.evaluate(async () => {
      const aimMod = (await import(/* @vite-ignore */ "/src/net/aimStore.ts")) as { useAimStore: { getState: () => { skill: unknown } } };
      const catMod = (await import(/* @vite-ignore */ "/src/net/skillCatalog.ts")) as { useSkillCatalog: { getState: () => { byId: Record<number, unknown> } }; alcanceEfetivoDaSkill: (id: number) => number };
      const visMod = (await import(/* @vite-ignore */ "/src/hud/combatVisualsStore.ts")) as { useCombatVisuals: { getState: () => { showSkillArea: boolean } } };
      return {
        mirando: aimMod.useAimStore.getState().skill,
        catalogEntry: catMod.useSkillCatalog.getState().byId[90501],
        raioEfetivo: catMod.alcanceEfetivoDaSkill(90501),
        showSkillArea: visMod.useCombatVisuals.getState().showSkillArea,
      };
    });
    console.log("  [diagnóstico AimPreview]", JSON.stringify(diag));
    out.diagAimPreview = diag;
    results.push(
      await measureAction(page, "mira WARM (cancela + reabre, skill diferente mesmo modo)", async () => {
        await page.evaluate(async () => {
          const mod = (await import(/* @vite-ignore */ "/src/net/aimStore.ts")) as { useAimStore: { getState: () => { cancel: () => void; aim: (s: unknown) => void } } };
          mod.useAimStore.getState().cancel();
        });
        await page.waitForTimeout(50);
        await page.evaluate(async () => {
          const mod = (await import(/* @vite-ignore */ "/src/net/aimStore.ts")) as { useAimStore: { getState: () => { aim: (s: unknown) => void } } };
          mod.useAimStore.getState().aim({ id: 90502, level: 1, name: "Teste F6 B", mode: "ground" });
        });
      }),
    );

    out.results = results;

    await browser.close();
    const outFile = path.join(OUT_DIR, `fase6-result-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`[fase6] resultado salvo em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
