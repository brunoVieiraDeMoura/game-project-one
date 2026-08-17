const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const PORT = 3095;
const REPO = "C:\\Users\\Bruno\\desktop\\game-project";
const OUT = "C:\\Users\\Bruno\\AppData\\Local\\Temp\\claude\\C--Users-Bruno-desktop-game-project\\4b3162a9-56f6-4f51-936c-a91c26afc345\\scratchpad";

const IDX = { thunder: 4, safety: 16, fire: 17, sight: 18, fireball: 10 };
const CONDITIONS = [
  { k: "A", name: "nenhum VFX", skills: [] },
  { k: "B", name: "Sight sozinho", skills: [IDX.sight] },
  { k: "C", name: "Thunder Storm sozinho", skills: [IDX.thunder] },
  { k: "D", name: "Safety Wall sozinho", skills: [IDX.safety] },
  { k: "E", name: "Fire Wall sozinho", skills: [IDX.fire] },
  { k: "F", name: "Fire Ball sozinha", skills: [IDX.fireball] },
  { k: "G", name: "Thunder Storm + Sight", skills: [IDX.thunder, IDX.sight] },
  { k: "H", name: "Thunder Storm + Fire Ball", skills: [IDX.thunder, IDX.fireball] },
  { k: "I", name: "Sight + Fire Ball", skills: [IDX.sight, IDX.fireball] },
  { k: "J", name: "Thunder Storm + Sight + Fire Ball", skills: [IDX.thunder, IDX.sight, IDX.fireball] },
  { k: "K", name: "Thunder Storm + Safety Wall + Sight", skills: [IDX.thunder, IDX.safety, IDX.sight] },
];

function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tryConnect() {
      const sock = net.createConnection(port, "localhost");
      sock.once("connect", () => { sock.end(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("timeout waiting for port " + port));
        else setTimeout(tryConnect, 400);
      });
    })();
  });
}

function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: true }); } catch (e) {}
}

