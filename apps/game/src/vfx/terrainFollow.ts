import type { TerrainQuery } from "@ragnarok/engine-core";

/**
 * Correção de altura pra um ponto DENTRO de um VFX largo (buff de área,
 * estouro decorativo espalhado) — usado por quem tem partículas/pontos
 * deslocados do centro (`vfx/mage/oracle/OracleBuff`,
 * `vfx/mage/thunder-storm/ThunderStormImpact`, `vfx/mage/fire-ball/FireBallImpact`).
 *
 * O grupo pai (`vfx/SkillVfx.tsx: VfxNode`) já posiciona o EFEITO INTEIRO na
 * altura real do chão sob o caster/alvo (`cellToWorld` → `terrain.getHeight`,
 * recalculado todo quadro). O que faltava: um filho a `localX,localZ` células
 * de distância do centro (a órbita do Oráculo tem raio até 3 células; os
 * estouros decorativos da Fire Ball/Thunder Storm até ~2,6) herdava a MESMA
 * altura do centro — em ladeira/borda de montanha isso faz a partícula flutuar
 * ou atravessar o relevo. Consultar o terreno DE NOVO na posição real de cada
 * filho corrige sem inventar altura nenhuma nem levantar o efeito inteiro.
 *
 * `localX/localZ` em CÉLULAS (mesma unidade que os componentes já usam pros
 * offsets — o grupo pai escala por `cellSize`, é essa escala que este helper
 * replica pra achar a coordenada de mundo a consultar). O retorno já é a
 * correção pronta pra SOMAR na posição Y local existente do filho (preserva
 * qualquer "flutuar"/bob que o componente já desenhava sobre terreno plano —
 * em terreno plano o delta é 0, comportamento igual a antes).
 */
export function terrainFollowDeltaY(
  terrain: TerrainQuery,
  cellSize: number,
  anchor: { x: number; y: number; z: number },
  localX: number,
  localZ: number,
): number {
  const worldX = anchor.x + localX * cellSize;
  const worldZ = anchor.z + localZ * cellSize;
  const groundY = terrain.getHeight(worldX, worldZ);
  return (groundY - anchor.y) / cellSize;
}
