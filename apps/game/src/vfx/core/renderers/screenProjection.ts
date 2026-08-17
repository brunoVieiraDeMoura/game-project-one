import * as THREE from "three";

/**
 * Projeção mundo→tela compartilhada — MESMA fórmula que `drei`'s `<Html
 * distanceFactor={9} transform={false}>` já usava (`Object3D.project`,
 * escala por FOV/distância), extraída de `DomRenderer.ts` pra também ficar
 * disponível pra ARTES com sub-elementos em posições 3D PRÓPRIAS (ex.:
 * Fire Ball — bola + ecos + estouros decorativos, cada um em um ponto
 * diferente do espaço, dentro da MESMA instância de VFX).
 *
 * `DomRenderer` usa isto pra posicionar o wrapper de CADA instância; uma
 * arte com múltiplos pontos usa a MESMA função pros seus próprios
 * sub-elementos — nunca uma segunda fórmula de projeção no projeto.
 */
export const DISTANCE_FACTOR = 9;

export interface ScreenPoint {
  x: number;
  y: number;
  scale: number;
}

const projVec = new THREE.Vector3();
const worldVec = new THREE.Vector3();
const camPosVec = new THREE.Vector3();

export function projectWorldToScreen(
  camera: THREE.Camera,
  viewportWidth: number,
  viewportHeight: number,
  worldPos: { x: number; y: number; z: number },
): ScreenPoint {
  worldVec.set(worldPos.x, worldPos.y, worldPos.z);
  projVec.copy(worldVec).project(camera);
  const x = (projVec.x * viewportWidth) / 2 + viewportWidth / 2;
  const y = -(projVec.y * viewportHeight) / 2 + viewportHeight / 2;

  let scale = 1;
  if (camera instanceof THREE.PerspectiveCamera) {
    camPosVec.setFromMatrixPosition(camera.matrixWorld);
    const dist = worldVec.distanceTo(camPosVec);
    const vFov = (camera.fov * Math.PI) / 180;
    const scaleFov = 2 * Math.tan(vFov / 2) * dist;
    scale = (1 / scaleFov) * DISTANCE_FACTOR;
  }
  return { x, y, scale };
}
