import type * as THREE from "three";

/**
 * DIAGNÓSTICO do prewarm de shader do VFX Core — DEV-only, mesmo padrão de
 * `core/diagnostics/rendererProbe.ts` (custo zero em produção,
 * `import.meta.env.DEV` vira `false` estático no build).
 *
 * Existe pra responder, ao vivo, a pergunta que motivou o prewarm: "o
 * renderer novo (pós disconnect/reconnect) ainda compila shader durante o
 * primeiro cast de verdade?" — sem isso, a única forma de provar era a
 * instrumentação frame-síncrona manual usada na investigação (removida
 * depois de cada rodada). Esta fica, porque o prewarm é uma peça real de
 * arquitetura agora, não mais uma hipótese.
 */

interface PrewarmGeracao {
  geracao: number;
  programsAntes: number;
  programsDepoisSync: number;
  inicioEm: number;
  fimEm?: number;
  programsDepoisAsync?: number;
}

const geracoes: PrewarmGeracao[] = [];
let geracaoAtual = 0;

export function prewarmDiagStart(gl: THREE.WebGLRenderer): PrewarmGeracao {
  geracaoAtual++;
  const g: PrewarmGeracao = {
    geracao: geracaoAtual,
    programsAntes: gl.info.programs?.length ?? -1,
    programsDepoisSync: -1,
    inicioEm: performance.now(),
  };
  geracoes.push(g);
  if (geracoes.length > 8) geracoes.shift();
  return g;
}

export function prewarmDiagSync(g: PrewarmGeracao, gl: THREE.WebGLRenderer): void {
  g.programsDepoisSync = gl.info.programs?.length ?? -1;
}

export function prewarmDiagEnd(g: PrewarmGeracao, gl: THREE.WebGLRenderer): void {
  g.fimEm = performance.now();
  g.programsDepoisAsync = gl.info.programs?.length ?? -1;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __vfxPrewarm?: unknown }).__vfxPrewarm = {
    /** todas as gerações registradas nesta sessão (até 8, mais recente por último) */
    geracoes: () => geracoes.map((g) => ({ ...g })),
    /** a mais recente */
    atual: () => (geracoes.length ? { ...geracoes[geracoes.length - 1] } : null),
  };
}
