import type { VfxInstanceRuntime } from "../types";
import type { FlightOffset } from "./flightOffset";

const ZERO: FlightOffset = { x: 0, y: 0, z: 0 };

/**
 * Deslocamento local genérico de "órbita" (Fase 5, migração Oracle GPU) —
 * mesmo espírito de `flightOffset.ts`: qualquer skill/layer com
 * `payload.orbitRadius` numérico ganha um movimento circular ao redor da
 * âncora, sem `if <skill>` em renderer nenhum. Sem `orbitRadius`, devolve
 * zero (nunca muda comportamento de quem não pediu órbita).
 *
 * Simplificação deliberada em relação à órbita DOM original do Oráculo
 * (que também balançava em Y por skull, `bobPhase`/`Math.sin`): aqui a
 * altura é FIXA (`payload.orbitHeight`) — "reduzir detalhes secundários"
 * é uma escolha explícita desta rodada (leia1.txt: "aceito reduzir...
 * detalhes secundários"), não um esquecimento.
 */
export function computeOrbitOffset(instance: VfxInstanceRuntime, elapsedMs: number): FlightOffset {
  const payload = instance.spawnOptions.payload;
  const radius = payload?.orbitRadius;
  if (typeof radius !== "number") return ZERO;
  const speedDegPerSec = Number(payload?.orbitSpeedDegPerSec ?? 0);
  const angle0Deg = Number(payload?.orbitAngle0Deg ?? 0);
  const height = Number(payload?.orbitHeight ?? 0);
  const t = elapsedMs / 1000;
  const angleRad = ((angle0Deg + speedDegPerSec * t) * Math.PI) / 180;
  return { x: Math.cos(angleRad) * radius, y: height, z: Math.sin(angleRad) * radius };
}
