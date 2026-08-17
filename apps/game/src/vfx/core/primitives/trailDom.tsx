import type { CSSProperties } from "react";
import type { DomArtRefs, DomArtScreenPoint } from "../renderers/domArtRegistry";

/**
 * `TrailPrimitive` (renderer DOM) — Fase 5, "Trail/Echo": Oráculo (rastro
 * atrás da caveira orbitando) e Fire Ball (rastro atrás da bola voando)
 * usavam CADA UM sua própria implementação artesanal (`or-echo`/`fbi-echo`
 * em `legacyVfxArt.ts`, JSX+update duplicados em `oracleVfxDef.tsx`/
 * `fireBallVfxDef.tsx`). Auditoria confirmou: MESMA estrutura visual (N
 * cópias fantasmas em arco SVG, opacidade/escala decrescendo por índice,
 * `drop-shadow`), só cor/tamanho/traço diferentes — e um terceiro conceito
 * (`fbi-decoy`, estouro atrasado no impacto) que NÃO é a mesma coisa
 * (flash pontual, não rastro contínuo) e fica de fora de propósito.
 *
 * Fronteira real, não CSS renomeado: a SKILL não sabe como um eco é
 * desenhado (isto aqui — JSX + escrita de `transform`/`display`), só
 * fornece DOIS pedaços de conhecimento que são dela por natureza:
 *   1. `style` (`TrailStyle`) — a receita visual (cor, tamanho, glow, traço,
 *      formas do arco em cada paridade de índice);
 *   2. `positionAtLag(i)` — ONDE o eco `i` deveria estar agora, que só a
 *      skill sabe calcular (Oráculo: `ângulo - lag` numa órbita circular;
 *      Fire Ball: `progresso - lag` numa trajetória reta). A PRIMITIVE nunca
 *      inventa movimento — só posiciona o que a skill calculou.
 *
 * Hoje só existe a implementação DOM (`TrailEchoes`/`updateTrailEchoes`).
 * Renderer GPU para esta primitive NÃO existe ainda — documentado como gap
 * real em `docs/claude-context/09-vfx-gpu-migration.md` (Caso E: nenhum
 * renderer GPU existente representa "N cópias na posição EXATA que a skill
 * mandou" sem trabalho novo de renderer, não forçado aqui).
 */

export interface TrailStyle {
  /** largura/altura da caixa do arco, em px — MESMOS valores que
   * `viewBox`, os dois casos reais (Oráculo 40×16, Fire Ball 80×32) têm
   * viewBox idêntico à caixa. */
  widthPx: number;
  heightPx: number;
  opacityBase: number;
  opacityStep: number;
  scaleStep: number;
  glowPx: number;
  glowColor: string;
  strokeColor: string;
  strokeWidth: number;
  /** paridade do índice decide qual arco usar (mesmo truque visual das
   * duas implementações originais: "sobe" vs "desce" alternado). */
  pathEven: string;
  pathOdd: string;
}

export interface TrailSpec {
  count: number;
  style: TrailStyle;
}

const FREE_POS_STYLE: CSSProperties = { position: "absolute", left: 0, top: 0, pointerEvents: "none" };

/**
 * JSX estrutural — monta uma vez, cada `<div ref>` vira um ref nomeado
 * `${refPrefix}-${i}` pro `update` escrever depois. `tscaleStyle`
 * (`--tscale`) é opcional: só a versão do Fire Ball escala pelo tamanho do
 * alvo, o Oráculo nunca setava essa variável no eco original (preservado:
 * omitir o prop reproduz o comportamento antigo byte a byte, `--tscale`
 * cai no default `1` do CSS).
 */
export function TrailEchoes({
  spec,
  refPrefix,
  registerRef,
  tscaleStyle,
}: {
  spec: TrailSpec;
  refPrefix: string;
  registerRef: (name: string, el: HTMLElement | null) => void;
  tscaleStyle?: CSSProperties;
}) {
  const { count, style } = spec;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} ref={(el) => registerRef(`${refPrefix}-${i}`, el)} style={{ ...FREE_POS_STYLE, display: "none" }}>
          <svg
            className="vfx-trail-echo"
            viewBox={`0 0 ${style.widthPx} ${style.heightPx}`}
            style={
              {
                "--echoi": String(i),
                "--srot": `${(i * 53) % 360}deg`,
                "--tw": `${style.widthPx}px`,
                "--th": `${style.heightPx}px`,
                "--op0": String(style.opacityBase),
                "--opstep": String(style.opacityStep),
                "--scalestep": String(style.scaleStep),
                "--glowpx": `${style.glowPx}px`,
                "--glowcolor": style.glowColor,
                "--strokecolor": style.strokeColor,
                "--strokew": String(style.strokeWidth),
                ...tscaleStyle,
              } as CSSProperties
            }
          >
            <path d={i % 2 === 0 ? style.pathEven : style.pathOdd} fill="none" />
          </svg>
        </div>
      ))}
    </>
  );
}

/**
 * Escreve a posição de CADA eco a partir da trajetória fornecida pela
 * skill. `positionAtLag(i)` devolve o offset LOCAL (unidades de célula) do
 * eco `i` no instante atual, ou `null` se ele não deve estar visível
 * (ex.: Fire Ball esconde os ecos depois que a bola chega no alvo).
 */
export function updateTrailEchoes(
  refs: DomArtRefs,
  refPrefix: string,
  count: number,
  positionAtLag: (index: number) => { x: number; y: number; z: number } | null,
  project: (dx: number, dy: number, dz: number) => DomArtScreenPoint | null,
): void {
  for (let i = 0; i < count; i++) {
    const el = refs[`${refPrefix}-${i}`] as HTMLDivElement | undefined;
    if (!el) continue;
    const local = positionAtLag(i);
    if (!local) {
      el.style.display = "none";
      continue;
    }
    const screen = project(local.x, local.y, local.z);
    if (!screen) continue;
    el.style.display = "block";
    el.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) scale(${screen.scale})`;
  }
}
