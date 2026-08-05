import type * as THREE from "three";

/**
 * Contadores de desempenho do cliente 3D — o mínimo para parar de otimizar no
 * escuro.
 *
 * Medir com `requestAnimationFrame` de fora (pelo console) mistura duas coisas
 * que não são a mesma: o intervalo entre quadros (que o navegador ESTRANGULA
 * quando a aba não está em foco — foi o que me fez ler 30 FPS num editor que
 * roda a 60) e o trabalho que a cena realmente dá. Aqui a amostra vem de dentro
 * do laço do three, junto com `gl.info`, que é a única fonte de draw call e
 * triângulo REALMENTE desenhados no quadro.
 *
 * Tudo mora em módulo, não em estado do React: o overlay lê por
 * `requestAnimationFrame` e escreve no DOM por ref. Passar 60 amostras por
 * segundo por `setState` repintaria a árvore inteira — o mesmo erro que o
 * cronômetro da barra de skills já evita.
 */

/** quantos quadros o histograma guarda (~5 s a 60 FPS) */
const JANELA = 300;

const amostras = new Float32Array(JANELA);
let n = 0;
let escrita = 0;

/** construção de geometria de chunk, acumulada desde o boot */
const build = { chunks: 0, ms: 0 };
/** e a janela de 1 s, para mostrar "agora" em vez do acumulado */
let buildJanela = { t0: 0, chunks: 0, ms: 0 };
let buildRecente = { chunks: 0, ms: 0 };

let renderer: THREE.WebGLRenderer | null = null;

/**
 * Histórico de texturas vivas — para acusar VAZAMENTO.
 *
 * Textura de GPU não aparece em teste (não há WebGL no vitest), então a guarda
 * mora aqui. Em regime o número tem de ser PLANO: sobe quando um mapa novo
 * carrega e desce quando ele sai. Medido no jogo com o personagem parado num
 * campo com mob: 4.042 texturas vivas contra 5 referenciadas pela cena, subindo
 * 1,8 por segundo — os saltos batiam com spawn de entidade.
 */
const historicoTex: { t: number; n: number }[] = [];
const JANELA_VAZAMENTO_MS = 10_000;

export function registrarRenderer(gl: THREE.WebGLRenderer | null): void {
  renderer = gl;
}

/** o custo de montar chunks de terreno, chamado por quem monta */
export function registrarBuild(chunks: number, ms: number): void {
  if (chunks <= 0) return;
  build.chunks += chunks;
  build.ms += ms;
  buildJanela.chunks += chunks;
  buildJanela.ms += ms;
}

export function registrarQuadro(dtMs: number): void {
  amostras[escrita] = dtMs;
  escrita = (escrita + 1) % JANELA;
  if (n < JANELA) n++;

  const agora = performance.now();
  // amostra o número de texturas uma vez por segundo (não por quadro)
  const ultima = historicoTex[historicoTex.length - 1];
  if (renderer && (!ultima || agora - ultima.t > 1000)) {
    historicoTex.push({ t: agora, n: renderer.info.memory.textures });
    while (historicoTex.length > 1 && agora - historicoTex[0]!.t > JANELA_VAZAMENTO_MS) historicoTex.shift();
  }
  if (buildJanela.t0 === 0) buildJanela.t0 = agora;
  else if (agora - buildJanela.t0 >= 1000) {
    buildRecente = { chunks: buildJanela.chunks, ms: Math.round(buildJanela.ms * 10) / 10 };
    buildJanela = { t0: agora, chunks: 0, ms: 0 };
  }
}

export interface PerfSnapshot {
  fps: number;
  p50: number;
  p99: number;
  pior: number;
  quadros: number;
  chunksPorSegundo: number;
  msDeChunkPorSegundo: number;
  chunksTotal: number;
  msDeChunkTotal: number;
  calls: number;
  triangulos: number;
  programas: number;
  geometrias: number;
  texturas: number;
  /** quantas texturas a mais nos últimos 10 s — em regime tem de ser 0 */
  texturasVazando: number;
}

const ordenado = new Float32Array(JANELA);

export function perfSnapshot(): PerfSnapshot {
  ordenado.set(amostras.subarray(0, n));
  const fatia = ordenado.subarray(0, n);
  fatia.sort();
  const q = (p: number) => (n === 0 ? 0 : Math.round(fatia[Math.min(n - 1, Math.floor(n * p))]! * 10) / 10);
  const p50 = q(0.5);
  const info = renderer?.info;
  return {
    fps: p50 > 0 ? Math.round(1000 / p50) : 0,
    p50,
    p99: q(0.99),
    pior: n === 0 ? 0 : Math.round(fatia[n - 1]! * 10) / 10,
    quadros: n,
    chunksPorSegundo: buildRecente.chunks,
    msDeChunkPorSegundo: buildRecente.ms,
    chunksTotal: build.chunks,
    msDeChunkTotal: Math.round(build.ms),
    calls: info?.render.calls ?? 0,
    triangulos: info?.render.triangles ?? 0,
    programas: info?.programs?.length ?? 0,
    geometrias: info?.memory.geometries ?? 0,
    texturas: info?.memory.textures ?? 0,
    texturasVazando:
      historicoTex.length > 1 ? Math.max(0, historicoTex[historicoTex.length - 1]!.n - historicoTex[0]!.n) : 0,
  };
}
