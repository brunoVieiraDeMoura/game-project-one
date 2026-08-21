import type { VfxInstanceRuntime, VfxWorldContext } from "../types";
import type { FlightOffset } from "./flightOffset";

const ZERO: FlightOffset = { x: 0, y: 0, z: 0 };

/**
 * Deslocamento local genérico de "órbita" (Fase 5, migração Oracle GPU) —
 * mesmo espírito de `flightOffset.ts`: qualquer skill/layer com
 * `payload.orbitRadius` numérico ganha um movimento circular ao redor da
 * âncora, sem `if <skill>` em renderer nenhum. Sem ele, devolve zero (nunca
 * muda comportamento de quem não pediu órbita).
 *
 * REVERTIDO (bug real, "Fire Ball saindo com origem E destino deslocados"):
 * uma rodada anterior tentou um fallback `?? payload.areaRadius` aqui (pro
 * Oráculo circular no raio real da AoE). `payload.areaRadius` NÃO é
 * exclusivo de skill com órbita — Fire Ball também carrega esse campo (pro
 * raio de espalhamento da fumaça, `SplashArea:2` real,
 * `migratedVfxBridge.ts`), e como o fallback rodava em QUALQUER camada
 * `sprite`/`trail` da instância (bola, glow, trail, não só a fumaça), a
 * Fire Ball inteira ganhou uma órbita de VELOCIDADE ZERO — ou seja, um
 * deslocamento lateral CONSTANTE (`speedDegPerSec` ausente = 0,
 * `Math.cos(0)*radius = radius` sempre) — a MESMA distância somada na
 * origem e no destino do voo, exatamente o sintoma relatado. `orbitRadius`
 * explícito nunca teve esse problema (só quem PEDE órbita de propósito
 * seta esse campo); Oracle agora tem seu próprio raio real explícito em
 * `oracleVfxDefGpu.tsx: ORBIT_RADIUS` (mesma AoE, sem reusar um campo
 * genérico compartilhado com outras skills).
 *
 * Altura: `payload.orbitHeight` continua fixa por padrão (simplificação
 * deliberada da órbita DOM original do Oráculo, que balançava em Y por
 * skull). `payload.orbitBobEnabled:true` liga essa oscilação de volta —
 * pedido "movimentação pra cima/pra baixo, do chão até a cabeça do
 * personagem": `orbitBobMinY`/`orbitBobMaxY` (default chão→cabeça real,
 * `HEAD_Y=1.7` = MESMA referência que `LightBoltImpact.tsx: HEAD_Y` já usa
 * pro alvo, escalado por `instance.targetScale`) senoidal em
 * `orbitBobHz` — fase default = o PRÓPRIO `angle0Deg` (cada órbita, ex. as
 * 3 caveiras do Oráculo, já tem um ângulo inicial diferente; reusar isso
 * como fase do bob desincroniza as 3 de graça, sem campo novo).
 */
export function computeOrbitOffset(instance: VfxInstanceRuntime, elapsedMs: number, world: VfxWorldContext): FlightOffset {
  void world;
  const payload = instance.spawnOptions.payload;
  const radius = payload?.orbitRadius;
  if (typeof radius !== "number") return ZERO;
  const speedDegPerSec = Number(payload?.orbitSpeedDegPerSec ?? 0);
  const angle0Deg = Number(payload?.orbitAngle0Deg ?? 0);
  const t = elapsedMs / 1000;
  const angleRad = ((angle0Deg + speedDegPerSec * t) * Math.PI) / 180;

  let height: number;
  if (payload?.orbitBobEnabled === true) {
    const bobHz = Number(payload?.orbitBobHz ?? 0.35);
    const minY = Number(payload?.orbitBobMinY ?? 0);
    const maxY = Number(payload?.orbitBobMaxY ?? 1.7) * instance.targetScale;
    const phaseDeg = Number(payload?.orbitBobPhaseOffsetDeg ?? angle0Deg);
    const u = (Math.sin(t * Math.PI * 2 * bobHz + (phaseDeg * Math.PI) / 180) + 1) / 2;
    height = minY + (maxY - minY) * u;
  } else {
    height = Number(payload?.orbitHeight ?? 0);
  }

  return { x: Math.cos(angleRad) * radius, y: height, z: Math.sin(angleRad) * radius };
}
