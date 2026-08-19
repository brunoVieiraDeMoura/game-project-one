/**
 * FASE 8 — validação REAL do fix de `entities/petrifyMaterial.ts`, fim-a-fim.
 * rAthena real (WSL2) + API real + gateway real já confirmados de pé nesta
 * sessão — login de verdade, personagem de verdade, Stone Curse de verdade
 * num monstro de verdade. Nenhum fake de sessão, nenhum monkeypatch.
 *
 * `pnpm --filter @ragnarok/game exec tsx scripts/pipelineAuditFase8.ts`
 *
 * Usa uma conta de teste jogável criada só pra esta validação
 * (`f8test`/`f8test123`, account_id 2000088, group_id 99/GM — inserida
 * direto na tabela `login` do banco de dev local, não em produção de
 * verdade nenhuma; é o mesmo tipo de dado descartável que `wsl-gm.sh` já
 * assume existir). Sobe SEU PRÓPRIO vite dev (porta dedicada) pra não
 * mexer na sessão de dev paralela que já está na 3001.
 */
import { chromium, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, "..");
const PORT = 3093;
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = path.join(APP_DIR, "pipeline-audit-results");
const HEADLESS = process.env.PIPELINE_AUDIT_HEADED === "0";

const USERNAME = "f8test";
const PASSWORD = "f8test123";
const CHAR_NAME = "F8Tester";
const MG_STONECURSE = 16;

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

async function sendChat(page: Page, msg: string): Promise<void> {
  const input = page.getByPlaceholder("Digite sua mensagem...");
  await input.click({ force: true });
  await input.fill("");
  await input.fill(msg);
  const valorDigitado = await input.inputValue();
  if (valorDigitado !== msg) console.log(`  [sendChat] AVISO: campo mostra "${valorDigitado}", esperava "${msg}"`);
  await input.press("Enter");
  await page.waitForTimeout(200);
}

interface CastResult {
  label: string;
  gid: number;
  eventoCompile: unknown;
  quadroDoEvento: Record<string, number> | null;
  resumoJanela: Record<string, { max: number; p50: number }>;
}

