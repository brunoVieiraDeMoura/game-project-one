import type { VfxDefinition, VfxLayer } from "../../core/types";

/**
 * Cúpula Sagrada (MG_SAFETYWALL) em GPU — reconstrução visual 2026-08-19-x,
 * a partir da referência `C:\Users\Bruno\Desktop\ref\cupula-sagrada.jpg`:
 * gaiola de cristal (diamante/octaedro de arestas) envolvendo o personagem,
 * com uma faixa de brilho na base. Substitui a composição anterior (anel de
 * borda + 3 fantasmas orbitando + poeira) — nenhum billboard consegue
 * formar uma aresta reta vista de lado, só uma geometria 3D real; ver
 * `renderer:"cage"` (`core/renderers/CageRenderer.ts`, NOVO nesta rodada)
 * pro raciocínio completo de por que precisou de um 6º renderer.
 *
 * `ghostDomeVfxDef.tsx` (DOM real) INTOCADA; toggle troca a MESMA
 * `VfxDefinition` id "ghost_dome" (mesma técnica de Fire Ball/Oracle/Fire
 * Wall/Thunder Storm) — o nome do arquivo/id ficou de antes (Cúpula
 * Fantasma), a identidade visual agora É a Cúpula Sagrada; renomear
 * arquivo/id é troca cosmética sem valor pra este pedido, não feita.
 *
 * ## Personagem visível DENTRO, nunca coberto
 *
 * A gaiola (`renderer:"cage"`) respeita profundidade normal — diferente do
 * `ring` antigo, que desligava `depthTest` de propósito (decal de chão).
 * Arestas finas (`LineSegments`) cruzam o personagem sem cobri-lo; o vidro
 * translúcido usa `side:"BackSide"` internamente (só a face LONGE da
 * câmera desenha) — o lado entre a câmera e o personagem nunca existe como
 * triângulo, não tem o que ocultar. Ver docblock completo em
 * `CageRenderer.ts`.
 *
 * SEM camada `dom`: área de buff sem dano, sem número nenhum a mostrar
 * (igual antes).
 *
 * ## Rodada 2026-08-19-y (4 ajustes sobre a reconstrução acima)
 *
 * 1. Célula central brilhando branco — `renderer:"ring"` novo, `mode:
 *    "disc"`, cor branca, RAIO pequeno (não é a área real da skill, só um
 *    brilho decorativo no centro — MG_SAFETYWALL sem AoE de verdade aqui).
 * 2. Faíscas ESPALHADAS por dentro do prisma, não só no pé — `particle`
 *    ganhou `heightMin/heightMax` (`ParticleRenderer.ts`, novo), contagem
 *    subiu de 8 pra 24.
 * 3. Rotação horizontal lenta — `payload.rotateSpeedDegPerSec` (novo em
 *    `CageRenderer.ts`), explícito aqui embora bata com o default (deixa a
 *    intenção clara nesta definição, não escondida atrás de um valor
 *    genérico do renderer).
 * 4. `heightOffset` do disco central alto o bastante pra nunca afundar em
 *    relevo de terreno irregular (`RingRenderer.ts`, novo — era só
 *    `HEIGHT_OFFSET=0.05` fixo, pensado pra decal raso tipo Fire Wall).
 */

const EDGE_COLOR = "#ffffff";
const FILL_COLOR = "#dce8ff";
const BAND_COLOR = "#ffe9a8";
const CENTER_GLOW_COLOR = "#ffffff";
/** faíscas espalhadas por dentro do prisma — toque "sagrado" sutil, nunca
 * o elemento principal (identidade é a gaiola, não a partícula). */
const SPARK_COLOR = "#fff6d8";
const SPARK_COUNT = 24;
const CAGE_HEIGHT = 2.3;

function buildGhostDomeGpuLayers(): VfxLayer[] {
  return [
    {
      renderer: "cage",
      params: {
        radius: 1.15,
        height: CAGE_HEIGHT,
        edgeColor: EDGE_COLOR,
        fillColor: FILL_COLOR,
        fillOpacity: 0.08,
        bandColor: BAND_COLOR,
        bandOpacity: 0.6,
        rotateSpeedDegPerSec: 15,
      },
    },
    {
      renderer: "particle",
      scale: { base: 0.1 },
      params: {
        particleCount: SPARK_COUNT,
        radius: 0.4,
        color: SPARK_COLOR,
        // dentro do volume do prisma (0.2 acima do chão até perto do topo,
        // com folga das duas pontas pra não furar a silhueta afunilada).
        heightMin: 0.2,
        heightMax: CAGE_HEIGHT * 0.78,
      },
    },
    {
      renderer: "ring",
      params: { radius: 0.5, mode: "disc", color: CENTER_GLOW_COLOR, heightOffset: 0.5 },
    },
  ];
}

export const GHOST_DOME_GPU_DEF: VfxDefinition = {
  id: "ghost_dome",
  renderer: "cage",
  anchor: "cell",
  layers: buildGhostDomeGpuLayers(),
};
