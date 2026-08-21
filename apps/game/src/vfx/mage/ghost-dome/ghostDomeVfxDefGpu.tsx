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
 *
 * ## Rodada 2026-08-19-ze — 3 prismas orbitando na altura do peito
 *
 * A gaiola ÚNICA que envolvia o personagem de pé virou 3 gaiolas PEQUENAS
 * (metade do tamanho da rodada anterior, que já era metade da original —
 * `CAGE_RADIUS`/`CAGE_HEIGHT` acumulam os dois cortes de 50%) circulando
 * ao redor da célula central branca, na altura do peito. `CageRenderer.ts`
 * ganhou `payload.orbitRadius/orbitSpeedDegPerSec/orbitAngle0Deg/
 * orbitHeight` — MESMO `orbitOffset.ts` que Oracle e os fantasmas orbitando
 * de antes da Cúpula Sagrada já usavam, nunca um mecanismo novo — e passou
 * a recalcular posição TODO quadro (antes só a rotação animava). Sem
 * `orbitRadius`, o comportamento é idêntico ao de sempre (gaiola parada,
 * ancorada no chão) — nenhuma skill que já usava `renderer:"cage"` muda.
 */

const EDGE_COLOR = "#ffffff";
const FILL_COLOR = "#dce8ff";
const BAND_COLOR = "#ffe9a8";
const CENTER_GLOW_COLOR = "#ffffff";
/** faíscas espalhadas por dentro do prisma — toque "sagrado" sutil, nunca
 * o elemento principal (identidade é a gaiola, não a partícula). */
const SPARK_COLOR = "#fff6d8";
const SPARK_COUNT = 24;
// 2026-08-19-zc: "diminui 50% do tamanho do prisma" — eram 1.15/2.3.
// 2026-08-19-ze: "diminui em 50% novamente" — eram 0.575/1.15.
const CAGE_RADIUS = 0.2875;
const CAGE_HEIGHT = 0.575;
/** raio da órbita (célula) e altura (mundo, peito) — 2026-08-19-ze: "3
 * prismas voando e girando ao entorno da célula principal branca, na
 * altura do peito". `orbitOffset.ts` (já usado por Oracle/os fantasmas
 * antigos) faz o trabalho — `CageRenderer.ts` só precisou aprender a ler
 * `payload.orbitRadius` em vez de ancorar a ponta de baixo no chão. */
// 2026-08-19-zf: "aumenta o espaçamento entre os triângulos" — era 0.8.
const ORBIT_RADIUS = 1.15;
const ORBIT_HEIGHT = 1.0;
const ORBIT_SPEED_DEG_PER_SEC = 40;
const ORBIT_ANGLES_DEG = [0, 120, 240] as const;

function buildOrbitingCageLayers(): VfxLayer[] {
  return ORBIT_ANGLES_DEG.map((angle0Deg) => ({
    renderer: "cage",
    params: {
      radius: CAGE_RADIUS,
      height: CAGE_HEIGHT,
      edgeColor: EDGE_COLOR,
      fillColor: FILL_COLOR,
      fillOpacity: 0.08,
      // 2026-08-19-zi: "remove o mini-círculo dentro de cada prisma" —
      // `bandOpacity:0` apaga a faixa (torus) sem tocar `CageRenderer.ts`,
      // única skill usando `renderer:"cage"` hoje.
      bandColor: BAND_COLOR,
      bandOpacity: 0,
      rotateSpeedDegPerSec: 15,
      orbitRadius: ORBIT_RADIUS,
      orbitSpeedDegPerSec: ORBIT_SPEED_DEG_PER_SEC,
      orbitAngle0Deg: angle0Deg,
      orbitHeight: ORBIT_HEIGHT,
    },
  }));
}

function buildGhostDomeGpuLayers(): VfxLayer[] {
  return [
    ...buildOrbitingCageLayers(),
    {
      renderer: "particle",
      scale: { base: 0.1 },
      params: {
        particleCount: SPARK_COUNT,
        radius: 0.2, // acompanha o raio menor do prisma (era 0.4 pro 1.15 antigo)
        color: SPARK_COLOR,
        // dentro do volume do prisma (acima do chão até perto do topo, com
        // folga das duas pontas pra não furar a silhueta afunilada) —
        // `heightMin` acompanha a proporção antiga (0.2/2.3), `heightMax`
        // já é fração de `CAGE_HEIGHT`, acompanha o prisma sozinho.
        heightMin: 0.1,
        heightMax: CAGE_HEIGHT * 0.78,
      },
    },
    {
      // 2026-08-19-zd: "deixa o chão da célula branco também, pra destacar
      // o local da skill" — raio 1 cobria o TILE inteiro (era 0.5, um brilho
      // decorativo pequeno no centro), o chão da célula inteira acendeu.
      // 2026-08-19-zf: "diminui um pouco o círculo do chão" — 0.7.
      // 2026-08-19-zg: "bota um pouco mais pra baixo" — heightOffset 0.5→0.2
      // (ainda acima do suficiente pra não afundar em relevo irregular).
      // 2026-08-19-zh: "personagem na layer acima desse círculo" —
      // `depthTest:true` (novo em `RingRenderer.ts`): sem isto o decal
      // sempre pintava por cima dos pés/pernas do personagem, não importa
      // a profundidade real (comportamento padrão de decal, pensado pra
      // atravessar relevo — errado pra um brilho perto de alguém de pé).
      renderer: "ring",
      params: { radius: 0.7, mode: "disc", color: CENTER_GLOW_COLOR, heightOffset: 0.2, depthTest: true },
    },
  ];
}

export const GHOST_DOME_GPU_DEF: VfxDefinition = {
  id: "ghost_dome",
  renderer: "cage",
  anchor: "cell",
  layers: buildGhostDomeGpuLayers(),
};
