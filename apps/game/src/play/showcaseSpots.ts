import type { ParticleKind } from "../vfx/AmbientParticles";

/**
 * Pontos de partícula do mapa de showcase real (`gpqa01` — ver
 * `apps/api/src/scripts/build-showcase-map.ts`, que escreveu o resto do
 * conteúdo — árvores/lago/construção — direto no Supabase). Coordenadas
 * combinam com a "área de partículas" (célula 20,64 → mundo 40,128) que o
 * script deixou vazia de propósito.
 *
 * `scale: 4` — bem maior que o padrão de ambientação (`sceneTestMap.ts` usa
 * o preset puro, `scale` implícito 1): aqui o objetivo é o oposto de sutil —
 * "obviamente visível", pedido explícito do teste de showcase.
 */
export const SHOWCASE_MAP_ID = "gpqa01";

export const SHOWCASE_PARTICLE_SPOTS: { kind: ParticleKind; origin: [number, number, number]; count?: number; radius?: number; scale?: number }[] = [
  { kind: "ember", origin: [30, 1, 118], count: 50, radius: 2, scale: 4 },
  { kind: "spark", origin: [30, 1.5, 118], count: 35, radius: 1.5, scale: 4 },
  // varredura (sweep>0, ver AmbientParticles) precisa de área — raio bem
  // maior que os emissores locais acima, pra dar espaço da partícula
  // atravessar em vez de nascer já do outro lado da zona
  { kind: "dust", origin: [50, 1, 122], count: 60, radius: 16, scale: 3 },
  { kind: "snow", origin: [50, 4, 122], count: 60, radius: 16, scale: 3 },
  { kind: "magic", origin: [40, 2, 136], count: 30, radius: 3, scale: 4 },
  { kind: "mist", origin: [40, 0.8, 104], count: 25, radius: 4, scale: 4 },
];
