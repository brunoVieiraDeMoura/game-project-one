/**
 * MATRIZ DE BENCHMARK TEMPORÁRIA — Oráculo (Fase 5, Etapa 6: leia1.txt
 * "antes de migrar o Oracle pra GPU, decompor visualmente sua receita
 * atual e medir quanto cada elemento custa" — não assumir, medir).
 *
 * Mesmo padrão de `fire-wall/fireWallBenchConfig.ts`: um interruptor de
 * DIAGNÓSTICO lido por `oracleVfxDef.tsx` pra montar variantes controladas
 * — sem caveira/glow/eco/partícula, sem filtro — sem duplicar a
 * implementação real. Nasce no estado PADRÃO (idêntico à produção) e só
 * muda via `window.__oracleBench.set(...)` pelo console/benchmark script —
 * nenhum jogador em produção encosta nisto.
 *
 * REMOVER este arquivo (e as leituras dele em `oracleVfxDef.tsx`) depois
 * que a decisão de migração do Oráculo for tomada com os números medidos.
 */

export interface OracleBenchConfig {
  /** 0..14 — quantos ecos de rastro por caveira (produção: 14, `TRAIL_LAGS_DEG`) */
  echoCountPerSkull: number;
  /** 0..66 — quantas partículas de área (produção: 66, `AREA_PARTICLE_COUNT`) */
  glimmerCount: number;
  /** `.or-skull__glow` (radial-gradient + `blur(3px)`) — elemento inteiro, não só o filtro */
  showSkullGlow: boolean;
  /** `.or-skull { filter: drop-shadow(11px) drop-shadow(26px) }` */
  skullFilterMode: "all" | "none";
  /** `.or-echo { filter: drop-shadow(3px) }` */
  echoFilterMode: "all" | "none";
  /** Fase 5, rodada "isolamento do custo do document-connected tree",
   * controle C/D: quando `true`, `updateOracle()` (`oracleVfxDef.tsx`)
   * retorna sem escrever NENHUM `style`/`transform` — a árvore inteira
   * (DOM, React, portal, SVG) continua exatamente igual, só para de mudar
   * quadro a quadro. Isola "árvore complexa parada" de "árvore complexa
   * sendo escrita todo quadro", sem remover React nem desconectar nada. */
  freezeUpdates: boolean;
  /** Fase 5, rodada "isolar CSS animation dos glimmers" — `.or-glimmer`
   * continua existindo, mesma contagem, mesma estrutura, MESMO React;
   * `"off"` só injeta `animation: none !important` por cima (mesma técnica
   * de `skullFilterMode`/`echoFilterMode`). Isola "glimmer DOM existir" de
   * "glimmer DOM + animação CSS `infinite` ativa". */
  glimmerAnimationMode: "on" | "off";
  /** Fase 5, rodada "por que orGlimmer custa mesmo culled" — troca `"off"`
   * (fixo em `animation:none`, já medido) por um controle mais fino: manter
   * a MESMA animation-name/duration/iteration-count, só pausar a
   * execução (`animation-play-state`) ou tornar o glimmer invisível por
   * `visibility` (mecanismo DIFERENTE do `display:none` que o culling já
   * aplica no ancestral da instância inteira). `"running"` = padrão. */
  glimmerPlayState: "running" | "paused";
  /** `visibility:hidden` no PRÓPRIO `.or-glimmer` (não no ancestral da
   * instância, que já fica `display:none` quando culled) — mecanismo de
   * invisibilidade DIFERENTE de `display:none`, com a animation
   * continuando `running`. */
  glimmerVisibilityHidden: boolean;
}

export const ORACLE_BENCH_DEFAULT: OracleBenchConfig = {
  echoCountPerSkull: 14,
  glimmerCount: 66,
  showSkullGlow: true,
  skullFilterMode: "all",
  echoFilterMode: "all",
  freezeUpdates: false,
  glimmerAnimationMode: "on",
  glimmerPlayState: "running",
  glimmerVisibilityHidden: false,
};

let config: OracleBenchConfig = { ...ORACLE_BENCH_DEFAULT };

export function oracleBenchConfig(): OracleBenchConfig {
  return config;
}

const OVERRIDE_STYLE_ID = "oracle-bench-override";

function aplicarOverrideCss(cfg: OracleBenchConfig): void {
  if (typeof document === "undefined") return;
  let tag = document.getElementById(OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = OVERRIDE_STYLE_ID;
    document.head.appendChild(tag);
  }

  const regras: string[] = [];
  if (cfg.skullFilterMode === "none") regras.push(`.or-skull { filter: none !important; }`);
  if (cfg.echoFilterMode === "none") regras.push(`.or-echo { filter: none !important; }`);
  if (cfg.glimmerAnimationMode === "off") regras.push(`.or-glimmer { animation: none !important; }`);
  if (cfg.glimmerPlayState === "paused") regras.push(`.or-glimmer { animation-play-state: paused !important; }`);
  if (cfg.glimmerVisibilityHidden) regras.push(`.or-glimmer { visibility: hidden !important; }`);
  tag.textContent = regras.join("\n");
}

export function setOracleBenchConfig(parcial: Partial<OracleBenchConfig>): void {
  config = { ...config, ...parcial };
  aplicarOverrideCss(config);
}

export function resetOracleBenchConfig(): void {
  config = { ...ORACLE_BENCH_DEFAULT };
  document.getElementById(OVERRIDE_STYLE_ID)?.remove();
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __oracleBench?: unknown }).__oracleBench = {
    set: setOracleBenchConfig,
    reset: resetOracleBenchConfig,
    get: oracleBenchConfig,
  };
}