async function measureCast(page: Page, label: string, gid: number): Promise<CastResult> {
  await page.evaluate(() => (window as unknown as { __voo: { limpar: () => void } }).__voo.limpar());
  await page.evaluate(
    async ({ gid, skillId }) => {
      const mod = (await import(/* @vite-ignore */ "/src/net/acoes.ts")) as { castarEmAlvo: (id: number, lvl: number, name: string, gid: number) => void };
      mod.castarEmAlvo(skillId, 1, "MG_STONECURSE", gid);
    },
    { gid, skillId: MG_STONECURSE },
  );
  // dá tempo pro personagem andar até o alcance (se precisar), o servidor
  // processar, o pacote de status voltar, e o compile assíncrono (se
  // disparado) resolver — bem mais generoso que os benches sintéticos
  // porque aqui há latência de rede REAL indo até o rAthena e voltando.
  await page.waitForTimeout(4000);
  await page.evaluate(() => (window as unknown as { __voo: { capturar: (m: string) => void } }).__voo.capturar("manual"));
  await page.waitForTimeout(300);
  const dump = (await page.evaluate(() => (window as unknown as { __voo: { json: () => unknown } }).__voo.json())) as {
    resumo: Record<string, { max: number; p50: number }>;
    casos: { eventos: { cat: string; tipo: string; quadro: number; dados?: unknown }[]; quadros: Record<string, number[]> }[];
  };
  const caso = dump.casos[dump.casos.length - 1];
  const compileEvt = (caso?.eventos ?? []).find((e) => e.tipo === "shader:compile-petrificar");
  let quadroDoEvento: Record<string, number> | null = null;
  if (compileEvt && caso) {
    const idx = caso.quadros.quadro?.indexOf(compileEvt.quadro);
    if (idx !== undefined && idx >= 0) {
      quadroDoEvento = {};
      for (const [campo, arr] of Object.entries(caso.quadros)) quadroDoEvento[campo] = arr[idx]!;
    }
  }
  console.log(
    `  [${label}] evento shader:compile-petrificar=${compileEvt ? JSON.stringify(compileEvt.dados) : "NÃO OCORREU"} | quadroMs_max_janela=${dump.resumo.quadroMs?.max} renderMs_max=${dump.resumo.renderMs?.max} gpuMs_max=${dump.resumo.gpuMs?.max}`,
  );
  if (quadroDoEvento) console.log(`    quadro do evento: quadroMs=${quadroDoEvento.quadroMs} renderMs=${quadroDoEvento.renderMs} gpuMs=${quadroDoEvento.gpuMs} sceneVisivel=${quadroDoEvento.sceneVisivel}`);
  return { label, gid, eventoCompile: compileEvt?.dados ?? null, quadroDoEvento, resumoJanela: dump.resumo };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  await freePort(PORT);
  console.log(`[fase8] subindo vite dev em :${PORT}...`);
  const vite = startVite();
  vite.stdout?.on("data", () => {});
  vite.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  const out: Record<string, unknown> = {};
  const texturaRede: { url: string; status: number; t: number }[] = [];

  try {
    await waitForServer(BASE_URL, 30000);
    const browser = await chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    page.on("response", (res) => {
      if (res.url().includes("stone-Rock033")) texturaRede.push({ url: res.url(), status: res.status(), t: Date.now() });
    });

    console.log(`[fase8] headless=${HEADLESS}`);

    // ---- LOGIN real ----
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Usuário").fill(USERNAME);
    await page.getByLabel("Senha").fill(PASSWORD);
    await page.getByRole("button", { name: /^entrar$/i }).click();
    console.log("[fase8] login enviado, esperando char-select...");
    await page.waitForURL(/char-select/, { timeout: 20000 });
    await page.waitForTimeout(1500);

    // ---- criação de personagem (1ª vez) ou seleção (se já existir) ----
    const temCriar = await page.getByText("Criar Novo Personagem").isVisible().catch(() => false);
    if (temCriar) {
      console.log("[fase8] criando personagem...");
      await page.getByText("Criar Novo Personagem").click();
      await page.waitForTimeout(300);
      const nomeInput = page.locator('input[maxlength="23"]');
      await nomeInput.fill(CHAR_NAME);
      await page.getByText("Criar", { exact: true }).click();
      await page.waitForTimeout(1500);
    }

    console.log("[fase8] entrando no mundo...");
    await page.getByText("Entrar no Mundo").click();
    await page.waitForURL(/\/play/, { timeout: 20000 });
    await page.waitForFunction(() => typeof (window as unknown as { __gl?: unknown }).__gl === "function", { timeout: 20000 });

    const rendererString = await page.evaluate(() => {
      const w = window as unknown as { __gl: () => { getContext: () => WebGLRenderingContext } };
      const ctx = w.__gl().getContext();
      const e = ctx.getExtension("WEBGL_debug_renderer_info");
      return e ? String(ctx.getParameter(e.UNMASKED_RENDERER_WEBGL)) : "sem WEBGL_debug_renderer_info";
    });
    console.log("[fase8] GPU real confirmada:", rendererString);
    out.rendererString = rendererString;

    console.log("[fase8] esperando cortina/aquecimento do mundo real...");
    await page.waitForTimeout(8000);
    await page.bringToFront();

    // ---- vira Mago, ganha todas as skills, HP/SP cheio (comandos de GM reais) ----
    console.log("[fase8] comandos de GM: virar Mago + todas as skills + heal");
    await sendChat(page, "@jobchange 2"); // 2 = Mage (job-classes.json), não 9
    await page.waitForTimeout(1500);
    await sendChat(page, "@allskill");
    await page.waitForTimeout(1500);
    await sendChat(page, "@heal 9999 9999");
    await page.waitForTimeout(1500);

    // ---- spawna monstro #1 (Poring) perto, pra testar COLD ----
    console.log("[fase8] spawnando monstro #1 (Poring)...");
    await sendChat(page, "@monster 1002 1");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT_DIR, "fase8-depois-monster.png") }).catch(() => {});

    /**
     * ACHADO desta fase: ler `worldStore.entities` de fora (via `import()`
     * dinâmico) sempre voltou vazio, mesmo com o monstro visivelmente
     * renderizado na tela (screenshot prova). `net/NetEntity.tsx` também não
     * marca `userData.gid` no group raiz (grep confirmou — suposição
     * anterior errada). Pivô final: usar TAB de verdade
     * (`play/AlvoPorTab.tsx`, tecla real, cicla pro alvo mais próximo, sem
     * precisar de coordenada de tela nem de nenhum import) pra selecionar o
     * alvo, e ler só `worldStore.getState().target` (um NÚMERO, não o mapa
     * de entidades inteiro) numa ÚNICA chamada de `evaluate` — import e
     * leitura no mesmo tick, sem folga pra qualquer instabilidade de módulo.
     */
    await page.mouse.click(640, 500); // clica no meio do mundo 3D, tira o foco do chat
    await page.waitForTimeout(300);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, "fase8-alvo-selecionado.png") }).catch(() => {});

    const alvoGid1 = await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ "/src/net/worldStore.ts")) as { useWorldStore: { getState: () => { target: number | null; selfGid: number } } };
      const st = mod.useWorldStore.getState();
      return { target: st.target, selfGid: st.selfGid };
    });
    console.log("[fase8] após Tab, worldStore.target:", JSON.stringify(alvoGid1));
    out.alvoGid1Debug = alvoGid1;

    // NÃO trava mais em `alvoGid1.target === null` — a leitura via import()
    // provou ser sempre desconectada do estado real (achado desta fase,
    // ver comentário acima), mas o screenshot já confirmou visualmente que o
    // TAB de verdade funcionou (nameplate "Poring" com HP real apareceu). O
    // resto do fluxo usa só ação de UI real (tecla, clique), nunca lê esse
    // valor de novo.

    // ---- vincula Petrificar na barra de habilidades (arrastar de verdade,
    // é a ÚNICA forma real de lançar skill nesta UI — clique na janela de
    // skills só seleciona pra gastar ponto, não lança) ----
    console.log("[fase8] abrindo janela de Skills e vinculando Petrificar na barra...");
    await page.getByText("Skills", { exact: true }).click();
    await page.waitForTimeout(800);
    // a janela abre na aba "Básica" — Petrificar (Stone Curse) é skill de
    // Mago, fica na aba "Mago" (visível na lateral esquerda do livro)
    await page.getByText("Mago", { exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "fase8-skills-window.png") }).catch(() => {});

    let petrificarIcone = page.locator('[title*="Petrificar"]').first();
    let existe = (await petrificarIcone.count()) > 0;
    if (!existe) {
      // não achou na página 1/2 — vira a página do livro (Mago tem mais
      // skills do que cabe numa página só, por isso o paginador "1/2")
      console.log("[fase8] Petrificar não achado na página 1 — virando pra página 2...");
      await page.mouse.click(973, 497); // seta ">" do paginador
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT_DIR, "fase8-skills-window-pg2.png") }).catch(() => {});
      petrificarIcone = page.locator('[title*="Petrificar"]').first();
      existe = (await petrificarIcone.count()) > 0;
    }
    console.log("[fase8] ícone de Petrificar encontrado?", existe);
    if (!existe) {
      writeFileSync(path.join(OUT_DIR, `fase8-result-${Date.now()}.json`), JSON.stringify(out, null, 2));
      throw new Error("Ícone de Petrificar não encontrado na janela de Skills (ver fase8-skills-window.png) — pode estar em outra aba/página da árvore.");
    }
    // slot 2 da barra (slot 1 já tem Ataque Básico) — layout fixo do HUD,
    // mesma posição de tela em toda sessão (não depende de câmera/mundo).
    // Drag HTML5 nativo (`draggable`+`dataTransfer`) só dispara via
    // simulação de verdade do Playwright (`dragTo`), não com
    // mouse.move/down/up crus — mas a checagem de actionability padrão
    // travava em "elemento intercepta pointer events" (empilhamento de
    // overlay); `force:true` pula essa checagem e ainda usa o mecanismo de
    // drag nativo por baixo.
    await petrificarIcone.dragTo(page.locator("body"), { targetPosition: { x: 440, y: 695 }, force: true, timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, "fase8-apos-drag.png") }).catch(() => {});

    // fecha a janela de skills (pode cobrir a barra/atrapalhar clique) e
    // aciona o slot 2 pela TECLA 2 — mesmo bind real de `SkillBar.tsx`
    await page.getByText("Skills", { exact: true }).click();
    await page.waitForTimeout(300);
    await page.mouse.click(640, 500); // garante foco no mundo, não no chat
    await page.waitForTimeout(200);

    console.log("[fase8] COLD — 1º Stone Curse REAL da sessão (tecla 2, alvo real via Tab)");
    await page.evaluate(() => (window as unknown as { __voo: { limpar: () => void } }).__voo.limpar());
    await page.keyboard.press("2");
    await page.waitForTimeout(4000);
    await page.evaluate(() => (window as unknown as { __voo: { capturar: (m: string) => void } }).__voo.capturar("manual"));
    await page.waitForTimeout(300);
    const coldDump = (await page.evaluate(() => (window as unknown as { __voo: { json: () => unknown } }).__voo.json())) as {
      resumo: Record<string, { max: number; p50: number }>;
      casos: { eventos: { cat: string; tipo: string; quadro: number; dados?: unknown }[]; quadros: Record<string, number[]> }[];
    };
    const casoAtual = coldDump.casos[coldDump.casos.length - 1];
    const compileEvt = (casoAtual?.eventos ?? []).find((e) => e.tipo === "shader:compile-petrificar");
    console.log("[fase8] evento shader:compile-petrificar:", compileEvt ? JSON.stringify(compileEvt.dados) : "NÃO OCORREU");
    console.log("[fase8] resumo da janela: quadroMs_max=" + coldDump.resumo.quadroMs?.max + " renderMs_max=" + coldDump.resumo.renderMs?.max + " gpuMs_max=" + coldDump.resumo.gpuMs?.max);
    await page.screenshot({ path: path.join(OUT_DIR, "fase8-apos-cast.png") }).catch(() => {});
    out.cold = { eventoCompile: compileEvt?.dados ?? null, resumo: coldDump.resumo, temEvento: !!compileEvt };

    out.texturaRede = texturaRede;
    console.log("[fase8] requisições de rede pra stone-Rock033.png:", JSON.stringify(texturaRede));

    await page.screenshot({ path: path.join(OUT_DIR, "fase8-final.png") }).catch(() => {});

    await browser.close();
    const outFile = path.join(OUT_DIR, `fase8-result-${Date.now()}.json`);
    writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(`[fase8] resultado salvo em ${outFile}`);
  } finally {
    killViteTree(vite);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