async function main() {
  console.log("[setup] starting vite on port", PORT);
  const gameDir = path.join(REPO, "apps", "game");
  const child = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: gameDir,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  await waitForPort(PORT, 60000);
  await new Promise((r) => setTimeout(r, 800));
  console.log("[setup] vite ready");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto(`http://localhost:${PORT}/vfx-bench`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__vfxBenchReady === true, { timeout: 15000 });
  await page.evaluate(() => {
    window.__voo.ligar();
    window.__voo.vfxLigar();
  });
  console.log("[setup] page ready, instrumentation on");

  async function runCondition(cond, round) {
    await page.evaluate(() => {
      window.__voo.limpar();
      window.__voo.vfxZerar();
      window.__vfxBench.reset(5);
    });
    await page.waitForTimeout(150);
    const spawned = [];
    for (const idx of cond.skills) {
      const ids = await page.evaluate((i) => window.__vfxBench.spawnAll(i), idx);
      spawned.push({ idx, ids });
    }
    await page.waitForTimeout(2000);
    const relatorio = await page.evaluate(() => window.__voo.vfxRelatorio());
    const json = await page.evaluate(() => window.__voo.json());
    await page.evaluate(() => window.__vfxBench.clear());
    await page.waitForTimeout(300);

    fs.writeFileSync(
      path.join(OUT, `matrix2-${cond.k}-r${round}.json`),
      JSON.stringify({ condition: cond.k, name: cond.name, round, spawned, relatorio, json }, null, 0),
    );

    const resumo = json.resumo || {};
    const eventos = json.eventos || [];
    const cenaRenderer = eventos.filter((e) => e.cat === "cena" || e.cat === "renderer");
    const tipos = {};
    for (const e of cenaRenderer) tipos[e.tipo] = (tipos[e.tipo] || 0) + 1;

    let dominant = null;
    for (const s of relatorio.porSkill || []) {
      if (!dominant || s.avgFrameMsWhileActive > dominant.avgFrameMsWhileActive) dominant = s;
    }

    return {
      cond: cond.k,
      name: cond.name,
      round,
      spawnedCounts: spawned.map((s) => s.ids.length),
      avgFrame: dominant ? dominant.avgFrameMsWhileActive : resumo.quadroMs ? resumo.quadroMs.p50 : 0,
      p95: dominant ? dominant.p95FrameMsWhileActive : resumo.quadroMs ? resumo.quadroMs.p95 : 0,
      max: dominant ? dominant.maxFrameMsWhileActive : resumo.quadroMs ? resumo.quadroMs.max : 0,
      framesAcima33: dominant ? dominant.framesAcima33 : 0,
      framesAcima50: dominant ? dominant.framesAcima50 : 0,
      longTasks: dominant ? dominant.longTasks : 0,
      longTaskMs: dominant ? dominant.longTaskMs : 0,
      domNodes: dominant ? dominant.maxDomNodes : 0,
      htmlNodes: dominant ? dominant.avgHtmlNodes : 0,
      renderMsP50: resumo.renderMs ? resumo.renderMs.p50 : null,
      renderMsP95: resumo.renderMs ? resumo.renderMs.p95 : null,
      gpuMsP50: resumo.gpuMs ? resumo.gpuMs.p50 : null,
      drawCallsP50: resumo.drawCalls ? resumo.drawCalls.p50 : null,
      drawCallsMax: resumo.drawCalls ? resumo.drawCalls.max : null,
      programasP50: resumo.programas ? resumo.programas.p50 : null,
      programasMax: resumo.programas ? resumo.programas.max : null,
      geometriasP50: resumo.geometrias ? resumo.geometrias.p50 : null,
      geometriasMax: resumo.geometrias ? resumo.geometrias.max : null,
      texturasP50: resumo.texturas ? resumo.texturas.p50 : null,
      texturasMax: resumo.texturas ? resumo.texturas.max : null,
      cenaRendererEventCounts: tipos,
      amostras: dominant ? dominant.amostrasDeQuadro : 0,
    };
  }

  const rounds = [[], []];
  for (let r = 0; r < 2; r++) {
    for (const cond of CONDITIONS) {
      const res = await runCondition(cond, r + 1);
      console.log(
        `[round ${r + 1}] ${cond.k} (${cond.name}): spawned=${JSON.stringify(res.spawnedCounts)} avg=${res.avgFrame} p95=${res.p95} max=${res.max} longTaskMs=${res.longTaskMs} dom=${res.domNodes}`,
      );
      rounds[r].push(res);
    }
  }

  await browser.close();
  killTree(child.pid);

  const avg = (a, b) => (a == null || b == null ? null : Math.round(((a + b) / 2) * 100) / 100);
  const final = CONDITIONS.map((cond, i) => {
    const a = rounds[0][i];
    const b = rounds[1][i];
    return {
      cond: cond.k,
      name: cond.name,
      avgFrame: avg(a.avgFrame, b.avgFrame),
      p95: avg(a.p95, b.p95),
      max: avg(a.max, b.max),
      framesAcima33: avg(a.framesAcima33, b.framesAcima33),
      framesAcima50: avg(a.framesAcima50, b.framesAcima50),
      longTasks: avg(a.longTasks, b.longTasks),
      longTaskMs: avg(a.longTaskMs, b.longTaskMs),
      domNodes: avg(a.domNodes, b.domNodes),
      htmlNodes: avg(a.htmlNodes, b.htmlNodes),
      renderMsP50: avg(a.renderMsP50, b.renderMsP50),
      renderMsP95: avg(a.renderMsP95, b.renderMsP95),
      gpuMsP50: avg(a.gpuMsP50, b.gpuMsP50),
      drawCallsP50: avg(a.drawCallsP50, b.drawCallsP50),
      drawCallsMax: avg(a.drawCallsMax, b.drawCallsMax),
      programasP50: avg(a.programasP50, b.programasP50),
      programasMax: avg(a.programasMax, b.programasMax),
      geometriasP50: avg(a.geometriasP50, b.geometriasP50),
      geometriasMax: avg(a.geometriasMax, b.geometriasMax),
      texturasP50: avg(a.texturasP50, b.texturasP50),
      texturasMax: avg(a.texturasMax, b.texturasMax),
      round1: a,
      round2: b,
    };
  });

  fs.writeFileSync(path.join(OUT, "matrix2-a-k.json"), JSON.stringify(final, null, 2));

  let md = "# Matriz A-K (média de 2 rodadas intercaladas, /vfx-bench, 5 instancias/skill)\n\n";
  md += "| Cond | Nome | avgFrame | p95 | max | f>33 | f>50 | longTasks | longTaskMs | domNodes(max) | htmlNodes(avg) | renderMs p50/p95 | gpuMs p50 | draw p50/max | prog p50/max | geom p50/max | tex p50/max |\n";
  md += "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const f of final) {
    md += `| ${f.cond} | ${f.name} | ${f.avgFrame} | ${f.p95} | ${f.max} | ${f.framesAcima33} | ${f.framesAcima50} | ${f.longTasks} | ${f.longTaskMs} | ${f.domNodes} | ${f.htmlNodes} | ${f.renderMsP50}/${f.renderMsP95} | ${f.gpuMsP50} | ${f.drawCallsP50}/${f.drawCallsMax} | ${f.programasP50}/${f.programasMax} | ${f.geometriasP50}/${f.geometriasMax} | ${f.texturasP50}/${f.texturasMax} |\n`;
  }
  fs.writeFileSync(path.join(OUT, "matrix2-a-k.md"), md);

  console.log("\n=== DONE ===");
  console.table(final.map((f) => ({ cond: f.cond, avg: f.avgFrame, p95: f.p95, max: f.max, longTaskMs: f.longTaskMs, dom: f.domNodes })));
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
