/**
 * MATRIZ DE BENCHMARK TEMPORÁRIA — Fire Wall (leia1.txt, investigação do
 * custo residual DEPOIS da agregação de 19→1 `<Html>`).
 *
 * Não é código de produto: é um interruptor de DIAGNÓSTICO, lido por
 * `FireWallVisual` (`FireWallCell.tsx`) pra montar variantes controladas —
 * menos brasas, sem filtro, sem animação secundária — sem tocar a
 * implementação real em 8 lugares diferentes. Nasce no estado PADRÃO (igual
 * à produção, `config` idêntico ao que sempre existiu) e só muda quando
 * alguém chama `window.__fwBench.set(...)` explicitamente pelo console —
 * nenhum jogador em produção encosta nisto.
 *
 * REMOVER este arquivo (e as leituras dele em `FireWallCell.tsx`) depois
 * que a investigação terminar e a mudança definitiva for decidida.
 */

export interface FireWallBenchConfig {
  /** 0..40 — quantas brasas desenhar (fatia do array já construído, nunca reconstrói) */
  emberCount: number;
  showGlow: boolean;
  showLicks: boolean;
  showSmoke: boolean;
  /** `filter` é a propriedade suspeita (blur/drop-shadow, 7 elementos no total) */
  filterMode: "all" | "blurOnly" | "dropShadowOnly" | "none";
  /** glow pulse + column sway + lick sway + smoke rise — NÃO inclui a chama principal nem as brasas */
  animateSecondary: boolean;
  /** flicker do `.fw-column__core` — a "chama principal" */
  animateCore: boolean;
  animateEmbers: boolean;
}

export const FIRE_WALL_BENCH_DEFAULT: FireWallBenchConfig = {
  emberCount: 40,
  showGlow: true,
  showLicks: true,
  showSmoke: true,
  filterMode: "all",
  animateSecondary: true,
  animateCore: true,
  animateEmbers: true,
};

let config: FireWallBenchConfig = { ...FIRE_WALL_BENCH_DEFAULT };

export function fireWallBenchConfig(): FireWallBenchConfig {
  return config;
}

const OVERRIDE_STYLE_ID = "fire-wall-bench-override";

/** classes com `filter: blur(...)` (2) vs `filter: drop-shadow(...)` (5) — auditado direto do CSS, não chutado */
const BLUR_CLASSES = [".fw-glow", ".fw-smoke"];
const DROPSHADOW_CLASSES = [".fw-column__core", ".fw-lick"];

function aplicarOverrideCss(cfg: FireWallBenchConfig): void {
  if (typeof document === "undefined") return;
  let tag = document.getElementById(OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = OVERRIDE_STYLE_ID;
    document.head.appendChild(tag);
  }

  const regras: string[] = [];
  if (cfg.filterMode === "none") {
    regras.push(`${[...BLUR_CLASSES, ...DROPSHADOW_CLASSES].join(",")} { filter: none !important; }`);
  } else if (cfg.filterMode === "blurOnly") {
    regras.push(`${DROPSHADOW_CLASSES.join(",")} { filter: none !important; }`);
  } else if (cfg.filterMode === "dropShadowOnly") {
    regras.push(`${BLUR_CLASSES.join(",")} { filter: none !important; }`);
  }
  if (!cfg.animateSecondary) {
    regras.push(`.fw-glow, .fw-column, .fw-lick, .fw-smoke { animation: none !important; }`);
  }
  if (!cfg.animateCore) {
    regras.push(`.fw-column__core { animation: none !important; }`);
  }
  if (!cfg.animateEmbers) {
    // congela VISÍVEL (não em 0, que é o estado inicial do keyframe) — senão
    // "sem animação" ficaria indistinguível de "sem brasa nenhuma"
    regras.push(`.fw-ember { animation: none !important; opacity: 0.7 !important; }`);
  }
  tag.textContent = regras.join("\n");
}

export function setFireWallBenchConfig(parcial: Partial<FireWallBenchConfig>): void {
  config = { ...config, ...parcial };
  aplicarOverrideCss(config);
}

export function resetFireWallBenchConfig(): void {
  config = { ...FIRE_WALL_BENCH_DEFAULT };
  aplicarOverrideCss(config);
  document.getElementById(OVERRIDE_STYLE_ID)?.remove();
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __fwBench?: unknown }).__fwBench = {
    set: setFireWallBenchConfig,
    reset: resetFireWallBenchConfig,
    get: fireWallBenchConfig,
  };
}
