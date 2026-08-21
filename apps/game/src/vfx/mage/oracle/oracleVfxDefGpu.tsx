import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Oráculo em GPU (Fase 5, rodada "migração agressiva performance-first") —
 * PROTÓTIPO com 4 orçamentos visuais (LOW/MEDIUM/HIGH/ULTRA), comparados
 * entre si e contra a versão DOM real via `oracleRenderMode.ts`. A versão
 * DOM (`oracleVfxDef.tsx`) é INTOCADA — nem importada aqui.
 *
 * Oracle foi o PRIMEIRO penhasco confirmado do combo (44→8fps ao entrar,
 * Fase 5 anterior, decomposição incremental) — candidata #1 de migração
 * por pedido explícito do usuário.
 *
 * Composição (3 caveiras orbitando + rastro + partículas de área — mesma
 * identidade visual: forma, cor, movimento, "sensação de poder"):
 *   - 3× `sprite` (uma caveira cada) com órbita genérica
 *     (`payload.orbitRadius/orbitSpeedDegPerSec/orbitAngle0Deg`, ver
 *     `orbitOffset.ts` — sem `if ORACLE` em nenhum renderer);
 *   - 3× `trail` (rastro de cada caveira, MESMOS parâmetros de órbita —
 *     LOW não tem, MEDIUM/HIGH/ULTRA têm com tamanho crescente);
 *   - 1× `particle` (as partículas de área/"glimmers" — a distribuição
 *     radial seed+delay+dur que `ParticleRenderer.buildParticles` já faz
 *     é estruturalmente a MESMA fórmula que `oracleVfxDef.tsx:
 *     buildAreaParticles` usava, só sem DOM).
 *
 * Reduzido deliberadamente vs. a versão DOM (permitido/pedido
 * explicitamente): sem glow radial separado por caveira, sem drop-shadow/
 * filter algum — tudo shader puro. Contagens exatas por tier abaixo,
 * calibradas por benchmark (não chutadas às cegas).
 *
 * ## Rodada seguinte (5 pedidos)
 *
 * 1. Raio da órbita/glimmers = `payload.areaRadius` REAL (fallback novo em
 *    `orbitOffset.ts`/já existente em `ParticleRenderer.ts`) — "circularem
 *    no range do tamanho da habilidade".
 * 2. Órbitas de `#ff5c5c`/`#ff9494` (vermelho) → `#f5f8ff`/`#eaf2ff`
 *    (branco/gelado, mesmo tom dos glimmers — "deixa as orbs brancas").
 * 3. `orbitBobEnabled:true` + `orbitBobHz` (novo em `orbitOffset.ts`) — bob
 *    vertical chão↔cabeça de volta (a versão DOM original tinha, tinha
 *    sido cortada de propósito na migração; "movimentação pra cima/pra
 *    baixo" pediu de volta).
 * 4. `trailNoiseAmt` (novo em `TrailRenderer.ts`) + gravação de história em
 *    intervalo FIXO (não mais 1 ponto por quadro renderizado, genérico pra
 *    QUALQUER skill com `trail`) — "trail mais uniforme, com ruído melhor".
 * 5. `skullScale` dobrado por tier — "aumenta o tamanho das 3 bolinhas em 2x".
 *
 * ## Rodada seguinte 2 (2 ajustes sobre a rodada acima)
 *
 * "raio pequeno ainda / tem que ser a mesma AoE" — a versão original desta
 * rodada tentou um fallback GENÉRICO em `orbitOffset.ts`/`ParticleRenderer.
 * ts` (`payload.orbitRadius ?? payload.areaRadius`). Bug real descoberto
 * depois (ver docblock de `orbitOffset.ts`): `payload.areaRadius` também é
 * carregado por skills SEM órbita nenhuma (Fire Ball, pro raio da fumaça) —
 * o fallback genérico deu à Fire Ball inteira um deslocamento lateral
 * constante (origem E destino do voo empurrados igual). Revertido nos dois
 * arquivos; aqui, `ORBIT_RADIUS` (abaixo) é EXPLÍCITO — não reusa o campo
 * `areaRadius` genérico do payload, cada skill com órbita cuida do próprio
 * raio. Valor real, não chutado: `skill_db.yml: MG_SIGHT.SplashArea:3`
 * (`MaxLevel:1`, nunca varia por nível) × `cellSize:2` (grade quadrada,
 * invariante do projeto) = 6.
 *
 * "deixa aleatório/diferente entre as 3 orbes, como decidem subir/descer" —
 * `SKULL_BOB` (abaixo) troca a frequência ÚNICA (`ORBIT_BOB_HZ`) por uma
 * `bobHz`/fase PRÓPRIA por caveira — antes as 3 eram a MESMA senoide só
 * defasada por `angle0Deg` (sobem/descem em "revezamento" mecânico,
 * sincronizadas pela mesma frequência); frequências diferentes fazem os 3
 * picos derivarem uns dos outros com o tempo, sem repetir um padrão óbvio.
 */

export type OracleGpuTier = "low" | "medium" | "high" | "ultra";

const ORBIT_SPEED_DEG_PER_SEC = 82;
/** raio real da AoE de MG_SIGHT — `SplashArea:3` (MaxLevel:1, constante) ×
 * `cellSize:2` (grade quadrada, sempre 2.0 no jogo real) = 6. EXPLÍCITO de
 * propósito (ver docblock do topo — nunca mais via fallback genérico de
 * `payload.areaRadius`, que outras skills usam pra outra coisa). */
const ORBIT_RADIUS = 6;
/** cada caveira com `bobHz`/fase PRÓPRIA (pedido "diferente entre as 3
 * orbes, como decidem subir/descer") — ver docblock do topo. `angle0Deg`
 * continua sendo o ângulo INICIAL da órbita horizontal (não muda). */
const SKULL_BOB = [
  { angle0Deg: 0, bobHz: 0.24, phaseOffsetDeg: 0 },
  { angle0Deg: 120, bobHz: 0.37, phaseOffsetDeg: 210 },
  { angle0Deg: 240, bobHz: 0.29, phaseOffsetDeg: 95 },
] as const;
/** branco (era `#ff5c5c`/`#ff9494` vermelho — pedido "deixa as orbs
 * brancas") — mesmo tom frio já usado pelos glimmers de área (`#eaf2ff`),
 * pra ficar coerente com a identidade "mística/gelada" que o resto da
 * composição já tinha, em vez de inventar um branco novo. */
const ORB_COLOR = "#f5f8ff";
const ORB_TRAIL_COLOR = "#eaf2ff";
const GLIMMER_COLOR = "#eaf2ff";
/** bob vertical (pedido "chão até a cabeça do personagem") — ver
 * `orbitOffset.ts: computeOrbitOffset` pro mecanismo (`orbitBobMaxY` já
 * usa a MESMA referência real de cabeça que `LightBoltImpact.tsx: HEAD_Y`,
 * escalada por `targetScale`). Frequência/fase por caveira em `SKULL_BOB`. */
/** ruído do rastro (pedido "ruído melhor") — pequeno o bastante pra
 * cintilar, nunca apagar/estourar o segmento (`opacity`/`scale` ficam
 * dentro de [1-amt, 1+amt] por design do helper). */
const TRAIL_NOISE_AMT = 0.18;

interface TierSpec {
  skullScale: number;
  trailLength: number; // 0 = sem camada de trail
  glimmerCount: number;
  glimmerScale: number;
}

// `skullScale` DOBRADO em relação ao original (pedido "aumenta o tamanho
// das 3 bolinhas em 2x") — `trailLength`/`glimmerCount`/`glimmerScale`
// intocados, tier continua controlando só CUSTO, não a identidade visual.
const TIER_SPECS: Record<OracleGpuTier, TierSpec> = {
  low: { skullScale: 0.7, trailLength: 0, glimmerCount: 12, glimmerScale: 0.1 },
  medium: { skullScale: 0.8, trailLength: 4, glimmerCount: 30, glimmerScale: 0.12 },
  high: { skullScale: 0.9, trailLength: 8, glimmerCount: 66, glimmerScale: 0.14 },
  ultra: { skullScale: 1.0, trailLength: 14, glimmerCount: 120, glimmerScale: 0.16 },
};

function buildOracleGpuLayers(tier: OracleGpuTier): VfxLayer[] {
  const spec = TIER_SPECS[tier];
  const layers: VfxLayer[] = [];

  for (const skull of SKULL_BOB) {
    layers.push({
      renderer: "sprite",
      scale: { base: spec.skullScale },
      params: {
        color: ORB_COLOR,
        opacity: 0.95,
        orbitRadius: ORBIT_RADIUS,
        orbitSpeedDegPerSec: ORBIT_SPEED_DEG_PER_SEC,
        orbitAngle0Deg: skull.angle0Deg,
        orbitBobEnabled: true,
        orbitBobHz: skull.bobHz,
        orbitBobPhaseOffsetDeg: skull.phaseOffsetDeg,
      },
    });
    if (spec.trailLength > 0) {
      layers.push({
        renderer: "trail",
        scale: { base: spec.skullScale * 0.6 },
        params: {
          color: ORB_TRAIL_COLOR,
          trailLength: spec.trailLength,
          trailNoiseAmt: TRAIL_NOISE_AMT,
          orbitRadius: ORBIT_RADIUS,
          orbitSpeedDegPerSec: ORBIT_SPEED_DEG_PER_SEC,
          orbitAngle0Deg: skull.angle0Deg,
          orbitBobEnabled: true,
          orbitBobHz: skull.bobHz,
          orbitBobPhaseOffsetDeg: skull.phaseOffsetDeg,
        },
      });
    }
  }

  layers.push({
    renderer: "particle",
    scale: { base: spec.glimmerScale },
    // `radius` explícito (mesmo `ORBIT_RADIUS`, não o fallback genérico de
    // `ParticleRenderer.ts` — mesmo motivo do `orbitRadius` acima).
    params: { particleCount: spec.glimmerCount, radius: ORBIT_RADIUS, color: GLIMMER_COLOR },
  });

  return layers;
}

export function oracleGpuDef(tier: OracleGpuTier): VfxDefinition {
  return {
    id: "oracle_buff",
    renderer: "sprite",
    anchor: "entity",
    layers: buildOracleGpuLayers(tier),
  };
}
