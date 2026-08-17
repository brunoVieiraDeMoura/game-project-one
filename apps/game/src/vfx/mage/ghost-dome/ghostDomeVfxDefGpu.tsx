import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Cúpula Fantasma (MG_SAFETYWALL) em GPU — skill fora da lista original
 * de 5, migrada na mesma varredura por já estar no Core (`ghostDomeVfxDef.
 * tsx`, Fase 3) e ter blur real em 2 elementos (`.gd-wisp::before`,
 * `.gd-ghost__glow`) — mesmo padrão de custo já resolvido nas outras
 * skills, só em escala menor. `ghostDomeVfxDef.tsx` (DOM real) INTOCADA;
 * toggle troca a MESMA `VfxDefinition` id "ghost_dome" (mesma técnica de
 * Fire Ball/Oracle/Fire Wall/Thunder Storm).
 *
 * Composição (identidade essencial: cúpula translúcida + fantasmas
 * orbitando + poeira subindo):
 *   - 1× `ring` — borda da cúpula (`mode` default "borda de célula", NÃO
 *     disc — geometricamente já é a MESMA forma de `.gd-border`, um
 *     contorno, não um disco preenchido; por ser um CONTORNO fino, não
 *     compete em área com os sprites orbitando, evitando o risco de
 *     ordem-de-desenho já documentado em Fire Wall);
 *   - 3× `sprite` — fantasmas orbitando (mesma órbita genérica de
 *     Oracle, `orbitRadius/orbitSpeedDegPerSec/orbitAngle0Deg`);
 *   - 1× `particle` — poeira/wisps subindo, contagem fixa baixa.
 *
 * SEM camada `dom`: área de buff sem dano, sem número nenhum a mostrar.
 */

const DOME_COLOR = "#ffffff";
const GHOST_COLOR = "#f2f2f8";
const WISP_COLOR = "#ffffff";
const ORBIT_RADIUS = 0.32;
const ORBIT_SPEED_DEG_PER_SEC = 40;
const GHOST_ANGLES = [0, 120, 240] as const;

function buildGhostDomeGpuLayers(): VfxLayer[] {
  const layers: VfxLayer[] = [
    {
      renderer: "ring",
      params: { radius: 0.55, mode: "border", color: DOME_COLOR },
    },
  ];
  for (const angle0 of GHOST_ANGLES) {
    layers.push({
      renderer: "sprite",
      scale: { base: 0.45 },
      params: {
        color: GHOST_COLOR,
        opacity: 0.85,
        orbitRadius: ORBIT_RADIUS,
        orbitSpeedDegPerSec: ORBIT_SPEED_DEG_PER_SEC,
        orbitAngle0Deg: angle0,
        orbitHeight: 0.25,
      },
    });
  }
  layers.push({
    renderer: "particle",
    scale: { base: 0.16 },
    params: { particleCount: 10, radius: 0.25, color: WISP_COLOR },
  });
  return layers;
}

export const GHOST_DOME_GPU_DEF: VfxDefinition = {
  id: "ghost_dome",
  renderer: "sprite",
  anchor: "cell",
  layers: buildGhostDomeGpuLayers(),
};
